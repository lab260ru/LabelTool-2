"""Tests for public annotator self-registration (POST /api/auth/register).

'User registration' contract item 1: public endpoint (no auth required),
creates a user with role='user' and permissions={} (all types allowed), auto-login
(session cookie like /auth/login), 201 + full User (shape of /auth/me, without
password_hash). Validation with machine-readable codes:
fio_required / bad_login / login_taken / password_too_short.
"""

import pytest
from sqlalchemy import select

from src.auth import verify_password
from src.models import User
from tests.conftest import login_as

USER_SHAPE = {"id", "fio", "login", "role", "can_add_admins", "group", "metrics", "permissions"}
ALL_TASK_TYPES = {
    "transcription", "verification", "classification",
    "segmentation", "diarization", "mos", "sbs",
}

# Valid registration body; individual fields are overridden in tests.
VALID = {"fio": "Петров Пётр Петрович", "login": "petrov", "password": "Secret123", "group": "БВТ2101"}


# ---------------------------------------------------------------------------
# Success + auto-login
# ---------------------------------------------------------------------------


def test_register_public_no_auth_required(client):
    # public endpoint: without a prior session → 201
    resp = client.post("/api/auth/register", json=VALID)
    assert resp.status_code == 201, resp.text


def test_register_success_shape(client):
    body = client.post("/api/auth/register", json=VALID).json()
    # response shape 1:1 with types.ts User (like /auth/me), without password_hash
    assert set(body) == USER_SHAPE
    assert "password_hash" not in body
    assert body["role"] == "user"
    assert body["can_add_admins"] is False
    assert body["login"] == "petrov"
    assert body["fio"] == "Петров Пётр Петрович"
    assert body["group"] == "БВТ2101"
    # permissions={} is expanded by the serializer into the full matrix = all allowed
    assert set(body["permissions"]) == ALL_TASK_TYPES
    assert set(body["permissions"].values()) == {"user_allow"}
    assert body["metrics"]["tasks_done"] == 0


def test_register_autologin(client):
    # auto-login: session cookie is set, /auth/me returns the new user
    reg = client.post("/api/auth/register", json=VALID)
    assert reg.status_code == 201
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["login"] == "petrov"
    assert me.json()["role"] == "user"
    assert me.json()["id"] == reg.json()["id"]


def test_registered_user_is_not_admin(client):
    # self-registration grants only the annotator role: admin endpoints are forbidden
    assert client.post("/api/auth/register", json=VALID).status_code == 201
    assert client.get("/api/users").status_code == 403
    assert client.get("/api/dashboard").status_code == 403


# ---------------------------------------------------------------------------
# Password is actually hashed
# ---------------------------------------------------------------------------


def test_register_password_relogin_works(client):
    # password is stored so that logging in again with the same password works
    assert client.post("/api/auth/register", json=VALID).status_code == 201
    assert client.post("/api/auth/logout").status_code == 200
    login_as(client, "petrov", "Secret123")
    assert client.get("/api/auth/me").json()["login"] == "petrov"
    # wrong password is rejected
    bad = client.post("/api/auth/login", json={"login": "petrov", "password": "Secret123x"})
    assert bad.status_code == 401


def test_register_password_stored_as_hash(client, db_session):
    # the DB holds a bcrypt hash, not the plaintext password
    assert client.post("/api/auth/register", json=VALID).status_code == 201
    db_session.expire_all()
    user = db_session.execute(select(User).where(User.login == "petrov")).scalar_one()
    assert user.password_hash != "Secret123"
    assert verify_password("Secret123", user.password_hash)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_register_login_taken(client, super_admin):
    # super_admin has login 'admin' → re-registration 409
    resp = client.post("/api/auth/register", json={**VALID, "login": "admin"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "login_taken"


def test_register_login_taken_after_self_register(client):
    assert client.post("/api/auth/register", json=VALID).status_code == 201
    dup = client.post("/api/auth/register", json={**VALID, "fio": "Другой"})
    assert dup.status_code == 409
    assert dup.json()["detail"] == "login_taken"


@pytest.mark.parametrize("login", ["ab", "a", "", "   ", "юзер", "bad!", "he@llo", "with space"])
def test_register_bad_login(client, login):
    resp = client.post("/api/auth/register", json={**VALID, "login": login})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "bad_login"


@pytest.mark.parametrize("login", ["abc", "a.b_c-1", "user123", "PetroV"])
def test_register_valid_login_accepted(client, login):
    resp = client.post("/api/auth/register", json={**VALID, "login": login})
    assert resp.status_code == 201, resp.text
    assert resp.json()["login"] == login


@pytest.mark.parametrize("password", ["", "short", "1234567"])
def test_register_password_too_short(client, password):
    resp = client.post("/api/auth/register", json={**VALID, "password": password})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "password_too_short"


def test_register_password_min_length_ok(client):
    resp = client.post("/api/auth/register", json={**VALID, "login": "eightpw", "password": "12345678"})
    assert resp.status_code == 201


@pytest.mark.parametrize("fio", ["", "   ", "\t\n"])
def test_register_fio_required(client, fio):
    resp = client.post("/api/auth/register", json={**VALID, "fio": fio})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "fio_required"


def test_register_validation_order_fio_first(client):
    # with multiple violations fio_required takes priority (contract order)
    resp = client.post("/api/auth/register", json={"fio": "", "login": "ab", "password": "x"})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "fio_required"


def test_register_fio_and_group_trimmed(client):
    resp = client.post(
        "/api/auth/register",
        json={"fio": "  Иван  ", "login": "ivantrim", "password": "Secret123", "group": "  ГР-1  "},
    )
    assert resp.status_code == 201
    assert resp.json()["fio"] == "Иван"
    assert resp.json()["group"] == "ГР-1"


# ---------------------------------------------------------------------------
# group is optional
# ---------------------------------------------------------------------------


def test_register_group_omitted_is_null(client):
    resp = client.post(
        "/api/auth/register",
        json={"fio": "Без Группы", "login": "nogroup", "password": "Secret123"},
    )
    assert resp.status_code == 201
    assert resp.json()["group"] is None


@pytest.mark.parametrize("group", ["", "   ", None])
def test_register_group_empty_is_null(client, group):
    resp = client.post(
        "/api/auth/register",
        json={"fio": "Пустая Группа", "login": "emptygrp", "password": "Secret123", "group": group},
    )
    assert resp.status_code == 201
    assert resp.json()["group"] is None

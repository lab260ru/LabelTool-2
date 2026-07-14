"""Smoke tests: health, auth, roles, availability of the main endpoints."""

from tests.conftest import ADMIN_PASSWORD, USER_PASSWORD, login_as


# --- health -----------------------------------------------------------------


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# --- auth: login / logout / me ------------------------------------------------


def test_me_unauthorized(client):
    assert client.get("/api/auth/me").status_code == 401


def test_login_wrong_password(client, regular_user):
    resp = client.post(
        "/api/auth/login", json={"login": regular_user.login, "password": "wrong"}
    )
    assert resp.status_code == 401


def test_login_unknown_user(client):
    resp = client.post("/api/auth/login", json={"login": "ghost", "password": "x"})
    assert resp.status_code == 401


def test_login_me_logout_flow(client, regular_user):
    resp = client.post(
        "/api/auth/login",
        json={"login": regular_user.login, "password": USER_PASSWORD},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["login"] == regular_user.login
    assert body["role"] == "user"
    assert "password_hash" not in body

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["fio"] == "Иволгина Мария Андреевна"
    # types.ts User contract: the field is called group (model group_name),
    # plus metrics and the full permissions matrix
    assert me.json()["group"] == "БВТ2101"
    assert me.json()["metrics"]["tasks_done"] == 0
    # 7 task types, including MOS rating and Side-by-Side
    assert set(me.json()["permissions"]) == {
        "transcription", "verification", "classification", "segmentation",
        "diarization", "mos", "sbs",
    }

    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_session_cookie_tamper(client, regular_user):
    login_as(client, regular_user.login, USER_PASSWORD)
    client.cookies.set("lt2_session", "forged-token")
    assert client.get("/api/auth/me").status_code == 401


# --- roles --------------------------------------------------------------------


def test_admin_route_requires_auth(client):
    assert client.get("/api/users").status_code == 401


def test_user_cannot_access_admin_route(user_client):
    # a regular user cannot reach an admin endpoint
    assert user_client.get("/api/users").status_code == 403
    assert user_client.get("/api/dashboard").status_code == 403


def test_admin_accesses_admin_route(admin_client):
    assert admin_client.get("/api/users").status_code == 200


def test_plain_admin_cannot_access_super_admin_route(admin_client):
    assert admin_client.get("/api/admins").status_code == 403


def test_super_admin_accesses_super_admin_route(super_admin_client):
    assert super_admin_client.get("/api/admins").status_code == 200


# --- Main endpoints available (guard passed, not 404) --------------------------------


def test_task_random_available(user_client):
    # empty DB: endpoint is live, responds with contract 404 no_tasks_available
    resp = user_client.get("/api/task/random")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "no_tasks_available"


def test_file_batch_route_replaced_legacy(admin_client):
    # the old POST /api/file/upload is replaced by batch endpoints
    assert admin_client.post("/api/file/upload").status_code == 404


def test_export_routes_available(admin_client):
    # nonexistent project → contract 404
    resp = admin_client.post(
        "/api/project/999/export", json={"format": "jsonl", "scope": "consensus"}
    )
    assert resp.status_code == 404

    assert admin_client.get("/api/project/999/exports").status_code == 404


def test_project_fragments_available(admin_client):
    assert admin_client.get("/api/project/999/fragments").status_code == 404


def test_instruction_readable_by_user(user_client):
    # annotator guard passed, nonexistent project → 404
    assert user_client.get("/api/project/999/instruction").status_code == 404


def test_export_format_validation(admin_client):
    # invalid format is rejected by the pydantic schema
    resp = admin_client.post("/api/project/1/export", json={"format": "xml"})
    assert resp.status_code == 422


# --- media (LocalStorage) -------------------------------------------------------


def test_media_not_found(client):
    assert client.get("/api/media/audio/nope.wav").status_code == 404


def test_media_serves_local_file(client):
    from src.storage import get_storage

    storage = get_storage()
    storage.put("audio/demo.wav", b"RIFF-demo-bytes")
    url = storage.presigned_url("audio/demo.wav")
    assert url == "/api/media/audio/demo.wav"

    resp = client.get(url)
    assert resp.status_code == 200
    assert resp.content == b"RIFF-demo-bytes"

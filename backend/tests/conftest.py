"""Shared pytest fixtures: temporary sqlite DB, TestClient, users.

Feature tests live in tests/test_<f>.py and reuse these fixtures.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.auth import hash_password
from src.db import Base, get_db
from src.main import app
from src.models import User, UserRole


@pytest.fixture()
def engine(tmp_path):
    """Fresh sqlite DB per test (file in a temporary folder)."""
    eng = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def db_session(engine):
    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = TestSession()
    yield session
    session.close()


@pytest.fixture()
def client(engine, db_session, tmp_path, monkeypatch):
    """TestClient with get_db overridden and local storage in a temporary folder."""
    from src.config import settings
    from src.storage import get_storage

    monkeypatch.setattr(settings, "LOCAL_STORAGE_DIR", str(tmp_path / "storage"))
    monkeypatch.setattr(settings, "STORAGE_BACKEND", "local")
    get_storage.cache_clear()

    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    get_storage.cache_clear()


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

SUPER_ADMIN_PASSWORD = "Admin12345"
ADMIN_PASSWORD = "Admin12345"
USER_PASSWORD = "User12345"


def _make_user(db, login: str, password: str, role: UserRole, **kw) -> User:
    user = User(
        login=login,
        password_hash=hash_password(password),
        fio=kw.pop("fio", login.title()),
        role=role,
        **kw,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def super_admin(db_session) -> User:
    return _make_user(
        db_session, "admin", SUPER_ADMIN_PASSWORD, UserRole.admin,
        fio="Соколов Дмитрий Александрович", can_add_admins=True,
    )


@pytest.fixture()
def admin_user(db_session) -> User:
    return _make_user(
        db_session, "akim", ADMIN_PASSWORD, UserRole.admin,
        fio="Ким Анна Владимировна", can_add_admins=False,
    )


@pytest.fixture()
def regular_user(db_session) -> User:
    return _make_user(
        db_session, "ivolgina", USER_PASSWORD, UserRole.user,
        fio="Иволгина Мария Андреевна", group_name="БВТ2101",
        permissions={"transcription": "user_allow"},
    )


def login_as(client: TestClient, login: str, password: str) -> None:
    resp = client.post("/api/auth/login", json={"login": login, "password": password})
    assert resp.status_code == 200, resp.text


@pytest.fixture()
def user_client(client, regular_user) -> TestClient:
    login_as(client, regular_user.login, USER_PASSWORD)
    return client


@pytest.fixture()
def admin_client(client, admin_user) -> TestClient:
    login_as(client, admin_user.login, ADMIN_PASSWORD)
    return client


@pytest.fixture()
def super_admin_client(client, super_admin) -> TestClient:
    login_as(client, super_admin.login, SUPER_ADMIN_PASSWORD)
    return client

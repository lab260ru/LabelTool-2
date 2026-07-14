"""Tests for users and admins: table with metrics and filters,
create/invite/bulk, permissions matrix (admin_* — super-admin only), passwords,
granting/revoking admin, protection of the last super-admin. Response shapes —
src/api/types.ts (User, Paginated, InviteUsersResult)."""

import uuid
from datetime import timedelta

from src.auth import hash_password
from src.models import (
    AudioFragment,
    Project,
    Task,
    TaskStatus,
    User,
    UserRole,
    utcnow,
)
from src.models import TaskType as TT
from tests.conftest import (
    ADMIN_PASSWORD,
    SUPER_ADMIN_PASSWORD,
    USER_PASSWORD,
    login_as,
)

USER_SHAPE = {"id", "fio", "login", "role", "can_add_admins", "group", "metrics", "permissions"}
METRICS_SHAPE = {"tasks_done", "tasks_skipped", "avg_task_sec", "agreement_pct", "last_active_at"}
ALL_TASK_TYPES = {t.value for t in TT}


def make_user(db, login, role=UserRole.user, group=None, fio=None, **kw) -> User:
    user = User(
        login=login,
        password_hash=hash_password(USER_PASSWORD),
        fio=fio or login.title(),
        role=role,
        group_name=group,
        **kw,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def seed_done_tasks(db, user, count=2, task_sec=60) -> None:
    project = Project(name=f"P-{uuid.uuid4().hex[:6]}", label_list=[])
    db.add(project)
    db.commit()
    base = utcnow()
    for i in range(count):
        fragment = AudioFragment(
            project_id=project.id,
            filename=f"{uuid.uuid4().hex}.wav",
            s3_key=uuid.uuid4().hex,
            task_type=TT.transcription,
        )
        db.add(fragment)
        db.commit()
        db.add(
            Task(
                fragment_id=fragment.id,
                user_id=user.id,
                status=TaskStatus.done,
                started_at=base - timedelta(seconds=task_sec, minutes=i),
                finished_at=base - timedelta(minutes=i),
                result={"text": "x"},
            )
        )
    db.commit()


# ---------------------------------------------------------------------------
# GET /users — table
# ---------------------------------------------------------------------------


def test_users_requires_auth(client):
    assert client.get("/api/users").status_code == 401


def test_users_requires_admin(user_client):
    assert user_client.get("/api/users").status_code == 403


def test_list_users_shape_and_metrics(super_admin_client, regular_user, db_session):
    seed_done_tasks(db_session, regular_user, count=2, task_sec=60)

    resp = super_admin_client.get("/api/users")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"items", "total", "offset", "limit"}
    assert body["total"] == 2  # super-admin + annotator

    item = next(u for u in body["items"] if u["login"] == regular_user.login)
    assert set(item) == USER_SHAPE
    assert item["group"] == "БВТ2101"
    assert item["role"] == "user"
    assert item["can_add_admins"] is False

    # Full permissions matrix: explicit cell + default values
    assert set(item["permissions"]) == ALL_TASK_TYPES
    assert item["permissions"]["transcription"] == "user_allow"
    assert item["permissions"]["diarization"] == "user_allow"

    # Metrics from submitted tasks
    assert set(item["metrics"]) == METRICS_SHAPE
    assert item["metrics"]["tasks_done"] == 2
    assert item["metrics"]["avg_task_sec"] == 60.0
    assert item["metrics"]["last_active_at"] is not None


def test_list_users_filters_and_pagination(super_admin_client, db_session):
    make_user(db_session, "stud1", group="БВТ2101")
    make_user(db_session, "stud2", group="БВТ2102")
    make_user(db_session, "helper", role=UserRole.admin, fio="Помощник Админ")

    by_group = super_admin_client.get("/api/users?group=БВТ2102").json()
    assert [u["login"] for u in by_group["items"]] == ["stud2"]

    by_role = super_admin_client.get("/api/users?role=admin").json()
    assert {u["login"] for u in by_role["items"]} == {"admin", "helper"}

    by_search = super_admin_client.get("/api/users?search=stud").json()
    assert {u["login"] for u in by_search["items"]} == {"stud1", "stud2"}

    page = super_admin_client.get("/api/users?offset=1&limit=2").json()
    assert page["offset"] == 1
    assert page["limit"] == 2
    assert len(page["items"]) == 2
    assert page["total"] == 4


# ---------------------------------------------------------------------------
# POST /users, /users/invite, /users/bulk
# ---------------------------------------------------------------------------


def test_create_user(admin_client, db_session):
    resp = admin_client.post(
        "/api/users",
        json={"fio": "Тестов Тест", "login": "test1", "password": "Passw0rd123",
              "group": "БВТ2103"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert set(body) == USER_SHAPE
    assert body["login"] == "test1"
    assert body["role"] == "user"
    assert body["group"] == "БВТ2103"
    assert body["metrics"]["tasks_done"] == 0
    assert set(body["permissions"]) == ALL_TASK_TYPES

    # The created user can log in
    login_as(admin_client, "test1", "Passw0rd123")


def test_create_user_validation(admin_client):
    resp = admin_client.post("/api/users", json={"fio": "Без Логина"})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "login_and_fio_required"

    admin_client.post("/api/users", json={"fio": "Раз", "login": "dup1"})
    resp = admin_client.post("/api/users", json={"fio": "Два", "login": "dup1"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "login_taken"


def test_create_admin_requires_super_admin(admin_client, super_admin, db_session):
    resp = admin_client.post(
        "/api/users", json={"fio": "Новый Админ", "login": "newadmin", "role": "admin"}
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "super_admin_required"

    login_as(admin_client, super_admin.login, SUPER_ADMIN_PASSWORD)
    resp = admin_client.post(
        "/api/users", json={"fio": "Новый Админ", "login": "newadmin", "role": "admin"}
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "admin"


def test_invite_users(admin_client, regular_user):
    resp = admin_client.post(
        "/api/users/invite",
        json={"logins": ["st1", "st2", regular_user.login], "group": "БВТ2105"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert set(body) == {"invited", "users"}
    assert body["invited"] == 2  # existing login skipped
    assert {u["login"] for u in body["users"]} == {"st1", "st2"}
    assert all(u["group"] == "БВТ2105" for u in body["users"])

    resp = admin_client.post("/api/users/invite", json={"logins": [], "group": None})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "logins_required"


def test_bulk_update(admin_client, db_session):
    a = make_user(db_session, "bulk1")
    b = make_user(db_session, "bulk2")

    resp = admin_client.post(
        "/api/users/bulk",
        json={"user_ids": [a.id, b.id], "group": "БВТ2110",
              "permissions": {"segmentation": "user_block"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["updated"] == 2
    assert all(u["group"] == "БВТ2110" for u in body["users"])
    assert all(u["permissions"]["segmentation"] == "user_block" for u in body["users"])

    # admin_* in bulk — super-admin only
    resp = admin_client.post(
        "/api/users/bulk",
        json={"user_ids": [a.id], "permissions": {"transcription": "admin_block"}},
    )
    assert resp.status_code == 403

    resp = admin_client.post("/api/users/bulk", json={"user_ids": [a.id, 9999]})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /user/{id}, DELETE /user/{id}
# ---------------------------------------------------------------------------


def test_patch_user_fields(admin_client, regular_user, db_session):
    resp = admin_client.patch(
        f"/api/user/{regular_user.id}", json={"fio": "Новая Фамилия", "group": None}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["fio"] == "Новая Фамилия"
    assert body["group"] is None

    # Login conflict
    resp = admin_client.patch(f"/api/user/{regular_user.id}", json={"login": "akim"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "login_taken"

    assert admin_client.patch("/api/user/9999", json={"fio": "x"}).status_code == 404


def test_patch_role_requires_super_admin(admin_client, super_admin, regular_user):
    resp = admin_client.patch(f"/api/user/{regular_user.id}", json={"role": "admin"})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "super_admin_required"

    login_as(admin_client, super_admin.login, SUPER_ADMIN_PASSWORD)
    resp = admin_client.patch(f"/api/user/{regular_user.id}", json={"role": "admin"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_delete_user(admin_client, super_admin, regular_user, db_session):
    other_admin = make_user(db_session, "deladmin", role=UserRole.admin)

    # A regular admin does not delete admins
    assert admin_client.delete(f"/api/user/{other_admin.id}").status_code == 403
    # A regular user — deletes
    assert admin_client.delete(f"/api/user/{regular_user.id}").status_code == 204
    db_session.expunge_all()
    assert db_session.get(User, regular_user.id) is None

    # A super-admin deletes an admin
    login_as(admin_client, super_admin.login, SUPER_ADMIN_PASSWORD)
    assert admin_client.delete(f"/api/user/{other_admin.id}").status_code == 204


# ---------------------------------------------------------------------------
# Permissions matrix: PUT /user/{id}/permissions
# ---------------------------------------------------------------------------


def test_permissions_user_cells(admin_client, regular_user):
    resp = admin_client.put(
        f"/api/user/{regular_user.id}/permissions",
        json={"permissions": {"segmentation": "user_block"}},
    )
    assert resp.status_code == 200
    perms = resp.json()["permissions"]
    assert perms["segmentation"] == "user_block"
    assert perms["transcription"] == "user_allow"  # other cells untouched


def test_permissions_matrix_has_seven_rows_including_mos_and_sbs(admin_client, regular_user):
    # permissions matrix — 7 rows (5 base types + 'mos' + 'sbs'); cells are editable
    resp = admin_client.put(
        f"/api/user/{regular_user.id}/permissions",
        json={"permissions": {"mos": "user_block", "sbs": "user_block"}},
    )
    assert resp.status_code == 200
    perms = resp.json()["permissions"]
    assert len(perms) == 7
    assert perms["mos"] == "user_block"
    assert perms["sbs"] == "user_block"


def test_permissions_admin_cells_super_admin_only(
    admin_client, super_admin, regular_user
):
    # A regular admin cannot set admin_*
    resp = admin_client.put(
        f"/api/user/{regular_user.id}/permissions",
        json={"permissions": {"transcription": "admin_block"}},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "admin_cell_requires_super_admin"

    # A super-admin can set it
    login_as(admin_client, super_admin.login, SUPER_ADMIN_PASSWORD)
    resp = admin_client.put(
        f"/api/user/{regular_user.id}/permissions",
        json={"permissions": {"transcription": "admin_block"}},
    )
    assert resp.status_code == 200
    assert resp.json()["permissions"]["transcription"] == "admin_block"

    # A regular admin cannot overwrite an admin-locked cell
    login_as(admin_client, "akim", ADMIN_PASSWORD)
    resp = admin_client.put(
        f"/api/user/{regular_user.id}/permissions",
        json={"permissions": {"transcription": "user_allow"}},
    )
    assert resp.status_code == 403


def test_permissions_bad_value(admin_client, regular_user):
    resp = admin_client.put(
        f"/api/user/{regular_user.id}/permissions",
        json={"permissions": {"transcription": "nope"}},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "bad_permission"

    resp = admin_client.put(
        f"/api/user/{regular_user.id}/permissions",
        json={"permissions": {"weird_type": "user_allow"}},
    )
    assert resp.status_code == 400


def test_permissions_requires_admin(user_client, regular_user):
    resp = user_client.put(
        f"/api/user/{regular_user.id}/permissions",
        json={"permissions": {"transcription": "user_block"}},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------


def test_change_own_password(user_client, regular_user):
    resp = user_client.post(
        "/api/user/password",
        json={"old_password": "wrong", "new_password": "NewPass12345"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "wrong_old_password"

    resp = user_client.post(
        "/api/user/password",
        json={"old_password": USER_PASSWORD, "new_password": "short"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "password_too_short"

    resp = user_client.post(
        "/api/user/password",
        json={"old_password": USER_PASSWORD, "new_password": "NewPass12345"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    # The old password no longer works, the new one — works
    resp = user_client.post(
        "/api/auth/login", json={"login": regular_user.login, "password": USER_PASSWORD}
    )
    assert resp.status_code == 401
    login_as(user_client, regular_user.login, "NewPass12345")


def test_admin_sets_user_password(admin_client, regular_user):
    resp = admin_client.post(
        f"/api/user/{regular_user.id}/password", json={"new_password": "AdminSet12345"}
    )
    assert resp.status_code == 200
    login_as(admin_client, regular_user.login, "AdminSet12345")


def test_admin_cannot_set_other_admin_password(admin_client, super_admin):
    resp = admin_client.post(
        f"/api/user/{super_admin.id}/password", json={"new_password": "Hacked12345"}
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "super_admin_required"


def test_set_password_requires_admin(user_client, regular_user):
    resp = user_client.post(
        f"/api/user/{regular_user.id}/password", json={"new_password": "NewPass12345"}
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Admins: /admins, /user/{id}/admin, promote/demote
# ---------------------------------------------------------------------------


def test_admins_list_super_admin_only(super_admin_client, admin_user, regular_user):
    resp = super_admin_client.get("/api/admins")
    assert resp.status_code == 200
    body = resp.json()
    assert {u["login"] for u in body} == {"admin", "akim"}
    assert all(u["role"] == "admin" for u in body)
    assert set(body[0]) == USER_SHAPE

    login_as(super_admin_client, admin_user.login, ADMIN_PASSWORD)
    assert super_admin_client.get("/api/admins").status_code == 403


def test_grant_patch_revoke_admin(super_admin_client, regular_user, db_session):
    # Grant admin
    resp = super_admin_client.post(
        f"/api/user/{regular_user.id}/admin", json={"can_add_admins": False}
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"
    assert resp.json()["can_add_admins"] is False

    # Super-admin flag
    resp = super_admin_client.patch(
        f"/api/user/{regular_user.id}/admin", json={"can_add_admins": True}
    )
    assert resp.status_code == 200
    assert resp.json()["can_add_admins"] is True

    # Revoke admin (there are two super-admins — allowed)
    resp = super_admin_client.delete(f"/api/user/{regular_user.id}/admin")
    assert resp.status_code == 200
    assert resp.json()["role"] == "user"
    assert resp.json()["can_add_admins"] is False

    # Revoke from a non-admin — 400
    resp = super_admin_client.delete(f"/api/user/{regular_user.id}/admin")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "not_an_admin"


def test_promote_demote_aliases(super_admin_client, regular_user):
    resp = super_admin_client.post(
        f"/api/user/{regular_user.id}/promote", json={"can_add_admins": False}
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"

    resp = super_admin_client.post(f"/api/user/{regular_user.id}/demote")
    assert resp.status_code == 200
    assert resp.json()["role"] == "user"


def test_admin_management_requires_super_admin(admin_client, regular_user):
    # akim — an admin without can_add_admins
    assert (
        admin_client.post(f"/api/user/{regular_user.id}/promote").status_code == 403
    )
    assert admin_client.get("/api/admins").status_code == 403
    assert (
        admin_client.post(f"/api/user/{regular_user.id}/admin", json={}).status_code == 403
    )


def test_last_super_admin_protected(super_admin_client, super_admin, regular_user):
    # The only super-admin: cannot revoke/delete/demote — 409
    for method, url, body in [
        ("delete", f"/api/user/{super_admin.id}/admin", None),
        ("post", f"/api/user/{super_admin.id}/demote", None),
        ("patch", f"/api/user/{super_admin.id}/admin", {"can_add_admins": False}),
        ("delete", f"/api/user/{super_admin.id}", None),
        ("patch", f"/api/user/{super_admin.id}", {"role": "user"}),
    ]:
        resp = getattr(super_admin_client, method)(
            url, **({"json": body} if body is not None else {})
        )
        assert resp.status_code == 409, f"{method} {url}: {resp.text}"
        assert resp.json()["detail"] == "last_super_admin"

    # A second super-admin appeared — the first one can be demoted
    resp = super_admin_client.post(
        f"/api/user/{regular_user.id}/admin", json={"can_add_admins": True}
    )
    assert resp.status_code == 200
    resp = super_admin_client.delete(f"/api/user/{super_admin.id}/admin")
    assert resp.status_code == 200
    assert resp.json()["role"] == "user"


# ---------------------------------------------------------------------------
# GET /statistics — aggregate endpoint of the 'Statistics' screen
# ---------------------------------------------------------------------------

STATS_ROW_SHAPE = {
    "user_id", "fio", "login", "group", "tasks_done", "tasks_skipped",
    "avg_task_sec", "agreement_pct", "consensus_rate_pct", "last_active_at",
}


def test_statistics_requires_auth(client):
    assert client.get("/api/statistics").status_code == 401


def test_statistics_requires_admin(user_client):
    assert user_client.get("/api/statistics").status_code == 403


def test_statistics_rows_shape_and_filters(admin_client, regular_user, db_session):
    make_user(db_session, "skvortsov", group="БВТ2102", fio="Скворцов Пётр Ильич")
    seed_done_tasks(db_session, regular_user, count=3, task_sec=45)

    resp = admin_client.get("/api/statistics")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"items", "total", "offset", "limit"}
    # Only annotators (role=user): the admin is not in the table
    assert body["total"] == 2
    row = next(r for r in body["items"] if r["login"] == regular_user.login)
    assert set(row) == STATS_ROW_SHAPE
    assert row["tasks_done"] == 3
    assert row["avg_task_sec"] == 45.0
    assert row["group"] == "БВТ2101"

    # Filter by group
    resp = admin_client.get("/api/statistics", params={"group": "БВТ2102"})
    assert [r["login"] for r in resp.json()["items"]] == ["skvortsov"]

    # Search by FIO/login (by login — sqlite ASCII-only case-insensitivity)
    resp = admin_client.get("/api/statistics", params={"search": "IVOLG"})
    assert [r["login"] for r in resp.json()["items"]] == [regular_user.login]


def test_statistics_consensus_and_agreement(admin_client, db_session, regular_user):
    """Two annotators submitted the same result on one fragment —
    both have agreement and consensus at 100%."""
    other = make_user(db_session, "sinitsyna", group="БВТ2102")
    project = Project(name="P-stats", label_list=[])
    db_session.add(project)
    db_session.commit()
    fragment = AudioFragment(
        project_id=project.id,
        filename="agree.wav",
        s3_key=uuid.uuid4().hex,
        task_type=TT.transcription,
    )
    db_session.add(fragment)
    db_session.commit()
    for u in (regular_user, other):
        db_session.add(
            Task(
                fragment_id=fragment.id,
                user_id=u.id,
                status=TaskStatus.done,
                started_at=utcnow() - timedelta(seconds=30),
                finished_at=utcnow(),
                result={"text": "совпадает"},
            )
        )
    db_session.commit()

    resp = admin_client.get("/api/statistics")
    rows = {r["login"]: r for r in resp.json()["items"]}
    assert rows[regular_user.login]["agreement_pct"] == 100.0
    assert rows[regular_user.login]["consensus_rate_pct"] == 100.0
    assert rows["sinitsyna"]["consensus_rate_pct"] == 100.0


def test_statistics_export_csv(admin_client, regular_user):
    resp = admin_client.get("/api/statistics/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert "attachment" in resp.headers["content-disposition"]
    lines = resp.text.strip().splitlines()
    assert lines[0].startswith("user_id,fio,login,group,tasks_done")
    assert any(regular_user.login in line for line in lines[1:])

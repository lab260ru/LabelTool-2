"""Users and admins: table with metrics, create/invite/bulk,
permission matrix, password change, granting/revoking admin, protecting the last super-admin.

Contract (response shapes — src/api/types.ts,
paths — src/api/client.ts):
  GET    /users                — table (filters search/group/role, offset/limit, metrics);
  POST   /users                — create a user;
  POST   /users/invite         — invite by a list of logins;
  POST   /users/bulk           — bulk operations (group, permission cells);
  PATCH  /user/{id}            — full name/login/group/role/permissions;
  DELETE /user/{id}            — deletion (the last super-admin is protected);
  PUT    /user/{id}/permissions — permission matrix {task_type: PermissionValue};
  POST   /user/password        — change one's own password;
  POST   /user/{id}/password   — set a password by an admin;
  GET    /admins               — list of admins (super-admin);
  POST/DELETE/PATCH /user/{id}/admin — grant/revoke admin, the can_add_admins flag;
  POST   /user/{id}/promote|demote   — aliases for granting/revoking (super-admin).

Rules:
  - admin_allow/admin_block cells (and editing admin-locked cells) — super-admin only;
  - the last super-admin cannot be removed — 409 'last_super_admin';
  - detail is always a machine-readable code.
"""

import csv
import io
import secrets
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from src.auth import (
    get_current_admin,
    get_current_super_admin,
    get_current_user,
    hash_password,
    verify_password,
)
from src.db import get_db
from src.models import Task, TaskStatus, TaskType, User, UserRole
from src.schemas.common import OkResponse
from src.schemas.user import (
    MIN_PASSWORD_LEN,
    PERMISSION_DEFAULT,
    PERMISSION_VALUES,
    AdminGrantIn,
    AdminPatchIn,
    BulkUsersIn,
    BulkUsersOut,
    ChangePasswordIn,
    CreateUserIn,
    InviteUsersIn,
    InviteUsersOut,
    PermissionsIn,
    SetPasswordIn,
    StatisticsPage,
    StatisticsRowOut,
    UpdateUserIn,
    UserMetricsOut,
    UserOut,
    UsersPage,
)

router = APIRouter(tags=["user"])


# ---------------------------------------------------------------------------
# Building the UserOut response (metrics + full permission matrix)
# ---------------------------------------------------------------------------


def _full_permissions(perms: dict | None) -> dict[str, str]:
    """Full matrix over all 6 task types, including 'mos'
    (a missing entry = user_allow)."""
    perms = perms or {}
    return {t.value: perms.get(t.value, PERMISSION_DEFAULT) for t in TaskType}


def _metrics_map(db: Session, user_ids: list[int]) -> dict[int, UserMetricsOut]:
    """Metrics over done tasks. tasks_skipped/agreement_pct — 0 (skip clears
    user_id, there is no consensus engine: nothing in the model to compute from)."""
    out = {uid: UserMetricsOut() for uid in user_ids}
    if not user_ids:
        return out
    rows = db.execute(
        select(Task.user_id, Task.started_at, Task.finished_at).where(
            Task.user_id.in_(user_ids), Task.status == TaskStatus.done
        )
    ).all()
    durations: dict[int, list[float]] = {}
    for uid, started_at, finished_at in rows:
        m = out[uid]
        m.tasks_done += 1
        if finished_at is not None and (
            m.last_active_at is None or finished_at > m.last_active_at
        ):
            m.last_active_at = finished_at
        if started_at is not None and finished_at is not None:
            durations.setdefault(uid, []).append((finished_at - started_at).total_seconds())
    for uid, secs in durations.items():
        out[uid].avg_task_sec = round(sum(secs) / len(secs), 1)
    return out


def _users_out(db: Session, users: list[User]) -> list[UserOut]:
    metrics = _metrics_map(db, [u.id for u in users])
    return [
        UserOut(
            id=u.id,
            fio=u.fio,
            login=u.login,
            role=u.role,
            can_add_admins=u.can_add_admins,
            group=u.group_name,
            metrics=metrics[u.id],
            permissions=_full_permissions(u.permissions),
        )
        for u in users
    ]


def _user_out(db: Session, user: User) -> UserOut:
    return _users_out(db, [user])[0]


# ---------------------------------------------------------------------------
# Permission-matrix rules and super-admin protection
# ---------------------------------------------------------------------------


def _validate_permissions(patch: dict[str, str]) -> None:
    valid_types = {t.value for t in TaskType}
    for task_type, value in patch.items():
        if task_type not in valid_types or value not in PERMISSION_VALUES:
            raise HTTPException(status_code=400, detail="bad_permission")


def _apply_permissions(target: User, patch: dict[str, str], actor: User) -> None:
    """Merge cells into the matrix. admin_* cells (and editing admin-locked cells)
    can be done only by a super-admin."""
    if not patch:
        return
    _validate_permissions(patch)
    if not actor.is_super_admin:
        current = target.permissions or {}
        for task_type, value in patch.items():
            locked = str(current.get(task_type, "")).startswith("admin_")
            if value.startswith("admin_") or locked:
                raise HTTPException(status_code=403, detail="admin_cell_requires_super_admin")
    target.permissions = {**(target.permissions or {}), **patch}


def _super_admin_count(db: Session) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role == UserRole.admin, User.can_add_admins.is_(True))
        )
        or 0
    )


def _guard_last_super_admin(db: Session, target: User) -> None:
    """409 if the operation removes/deletes the last super-admin."""
    if target.is_super_admin and _super_admin_count(db) <= 1:
        raise HTTPException(status_code=409, detail="last_super_admin")


def _get_user_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user_not_found")
    return user


def _check_new_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LEN:
        raise HTTPException(status_code=400, detail="password_too_short")


def _random_password() -> str:
    return secrets.token_urlsafe(12)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


@router.get("/users", response_model=UsersPage)
def list_users(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=500),
    search: str | None = None,
    group: str | None = None,
    role: UserRole | None = None,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> UsersPage:
    """Users table: filters role/group/search, pagination, metrics."""
    stmt = select(User)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(or_(User.fio.ilike(pattern), User.login.ilike(pattern)))
    if group:
        stmt = stmt.where(User.group_name == group)
    if role is not None:
        stmt = stmt.where(User.role == role)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    users = list(db.execute(stmt.order_by(User.id).offset(offset).limit(limit)).scalars())
    return UsersPage(items=_users_out(db, users), total=total, offset=offset, limit=limit)


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    payload: CreateUserIn,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    """Create a user. role=admin — super-admin only."""
    if not payload.login or not payload.fio:
        raise HTTPException(status_code=400, detail="login_and_fio_required")
    if db.scalar(select(User.id).where(User.login == payload.login)) is not None:
        raise HTTPException(status_code=409, detail="login_taken")
    role = payload.role or UserRole.user
    if role == UserRole.admin and not admin.is_super_admin:
        raise HTTPException(status_code=403, detail="super_admin_required")
    if payload.password is not None:
        _check_new_password(payload.password)
    permissions = dict(payload.permissions or {})
    _validate_permissions(permissions)
    if not admin.is_super_admin and any(v.startswith("admin_") for v in permissions.values()):
        raise HTTPException(status_code=403, detail="admin_cell_requires_super_admin")

    user = User(
        login=payload.login,
        fio=payload.fio,
        password_hash=hash_password(payload.password or _random_password()),
        role=role,
        group_name=payload.group,
        permissions=permissions,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.post("/users/invite", response_model=InviteUsersOut, status_code=201)
def invite_users(
    payload: InviteUsersIn,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> InviteUsersOut:
    """Invite by a list of logins: missing ones are created, existing ones are skipped."""
    logins = [login.strip() for login in payload.logins if login and login.strip()]
    if not logins:
        raise HTTPException(status_code=400, detail="logins_required")
    existing = set(db.execute(select(User.login).where(User.login.in_(logins))).scalars())
    created: list[User] = []
    for login in dict.fromkeys(logins):  # dedup preserving order
        if login in existing:
            continue
        user = User(
            login=login,
            fio=login,
            password_hash=hash_password(_random_password()),
            role=UserRole.user,
            group_name=payload.group,
            permissions={},
        )
        db.add(user)
        created.append(user)
    db.commit()
    for user in created:
        db.refresh(user)
    return InviteUsersOut(invited=len(created), users=_users_out(db, created))


@router.post("/users/bulk", response_model=BulkUsersOut)
def bulk_update_users(
    payload: BulkUsersIn,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> BulkUsersOut:
    """Bulk operations: assign a group and/or permission cells to a list of users."""
    if not payload.user_ids:
        raise HTTPException(status_code=400, detail="user_ids_required")
    users = list(
        db.execute(
            select(User).where(User.id.in_(payload.user_ids)).order_by(User.id)
        ).scalars()
    )
    if len(users) != len(set(payload.user_ids)):
        raise HTTPException(status_code=404, detail="user_not_found")
    for user in users:
        if "group" in payload.model_fields_set:
            user.group_name = payload.group
        if payload.permissions:
            _apply_permissions(user, payload.permissions, admin)
    db.commit()
    return BulkUsersOut(updated=len(users), users=_users_out(db, users))


@router.patch("/user/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UpdateUserIn,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    """Edit full name/login/group/role/permissions. Only a super-admin changes the role."""
    user = _get_user_or_404(db, user_id)
    if payload.login is not None and payload.login != user.login:
        if db.scalar(select(User.id).where(User.login == payload.login)) is not None:
            raise HTTPException(status_code=409, detail="login_taken")
        user.login = payload.login
    if payload.fio is not None:
        user.fio = payload.fio
    if "group" in payload.model_fields_set:
        user.group_name = payload.group
    if payload.role is not None and payload.role != user.role:
        if not admin.is_super_admin:
            raise HTTPException(status_code=403, detail="super_admin_required")
        if payload.role == UserRole.user:
            _guard_last_super_admin(db, user)
            user.can_add_admins = False
        user.role = payload.role
    if payload.permissions is not None:
        _apply_permissions(user, payload.permissions, admin)
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.delete("/user/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> Response:
    """Delete a user. An admin can be deleted only by a super-admin;
    the last super-admin is protected (409)."""
    user = _get_user_or_404(db, user_id)
    if user.role == UserRole.admin and not admin.is_super_admin:
        raise HTTPException(status_code=403, detail="super_admin_required")
    _guard_last_super_admin(db, user)
    db.delete(user)
    db.commit()
    return Response(status_code=204)


@router.put("/user/{user_id}/permissions", response_model=UserOut)
def set_permissions(
    user_id: int,
    payload: PermissionsIn,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    """Permission matrix {task_type: user_allow|user_block|admin_allow|admin_block}.
    admin_* cells — super-admin only."""
    user = _get_user_or_404(db, user_id)
    _apply_permissions(user, payload.permissions, admin)
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------


@router.post("/user/password", response_model=OkResponse)
def change_own_password(
    payload: ChangePasswordIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OkResponse:
    """Change one's own password (old_password + new_password)."""
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="wrong_old_password")
    _check_new_password(payload.new_password)
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return OkResponse()


@router.post("/user/{user_id}/password", response_model=OkResponse)
def set_user_password(
    user_id: int,
    payload: SetPasswordIn,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> OkResponse:
    """Set a password by an admin. For another admin — super-admin only."""
    user = _get_user_or_404(db, user_id)
    if user.role == UserRole.admin and user.id != admin.id and not admin.is_super_admin:
        raise HTTPException(status_code=403, detail="super_admin_required")
    _check_new_password(payload.new_password)
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return OkResponse()


# ---------------------------------------------------------------------------
# Admins (super-admin only)
# ---------------------------------------------------------------------------


@router.get("/admins", response_model=list[UserOut])
def list_admins(
    super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> list[UserOut]:
    """List of admins (the "Admins" screen)."""
    admins = list(
        db.execute(select(User).where(User.role == UserRole.admin).order_by(User.id)).scalars()
    )
    return _users_out(db, admins)


def _grant_admin(db: Session, user_id: int, can_add_admins: bool) -> User:
    user = _get_user_or_404(db, user_id)
    user.role = UserRole.admin
    user.can_add_admins = can_add_admins
    db.commit()
    db.refresh(user)
    return user


def _revoke_admin(db: Session, user_id: int) -> User:
    user = _get_user_or_404(db, user_id)
    if user.role != UserRole.admin:
        raise HTTPException(status_code=400, detail="not_an_admin")
    _guard_last_super_admin(db, user)
    user.role = UserRole.user
    user.can_add_admins = False
    db.commit()
    db.refresh(user)
    return user


@router.post("/user/{user_id}/admin", response_model=UserOut)
def grant_admin(
    user_id: int,
    payload: AdminGrantIn | None = None,
    super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    """Grant admin (optionally can_add_admins right away)."""
    can_add = payload.can_add_admins if payload is not None else False
    return _user_out(db, _grant_admin(db, user_id, can_add))


@router.delete("/user/{user_id}/admin", response_model=UserOut)
def revoke_admin(
    user_id: int,
    super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    """Revoke admin. The last super-admin is protected — 409 'last_super_admin'."""
    return _user_out(db, _revoke_admin(db, user_id))


@router.patch("/user/{user_id}/admin", response_model=UserOut)
def set_can_add_admins(
    user_id: int,
    payload: AdminPatchIn,
    super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    """The can_add_admins flag. Cannot be removed from the last super-admin — 409."""
    user = _get_user_or_404(db, user_id)
    if user.role != UserRole.admin:
        raise HTTPException(status_code=400, detail="not_an_admin")
    if user.can_add_admins and not payload.can_add_admins:
        _guard_last_super_admin(db, user)
    user.can_add_admins = payload.can_add_admins
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.post("/user/{user_id}/promote", response_model=UserOut)
def promote_admin(
    user_id: int,
    payload: AdminGrantIn | None = None,
    super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    """Alias for granting admin."""
    can_add = payload.can_add_admins if payload is not None else False
    return _user_out(db, _grant_admin(db, user_id, can_add))


@router.post("/user/{user_id}/demote", response_model=UserOut)
def demote_admin(
    user_id: int,
    super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    """Alias for revoking admin. The last super-admin is protected — 409."""
    return _user_out(db, _revoke_admin(db, user_id))


# ---------------------------------------------------------------------------
# Annotator statistics — an aggregate endpoint for the "Statistics" screen.
# Used by client.ts statisticsApi.list/exportCsv.
# ---------------------------------------------------------------------------

_STATS_CSV_HEADER = [
    "user_id", "fio", "login", "group", "tasks_done", "tasks_skipped",
    "avg_task_sec", "agreement_pct", "consensus_rate_pct", "last_active_at",
]


def _consensus_rate_map(db: Session) -> dict[int, float]:
    """Share of the annotator's done tasks that matched the majority on the fragment
    (fragments with >=2 done are counted; denominator — all done tasks)."""
    from src.routers.project import _canon  # local import: avoid coupling modules at startup

    done_totals: dict[int, int] = dict(
        db.execute(
            select(Task.user_id, func.count())
            .where(Task.status == TaskStatus.done, Task.user_id.is_not(None))
            .group_by(Task.user_id)
        ).all()
    )
    multi = (
        select(Task.fragment_id)
        .where(Task.status == TaskStatus.done)
        .group_by(Task.fragment_id)
        .having(func.count() >= 2)
        .subquery()
    )
    rows = db.execute(
        select(Task.fragment_id, Task.user_id, Task.result)
        .join(multi, multi.c.fragment_id == Task.fragment_id)
        .where(Task.status == TaskStatus.done)
    ).all()
    by_fragment: dict[int, list[tuple[int | None, str]]] = {}
    for fragment_id, user_id, result in rows:
        by_fragment.setdefault(fragment_id, []).append((user_id, _canon(result)))

    in_consensus: Counter[int] = Counter()
    for tasks in by_fragment.values():
        counts = Counter(canon for _, canon in tasks)
        modal, modal_n = counts.most_common(1)[0]
        if modal_n < 2:
            continue
        for user_id, canon in tasks:
            if user_id is not None and canon == modal:
                in_consensus[user_id] += 1
    return {
        uid: round(in_consensus.get(uid, 0) * 100.0 / total, 1)
        for uid, total in done_totals.items()
        if total > 0
    }


def _statistics_rows(
    db: Session,
    offset: int,
    limit: int,
    search: str | None,
    group: str | None,
) -> tuple[list[StatisticsRowOut], int]:
    """Rows of the "Statistics" table: annotators (role=user) with metrics."""
    from src.routers.project import _annotator_agreement

    stmt = select(User).where(User.role == UserRole.user)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(or_(User.fio.ilike(pattern), User.login.ilike(pattern)))
    if group:
        stmt = stmt.where(User.group_name == group)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    users = list(db.execute(stmt.order_by(User.id).offset(offset).limit(limit)).scalars())

    metrics = _metrics_map(db, [u.id for u in users])
    agreement = _annotator_agreement(db)
    consensus = _consensus_rate_map(db)
    rows = [
        StatisticsRowOut(
            user_id=u.id,
            fio=u.fio,
            login=u.login,
            group=u.group_name,
            tasks_done=metrics[u.id].tasks_done,
            tasks_skipped=metrics[u.id].tasks_skipped,
            avg_task_sec=metrics[u.id].avg_task_sec,
            agreement_pct=agreement.get(u.id, 0.0),
            consensus_rate_pct=consensus.get(u.id, 0.0),
            last_active_at=metrics[u.id].last_active_at,
        )
        for u in users
    ]
    return rows, int(total)


@router.get("/statistics", response_model=StatisticsPage)
def statistics(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=500),
    search: str | None = None,
    group: str | None = None,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> StatisticsPage:
    """Table of annotators with summary metrics (filters search/group)."""
    rows, total = _statistics_rows(db, offset, limit, search, group)
    return StatisticsPage(items=rows, total=total, offset=offset, limit=limit)


@router.get("/statistics/export")
def statistics_export_csv(
    search: str | None = None,
    group: str | None = None,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> Response:
    """Export the statistics table to CSV (same filters, no pagination)."""
    rows, _ = _statistics_rows(db, offset=0, limit=500, search=search, group=group)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_STATS_CSV_HEADER)
    for r in rows:
        writer.writerow([
            r.user_id, r.fio, r.login, r.group or "", r.tasks_done, r.tasks_skipped,
            r.avg_task_sec, r.agreement_pct, r.consensus_rate_pct,
            r.last_active_at.isoformat() if r.last_active_at else "",
        ])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="statistics.csv"'},
    )

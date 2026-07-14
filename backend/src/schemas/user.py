"""Pydantic schemas for users and admins.

Response shapes are 1:1 with the frontend contract src/api/types.ts:
User (with group and metrics), TaskPermissions (full matrix over 6 task types,
including 'mos'),
Paginated<User>, InviteUsersResult. Machine-readable error codes in detail —
the human-readable strings are produced by the UI via i18n.
"""

from datetime import datetime

from pydantic import BaseModel, Field

from src.models import UserRole

# Values of a permission-matrix cell (types.ts PermissionValue)
PERMISSION_VALUES = ("user_allow", "user_block", "admin_allow", "admin_block")

# Default value for task types without an explicit entry in the matrix
PERMISSION_DEFAULT = "user_allow"

MIN_PASSWORD_LEN = 8


class UserMetricsOut(BaseModel):
    """types.ts UserMetrics (tasks done, speed, activity)."""

    tasks_done: int = 0
    tasks_skipped: int = 0
    avg_task_sec: float = 0.0
    agreement_pct: float = 0.0
    last_active_at: datetime | None = None


class UserOut(BaseModel):
    """types.ts User: group (the model's group_name), full permissions matrix."""

    id: int
    fio: str
    login: str
    role: UserRole
    can_add_admins: bool
    group: str | None = None
    metrics: UserMetricsOut
    permissions: dict[str, str]


class UsersPage(BaseModel):
    """types.ts Paginated<User> (items/total/offset/limit)."""

    items: list[UserOut]
    total: int
    offset: int
    limit: int


class RegisterIn(BaseModel):
    """Body of the public self-registration POST /auth/register.

    The role is always 'user' (annotator) — you cannot register yourself as an admin,
    so there is no role field in the body. fio/login/password are validated in the
    endpoint (auth.py) to return the contract 400 codes
    (fio_required/bad_login/password_too_short) rather than a pydantic 422.
    group is optional (empty/whitespace → group_name=null).
    """

    fio: str = ""
    login: str = ""
    password: str = ""
    group: str | None = None


class CreateUserIn(BaseModel):
    """types.ts CreateUserRequest. login/fio are validated in the router
    to return the contract 400 'login_and_fio_required' (not a 422)."""

    fio: str | None = None
    login: str | None = None
    password: str | None = None
    role: UserRole | None = None
    group: str | None = None
    permissions: dict[str, str] = Field(default_factory=dict)


class UpdateUserIn(BaseModel):
    """types.ts UpdateUserRequest (all fields optional; group distinguishes
    "not provided" from null via model_fields_set)."""

    fio: str | None = None
    login: str | None = None
    group: str | None = None
    role: UserRole | None = None
    permissions: dict[str, str] | None = None


class PermissionsIn(BaseModel):
    """Body of PUT /user/{id}/permissions (client.ts setPermissions)."""

    permissions: dict[str, str] = Field(default_factory=dict)


class InviteUsersIn(BaseModel):
    """types.ts InviteUsersRequest."""

    logins: list[str] = Field(default_factory=list)
    group: str | None = None


class InviteUsersOut(BaseModel):
    """types.ts InviteUsersResult."""

    invited: int
    users: list[UserOut]


class BulkUsersIn(BaseModel):
    """Bulk operations on users: assign a group
    and/or apply permission-matrix cells to all user_ids."""

    user_ids: list[int] = Field(default_factory=list)
    group: str | None = None
    permissions: dict[str, str] | None = None


class BulkUsersOut(BaseModel):
    updated: int
    users: list[UserOut]


class ChangePasswordIn(BaseModel):
    """Change one's own password."""

    old_password: str
    new_password: str


class SetPasswordIn(BaseModel):
    """Setting a user's password by an admin."""

    new_password: str


class AdminGrantIn(BaseModel):
    """Body of POST /user/{id}/admin and /user/{id}/promote."""

    can_add_admins: bool = False


class AdminPatchIn(BaseModel):
    """Body of PATCH /user/{id}/admin (super-admin flag)."""

    can_add_admins: bool = False


class StatisticsRowOut(BaseModel):
    """types.ts StatisticsRow — a row of the "Statistics" table.

    The statistics screen needs
    an aggregate endpoint GET /statistics (client.ts statisticsApi.list).
    """

    user_id: int
    fio: str
    login: str
    group: str | None = None
    tasks_done: int = 0
    tasks_skipped: int = 0
    avg_task_sec: float = 0.0
    agreement_pct: float = 0.0
    # Share of the annotator's done tasks that reached consensus (matched the majority)
    consensus_rate_pct: float = 0.0
    last_active_at: datetime | None = None


class StatisticsPage(BaseModel):
    """types.ts Paginated<StatisticsRow>."""

    items: list[StatisticsRowOut]
    total: int
    offset: int
    limit: int

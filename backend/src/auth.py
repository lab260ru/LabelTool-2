"""Session authentication: signed cookie (itsdangerous) + bcrypt.

Endpoints: POST /api/auth/login, POST /api/auth/logout,
GET /api/auth/me. Dependencies for routers:
get_current_user / get_current_admin / get_current_super_admin.
"""

import re

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.config import settings
from src.db import get_db
from src.models import User, UserRole
from src.schemas.user import MIN_PASSWORD_LEN, RegisterIn
from src.schemas.user import UserOut as SchemaUserOut

# Self-registration login: latin letters/digits/._- , at least 3 characters (contract)
_LOGIN_RE = re.compile(r"[a-zA-Z0-9._-]{3,}")

# ---------------------------------------------------------------------------
# Passwords (bcrypt directly, without passlib)
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Session cookie
# ---------------------------------------------------------------------------

_serializer = URLSafeTimedSerializer(settings.SECRET_KEY, salt="lt2-session")


def create_session_token(user_id: int) -> str:
    return _serializer.dumps({"user_id": user_id})


def read_session_token(token: str) -> int | None:
    try:
        data = _serializer.loads(token, max_age=settings.SESSION_MAX_AGE_SEC)
    except (BadSignature, SignatureExpired):
        return None
    return data.get("user_id")


def set_session_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=create_session_token(user_id),
        max_age=settings.SESSION_MAX_AGE_SEC,
        httponly=True,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=settings.SESSION_COOKIE_NAME, path="/")


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    # detail — machine-readable codes: the UI builds strings via i18n
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="not_authenticated")
    user_id = read_session_token(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="session_expired")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="user_not_found")
    return user


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="admin_required")
    return user


def get_current_super_admin(user: User = Depends(get_current_admin)) -> User:
    if not user.can_add_admins:
        raise HTTPException(status_code=403, detail="super_admin_required")
    return user


# ---------------------------------------------------------------------------
# Schemas and /api/auth/* endpoints
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    login: str
    password: str


def _contract_user_out(db: Session, user: User):
    """Full types.ts User form (group, metrics, permissions matrix).

    The serializer lives in routers/user.py; the import is lazy because
    routers/user.py itself imports src.auth (otherwise a circular import).
    """
    from src.routers.user import _user_out

    return _user_out(db, user)


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=SchemaUserOut)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.login == payload.login)).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="invalid_credentials")
    set_session_cookie(response, user.id)
    return _contract_user_out(db, user)


@router.post("/register", response_model=SchemaUserOut, status_code=201)
def register(payload: RegisterIn, response: Response, db: Session = Depends(get_db)):
    """Public self-registration of a labeler (role='user', permissions={}).

    Validation with machine-readable codes (order as in the contract):
    fio_required → bad_login → login_taken → password_too_short. On success —
    auto-login (the same session cookie as in /auth/login) and 201 + full User
    (the /auth/me form, without password_hash). Passwords/hashes are not logged.
    """
    fio = (payload.fio or "").strip()
    if not fio:
        raise HTTPException(status_code=400, detail="fio_required")
    login = (payload.login or "").strip()
    if not _LOGIN_RE.fullmatch(login):
        raise HTTPException(status_code=400, detail="bad_login")
    if db.scalar(select(User.id).where(User.login == login)) is not None:
        raise HTTPException(status_code=409, detail="login_taken")
    if len(payload.password or "") < MIN_PASSWORD_LEN:
        raise HTTPException(status_code=400, detail="password_too_short")

    user = User(
        login=login,
        fio=fio,
        password_hash=hash_password(payload.password),
        role=UserRole.user,
        group_name=(payload.group or "").strip() or None,
        permissions={},
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    set_session_cookie(response, user.id)
    return _contract_user_out(db, user)


@router.post("/logout")
def logout(response: Response) -> dict:
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=SchemaUserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _contract_user_out(db, user)

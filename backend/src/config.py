"""Application settings (env / .env)."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    DATABASE_URL: str = "sqlite:///./labeltool2.db"

    # Session cookie signing key (in production, must be overridden via env)
    SECRET_KEY: str = "dev-secret-change-me"
    SESSION_COOKIE_NAME: str = "lt2_session"
    SESSION_MAX_AGE_SEC: int = 14 * 24 * 3600  # 14 days

    # Primary super-admin — created at startup (bootstrap) if it does not yet exist.
    # In production, set it via env (.env); the password must be changed.
    SUPERUSER_LOGIN: str = "admin"
    SUPERUSER_PASSWORD: str = "change-me-admin"
    SUPERUSER_FIO: str = "Administrator"

    # Whether to load demo data (projects/labelers) at startup.
    # DISABLED by default: the production stack comes up empty (super-admin only).
    SEED_DEMO: bool = False

    # Storage: 'local' (file system) or 's3' (S3/MinIO)
    STORAGE_BACKEND: Literal["local", "s3"] = "local"
    LOCAL_STORAGE_DIR: str = "./storage"

    # S3/MinIO (needed only when STORAGE_BACKEND=s3)
    S3_ENDPOINT: str | None = None
    S3_KEY: str | None = None
    S3_SECRET: str | None = None
    S3_BUCKET: str | None = None
    # Public endpoint for presigned URLs (the signature includes the host).
    # In docker-compose the backend reaches MinIO over the internal http://minio:9000,
    # while the browser needs links to the published port (http://localhost:9000).
    # None — presigned URLs are signed with the regular S3_ENDPOINT.
    S3_PUBLIC_ENDPOINT: str | None = None

    # Presigned URL lifetime (sec)
    PRESIGNED_URL_TTL_SEC: int = 3600


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

"""Storage for audio and export artifacts: LocalStorage / S3Storage.

Tests and dev run on LocalStorage (files in
LOCAL_STORAGE_DIR, "presigned" is /api/media/{key}, served as a FileResponse
in main.py). Real S3/MinIO — STORAGE_BACKEND=s3 + boto3 presigned URLs.
"""

from abc import ABC, abstractmethod
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from src.config import settings

# Audio extensions of S3 sources (listing/import filter, S3 feature contract)
AUDIO_EXTENSIONS = ("mp3", "wav", "flac", "ogg")


def _is_audio_key(key: str) -> bool:
    """The object key is audio by extension (mp3/wav/flac/ogg)."""
    return "." in key and key.rsplit(".", 1)[-1].lower() in AUDIO_EXTENSIONS


class Storage(ABC):
    """Storage interface. Routers use only this."""

    @abstractmethod
    def put(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    def get(self, key: str) -> bytes: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def presigned_url(self, key: str, ttl_sec: int | None = None) -> str:
        """URL for downloading without authorization (time-limited on S3)."""


class LocalStorage(Storage):
    """Files in LOCAL_STORAGE_DIR; "presigned" = /api/media/{key}."""

    def __init__(self, base_dir: str | None = None) -> None:
        self.base = Path(base_dir or settings.LOCAL_STORAGE_DIR).resolve()
        self.base.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.base / key).resolve()
        if not path.is_relative_to(self.base):  # protection against path traversal
            raise ValueError(f"Invalid storage key: {key!r}")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> bytes:
        path = self._path(key)
        if not path.is_file():
            raise FileNotFoundError(key)
        return path.read_bytes()

    def delete(self, key: str) -> None:
        path = self._path(key)
        path.unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def presigned_url(self, key: str, ttl_sec: int | None = None) -> str:
        return f"/api/media/{key}"


class S3Storage(Storage):
    """S3/MinIO via boto3, real presigned URLs."""

    def __init__(self) -> None:
        import boto3  # local import: not required for local mode/tests
        from botocore.config import Config

        if not settings.S3_BUCKET:
            raise RuntimeError("STORAGE_BACKEND=s3 but S3_BUCKET is not set")
        self.bucket = settings.S3_BUCKET
        # path-style: MinIO keeps the bucket in the path, not in a subdomain
        cfg = Config(s3={"addressing_style": "path"})
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT,
            aws_access_key_id=settings.S3_KEY,
            aws_secret_access_key=settings.S3_SECRET,
            config=cfg,
        )
        # Presigned URLs are signed with the public endpoint (the signature includes
        # the host): put/get operations go over the internal S3_ENDPOINT (docker
        # network), while browser links go over S3_PUBLIC_ENDPOINT (the published MinIO port).
        if settings.S3_PUBLIC_ENDPOINT and settings.S3_PUBLIC_ENDPOINT != settings.S3_ENDPOINT:
            self._presign_client = boto3.client(
                "s3",
                endpoint_url=settings.S3_PUBLIC_ENDPOINT,
                aws_access_key_id=settings.S3_KEY,
                aws_secret_access_key=settings.S3_SECRET,
                config=cfg,
            )
        else:
            self._presign_client = self.client

    def put(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data)

    def get(self, key: str) -> bytes:
        obj = self.client.get_object(Bucket=self.bucket, Key=key)
        return obj["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except self.client.exceptions.ClientError:
            return False

    def presigned_url(self, key: str, ttl_sec: int | None = None) -> str:
        return self._presign_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=ttl_sec or settings.PRESIGNED_URL_TTL_SEC,
        )


@lru_cache
def get_storage() -> Storage:
    if settings.STORAGE_BACKEND == "s3":
        return S3Storage()
    return LocalStorage()


# ---------------------------------------------------------------------------
# S3 data source (reference-in-place): presigned/head/listing AGAINST
# the external source bucket (not the application storage). See models.S3Source.
# ---------------------------------------------------------------------------


class SourceLike(Protocol):
    """Minimal contract of a source object (duck typing — storage.py does not
    depend on models): S3Source connection fields."""

    endpoint_url: str
    bucket: str
    prefix: str
    access_key: str
    secret_key: str
    region: str | None
    path_style: bool


class S3SourceStorage:
    """boto3 wrapper over the EXTERNAL source bucket: presigned/head/listing.

    Objects stay in the source (reference-in-place) — there is no put/delete here,
    only reading metadata and generating a presigned URL for playback.
    """

    def __init__(self, source: SourceLike) -> None:
        import boto3  # local import: not needed for local mode
        from botocore.config import Config

        self.bucket = source.bucket
        self.prefix = source.prefix or ""
        # path-style (MinIO) — the bucket is in the path, not in a host subdomain
        addressing = "path" if source.path_style else "virtual"
        cfg = Config(s3={"addressing_style": addressing})
        self.client = boto3.client(
            "s3",
            endpoint_url=source.endpoint_url or None,
            aws_access_key_id=source.access_key,
            aws_secret_access_key=source.secret_key,
            region_name=source.region or None,
            config=cfg,
        )

    def check_connection(self) -> None:
        """Availability check (list with limit=1). Raises on error — the call
        in routers/s3_source.create translates it into 400 s3_connection_failed."""
        self.client.list_objects_v2(Bucket=self.bucket, Prefix=self.prefix, MaxKeys=1)

    def head(self, key: str) -> int:
        """Object size (ContentLength) from S3 metadata."""
        obj = self.client.head_object(Bucket=self.bucket, Key=key)
        return int(obj.get("ContentLength", 0) or 0)

    def presigned_url(self, key: str, ttl_sec: int | None = None) -> str:
        """Presigned GET against the source (default lifetime — 1 h)."""
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=ttl_sec or settings.PRESIGNED_URL_TTL_SEC,
        )

    def list_objects(
        self, prefix: str | None = None, *, audio_only: bool = True, max_keys: int | None = None
    ) -> Iterator[tuple[str, int]]:
        """Generator of (key, size) under the source prefix (+ extra prefix).

        S3 listing pagination via ContinuationToken; size is taken from the
        listing's Size field (== the object's ContentLength). With audio_only —
        only audio extensions (mp3/wav/flac/ogg). max_keys — a hard ceiling on
        the number of emitted keys (a safeguard against endless listing)."""
        full_prefix = (self.prefix or "") + (prefix or "")
        token: str | None = None
        emitted = 0
        while True:
            kwargs: dict = {"Bucket": self.bucket, "Prefix": full_prefix}
            if token:
                kwargs["ContinuationToken"] = token
            resp = self.client.list_objects_v2(**kwargs)
            for item in resp.get("Contents", []) or []:
                key = item["Key"]
                if audio_only and not _is_audio_key(key):
                    continue
                yield key, int(item.get("Size", 0) or 0)
                emitted += 1
                if max_keys is not None and emitted >= max_keys:
                    return
            if resp.get("IsTruncated") and resp.get("NextContinuationToken"):
                token = resp["NextContinuationToken"]
            else:
                return


def get_source_storage(source: SourceLike) -> S3SourceStorage:
    """boto3 wrapper over the source bucket (see S3SourceStorage). Not cached
    (each source has its own creds/endpoint) — the caller caches if needed."""
    return S3SourceStorage(source)

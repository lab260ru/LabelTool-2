"""Pydantic schemas for the "Connect data from S3" feature (reference-in-place).

Response shapes are 1:1 with the frontend contract src/api/types.ts:
  S3Source       — a source WITHOUT secrets (secret_key/access_key are NOT returned);
  S3SourcePreview — listing statistics under the prefix (audio filter, sbs pairs);
  S3ImportResult — import result (created/skipped/unpaired).

IMPORTANT: secret_key is NEVER in a response_model (it is not in S3SourceOut) and
never in logs — it is the user's infrastructure config (like S3_SECRET in config.py).
"""

from datetime import datetime

from pydantic import BaseModel, Field


class S3SourceCreate(BaseModel):
    """Body of POST /project/{id}/s3-sources (client.ts s3SourcesApi.create).

    Non-empty name/endpoint_url/bucket/access_key/secret_key (min_length=1 →
    422 when empty). UI field defaults may be prefilled from the app's S3
    config (endpoint http://minio:9000, path_style true) — but that is a
    form hint, not autofill of the secret.
    """

    name: str = Field(min_length=1)
    endpoint_url: str = Field(min_length=1)
    bucket: str = Field(min_length=1)
    # Prefix inside the bucket — may be '' (the whole bucket)
    prefix: str = ""
    access_key: str = Field(min_length=1)
    # WRITE ONLY — absent in responses (S3SourceOut does not include it)
    secret_key: str = Field(min_length=1)
    region: str | None = None
    # path-style addressing (needed by MinIO); default true
    path_style: bool = True


class S3SourceOut(BaseModel):
    """Source in API responses (types.ts S3Source) — WITHOUT secrets.

    Neither secret_key nor access_key is in the output (secrets do not leave the backend).
    object_count — number of fragments already imported from the source.
    """

    id: int
    project_id: int
    name: str
    endpoint_url: str
    bucket: str
    prefix: str
    region: str | None = None
    path_style: bool
    created_at: datetime
    object_count: int | None = None


class S3SourcePreview(BaseModel):
    """Response of POST /s3-source/{id}/preview (types.ts S3SourcePreview).

    total_audio — total audio objects under the prefix; sample — up to 20 keys
    to display; already_imported / to_import — how many import units are already
    registered and how many are new (a unit = an object; for an sbs project — a PAIR).
    For an sbs project also pairs (complete pairs) and unpaired (single/unpaired
    audio files). truncated — the listing was cut off at the MAX_LIST_OBJECTS ceiling.
    """

    total_audio: int
    sample: list[str] = Field(default_factory=list)
    already_imported: int
    to_import: int
    # Only for an sbs project (null for others)
    pairs: int | None = None
    unpaired: int | None = None
    truncated: bool = False


class S3ImportResult(BaseModel):
    """Response of POST /s3-source/{id}/import (types.ts S3ImportResult).

    imported — fragments created (for sbs — pairs); skipped — already-imported
    ones skipped; unpaired — only for sbs (single/unpaired files)."""

    imported: int
    skipped: int
    unpaired: int | None = None

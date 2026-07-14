"""Pydantic schemas for session-based batch upload.

Response shapes are 1:1 with the frontend contract src/api/types.ts:
UploadSessionRequest/Info, UploadFileResult, UploadSummary, ManifestPreview, etc.
Machine-readable error codes (error_reason/reason) — the human-readable strings
are produced by the UI via i18n.

Contract extensions (beyond types.ts, backward compatible):
  - UploadSessionRequest.conflict = 'reject'|'rename' — name dedup mode
    (detect before write, WITHOUT silent overwrite);
  - UploadSessionRequest.orig_trb_all — bulk value for the ASR hint;
  - error_reason 'duplicate_name' — file rejection in conflict=reject mode.

The task type is
a project attribute. Upload NO LONGER ACCEPTS the type from the client:
  - UploadSessionRequest.task_type — DEPRECATED, ignored;
  - ColumnMapping.task_type — DEPRECATED, ignored (the type is not imported
    from the manifest, the per-row error 'bad_task_type' has been removed);
  - fragments and manifest rows always receive Project.task_type,
    UploadSummary.task_type returns the same value.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from src.models import TaskType

# Name-conflict resolution mode within a project
ConflictMode = Literal["reject", "rename"]

# Machine-readable reasons for per-file errors (types.ts UploadErrorReason
# + extension 'duplicate_name' for conflict=reject; 'unpaired' — a file of
# an sbs project without a <base>_a/<base>_b pair, not uploaded)
UploadErrorReason = Literal[
    "s3_timeout",
    "network_failure",
    "unsupported_format",
    "file_too_large",
    "cancelled",
    "duplicate_name",
    "unpaired",
]

# Reason a row/file was rejected in the summary (types.ts UploadFailedRow.reason)
FailedRowReason = Literal[
    "s3_timeout",
    "network_failure",
    "unsupported_format",
    "file_too_large",
    "cancelled",
    "duplicate_name",
    "invalid_row",
    "unpaired",
]


# ---------------------------------------------------------------------------
# Upload session (POST /upload/session)
# ---------------------------------------------------------------------------


class UploadFileMeta(BaseModel):
    """Client-side description of a file before upload (types.ts UploadFileMeta)."""

    client_id: str
    filename: str = Field(min_length=1, max_length=512)
    size: int = Field(default=0, ge=0)
    duration: float | None = None


class UploadSessionRequest(BaseModel):
    """Body of POST /upload/session (types.ts UploadSessionRequest)."""

    project_id: int
    # DEPRECATED: ignored — fragments inherit Project.task_type
    task_type: TaskType | None = None
    # key-value metadata for the whole batch
    metadata: dict[str, str] = Field(default_factory=dict)
    # ASR hints per file: client_id -> text
    orig_trb: dict[str, str] = Field(default_factory=dict)
    # ASR hint in bulk — for files without a per-file value (extension)
    orig_trb_all: str | None = None
    # Name dedup: reject — per-file error, rename — unique name (extension)
    conflict: ConflictMode = "rename"
    files: list[UploadFileMeta] = Field(default_factory=list)


class UploadSessionInfo(BaseModel):
    """Response for session creation (types.ts UploadSessionInfo)."""

    session_id: str
    # Names already existing in the project (conflict detected BEFORE write)
    duplicates: list[str]
    # Names with an unsupported format (server-side validation by extension)
    unsupported: list[str]


class UploadFileResult(BaseModel):
    """Per-file upload result (types.ts UploadFileResult).

    Business errors are returned as 200 + ok=false — errors do not break the batch.
    """

    client_id: str
    ok: bool
    fragment_id: int | None = None
    error_reason: UploadErrorReason | None = None
    # For network_failure — at what percentage it was interrupted
    failed_at_pct: int | None = None


class UploadFailedRow(BaseModel):
    """Row of the error block in the summary (types.ts UploadFailedRow)."""

    client_id: str
    filename: str
    reason: FailedRowReason


class UploadSummary(BaseModel):
    """Session/import summary (types.ts UploadSummary, wizard summary step)."""

    project_id: int
    # Project type (single for all uploaded fragments)
    task_type: TaskType
    total: int
    uploaded: int
    failed: list[UploadFailedRow]
    # CSV with the manifest's error rows ("Download rows with errors")
    error_rows_url: str | None = None


# ---------------------------------------------------------------------------
# CSV/JSONL manifest (tab 2)
# ---------------------------------------------------------------------------


class ManifestRow(BaseModel):
    """Manifest preview row (types.ts ManifestRow)."""

    index: int  # row number in the source file, starting at 1
    cells: dict[str, str]
    valid: bool
    # Row error code: 'missing_filename' | 'unsupported_format'
    # | 'parse_error' | null ('bad_task_type' removed: the type is no longer
    # imported from the manifest — the type is single per project)
    error: str | None = None


class ColumnMapping(BaseModel):
    """Manifest column mapping: target field -> source column
    (types.ts ColumnMapping)."""

    filename: str = ""
    # DEPRECATED: ignored — the type is set by the project, not a manifest column
    task_type: str | None = None
    orig_trb: str | None = None
    # Side-by-Side: columns of the pair variants' names (sbs projects only). In sbs
    # the manifest carries filename_a/filename_b instead of a single filename/orig_trb;
    # each row = one pair fragment (see routers/file.py). orig_trb is not
    # applicable to sbs and is ignored.
    filename_a: str | None = None
    filename_b: str | None = None
    # Metadata key -> source column
    metadata: dict[str, str] = Field(default_factory=dict)


class ManifestPreview(BaseModel):
    """Response of POST /upload/manifest/preview (types.ts ManifestPreview)."""

    filename: str
    columns: list[str]
    rows: list[ManifestRow]  # first rows for preview
    total_rows: int
    valid_count: int
    error_count: int
    suggested_mapping: ColumnMapping


class ManifestImportRequest(BaseModel):
    """Body of POST /upload/session/{sid}/manifest: {"mapping": {...}}."""

    mapping: ColumnMapping | None = None


# ---------------------------------------------------------------------------
# Single-step batch upload (POST /file/batch)
# ---------------------------------------------------------------------------


class BatchFileResult(UploadFileResult):
    """Per-file result of /file/batch: UploadFileResult + names."""

    filename: str
    # Final name in the project (differs from filename when conflict=rename)
    stored_as: str | None = None


class BatchUploadResult(BaseModel):
    """Response of POST /file/batch: summary + per-file results."""

    upload_session_id: int
    project_id: int
    task_type: TaskType
    total: int
    uploaded: int
    failed: list[UploadFailedRow]
    results: list[BatchFileResult]


class ConflictCheckResult(BaseModel):
    """Response of GET /project/{id}/files/conflicts — for client-side validation."""

    project_id: int
    duplicates: list[str]


# ---------------------------------------------------------------------------
# Upload session history (UploadSession)
# ---------------------------------------------------------------------------


class UploadSessionOut(BaseModel):
    id: int
    project_id: int
    user_id: int | None
    total: int
    succeeded: int
    failed: int
    created_at: datetime

    model_config = {"from_attributes": True}

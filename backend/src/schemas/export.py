"""Pydantic schemas for "Dataset export".

Response shapes are 1:1 with the frontend contract `src/api/types.ts` (ExportJob,
ExportRequest): progress is whole percentages 0..100, status additionally
supports 'cancelled' (stored in the DB as status=error + error='cancelled',
since models.py is frozen and the ExportStatus enum does not contain cancelled).
"""

from datetime import datetime
from pathlib import PurePosixPath

from pydantic import BaseModel

from src.models import ExportFormat, ExportJob, ExportScope, ExportStatus, TaskType

CANCELLED_MARKER = "cancelled"


class ExportRequest(BaseModel):
    """Body of POST /project/{id}/export (types.ts ExportRequest)."""

    format: ExportFormat
    scope: ExportScope = ExportScope.consensus
    include_metadata: bool = False
    # Restrict to task types (chips on the export screen); None/[] — all types.
    task_types: list[TaskType] | None = None


class ExportJobOut(BaseModel):
    """Job response — shape of the frontend ExportJob type (types.ts)."""

    id: int
    project_id: int
    format: ExportFormat
    scope: ExportScope
    include_metadata: bool
    task_types: list[TaskType] = []
    # 'pending' | 'running' | 'done' | 'error' | 'cancelled'
    status: str
    # 0..100 ("Building… 43%")
    progress: int
    size_bytes: int
    filename: str
    download_url: str | None = None
    created_at: datetime

    @classmethod
    def from_job(cls, job: ExportJob, task_types: list[TaskType] | None = None) -> "ExportJobOut":
        status = job.status.value
        if job.status == ExportStatus.error and job.error == CANCELLED_MARKER:
            status = CANCELLED_MARKER
        filename = (
            PurePosixPath(job.file_key).name if job.file_key else f"export_{job.id}.{job.format.value}"
        )
        download_url = f"/api/export/{job.id}/download" if job.status == ExportStatus.done else None
        return cls(
            id=job.id,
            project_id=job.project_id,
            format=job.format,
            scope=job.scope,
            include_metadata=job.include_metadata,
            task_types=task_types or [],
            status=status,
            progress=max(0, min(100, round(job.progress * 100))),
            size_bytes=job.size_bytes,
            filename=filename,
            download_url=download_url,
            created_at=job.created_at,
        )

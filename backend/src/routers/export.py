"""Dataset export + history.

Contract (frontend: src/api/types.ts + src/api/client.ts):
  POST   /project/{id}/export            — create an ExportJob (202), built
                                           asynchronously via BackgroundTasks;
  GET    /project/{id}/exports           — export history (newest first);
  GET    /export/{job_id}                — status/progress for polling;
  GET    /project/{id}/export/{job_id}   — same (the path client.ts calls);
  DELETE /project/{id}/export/{job_id}   — cancel building;
  GET    /export/{job_id}/download       — file (LocalStorage — directly,
                                           S3 — redirect to a presigned URL).

Errors — machine-readable codes: project_not_found, export_not_found,
format_not_applicable.

Scope: 'all' — all done tasks of all annotators; 'consensus' — one record
per fragment by the MAJORITY of K done results (K = Project.consensus_overlap,
consensus mechanism; on a tie the group with the latest submission wins) —
see pick_consensus in serializers/base.py.
Cancellation: in the DB status=error + error='cancelled' (models.py is frozen,
enum has no cancelled); outward status='cancelled' is returned. The task_types
filter lives in process memory (ExportJob has no column) — after a restart the
history returns [].

MOS projects (Project.task_type='mos'): result — {scores: {scale: 1..5}}
over the project's configurable scales (legacy {score: N} is read as
{scores: {'MOS': N}}), without text or segments, so only jsonl (a per-scale
scores object) and csv (an mos_<name> column per scale) are applicable.

SBS projects (Project.task_type='sbs'): result — {preference: -2..2}
in terms of systems (minus = A better, plus = B), the fragment is a pair; only
jsonl ({audio, audio_b, preference, systems}) and csv (columns audio_b
and sbs_preference) are applicable. For both types nemo/textgrid/conll/srt_vtt
respond 422 'format_not_applicable' (these formats have no meaningful minimum).
"""

import re
from pathlib import PurePosixPath

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.auth import get_current_admin
from src.db import get_db
from src.models import (
    AudioFragment,
    ExportFormat,
    ExportJob,
    ExportStatus,
    Project,
    Task,
    TaskStatus,
    TaskType,
    User,
)
from src.schemas.export import CANCELLED_MARKER, ExportJobOut, ExportRequest
from src.serializers import (
    ARCHIVE_EXT,
    build_archive,
    build_record,
    pick_consensus,
    serialize_dataset,
)
from src.storage import LocalStorage, get_storage

router = APIRouter(tags=["export"])

# Process state (does not survive a restart — see the module docstring):
# the task_types filter by job.id and the set of jobs for which cancellation was requested.
_job_task_types: dict[int, list[str]] = {}
_cancelled_jobs: set[int] = set()

# Only tabular formats (result without text/segments): applicable to
# MOS projects (result={scores}) and SBS projects (result={preference})
_TABULAR_FORMATS = {ExportFormat.jsonl, ExportFormat.csv}
# Task types that have no meaningful text/segments for nemo/textgrid/
# conll/srt_vtt — exporting to them responds 422 'format_not_applicable'
_TABULAR_ONLY_TYPES = {TaskType.mos, TaskType.sbs}

# Transliterate the project name into a filename slug
_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def _slug(name: str) -> str:
    chars = []
    for ch in name.lower():
        if ch in _TRANSLIT:
            chars.append(_TRANSLIT[ch])
        elif ch.isascii() and ch.isalnum():
            chars.append(ch)
        else:
            chars.append("-")
    return re.sub(r"-+", "-", "".join(chars)).strip("-")


def _get_project(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return project


def _get_job(db: Session, job_id: int, project_id: int | None = None) -> ExportJob:
    job = db.get(ExportJob, job_id)
    if job is None or (project_id is not None and job.project_id != project_id):
        raise HTTPException(status_code=404, detail="export_not_found")
    return job


def _out(job: ExportJob) -> ExportJobOut:
    return ExportJobOut.from_job(job, _job_task_types.get(job.id))


# ---------------------------------------------------------------------------
# Background dataset building
# ---------------------------------------------------------------------------


def _is_cancelled(job: ExportJob) -> bool:
    return job.id in _cancelled_jobs


def _run_export_job(job_id: int, bind) -> None:
    """Builds the dataset: records → serializer → archive → storage.

    Runs in the background (BackgroundTasks), so it opens its own session
    on the same engine as the request. Writes progress/size to the job row.
    """
    session = Session(bind=bind)
    try:
        job = session.get(ExportJob, job_id)
        if job is None or job.status != ExportStatus.pending or _is_cancelled(job):
            return
        job.status = ExportStatus.running
        job.progress = 0.05
        session.commit()

        # SBS project system names — for the systems field in the export (None for others)
        project = session.get(Project, job.project_id)
        sbs_systems = project.sbs_systems if project is not None else None

        stmt = (
            select(AudioFragment)
            .where(AudioFragment.project_id == job.project_id)
            .options(selectinload(AudioFragment.tasks).selectinload(Task.user))
            .order_by(AudioFragment.id)
        )
        task_types = _job_task_types.get(job_id)
        if task_types:
            stmt = stmt.where(AudioFragment.task_type.in_(task_types))
        fragments = session.scalars(stmt).all()

        records = []
        total = len(fragments)
        chunk = max(1, total // 5)
        for i, fragment in enumerate(fragments, start=1):
            if job.scope.value == "consensus":
                # Majority of the fragment's K done results
                # (K = consensus_overlap; on a tie — the latest by time)
                winner = pick_consensus(fragment.tasks)
                if winner is not None:
                    records.append(build_record(fragment, winner, sbs_systems))
            else:  # scope=all: all done tasks of all annotators
                for task in fragment.tasks:
                    if task.status == TaskStatus.done:
                        records.append(build_record(fragment, task, sbs_systems))
            if i % chunk == 0 or i == total:
                if _is_cancelled(job):
                    session.rollback()
                    return
                job.progress = 0.05 + 0.75 * i / total
                session.commit()

        members = serialize_dataset(job.format.value, records, job.include_metadata)
        job.progress = 0.9
        session.commit()

        data = build_archive(job.format.value, members)
        if _is_cancelled(job):
            session.rollback()
            return
        get_storage().put(job.file_key, data)

        job.size_bytes = len(data)
        job.progress = 1.0
        job.status = ExportStatus.done
        session.commit()
    except Exception as exc:  # noqa: BLE001 — the error status goes into the job row
        session.rollback()
        job = session.get(ExportJob, job_id)
        if job is not None:
            job.status = ExportStatus.error
            job.error = str(exc)
            session.commit()
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/project/{project_id}/export", response_model=ExportJobOut, status_code=202)
def create_export(
    project_id: int,
    payload: ExportRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> ExportJobOut:
    """Start asynchronous dataset building. 202 + ExportJob (pending).

    For MOS and SBS projects only jsonl/csv are allowed — other formats
    respond 422 'format_not_applicable' (see the module docstring)."""
    project = _get_project(db, project_id)
    if project.task_type in _TABULAR_ONLY_TYPES and payload.format not in _TABULAR_FORMATS:
        raise HTTPException(status_code=422, detail="format_not_applicable")
    job = ExportJob(
        project_id=project.id,
        format=payload.format,
        scope=payload.scope,
        include_metadata=payload.include_metadata,
        status=ExportStatus.pending,
        progress=0.0,
        size_bytes=0,
    )
    db.add(job)
    db.flush()
    # A freshly created job must not inherit process state from a job
    # with the same id from another DB (tests) or after the record was recreated.
    _cancelled_jobs.discard(job.id)
    _job_task_types.pop(job.id, None)
    slug = _slug(project.name) or f"project-{project.id}"
    filename = f"{slug}_{payload.format.value}.{ARCHIVE_EXT[payload.format.value]}"
    job.file_key = f"exports/{project.id}/{job.id}/{filename}"
    db.commit()
    db.refresh(job)
    if payload.task_types:
        _job_task_types[job.id] = [t.value for t in payload.task_types]
    background.add_task(_run_export_job, job.id, db.get_bind())
    out = _out(job)
    # Export screen contract: a freshly created job is returned as
    # running — the frontend polls status only for running jobs. In the DB it stays
    # pending: _run_export_job starts strictly from pending.
    if out.status == "pending":
        out.status = "running"
    return out


@router.get("/project/{project_id}/exports", response_model=list[ExportJobOut])
def list_exports(
    project_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> list[ExportJobOut]:
    """Project export history (newest first) with download links."""
    _get_project(db, project_id)
    jobs = db.scalars(
        select(ExportJob)
        .where(ExportJob.project_id == project_id)
        .order_by(ExportJob.created_at.desc(), ExportJob.id.desc())
    ).all()
    return [_out(j) for j in jobs]


@router.get("/export/{job_id}", response_model=ExportJobOut)
def export_status(
    job_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> ExportJobOut:
    """Status/progress of a single job (short path for polling)."""
    return _out(_get_job(db, job_id))


@router.get("/project/{project_id}/export/{job_id}", response_model=ExportJobOut)
def export_status_in_project(
    project_id: int,
    job_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> ExportJobOut:
    """Job status/progress — the path the frontend client.ts uses."""
    return _out(_get_job(db, job_id, project_id=project_id))


@router.delete("/project/{project_id}/export/{job_id}", response_model=ExportJobOut)
def cancel_export(
    project_id: int,
    job_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
) -> ExportJobOut:
    """Cancel building. Only pending/running can be cancelled."""
    job = _get_job(db, job_id, project_id=project_id)
    if job.status not in (ExportStatus.pending, ExportStatus.running):
        raise HTTPException(status_code=404, detail="export_not_found")
    _cancelled_jobs.add(job.id)
    job.status = ExportStatus.error
    job.error = CANCELLED_MARKER
    db.commit()
    return _out(job)


@router.get("/export/{job_id}/download")
def download_export(
    job_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    """Download a ready file: LocalStorage — the body directly (with
    Content-Disposition), S3 — redirect to a presigned URL."""
    job = _get_job(db, job_id)
    if job.status != ExportStatus.done or not job.file_key:
        raise HTTPException(status_code=404, detail="export_not_found")
    storage = get_storage()
    if isinstance(storage, LocalStorage):
        try:
            data = storage.get(job.file_key)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="export_not_found")
        filename = PurePosixPath(job.file_key).name
        media_type = "application/gzip" if filename.endswith(".tar.gz") else "application/zip"
        return Response(
            content=data,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    return RedirectResponse(storage.presigned_url(job.file_key), status_code=307)

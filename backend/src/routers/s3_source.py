"""«Connect data from S3» feature (reference-in-place).

Model of operation: source objects are NOT copied into the application storage.
Import creates AudioFragment records that reference objects in the source
bucket (AudioFragment.source_id → S3Source); the presigned URL for playback
is generated AGAINST the source (storage.get_source_storage).

Endpoints (all under /api, admin only):
  POST   /project/{id}/s3-sources     — create a source (connection check);
  GET    /project/{id}/s3-sources     — the project's sources list (without secrets);
  DELETE /s3-source/{id}              — delete a source (+ its fragments, like
                                        DELETE fragment, but WITHOUT deleting the
                                        source objects);
  POST   /s3-source/{id}/preview      — listing under the prefix (audio filter,
                                        sbs pairing, already_imported/to_import);
  POST   /s3-source/{id}/import       — create an AudioFragment for each NEW
                                        object (for sbs — for an _a/_b pair), K tasks
                                        (consensus_overlap) per fragment.
                                        Idempotent by (project_id, s3_key).

IMPORTANT: secret_key is NEVER in the response (S3SourceOut omits it) or in logs.
Upload filename = basename of the key; duration_sec=null; size_bytes from S3
(listing Size == ContentLength); task_type is inherited from the project.
"""

import random
import re

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth import get_current_admin
from src.db import get_db
from src.models import AudioFragment, Project, S3Source, Task, TaskStatus, TaskType, User
from src.schemas.s3_source import (
    S3ImportResult,
    S3SourceCreate,
    S3SourceOut,
    S3SourcePreview,
)
from src.storage import get_source_storage

router = APIRouter(tags=["s3-source"])

# Listing/import cap: we actually count up to this number of objects, beyond
# that we mark the preview as truncated (contract: "up to a reasonable cap of 10000")
MAX_LIST_OBJECTS = 10000
# How many keys to put into the preview sample
PREVIEW_SAMPLE = 20

# SBS pair: the _a/_b suffix strictly before the key extension (case-insensitive).
# The key is grouped by base+ext of the WHOLE key (including folders) — halves from
# one source "folder" are paired with each other.
_PAIR_SUFFIX_RE = re.compile(r"^(?P<base>.+)_(?P<side>[ab])\.(?P<ext>[^.]+)$", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return project


def _source_or_404(db: Session, source_id: int) -> S3Source:
    source = db.get(S3Source, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="s3_source_not_found")
    return source


def _basename(key: str) -> str:
    """Object name without the path prefix (basename of the key)."""
    return key.rsplit("/", 1)[-1]


def _split_pair_key(key: str) -> tuple[str, str] | None:
    """SBS pair key → (pair_key, side ∈ {'a','b'}); a name without an _a/_b suffix
    before the extension → None (unpaired file). pair_key groups the halves
    <base>_a.<ext> and <base>_b.<ext> into one pair."""
    m = _PAIR_SUFFIX_RE.match(key)
    if m is None:
        return None
    return f"{m.group('base').lower()}|{m.group('ext').lower()}", m.group("side").lower()


def _existing_keys(db: Session, project_id: int) -> set[str]:
    """Keys of objects already imported into the project (idempotency by
    (project_id, s3_key)); includes s3_key of all project fragments."""
    return set(
        db.execute(
            select(AudioFragment.s3_key).where(AudioFragment.project_id == project_id)
        ).scalars()
    )


def _source_out(source: S3Source, object_count: int | None = None) -> S3SourceOut:
    """Source in the response — WITHOUT secret_key/access_key (secrets never leave the backend)."""
    return S3SourceOut(
        id=source.id,
        project_id=source.project_id,
        name=source.name,
        endpoint_url=source.endpoint_url,
        bucket=source.bucket,
        prefix=source.prefix or "",
        region=source.region,
        path_style=source.path_style,
        created_at=source.created_at,
        object_count=object_count,
    )


def _list_audio(source: S3Source) -> tuple[list[tuple[str, int]], bool]:
    """The source's audio objects under its prefix: [(key, size)], truncated.

    Listing pagination is inside storage.list_objects (ContinuationToken).
    We cut off at MAX_LIST_OBJECTS (truncated=True — there are more under the prefix)."""
    storage = get_source_storage(source)
    items: list[tuple[str, int]] = []
    truncated = False
    for key, size in storage.list_objects(audio_only=True):
        if len(items) >= MAX_LIST_OBJECTS:
            truncated = True
            break
        items.append((key, size))
    return items, truncated


def _sbs_pairs(items: list[tuple[str, int]]) -> tuple[dict[str, dict[str, tuple[str, int]]], int]:
    """Groups audio objects into SBS pairs by the _a/_b suffixes.

    Returns (groups: pair_key → {'a'|'b': (key, size)}, lone_unpaired) —
    lone_unpaired counts files WITHOUT an _a/_b suffix before the extension
    (single halves — incomplete groups — are counted by the caller)."""
    groups: dict[str, dict[str, tuple[str, int]]] = {}
    lone = 0
    for key, size in items:
        parsed = _split_pair_key(key)
        if parsed is None:
            lone += 1
            continue
        pair_key, side = parsed
        groups.setdefault(pair_key, {})[side] = (key, size)
    return groups, lone


def _make_tasks(overlap: int, is_sbs: bool) -> list[Task]:
    """K open tasks per fragment (K = consensus_overlap). For sbs each has
    its own blind order Task.swap (random), as in a regular upload."""
    if is_sbs:
        return [
            Task(status=TaskStatus.open, swap=random.choice((False, True)))
            for _ in range(overlap)
        ]
    return [Task(status=TaskStatus.open) for _ in range(overlap)]


# ---------------------------------------------------------------------------
# Source CRUD
# ---------------------------------------------------------------------------


@router.post("/project/{project_id}/s3-sources", response_model=S3SourceOut, status_code=201)
def create_s3_source(
    project_id: int,
    body: S3SourceCreate,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> S3SourceOut:
    """Create a project data source. The backend CHECKS the connection (list with
    limit=1) — on error 400 's3_connection_failed', the source is NOT created.
    Response (201) — the source without secrets."""
    _project_or_404(db, project_id)
    source = S3Source(
        project_id=project_id,
        name=body.name.strip(),
        endpoint_url=body.endpoint_url.strip(),
        bucket=body.bucket.strip(),
        prefix=body.prefix or "",
        access_key=body.access_key,
        secret_key=body.secret_key,
        region=(body.region or None),
        path_style=body.path_style,
    )
    # Connection check BEFORE writing (we don't save if the source is unavailable)
    try:
        get_source_storage(source).check_connection()
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — any boto3/network failure → machine-readable code
        raise HTTPException(status_code=400, detail="s3_connection_failed")
    db.add(source)
    db.commit()
    db.refresh(source)
    return _source_out(source, object_count=0)


@router.get("/project/{project_id}/s3-sources", response_model=list[S3SourceOut])
def list_s3_sources(
    project_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> list[S3SourceOut]:
    """The project's sources list (without secrets). object_count — the number of
    audio objects under the source prefix (best-effort live listing, cap
    MAX_LIST_OBJECTS): if the source is unavailable — null (we don't fail the list,
    so the admin can delete a broken source)."""
    _project_or_404(db, project_id)
    sources = db.execute(
        select(S3Source).where(S3Source.project_id == project_id).order_by(S3Source.id)
    ).scalars().all()
    out: list[S3SourceOut] = []
    for source in sources:
        try:
            count = sum(
                1
                for _ in get_source_storage(source).list_objects(
                    audio_only=True, max_keys=MAX_LIST_OBJECTS
                )
            )
        except Exception:  # noqa: BLE001 — source unavailable → object_count=null
            count = None
        out.append(_source_out(source, object_count=count))
    return out


@router.delete("/s3-source/{source_id}", status_code=204)
def delete_s3_source(
    source_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> Response:
    """Delete a source. Referencing fragments are also deleted (like DELETE
    fragment: tasks cascade) — but objects in the SOURCE BUCKET are NOT touched
    (reference-in-place: the application does not own them)."""
    source = _source_or_404(db, source_id)
    fragments = db.execute(
        select(AudioFragment).where(AudioFragment.source_id == source_id)
    ).scalars().all()
    for fragment in fragments:
        db.delete(fragment)  # per-fragment cascade → tasks
    db.delete(source)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Listing preview
# ---------------------------------------------------------------------------


@router.post("/s3-source/{source_id}/preview", response_model=S3SourcePreview)
def preview_s3_source(
    source_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> S3SourcePreview:
    """Listing of audio objects under the source prefix: how many in total, a sample
    of keys, how many are already imported and how many are to import. For an sbs
    project — also the number of complete pairs and single/unpaired files."""
    source = _source_or_404(db, source_id)
    project = _project_or_404(db, source.project_id)
    try:
        items, truncated = _list_audio(source)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — source failure (creds/bucket disappeared)
        raise HTTPException(status_code=400, detail="s3_connection_failed")

    existing = _existing_keys(db, project.id)
    sample = [key for key, _ in items[:PREVIEW_SAMPLE]]
    total_audio = len(items)

    if project.task_type == TaskType.sbs:
        groups, unpaired = _sbs_pairs(items)
        pairs = already = to_import = 0
        for halves in groups.values():
            if "a" in halves and "b" in halves:
                pairs += 1
                if halves["a"][0] in existing:
                    already += 1
                else:
                    to_import += 1
            else:
                unpaired += 1  # a single half without a partner
        return S3SourcePreview(
            total_audio=total_audio,
            sample=sample,
            already_imported=already,
            to_import=to_import,
            pairs=pairs,
            unpaired=unpaired,
            truncated=truncated,
        )

    already = sum(1 for key, _ in items if key in existing)
    return S3SourcePreview(
        total_audio=total_audio,
        sample=sample,
        already_imported=already,
        to_import=total_audio - already,
        truncated=truncated,
    )


# ---------------------------------------------------------------------------
# Import (creating fragments by reference)
# ---------------------------------------------------------------------------


@router.post("/s3-source/{source_id}/import", response_model=S3ImportResult)
def import_s3_source(
    source_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> S3ImportResult:
    """Create an AudioFragment for each NEW source object (skip keys already
    imported into the project). For sbs — one fragment per _a/_b pair
    (unpaired are skipped). Per fragment — K tasks (consensus_overlap).
    Idempotent: repeating the same prefix → imported=0."""
    source = _source_or_404(db, source_id)
    project = _project_or_404(db, source.project_id)
    try:
        items, _ = _list_audio(source)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="s3_connection_failed")

    existing = _existing_keys(db, project.id)
    overlap = project.consensus_overlap
    is_sbs = project.task_type == TaskType.sbs

    if is_sbs:
        groups, unpaired = _sbs_pairs(items)
        imported = skipped = 0
        for halves in groups.values():
            if "a" not in halves or "b" not in halves:
                unpaired += 1
                continue
            key_a, size_a = halves["a"]
            key_b, size_b = halves["b"]
            if key_a in existing:
                skipped += 1
                continue
            db.add(
                AudioFragment(
                    project_id=project.id,
                    source_id=source.id,
                    filename=_basename(key_a),
                    s3_key=key_a,
                    size_bytes=size_a,
                    duration_sec=None,
                    filename_b=_basename(key_b),
                    s3_key_b=key_b,
                    size_bytes_b=size_b,
                    duration_sec_b=None,
                    task_type=TaskType.sbs,
                    orig_trb=None,  # ASR hints are not applicable to sbs
                    meta={},
                    tasks=_make_tasks(overlap, is_sbs=True),
                )
            )
            existing.add(key_a)
            imported += 1
        db.commit()
        return S3ImportResult(imported=imported, skipped=skipped, unpaired=unpaired)

    imported = skipped = 0
    for key, size in items:
        if key in existing:
            skipped += 1
            continue
        db.add(
            AudioFragment(
                project_id=project.id,
                source_id=source.id,
                filename=_basename(key),
                s3_key=key,
                size_bytes=size,
                duration_sec=None,
                task_type=project.task_type,  # inherited from the project
                orig_trb=None,
                meta={},
                tasks=_make_tasks(overlap, is_sbs=False),
            )
        )
        existing.add(key)
        imported += 1
    db.commit()
    return S3ImportResult(imported=imported, skipped=skipped)

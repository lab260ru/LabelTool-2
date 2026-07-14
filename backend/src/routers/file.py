"""Session-based batch upload.

Frontend contract — src/api/client.ts:
  POST /upload/session                        — create a session: detect duplicates
                                                and format failures BEFORE writing
  POST /upload/session/{sid}/file/{client_id} — upload one file (raw body);
                                                the client sends in parallel
  POST /upload/session/{sid}/finish           — session summary (UploadSummary)
  POST /upload/manifest/preview               — preview a CSV/JSONL manifest
  POST /upload/session/{sid}/manifest         — import a manifest with column mapping
  GET  /upload/manifest/errors.csv            — CSV of the last import's error rows

Additional endpoints:
  POST /file/batch                            — one-step multipart batch upload
  GET  /project/{id}/files/conflicts          — name-conflict check
  POST /project/{id}/manifest                 — one-step manifest import
  GET  /file/upload-sessions/{project_id}     — session history (UploadSession counters)

Rules:
  - authorization — an admin session (get_current_admin), no static tokens;
  - server-side validation: MP3/WAV/FLAC/OGG format by extension AND magic
    bytes, size ≤200 MB;
  - name dedup within the project: a conflict is detected BEFORE writing; modes
    conflict=reject (a per-file error 'duplicate_name') | rename (a unique
    name "name (2).ext" + a unique S3 key). There is NO silent overwrite;
  - a file's business errors — 200 + UploadFileResult{ok=false}: errors do not break the batch;
  - the task type from the client is NOT accepted: task_type fields in
    requests are DEPRECATED and ignored, fragments
    and manifest rows inherit Project.task_type; the manifest's task_type
    column is not imported (the 'bad_task_type' row error is removed);
  - consensus mechanism: for each created fragment (a file and a manifest
    row) K = Project.consensus_overlap open tasks are created —
    the fragment is annotated by K different annotators (1 = no consensus).

Limitation: the upload sessions' state lives in process memory (the
models have no field for the session payload) — a multi-process deployment needs
a shared store (Redis/a DB field). The UploadSession counters are written to the DB regardless.
"""

import csv
import io
import json
import random
import re
import threading
import uuid
from dataclasses import dataclass, field
from typing import Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, UploadFile
from fastapi import File as FileParam
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth import get_current_admin
from src.db import get_db
from src.models import AudioFragment, Project, Task, TaskStatus, TaskType, UploadSession, User
from src.schemas.file import (
    BatchFileResult,
    BatchUploadResult,
    ColumnMapping,
    ConflictCheckResult,
    ConflictMode,
    ManifestImportRequest,
    ManifestPreview,
    ManifestRow,
    UploadFailedRow,
    UploadFileMeta,
    UploadFileResult,
    UploadSessionInfo,
    UploadSessionOut,
    UploadSessionRequest,
    UploadSummary,
)
from src.storage import get_storage

router = APIRouter(tags=["file"])

# ---------------------------------------------------------------------------
# Constants and validation
# ---------------------------------------------------------------------------

MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024  # ≤200 MB
SUPPORTED_EXTENSIONS = ("mp3", "wav", "flac", "ogg")
MANIFEST_PREVIEW_ROWS = 50
MANIFEST_ERRORS_URL = "/api/upload/manifest/errors.csv"

# Heuristics for auto-mapping manifest columns (lower-case).
# The task_type column is still recognized (and excluded from metadata),
# but its values are ignored — the type is set by the project.
_FILENAME_COLUMNS = ("filename", "file", "path", "audio", "audio_filepath", "wav", "name")
_TASK_TYPE_COLUMNS = ("task_type", "tasktype", "task", "type")
_ORIG_TRB_COLUMNS = ("orig_trb", "text", "transcript", "transcription", "asr_text", "asr")
# Side-by-Side: columns for the pair's variant names (sbs project manifest)
_FILENAME_A_COLUMNS = ("filename_a", "file_a", "audio_a", "wav_a", "path_a", "a")
_FILENAME_B_COLUMNS = ("filename_b", "file_b", "audio_b", "wav_b", "path_b", "b")


# Side-by-Side: the pair variant suffix strictly before the extension —
# <base>_a.<ext> / <base>_b.<ext> (case-insensitive, exactly _a/_b)
_PAIR_SUFFIX_RE = re.compile(r"^(?P<base>.+)_(?P<side>[ab])\.(?P<ext>[^.]+)$", re.IGNORECASE)


def _split_pair(filename: str) -> tuple[str, str] | None:
    """Parse an SBS pair filename into (pair_key, side).

    side ∈ {'a','b'} (lower case); pair_key — a case-insensitive key of
    base+extension for grouping the two halves (<base>_a.<ext> and
    <base>_b.<ext> give one key). A name without an _a/_b suffix before
    the extension → None (unpaired file)."""
    m = _PAIR_SUFFIX_RE.match(filename)
    if m is None:
        return None
    return f"{m.group('base').lower()}|{m.group('ext').lower()}", m.group("side").lower()


def _sbs_task() -> "Task":
    """An open sbs task with a BLIND order: swap — random for each of the
    fragment's K tasks (payload applies it; submit normalizes it back)."""
    return Task(status=TaskStatus.open, swap=random.choice((False, True)))


def _ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _ext_supported(filename: str) -> bool:
    return _ext(filename) in SUPPORTED_EXTENSIONS


def _magic_ok(filename: str, data: bytes) -> bool:
    """The magic bytes must match the file extension."""
    if len(data) < 12:
        return False
    ext = _ext(filename)
    if ext == "wav":
        return data[:4] == b"RIFF" and data[8:12] == b"WAVE"
    if ext == "flac":
        return data[:4] == b"fLaC"
    if ext == "ogg":
        return data[:4] == b"OggS"
    if ext == "mp3":
        # ID3 tag or MPEG frame sync (11 bits of ones)
        return data[:3] == b"ID3" or (data[0] == 0xFF and (data[1] & 0xE0) == 0xE0)
    return False


def _validate_content(filename: str, data: bytes) -> str | None:
    """An error code ('unsupported_format' | 'file_too_large') or None."""
    if not _ext_supported(filename):
        return "unsupported_format"
    if len(data) > MAX_FILE_SIZE_BYTES:
        return "file_too_large"
    if not _magic_ok(filename, data):
        return "unsupported_format"
    return None


def _project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return project


def _project_filenames(db: Session, project_id: int) -> set[str]:
    rows = db.execute(
        select(AudioFragment.filename).where(AudioFragment.project_id == project_id)
    )
    return {name for (name,) in rows}


def _unique_name(filename: str, taken: set[str]) -> str:
    """A free name of the form "name (2).ext" — the conflict=rename mode."""
    if "." in filename:
        stem, _, ext = filename.rpartition(".")
        suffix = f".{ext}"
    else:
        stem, suffix = filename, ""
    n = 2
    while f"{stem} ({n}){suffix}" in taken:
        n += 1
    return f"{stem} ({n}){suffix}"


def _s3_key(project_id: int, filename: str, *, manifest: bool = False) -> str:
    """A unique S3 key: overwriting another object is precluded."""
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", filename)
    prefix = f"project_{project_id}/manifest" if manifest else f"project_{project_id}"
    return f"{prefix}/{uuid.uuid4().hex}_{safe}"


# ---------------------------------------------------------------------------
# Upload sessions state (in-memory, see the module docstring)
# ---------------------------------------------------------------------------


@dataclass
class _SessionState:
    token: str
    db_id: int  # id of the UploadSession row
    project_id: int
    task_type: TaskType
    consensus_overlap: int  # how many open tasks are created per fragment
    conflict: ConflictMode
    metadata: dict[str, str]
    orig_trb: dict[str, str]  # client_id -> text
    orig_trb_all: str | None
    files: dict[str, UploadFileMeta]  # client_id -> metadata
    # sbs project: a fragment is a PAIR, assembled by the _a/_b suffixes within
    # the session; halves wait for a partner here (pair_key -> {'a'|'b': half})
    is_sbs: bool = False
    pending_halves: dict[str, dict[str, dict]] = field(default_factory=dict)
    results: dict[str, UploadFileResult] = field(default_factory=dict)
    manifest_imported: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)


@dataclass
class _ManifestState:
    """A parsed manifest: (index, cells, parse_error) per row."""

    filename: str
    columns: list[str]
    rows: list[tuple[int, dict[str, str], str | None]]


_SESSIONS: dict[str, _SessionState] = {}
_SESSIONS_LOCK = threading.Lock()
# The last parsed manifest and the import errors CSV — keyed by admin.id
# (the import references only session_id, the file is not resent)
_MANIFESTS: dict[int, _ManifestState] = {}
_MANIFEST_ERRORS: dict[int, str] = {}


def _get_session_or_404(session_id: str) -> _SessionState:
    state = _SESSIONS.get(session_id)
    if state is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    return state


def _sync_session_counters(db: Session, state: _SessionState) -> None:
    """Absolute counter values in the DB (under lock — parallel-safe)."""
    with state.lock:
        succeeded = sum(1 for r in state.results.values() if r.ok)
        failed = len(state.results) - succeeded
    row = db.get(UploadSession, state.db_id)
    if row is not None:
        row.succeeded = succeeded
        row.failed = failed
        db.commit()


# ---------------------------------------------------------------------------
# Core: storing a single file
# ---------------------------------------------------------------------------


def _store_file(
    db: Session,
    *,
    project_id: int,
    task_type: TaskType,
    consensus_overlap: int,
    conflict: ConflictMode,
    batch_metadata: dict[str, str],
    client_id: str,
    filename: str,
    data: bytes,
    duration: float | None,
    orig_trb: str | None,
) -> tuple[UploadFileResult, str | None]:
    """Validation + dedup + write to storage + AudioFragment.

    Returns (the per-file result, the final name in the project or None).
    All business errors are in the result, nothing is raised outward.
    """

    def fail(reason: str) -> tuple[UploadFileResult, None]:
        return (
            UploadFileResult(client_id=client_id, ok=False, fragment_id=None, error_reason=reason),
            None,
        )

    error = _validate_content(filename, data)
    if error:
        return fail(error)

    # Name dedup: detect BEFORE writing, without silent overwrite
    target = filename
    taken = _project_filenames(db, project_id)
    if filename in taken:
        if conflict == "reject":
            return fail("duplicate_name")
        target = _unique_name(filename, taken)

    key = _s3_key(project_id, target)
    try:
        get_storage().put(key, data)
    except Exception:  # noqa: BLE001 — a storage failure does not break the batch
        return fail("s3_timeout")

    fragment = AudioFragment(
        project_id=project_id,
        filename=target,
        s3_key=key,
        size_bytes=len(data),
        duration_sec=duration,
        task_type=task_type,
        orig_trb=orig_trb,
        meta=dict(batch_metadata),
        # Every fragment immediately has open tasks
        # (otherwise /task/random after upload responds no_tasks_available);
        # consensus mechanism — K = Project.consensus_overlap tasks,
        # so the fragment is annotated by K different annotators
        tasks=[Task(status=TaskStatus.open) for _ in range(consensus_overlap)],
    )
    db.add(fragment)
    db.commit()
    db.refresh(fragment)
    return (
        UploadFileResult(client_id=client_id, ok=True, fragment_id=fragment.id),
        target,
    )


# ---------------------------------------------------------------------------
# Side-by-Side: assembling a pair and creating ONE fragment per pair
# ---------------------------------------------------------------------------


def _create_sbs_fragment(
    db: Session,
    *,
    project_id: int,
    conflict: ConflictMode,
    metadata: dict[str, str],
    consensus_overlap: int,
    half_a: dict,
    half_b: dict,
) -> tuple[UploadFileResult, UploadFileResult]:
    """Creates ONE AudioFragment per pair (filename=<...>_a, filename_b=<...>_b)
    with K sbs tasks (Task.swap=random for each). half_* = {client_id,
    filename, data, duration}. Returns the per-file results (A, B)."""

    def both(reason: str | None, fragment_id: int | None = None) -> tuple[UploadFileResult, UploadFileResult]:
        return (
            UploadFileResult(
                client_id=half_a["client_id"], ok=reason is None,
                fragment_id=fragment_id, error_reason=reason,
            ),
            UploadFileResult(
                client_id=half_b["client_id"], ok=reason is None,
                fragment_id=fragment_id, error_reason=reason,
            ),
        )

    a_name, b_name = half_a["filename"], half_b["filename"]
    taken = _project_filenames(db, project_id)
    # Dedup by the name of either pair variant (without silent overwrite)
    if a_name in taken or b_name in taken:
        if conflict == "reject":
            return both("duplicate_name")
        if a_name in taken:
            a_name = _unique_name(a_name, taken)
            taken.add(a_name)
        if b_name in taken:
            b_name = _unique_name(b_name, taken)

    key_a = _s3_key(project_id, a_name)
    key_b = _s3_key(project_id, b_name)
    storage = get_storage()
    try:
        storage.put(key_a, half_a["data"])
        storage.put(key_b, half_b["data"])
    except Exception:  # noqa: BLE001 — a storage failure does not break the batch
        return both("s3_timeout")

    fragment = AudioFragment(
        project_id=project_id,
        filename=a_name,
        s3_key=key_a,
        size_bytes=len(half_a["data"]),
        duration_sec=half_a["duration"],
        filename_b=b_name,
        s3_key_b=key_b,
        size_bytes_b=len(half_b["data"]),
        duration_sec_b=half_b["duration"],
        task_type=TaskType.sbs,
        orig_trb=None,  # ASR hints are not applicable to sbs
        meta=dict(metadata),
        # K = consensus_overlap sbs tasks, each with its own blind order swap
        tasks=[_sbs_task() for _ in range(consensus_overlap)],
    )
    db.add(fragment)
    db.commit()
    db.refresh(fragment)
    return both(None, fragment.id)


def _store_sbs_session_file(
    db: Session, state: _SessionState, client_id: str, filename: str, data: bytes, duration: float | None
) -> tuple[UploadFileResult, list[tuple[str, UploadFileResult]]]:
    """Process one file of an sbs project session: assembles a pair by the
    _a/_b suffixes. While only one half has arrived — ok=true without fragment_id (waiting
    for the partner); when the second arrives ONE fragment is created, both results
    are updated. An unpaired name / format failure — ok=false immediately.

    Returns (the current file's result, updates for the partner's results)."""
    error = _validate_content(filename, data)
    if error:
        return UploadFileResult(client_id=client_id, ok=False, error_reason=error), []
    parsed = _split_pair(filename)
    if parsed is None:
        return UploadFileResult(client_id=client_id, ok=False, error_reason="unpaired"), []
    pair_key, side = parsed
    half = {"client_id": client_id, "filename": filename, "data": data, "duration": duration}
    with state.lock:
        halves = state.pending_halves.setdefault(pair_key, {})
        halves[side] = half
        if "a" in halves and "b" in halves:
            complete = (halves["a"], halves["b"])
            state.pending_halves.pop(pair_key, None)
        else:
            complete = None
    if complete is None:
        # The first half is accepted — waiting for the partner, no fragment yet
        return UploadFileResult(client_id=client_id, ok=True, fragment_id=None), []
    result_a, result_b = _create_sbs_fragment(
        db,
        project_id=state.project_id,
        conflict=state.conflict,
        metadata=state.metadata,
        consensus_overlap=state.consensus_overlap,
        half_a=complete[0],
        half_b=complete[1],
    )
    if side == "a":
        return result_a, [(result_b.client_id, result_b)]
    return result_b, [(result_a.client_id, result_a)]


# ---------------------------------------------------------------------------
# Session-based upload (client.ts)
# ---------------------------------------------------------------------------


@router.post("/upload/session", response_model=UploadSessionInfo, status_code=201)
def create_upload_session(
    body: UploadSessionRequest,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> UploadSessionInfo:
    """Create a batch-upload session: name conflicts and format failures
    are returned BEFORE writing files.

    body.task_type is DEPRECATED and ignored — the type is taken from the project."""
    project = _project_or_404(db, body.project_id)

    existing = _project_filenames(db, body.project_id)
    duplicates: list[str] = []
    seen: set[str] = set()
    for f in body.files:
        if f.filename in existing or f.filename in seen:
            duplicates.append(f.filename)
        seen.add(f.filename)
    unsupported = [f.filename for f in body.files if not _ext_supported(f.filename)]

    row = UploadSession(project_id=body.project_id, user_id=admin.id, total=len(body.files))
    db.add(row)
    db.commit()
    db.refresh(row)

    token = f"ses-{uuid.uuid4().hex[:12]}"
    state = _SessionState(
        token=token,
        db_id=row.id,
        project_id=body.project_id,
        task_type=project.task_type,  # the project's type, not the client's
        consensus_overlap=project.consensus_overlap,
        conflict=body.conflict,
        metadata=body.metadata,
        orig_trb=body.orig_trb,
        orig_trb_all=body.orig_trb_all,
        files={f.client_id: f for f in body.files},
        is_sbs=project.task_type == TaskType.sbs,
    )
    with _SESSIONS_LOCK:
        _SESSIONS[token] = state
    return UploadSessionInfo(session_id=token, duplicates=duplicates, unsupported=unsupported)


@router.post("/upload/session/{session_id}/file/{client_id}", response_model=UploadFileResult)
async def upload_session_file(
    session_id: str,
    client_id: str,
    request: Request,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> UploadFileResult:
    """Upload one file of a session (the request body is the file's raw bytes).

    The client sends files in parallel; business errors — 200 + ok=false.
    Re-uploading a client_id (the "Retry" button) overwrites the result.
    """
    state = _get_session_or_404(session_id)
    meta = state.files.get(client_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="file_not_in_session")

    data = await request.body()
    if state.is_sbs:
        # sbs: assemble a pair by the _a/_b suffixes; the fragment — once both are received
        result, others = _store_sbs_session_file(
            db, state, client_id, meta.filename, data, meta.duration
        )
        with state.lock:
            for cid, res in others:
                state.results[cid] = res
            state.results[client_id] = result
        _sync_session_counters(db, state)
        return result

    result, _ = _store_file(
        db,
        project_id=state.project_id,
        task_type=state.task_type,
        consensus_overlap=state.consensus_overlap,
        conflict=state.conflict,
        batch_metadata=state.metadata,
        client_id=client_id,
        filename=meta.filename,
        data=data,
        duration=meta.duration,
        orig_trb=state.orig_trb.get(client_id, state.orig_trb_all),
    )
    with state.lock:
        state.results[client_id] = result
    _sync_session_counters(db, state)
    return result


@router.post("/upload/session/{session_id}/finish", response_model=UploadSummary)
def finish_upload_session(
    session_id: str,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> UploadSummary:
    """Session summary (step 5): how many uploaded, the failed ones with reasons.

    sbs project: uploaded halves that never found a partner by finish —
    'unpaired' errors (a file without a pair is not uploaded)."""
    state = _get_session_or_404(session_id)
    with state.lock:
        for halves in state.pending_halves.values():
            for half in halves.values():
                state.results[half["client_id"]] = UploadFileResult(
                    client_id=half["client_id"], ok=False, error_reason="unpaired"
                )
        state.pending_halves.clear()
        results = list(state.results.values())
    failed = [
        UploadFailedRow(
            client_id=r.client_id,
            filename=state.files[r.client_id].filename if r.client_id in state.files else "",
            reason=r.error_reason or "cancelled",
        )
        for r in results
        if not r.ok
    ]
    _sync_session_counters(db, state)
    return UploadSummary(
        project_id=state.project_id,
        task_type=state.task_type,
        total=len(state.files),
        uploaded=sum(1 for r in results if r.ok),
        failed=failed,
        error_rows_url=MANIFEST_ERRORS_URL if state.manifest_imported else None,
    )


# ---------------------------------------------------------------------------
# CSV/JSONL manifest (tab 2)
# ---------------------------------------------------------------------------


def _parse_manifest(filename: str, raw: bytes) -> _ManifestState:
    """CSV/TSV/JSONL -> columns + rows (index, cells, parse_error)."""
    text = raw.decode("utf-8-sig", errors="replace")
    if not text.strip():
        raise HTTPException(status_code=400, detail="empty_manifest")

    lower = filename.lower()
    is_jsonl = lower.endswith((".jsonl", ".ndjson", ".json")) or (
        not lower.endswith((".csv", ".tsv")) and text.lstrip()[:1] == "{"
    )

    columns: list[str] = []
    rows: list[tuple[int, dict[str, str], str | None]] = []

    if is_jsonl:
        index = 0
        for line in text.splitlines():
            if not line.strip():
                continue
            index += 1
            try:
                obj = json.loads(line)
                if not isinstance(obj, dict):
                    raise ValueError("row is not an object")
            except ValueError:
                rows.append((index, {"raw": line.strip()}, "parse_error"))
                continue
            cells = {str(k): "" if v is None else str(v) for k, v in obj.items()}
            for col in cells:
                if col not in columns:
                    columns.append(col)
            rows.append((index, cells, None))
    else:
        delimiter = "\t" if lower.endswith(".tsv") else ","
        reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
        columns = [c for c in (reader.fieldnames or []) if c]
        if not columns:
            raise HTTPException(status_code=400, detail="manifest_parse_error")
        for index, record in enumerate(reader, start=1):
            cells = {
                k: "" if v is None else str(v)
                for k, v in record.items()
                if k is not None
            }
            rows.append((index, cells, None))

    if not rows:
        raise HTTPException(status_code=400, detail="empty_manifest")
    return _ManifestState(filename=filename, columns=columns, rows=rows)


def _suggest_mapping(columns: list[str]) -> ColumnMapping:
    """Auto-mapping of columns by name ("column mapping")."""
    lower = {c.lower(): c for c in columns}

    def pick(candidates: tuple[str, ...]) -> str | None:
        for cand in candidates:
            if cand in lower:
                return lower[cand]
        return None

    task_type_col = pick(_TASK_TYPE_COLUMNS)
    # Side-by-Side: if the manifest carries filename_a AND filename_b — map a pair
    # (single filename is empty, the row = one fragment-pair)
    filename_a_col = pick(_FILENAME_A_COLUMNS)
    filename_b_col = pick(_FILENAME_B_COLUMNS)
    if filename_a_col and filename_b_col:
        used = {filename_a_col, filename_b_col, task_type_col}
        metadata = {c: c for c in columns if c not in used}
        return ColumnMapping(
            filename="",
            task_type=task_type_col,
            orig_trb=None,
            filename_a=filename_a_col,
            filename_b=filename_b_col,
            metadata=metadata,
        )

    filename_col = pick(_FILENAME_COLUMNS) or (columns[0] if columns else "")
    orig_trb_col = pick(_ORIG_TRB_COLUMNS)
    used = {filename_col, task_type_col, orig_trb_col}
    metadata = {c: c for c in columns if c not in used}
    return ColumnMapping(
        filename=filename_col, task_type=task_type_col, orig_trb=orig_trb_col, metadata=metadata
    )


def _row_pair_names(cells: dict[str, str], mapping: ColumnMapping) -> tuple[str, str]:
    """The A/B variant names of an sbs manifest row (after strip)."""
    a = (cells.get(mapping.filename_a) or "").strip() if mapping.filename_a else ""
    b = (cells.get(mapping.filename_b) or "").strip() if mapping.filename_b else ""
    return a, b


def _mapping_has_target(mapping: ColumnMapping | None, is_sbs: bool) -> bool:
    """Whether the mapping has the target name column(s): a single filename or
    (for an sbs project) the pair filename_a + filename_b."""
    if mapping is None:
        return False
    if is_sbs:
        return bool(mapping.filename_a and mapping.filename_b)
    return bool(mapping.filename)


def _row_metadata(
    cells: dict[str, str], mapping: ColumnMapping, base_metadata: dict[str, str]
) -> dict[str, str]:
    """Manifest row metadata: base (per batch) + non-empty values
    of the mapped metadata columns."""
    meta = dict(base_metadata)
    for key, col in mapping.metadata.items():
        value = (cells.get(col) or "").strip()
        if value:
            meta[key] = value
    return meta


def _validate_row(
    cells: dict[str, str], parse_error: str | None, mapping: ColumnMapping
) -> str | None:
    """A manifest row's error code or None (per-row validation).

    sbs manifest (mapping.filename_a/filename_b set): a row is valid if
    BOTH pair names are non-empty and of a supported format. Otherwise — a single
    filename. The task_type column value check is removed ('bad_task_type'):
    the type is set by the project, the column is ignored."""
    if parse_error:
        return parse_error
    if mapping.filename_a or mapping.filename_b:
        a, b = _row_pair_names(cells, mapping)
        if not a or not b:
            return "missing_filename"
        if not _ext_supported(a) or not _ext_supported(b):
            return "unsupported_format"
        return None
    name = (cells.get(mapping.filename) or "").strip()
    if not name:
        return "missing_filename"
    if not _ext_supported(name):
        return "unsupported_format"
    return None


@router.post("/upload/manifest/preview", response_model=ManifestPreview)
async def preview_manifest(
    file: UploadFile = FileParam(...),
    admin: User = Depends(get_current_admin),
) -> ManifestPreview:
    """Manifest preview: columns, per-row validity, auto-mapping.

    The parsed manifest is remembered for the admin — the import into a session
    (POST /upload/session/{sid}/manifest) does not resend the file.
    """
    raw = await file.read()
    state = _parse_manifest(file.filename or "manifest", raw)
    mapping = _suggest_mapping(state.columns)

    preview_rows: list[ManifestRow] = []
    valid_count = 0
    for index, cells, parse_error in state.rows:
        error = _validate_row(cells, parse_error, mapping)
        if error is None:
            valid_count += 1
        if len(preview_rows) < MANIFEST_PREVIEW_ROWS:
            preview_rows.append(
                ManifestRow(index=index, cells=cells, valid=error is None, error=error)
            )

    _MANIFESTS[admin.id] = state
    return ManifestPreview(
        filename=state.filename,
        columns=state.columns,
        rows=preview_rows,
        total_rows=len(state.rows),
        valid_count=valid_count,
        error_count=len(state.rows) - valid_count,
        suggested_mapping=mapping,
    )


def _import_manifest(
    db: Session,
    admin: User,
    *,
    manifest: _ManifestState,
    mapping: ColumnMapping,
    project_id: int,
    task_type: TaskType,
    consensus_overlap: int,
    base_metadata: dict[str, str],
    conflict: ConflictMode,
) -> UploadSummary:
    """Manifest import: per-row validation, dedup, AudioFragment creation.

    Erroneous rows do not abort the import — they go to failed + errors.csv.
    task_type is the PROJECT's type: the manifest's task_type column (mapping.task_type)
    is ignored, all fragments get the project's type. Per fragment
    consensus_overlap open tasks are created (the consensus mechanism).

    sbs project (task_type='sbs'): a manifest row carries filename_a/filename_b
    and creates ONE fragment-pair (K tasks with Task.swap=random); orig_trb for
    sbs is ignored."""
    is_sbs = task_type == TaskType.sbs
    mapped_cols = (
        (mapping.filename_a, mapping.filename_b, *mapping.metadata.values())
        if is_sbs
        else (mapping.filename, mapping.orig_trb, *mapping.metadata.values())
    )
    for col in mapped_cols:
        if col and col not in manifest.columns:
            raise HTTPException(status_code=400, detail="unknown_column")

    taken = _project_filenames(db, project_id)
    created = 0
    failed_rows: list[UploadFailedRow] = []

    for index, cells, parse_error in manifest.rows:
        reason: str | None = None
        row_error = _validate_row(cells, parse_error, mapping)

        if is_sbs:
            a_name, b_name = _row_pair_names(cells, mapping)
            display_name = a_name or b_name
            if row_error is not None:
                bad_fmt = (a_name and not _ext_supported(a_name)) or (
                    b_name and not _ext_supported(b_name)
                )
                reason = "unsupported_format" if bad_fmt else "invalid_row"
            target_a, target_b = a_name, b_name
            if reason is None and (a_name in taken or b_name in taken):
                if conflict == "reject":
                    reason = "duplicate_name"
                else:
                    if a_name in taken:
                        target_a = _unique_name(a_name, taken)
                        taken.add(target_a)
                    if b_name in taken:
                        target_b = _unique_name(b_name, taken)
                        taken.add(target_b)
            if reason is not None:
                failed_rows.append(
                    UploadFailedRow(
                        client_id=f"manifest-row-{index}", filename=display_name, reason=reason
                    )
                )
                continue
            db.add(
                AudioFragment(
                    project_id=project_id,
                    filename=target_a,
                    s3_key=_s3_key(project_id, target_a, manifest=True),
                    size_bytes=0,
                    duration_sec=None,
                    filename_b=target_b,
                    s3_key_b=_s3_key(project_id, target_b, manifest=True),
                    size_bytes_b=0,
                    duration_sec_b=None,
                    task_type=task_type,
                    orig_trb=None,  # ASR hints are not applicable to sbs
                    meta=_row_metadata(cells, mapping, base_metadata),
                    tasks=[_sbs_task() for _ in range(consensus_overlap)],
                )
            )
            taken.add(target_a)
            taken.add(target_b)
            created += 1
            continue

        name = (cells.get(mapping.filename) or "").strip()
        if row_error is not None:
            # per-row codes are detailed by the preview; in the summary — a single invalid_row
            # (except format — it matches the per-file code)
            reason = "unsupported_format" if name and not _ext_supported(name) else "invalid_row"

        target = name
        if reason is None and name in taken:
            if conflict == "reject":
                reason = "duplicate_name"
            else:
                target = _unique_name(name, taken)

        if reason is not None:
            failed_rows.append(
                UploadFailedRow(client_id=f"manifest-row-{index}", filename=name, reason=reason)
            )
            continue

        orig_trb = None
        if mapping.orig_trb:
            orig_trb = (cells.get(mapping.orig_trb) or "").strip() or None

        db.add(
            AudioFragment(
                project_id=project_id,
                filename=target,
                s3_key=_s3_key(project_id, target, manifest=True),
                size_bytes=0,
                duration_sec=None,
                task_type=task_type,
                orig_trb=orig_trb,
                meta=_row_metadata(cells, mapping, base_metadata),
                # K = consensus_overlap open tasks per fragment —
                # to hand out to K different annotators via /task/random
                tasks=[Task(status=TaskStatus.open) for _ in range(consensus_overlap)],
            )
        )
        taken.add(target)
        created += 1

    db.commit()

    # CSV "Download error rows"
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["index", "filename", "reason"])
    for row in failed_rows:
        writer.writerow([row.client_id.removeprefix("manifest-row-"), row.filename, row.reason])
    _MANIFEST_ERRORS[admin.id] = buf.getvalue()

    return UploadSummary(
        project_id=project_id,
        task_type=task_type,
        total=len(manifest.rows),
        uploaded=created,
        failed=failed_rows,
        error_rows_url=MANIFEST_ERRORS_URL if failed_rows else None,
    )


@router.post("/upload/session/{session_id}/manifest", response_model=UploadSummary)
def import_manifest_into_session(
    session_id: str,
    body: ManifestImportRequest,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> UploadSummary:
    """Import a previously uploaded manifest into a session with column mapping."""
    state = _get_session_or_404(session_id)
    if not _mapping_has_target(body.mapping, state.task_type == TaskType.sbs):
        raise HTTPException(status_code=400, detail="mapping_required")
    manifest = _MANIFESTS.get(admin.id)
    if manifest is None:
        raise HTTPException(status_code=404, detail="manifest_not_found")

    summary = _import_manifest(
        db,
        admin,
        manifest=manifest,
        mapping=body.mapping,
        project_id=state.project_id,
        task_type=state.task_type,
        consensus_overlap=state.consensus_overlap,
        base_metadata=state.metadata,
        conflict=state.conflict,
    )
    state.manifest_imported = True

    row = db.get(UploadSession, state.db_id)
    if row is not None:
        row.total += summary.total
        row.succeeded += summary.uploaded
        row.failed += len(summary.failed)
        db.commit()
    return summary


@router.get("/upload/manifest/errors.csv")
def manifest_errors_csv(admin: User = Depends(get_current_admin)) -> Response:
    """CSV of the last manifest import's error rows (the "Download error rows" button)."""
    text = _MANIFEST_ERRORS.get(admin.id)
    if text is None:
        raise HTTPException(status_code=404, detail="no_manifest_errors")
    return Response(
        content=text,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="manifest-errors.csv"'},
    )


# ---------------------------------------------------------------------------
# One-step endpoints
# ---------------------------------------------------------------------------


def _batch_sbs_results(
    db: Session,
    *,
    project_id: int,
    conflict: ConflictMode,
    metadata: dict[str, str],
    consensus_overlap: int,
    items: list[tuple[str, bytes]],
) -> list[BatchFileResult]:
    """One-step assembly of sbs project pairs within the batch: files are grouped
    by the _a/_b suffixes, a complete pair → ONE fragment (K sbs tasks), a lone
    or unpaired file → ok=false 'unpaired'. Results — in the order of files."""
    by_client: dict[str, UploadFileResult] = {}
    groups: dict[str, dict[str, dict]] = {}
    for filename, data in items:
        error = _validate_content(filename, data)
        if error:
            by_client[filename] = UploadFileResult(client_id=filename, ok=False, error_reason=error)
            continue
        parsed = _split_pair(filename)
        if parsed is None:
            by_client[filename] = UploadFileResult(
                client_id=filename, ok=False, error_reason="unpaired"
            )
            continue
        pair_key, side = parsed
        groups.setdefault(pair_key, {})[side] = {
            "client_id": filename, "filename": filename, "data": data, "duration": None,
        }

    stored_as: dict[str, str | None] = {}
    for grp in groups.values():
        if "a" in grp and "b" in grp:
            result_a, result_b = _create_sbs_fragment(
                db,
                project_id=project_id,
                conflict=conflict,
                metadata=metadata,
                consensus_overlap=consensus_overlap,
                half_a=grp["a"],
                half_b=grp["b"],
            )
            by_client[grp["a"]["client_id"]] = result_a
            by_client[grp["b"]["client_id"]] = result_b
            if result_a.ok:
                stored_as[grp["a"]["client_id"]] = grp["a"]["filename"]
                stored_as[grp["b"]["client_id"]] = grp["b"]["filename"]
        else:
            for half in grp.values():
                by_client[half["client_id"]] = UploadFileResult(
                    client_id=half["client_id"], ok=False, error_reason="unpaired"
                )

    results: list[BatchFileResult] = []
    for filename, _ in items:
        res = by_client[filename]
        results.append(
            BatchFileResult(filename=filename, stored_as=stored_as.get(filename), **res.model_dump())
        )
    return results


@router.post("/file/batch", response_model=BatchUploadResult)
async def batch_upload(
    project_id: int = Form(...),
    task_type: TaskType | None = Form(
        None, description="DEPRECATED: ignored, the type comes from the project"
    ),
    conflict: Literal["reject", "rename"] = Form("rename"),
    metadata: str = Form("{}", description="JSON key-value object for the batch"),
    orig_trb: str = Form(
        "{}",
        description="JSON: {filename: text} or an array parallel to files (per-file)",
    ),
    orig_trb_all: str | None = Form(None, description="ASR hint for the whole batch"),
    files: list[UploadFile] = FileParam(...),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> BatchUploadResult:
    """One-step multipart batch upload: validation, dedup, per-file
    result; errors of individual files do not break the batch.

    task_type is DEPRECATED and ignored — fragments inherit Project.task_type."""
    project = _project_or_404(db, project_id)

    def parse_json(raw: str, code: str) -> object:
        try:
            return json.loads(raw)
        except ValueError:
            raise HTTPException(status_code=400, detail=code)

    meta_obj = parse_json(metadata, "bad_metadata")
    if not isinstance(meta_obj, dict):
        raise HTTPException(status_code=400, detail="bad_metadata")
    batch_metadata = {str(k): str(v) for k, v in meta_obj.items()}

    trb_obj = parse_json(orig_trb, "bad_orig_trb")
    if isinstance(trb_obj, dict):
        trb_by_name = {str(k): str(v) for k, v in trb_obj.items()}
        trb_by_index: list[str | None] = []
    elif isinstance(trb_obj, list):
        trb_by_name = {}
        trb_by_index = [None if v is None else str(v) for v in trb_obj]
    else:
        raise HTTPException(status_code=400, detail="bad_orig_trb")

    row = UploadSession(project_id=project_id, user_id=admin.id, total=len(files))
    db.add(row)
    db.commit()
    db.refresh(row)

    results: list[BatchFileResult] = []
    if project.task_type == TaskType.sbs:
        # sbs: assemble pairs by the _a/_b suffixes (orig_trb is not applicable to sbs)
        items = [
            (upload.filename or f"file_{i + 1}", await upload.read())
            for i, upload in enumerate(files)
        ]
        results = _batch_sbs_results(
            db,
            project_id=project_id,
            conflict=conflict,
            metadata=batch_metadata,
            consensus_overlap=project.consensus_overlap,
            items=items,
        )
    else:
        for i, upload in enumerate(files):
            filename = upload.filename or f"file_{i + 1}"
            data = await upload.read()
            per_file_trb = trb_by_name.get(filename)
            if per_file_trb is None and i < len(trb_by_index):
                per_file_trb = trb_by_index[i]
            if per_file_trb is None:
                per_file_trb = orig_trb_all

            result, stored_as = _store_file(
                db,
                project_id=project_id,
                task_type=project.task_type,
                consensus_overlap=project.consensus_overlap,
                conflict=conflict,
                batch_metadata=batch_metadata,
                client_id=filename,
                filename=filename,
                data=data,
                duration=None,
                orig_trb=per_file_trb,
            )
            results.append(
                BatchFileResult(filename=filename, stored_as=stored_as, **result.model_dump())
            )

    uploaded = sum(1 for r in results if r.ok)
    row.succeeded = uploaded
    row.failed = len(results) - uploaded
    db.commit()

    failed = [
        UploadFailedRow(
            client_id=r.client_id, filename=r.filename, reason=r.error_reason or "cancelled"
        )
        for r in results
        if not r.ok
    ]
    return BatchUploadResult(
        upload_session_id=row.id,
        project_id=project_id,
        task_type=project.task_type,
        total=len(results),
        uploaded=uploaded,
        failed=failed,
        results=results,
    )


@router.get("/project/{project_id}/files/conflicts", response_model=ConflictCheckResult)
def check_name_conflicts(
    project_id: int,
    names: list[str] = Query(default=[]),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> ConflictCheckResult:
    """Name-conflict check for client-side validation.

    names — a repeatable query parameter; values with commas are expanded.
    """
    _project_or_404(db, project_id)
    requested: list[str] = []
    for chunk in names:
        requested.extend(part.strip() for part in chunk.split(",") if part.strip())
    existing = _project_filenames(db, project_id)
    duplicates = [n for i, n in enumerate(requested) if n in existing and n not in requested[:i]]
    return ConflictCheckResult(project_id=project_id, duplicates=duplicates)


@router.post("/project/{project_id}/manifest", response_model=UploadSummary)
async def import_project_manifest(
    project_id: int,
    file: UploadFile = FileParam(...),
    mapping: str = Form(..., description="JSON ColumnMapping"),
    task_type: TaskType | None = Form(
        None, description="DEPRECATED: ignored, the type comes from the project"
    ),
    conflict: Literal["reject", "rename"] = Form("rename"),
    metadata: str = Form("{}"),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> UploadSummary:
    """One-step import of a CSV/JSONL manifest into a project with column mapping.

    task_type is DEPRECATED and ignored — rows inherit Project.task_type."""
    project = _project_or_404(db, project_id)
    try:
        mapping_obj = ColumnMapping.model_validate(json.loads(mapping))
    except ValueError:
        raise HTTPException(status_code=400, detail="bad_mapping")
    if not _mapping_has_target(mapping_obj, project.task_type == TaskType.sbs):
        raise HTTPException(status_code=400, detail="mapping_required")
    try:
        meta_dict = json.loads(metadata)
        if not isinstance(meta_dict, dict):
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=400, detail="bad_metadata")

    raw = await file.read()
    manifest = _parse_manifest(file.filename or "manifest", raw)
    summary = _import_manifest(
        db,
        admin,
        manifest=manifest,
        mapping=mapping_obj,
        project_id=project_id,
        task_type=project.task_type,
        consensus_overlap=project.consensus_overlap,
        base_metadata={str(k): str(v) for k, v in meta_dict.items()},
        conflict=conflict,
    )

    db.add(
        UploadSession(
            project_id=project_id,
            user_id=admin.id,
            total=summary.total,
            succeeded=summary.uploaded,
            failed=len(summary.failed),
        )
    )
    db.commit()
    return summary


@router.get("/file/upload-sessions/{project_id}", response_model=list[UploadSessionOut])
def upload_sessions_history(
    project_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> list[UploadSession]:
    """A project's upload session history (total/succeeded/failed counters)."""
    _project_or_404(db, project_id)
    rows = db.execute(
        select(UploadSession)
        .where(UploadSession.project_id == project_id)
        .order_by(UploadSession.id.desc())
    )
    return list(rows.scalars())

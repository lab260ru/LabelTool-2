"""Annotator tasks: /task/random with filters and permissions, submit, skip, history.

Contract (response shapes — src/api/types.ts):
  GET  /task/random?project_id=&task_type=  — hand out a task (open|skipped → in_progress);
  POST /task/{id}/submit                    — submit a result (result JSON, finished_at);
  POST /task/{id}/skip                      — release a task (skipped, user_id cleared);
  GET  /task/history?offset=&limit=         — the current user's submitted history.

Hand-out rules (with the consensus mechanism K = Project.consensus_overlap, K open
tasks are created per fragment — picked up by K DIFFERENT annotators):
  - an open task is handed out only for a fragment where the current user has
    NO task of their own in status in_progress/done — one annotator cannot
    take or submit the same fragment twice;
  - task types with user_block/admin_block in the permission matrix are excluded
    (a missing entry = allowed); the matrix covers all 6 types, including 'mos';
  - a repeat request returns the already-taken in_progress task (within the filters);
  - "zombies" (in_progress older than ZOMBIE_RELEASE_HOURS) are auto-released on hand-out.

MOS rating (task_type='mos', configurable Project.mos_scales):
payload {scale_min: 1, scale_max: 5, mos_scales: [{name, labels?}]} — the frontend
renders a 1..5 rating FOR EACH project scale; the submit result is
{scores: {scale_name: 1..5}}, submit validates that ALL project scales
and only they are rated (422 detail='bad_result'). Legacy results
{score: N} are NO longer accepted on submit (old ones remain readable:
export treats them as {scores: {'MOS': N}}).
"""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from src.auth import get_current_user
from src.db import get_db
from src.models import (
    DEFAULT_MOS_SCALES,
    AudioFragment,
    Project,
    S3Source,
    Task,
    TaskStatus,
    TaskType,
    User,
    UserRole,
    project_participants,
    utcnow,
)
from src.schemas.task import (
    AudioFragmentOut,
    SubmitIn,
    SubmitOut,
    TaskHistoryItemOut,
    TaskHistoryPage,
    TaskOut,
)
from src.storage import get_source_storage, get_storage

router = APIRouter(prefix="/task", tags=["task"])

# After how many hours an in_progress task is considered a "zombie" and returned to the pool
ZOMBIE_RELEASE_HOURS = 8

# Permission-matrix values that forbid a task type to the user
_BLOCK_VALUES = ("user_block", "admin_block")

# Number of the fragment's done tasks from which the history shows "consensus"
_CONSENSUS_MIN_DONE = 2

_DIARIZATION_MAX_SPEAKERS = 4

# The MOS rating scale is always 1–5 (MOS standard); the scale name
# and item labels are configurable (Project.mos_scales)
MOS_SCALE_MIN = 1
MOS_SCALE_MAX = 5

# Side-by-Side: preference scale -2..2 (IN TERMS OF THE SHOWN order on
# submit: -2 = "Option 1 is much better", +2 = "Option 2 is much better",
# 0 = the same). The backend normalizes by Task.swap and stores in terms of systems.
SBS_PREF_MIN = -2
SBS_PREF_MAX = 2


def _project_mos_scales(project: Project) -> list[dict]:
    """The project's effective MOS scales: saved or the default (legacy project
    before backfill / created bypassing the API)."""
    return list(project.mos_scales or DEFAULT_MOS_SCALES)


def _validated_mos_scores(raw: object, project: Project) -> dict[str, int]:
    """Validates the MOS submit result per contract: {scores: {scale_name: 1..5}},
    ALL project scales and only they are rated, values are integers 1..5 — otherwise
    422 'bad_result'. Legacy {score: N} (without scores) does not pass here.
    Returns a normalized dict (int values) for Task.result."""
    if not isinstance(raw, dict):
        raise HTTPException(status_code=422, detail="bad_result")
    names = [scale["name"] for scale in _project_mos_scales(project)]
    if set(raw) != set(names):
        raise HTTPException(status_code=422, detail="bad_result")
    scores: dict[str, int] = {}
    for name in names:  # the project's scale order is canonical
        value = raw[name]
        # bool is a subclass of int; we accept float only if it's integral (4.0 → 4)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise HTTPException(status_code=422, detail="bad_result")
        if isinstance(value, float) and not value.is_integer():
            raise HTTPException(status_code=422, detail="bad_result")
        value = int(value)
        if not MOS_SCALE_MIN <= value <= MOS_SCALE_MAX:
            raise HTTPException(status_code=422, detail="bad_result")
        scores[name] = value
    return scores


def _validated_sbs_preference(raw: object) -> int:
    """Validates the SBS submit preference: integer -2..2 (in terms of the shown
    order) — otherwise 422 'bad_result'. bool is not accepted (subclass of int);
    an integral float (2.0) is allowed. Returns int."""
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise HTTPException(status_code=422, detail="bad_result")
    if isinstance(raw, float) and not raw.is_integer():
        raise HTTPException(status_code=422, detail="bad_result")
    value = int(raw)
    if not SBS_PREF_MIN <= value <= SBS_PREF_MAX:
        raise HTTPException(status_code=422, detail="bad_result")
    return value


def _normalize_sbs_preference(shown: int, swap: bool | None) -> int:
    """Converts preference from the SHOWN order terms into SYSTEM terms.

    swap=False: option 1 = A, 2 = B → the sign is unchanged (minus = A better).
    swap=True:  option 1 = B, 2 = A → the sign is inverted (minus = A better).
    Contract example: +2 with swap=True → A better → -2 in the result."""
    return -shown if swap else shown


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _blocked_types(user: User) -> list[TaskType]:
    """Task types forbidden to the user by the permission matrix (user/admin block)."""
    perms = user.permissions or {}
    return [t for t in TaskType if perms.get(t.value) in _BLOCK_VALUES]


def _release_zombies(db: Session) -> None:
    """Auto-release of stuck tasks: in_progress older than N hours → open."""
    cutoff = utcnow() - timedelta(hours=ZOMBIE_RELEASE_HOURS)
    db.execute(
        update(Task)
        .where(Task.status == TaskStatus.in_progress, Task.started_at < cutoff)
        .values(status=TaskStatus.open, user_id=None, started_at=None),
        execution_options={"synchronize_session": False},
    )
    db.commit()


def _done_count(db: Session, fragment_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Task)
            .where(Task.fragment_id == fragment_id, Task.status == TaskStatus.done)
        )
        or 0
    )


def _frag_presign(db: Session, fragment: AudioFragment):
    """Presigned routing by fragment.source_id (S3 feature contract): source_id=
    None → application storage; otherwise — presigned against the external source."""
    if fragment.source_id is None:
        app_storage = get_storage()
        return lambda key: app_storage.presigned_url(key) if key else None
    source_storage = get_source_storage(db.get(S3Source, fragment.source_id))
    return lambda key: source_storage.presigned_url(key) if key else None


def _fragment_out(
    db: Session, fragment: AudioFragment, overlap: int, presign
) -> AudioFragmentOut:
    done = _done_count(db, fragment.id)
    return AudioFragmentOut(
        id=fragment.id,
        project_id=fragment.project_id,
        filename=fragment.filename,
        duration_sec=fragment.duration_sec,
        size_bytes=fragment.size_bytes,
        task_type=fragment.task_type,
        orig_trb=fragment.orig_trb,
        metadata=fragment.meta or {},
        finished=done >= overlap,
        task_count=done,
        tasks_done=done,
        tasks_required=overlap,
        audio_url=presign(fragment.s3_key),
        source_id=fragment.source_id,
    )


def _payload(
    db: Session, fragment: AudioFragment, project: Project, task: Task, presign
) -> dict:
    """payload by task type (types.ts Task)."""
    t = fragment.task_type
    if t == TaskType.sbs:
        # Blind order: audio_url_1/2 ALREADY account for Task.swap; NO system names.
        # swap=False → 1=A(s3_key), 2=B(s3_key_b); swap=True → 1=B, 2=A.
        url_a = presign(fragment.s3_key)
        url_b = presign(fragment.s3_key_b) if fragment.s3_key_b else url_a
        if task.swap:
            return {"audio_url_1": url_b, "audio_url_2": url_a}
        return {"audio_url_1": url_a, "audio_url_2": url_b}
    if t == TaskType.transcription:
        return {"orig_trb": fragment.orig_trb}
    if t == TaskType.verification:
        # Text to verify: the last submitted annotation with text, otherwise the ASR draft
        prev = (
            db.execute(
                select(Task)
                .where(
                    Task.fragment_id == fragment.id,
                    Task.status == TaskStatus.done,
                    Task.result.is_not(None),
                )
                .order_by(Task.finished_at.desc(), Task.id.desc())
            )
            .scalars()
            .first()
        )
        text = fragment.orig_trb or ""
        author_fio = None
        if prev is not None and isinstance(prev.result, dict) and prev.result.get("text"):
            text = str(prev.result["text"])
            author_fio = prev.user.fio if prev.user is not None else None
        return {"text": text, "author_fio": author_fio}
    if t == TaskType.classification:
        return {"labels": project.label_list or [], "multiple": False}
    if t == TaskType.segmentation:
        return {"labels": project.label_list or []}
    if t == TaskType.diarization:
        return {"max_speakers": _DIARIZATION_MAX_SPEAKERS}
    # mos: the project's scales — the frontend renders a 1..5 rating for each.
    # The mos_scales key is normative (src/api/types.ts reads it).
    return {
        "scale_min": MOS_SCALE_MIN,
        "scale_max": MOS_SCALE_MAX,
        "mos_scales": _project_mos_scales(project),
    }


def _task_out(db: Session, task: Task, fragment: AudioFragment, project: Project) -> TaskOut:
    # Compute the source presigned routing once per task fragment
    presign = _frag_presign(db, fragment)
    return TaskOut(
        id=task.id,
        project_id=project.id,
        project_name=project.name,
        fragment=_fragment_out(db, fragment, project.consensus_overlap, presign),
        instruction=project.instruction or "",
        type=fragment.task_type,
        payload=_payload(db, fragment, project, task, presign),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/random", response_model=TaskOut)
def get_random_task(
    project_id: int | None = None,
    task_type: TaskType | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TaskOut:
    """Hand out a random task, respecting the filters and the permission matrix."""
    _release_zombies(db)

    blocked = _blocked_types(user)

    def scoped(stmt):
        stmt = stmt.join(AudioFragment, Task.fragment_id == AudioFragment.id)
        if blocked:
            stmt = stmt.where(AudioFragment.task_type.not_in(blocked))
        # An annotator gets tasks only from THEIR OWN projects (where they are a participant);
        # an admin is not restricted — can review any project
        if user.role != UserRole.admin:
            member_projects = select(project_participants.c.project_id).where(
                project_participants.c.user_id == user.id
            )
            stmt = stmt.where(AudioFragment.project_id.in_(member_projects))
        if project_id is not None:
            stmt = stmt.where(AudioFragment.project_id == project_id)
        if task_type is not None:
            stmt = stmt.where(AudioFragment.task_type == task_type)
        return stmt

    # An already-taken task within the filters — return it (without grabbing a new one)
    task = (
        db.execute(
            scoped(
                select(Task).where(
                    Task.user_id == user.id, Task.status == TaskStatus.in_progress
                )
            )
        )
        .scalars()
        .first()
    )

    if task is None:
        # Consensus: fragments where the user already has THEIR OWN task
        # in_progress/done are excluded — one annotator does not take or submit
        # the same fragment twice (K tasks per fragment → K different annotators)
        own_fragments = select(Task.fragment_id).where(
            Task.user_id == user.id,
            Task.status.in_((TaskStatus.in_progress, TaskStatus.done)),
        )
        task = (
            db.execute(
                scoped(
                    select(Task).where(
                        Task.status.in_((TaskStatus.open, TaskStatus.skipped)),
                        Task.fragment_id.not_in(own_fragments),
                    )
                ).order_by(func.random())
            )
            .scalars()
            .first()
        )
        if task is None:
            raise HTTPException(status_code=404, detail="no_tasks_available")
        task.status = TaskStatus.in_progress
        task.user_id = user.id
        task.started_at = utcnow()
        db.commit()
        db.refresh(task)

    fragment = db.get(AudioFragment, task.fragment_id)
    project = db.get(Project, fragment.project_id)
    return _task_out(db, task, fragment, project)


@router.post("/{task_id}/submit", response_model=SubmitOut)
def submit_task(
    task_id: int,
    payload: SubmitIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubmitOut:
    """Submit the annotation result: result JSON by task type, finished_at.

    MOS: result — {scores: {scale_name: 1..5}}; ALL project scales
    and only they are rated, otherwise 422 'bad_result' (legacy {score} is not accepted)."""
    if payload.task_id != task_id:
        raise HTTPException(status_code=400, detail="task_id_mismatch")
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    if task.user_id != user.id:
        raise HTTPException(status_code=403, detail="not_your_task")
    if task.status != TaskStatus.in_progress:
        raise HTTPException(status_code=409, detail="task_not_in_progress")

    fragment = db.get(AudioFragment, task.fragment_id)
    if payload.type is not None and payload.type != fragment.task_type:
        raise HTTPException(status_code=400, detail="task_type_mismatch")

    result = payload.model_dump(mode="json", exclude={"task_id"})
    if fragment.task_type == TaskType.mos:
        project = db.get(Project, fragment.project_id)
        # Normalize values to int — canonical JSON for consensus
        result["scores"] = _validated_mos_scores(result.get("scores"), project)
        result.pop("score", None)  # don't store the legacy field on submit
    elif fragment.task_type == TaskType.sbs:
        # preference arrives IN TERMS OF THE SHOWN order; normalize by
        # Task.swap and store in terms of SYSTEMS (minus = A better, plus = B)
        shown = _validated_sbs_preference(result.get("preference"))
        result["preference"] = _normalize_sbs_preference(shown, task.swap)
    task.result = result
    task.status = TaskStatus.done
    task.finished_at = utcnow()
    db.commit()
    return SubmitOut(ok=True, task_id=task_id)


@router.post("/{task_id}/skip", response_model=SubmitOut)
def skip_task(
    task_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SubmitOut:
    """Skip a task: return it to the pool (status=skipped, user_id cleared)."""
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task_not_found")
    if task.user_id != user.id:
        raise HTTPException(status_code=403, detail="not_your_task")
    if task.status != TaskStatus.in_progress:
        raise HTTPException(status_code=409, detail="task_not_in_progress")

    task.status = TaskStatus.skipped
    task.user_id = None
    task.started_at = None
    db.commit()
    return SubmitOut(ok=True, task_id=task_id)


@router.get("/history", response_model=TaskHistoryPage)
def task_history(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=10, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TaskHistoryPage:
    """The current user's submitted-tasks history (newest first, paginated)."""
    base = (
        select(Task, AudioFragment, Project)
        .join(AudioFragment, Task.fragment_id == AudioFragment.id)
        .join(Project, AudioFragment.project_id == Project.id)
        .where(Task.user_id == user.id, Task.status == TaskStatus.done)
    )
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.execute(
        base.order_by(Task.finished_at.desc(), Task.id.desc()).offset(offset).limit(limit)
    ).all()

    # Done counts for the page's fragments in one query — for the consensus status
    fragment_ids = {fragment.id for _, fragment, _ in rows}
    done_by_fragment: dict[int, int] = dict(
        db.execute(
            select(Task.fragment_id, func.count())
            .where(Task.fragment_id.in_(fragment_ids), Task.status == TaskStatus.done)
            .group_by(Task.fragment_id)
        ).all()
        if fragment_ids
        else []
    )

    items = [
        TaskHistoryItemOut(
            task_id=task.id,
            task_type=fragment.task_type,
            project_id=project.id,
            project_name=project.name,
            fragment_filename=fragment.filename,
            submitted_at=task.finished_at,
            status=(
                "consensus"
                if done_by_fragment.get(fragment.id, 0) >= _CONSENSUS_MIN_DONE
                else "accepted"
            ),
        )
        for task, fragment, project in rows
    ]
    return TaskHistoryPage(items=items, total=total, offset=offset, limit=limit)

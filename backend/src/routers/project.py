"""Project CRUD + fragments + aggregates + instruction.

Frontend contract — src/api/client.ts:
  GET    /projects                       — list of projects with aggregates
  POST   /projects                       — create (name, REQUIRED task_type,
                                           description, instruction, label_list,
                                           participants)
  GET    /project/{id}                   — project card
  PATCH  /project/{id}                   — edit (incl. participants and groups;
                                           task_type — only while there are no fragments,
                                           otherwise 409 'project_has_fragments')
  DELETE /project/{id}                   — deletion (+ files from storage)
  GET    /project/{id}/instruction       — reading is available to the annotator
  GET    /project/{id}/progress          — counters/progress
  GET    /project/{id}/agreement         — agreement metrics
  GET    /dashboard (= /stats/dashboard) — dashboard summary
  GET    /project/{id}/fragments         — pagination + filters + statuses
  PATCH  /fragment/{id}                  — edit (task_type change REMOVED:
                                           the type is uniform per project, the field is ignored)
  DELETE /fragment/{id}                  — deletion (+ file from storage)
  GET    /fragment/{id}/presigned        — playback URL

The task type is set
at project creation and inherited by all fragments; the 6th type is 'mos'.

Consensus mechanism (K = Project.consensus_overlap, 1..5): K open tasks are
created per fragment for K DIFFERENT annotators (see routers/file.py,
routers/task.py). PATCH consensus_overlap is allowed even when fragments exist —
open tasks are recomputed transactionally (increase — create additional
open tasks up to the new K, decrease — delete the excess; done/in_progress
are not touched).

Status semantics (documented in schemas/project.py):
  - a fragment is "labeled"/finished — done tasks >= K; task_count — number of done
    (plus tasks_done/tasks_required for the "1/2" progress on the frontend);
  - "in progress" — not labeled and (there is an in_progress task OR 0 < done < K);
  - "zombie" — an in_progress task with started_at older than zombie_hours (default 24h);
  - fragment agreement — the share of the largest group of matching results among
    done tasks (fragments with >=2 done); annotator agreement — the average share
    of the fragment's other annotators whose result matched their result.

Efficiency: aggregates are computed with 1–2 GROUP BY queries (no N+1),
fragment pagination is on the DB side; designed for 100k+ fragments.
"""

import json
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session, selectinload

from src.auth import get_current_admin, get_current_user
from src.config import settings
from src.db import get_db
from src.models import (
    DEFAULT_MOS_SCALES,
    DEFAULT_SBS_SYSTEMS,
    AudioFragment,
    Project,
    S3Source,
    Task,
    TaskStatus,
    TaskType,
    User,
    UserRole,
    utcnow,
)
from src.schemas.project import (
    AgreementPerType,
    AgreementStats,
    AnnotatorScore,
    AudioFragmentOut,
    DashboardStats,
    FragmentUpdate,
    InstructionOut,
    LabelClass,
    MosScale,
    PaginatedFragments,
    PresignedUrl,
    ProjectCounters,
    ProjectCreate,
    ProjectOut,
    ProjectParticipantOut,
    ProjectProgress,
    ProjectUpdate,
    SbsSystems,
    ZombieTask,
)
from src.storage import get_source_storage, get_storage

router = APIRouter(tags=["project"])

# "Zombie" threshold: in_progress older than N hours (overridable via a query parameter)
ZOMBIE_HOURS = 24.0
# How many zombie tasks and top/outsider annotators the dashboard returns
ZOMBIE_LIST_LIMIT = 100
ANNOTATORS_TOP_N = 5

_TASK_TYPE_ORDER = {t: i for i, t in enumerate(TaskType)}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project_not_found")
    return project


def _fragment_or_404(db: Session, fragment_id: int) -> AudioFragment:
    fragment = db.get(AudioFragment, fragment_id)
    if fragment is None:
        raise HTTPException(status_code=404, detail="fragment_not_found")
    return fragment


def _pct(part: int, total: int) -> int:
    return 0 if total <= 0 else int(round(part * 100 / total))


def _zombie_cutoff(zombie_hours: float) -> datetime:
    return utcnow() - timedelta(hours=zombie_hours)


def _hours_since(dt: datetime) -> float:
    """Hours since dt; naive values from SQLite are treated as UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (utcnow() - dt).total_seconds() / 3600


def _canon(result: object) -> str:
    """Canonical form of result for comparing annotations from different annotators."""
    return json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _frag_agg_subq(project_id: int | None = None):
    """Subquery: per fragment — the number of done and in_progress tasks
    plus its project's consensus_overlap (the finished threshold)."""
    q = (
        select(
            AudioFragment.id.label("fragment_id"),
            AudioFragment.project_id.label("project_id"),
            Project.consensus_overlap.label("overlap"),
            func.count(case((Task.status == TaskStatus.done, 1))).label("done"),
            func.count(case((Task.status == TaskStatus.in_progress, 1))).label("in_progress"),
        )
        .join(Project, AudioFragment.project_id == Project.id)
        .join(Task, Task.fragment_id == AudioFragment.id, isouter=True)
        # The joined Project columns must be in GROUP BY on PostgreSQL
        # (SQLite silently tolerates non-aggregated columns — the tests don't catch this)
        .group_by(AudioFragment.id, AudioFragment.project_id, Project.consensus_overlap)
    )
    if project_id is not None:
        q = q.where(AudioFragment.project_id == project_id)
    return q.subquery()


def _counters_by_project(
    db: Session, project_id: int | None = None, zombie_hours: float = ZOMBIE_HOURS
) -> dict[int, ProjectCounters]:
    """Counters per project in 2 GROUP BY queries (no N+1).

    Consensus: labeled = fragments with done >= K (K = the project's
    consensus_overlap); "in progress" = not labeled and (in_progress > 0 or 0 < done < K).
    """
    agg = _frag_agg_subq(project_id)
    rows = db.execute(
        select(
            agg.c.project_id,
            func.count(),
            func.sum(case((agg.c.done >= agg.c.overlap, 1), else_=0)),
            func.sum(
                case(
                    (
                        (agg.c.done < agg.c.overlap)
                        & ((agg.c.in_progress > 0) | (agg.c.done > 0)),
                        1,
                    ),
                    else_=0,
                )
            ),
        ).group_by(agg.c.project_id)
    ).all()
    counters: dict[int, ProjectCounters] = {}
    for pid, total, labeled, in_progress in rows:
        labeled = int(labeled or 0)
        counters[pid] = ProjectCounters(
            fragments_total=int(total or 0),
            fragments_labeled=labeled,
            fragments_in_progress=int(in_progress or 0),
            zombie_tasks=0,
            progress_pct=_pct(labeled, int(total or 0)),
        )

    zombie_q = (
        select(AudioFragment.project_id, func.count())
        .select_from(Task)
        .join(AudioFragment, Task.fragment_id == AudioFragment.id)
        .where(
            Task.status == TaskStatus.in_progress,
            Task.started_at.is_not(None),
            Task.started_at < _zombie_cutoff(zombie_hours),
        )
        .group_by(AudioFragment.project_id)
    )
    if project_id is not None:
        zombie_q = zombie_q.where(AudioFragment.project_id == project_id)
    for pid, count in db.execute(zombie_q):
        if pid in counters:
            counters[pid].zombie_tasks = int(count)
    return counters


def _task_types_by_project(
    db: Session, project_id: int | None = None
) -> dict[int, list[TaskType]]:
    """Task types occurring in the project (1 DISTINCT query)."""
    q = select(AudioFragment.project_id, AudioFragment.task_type).distinct()
    if project_id is not None:
        q = q.where(AudioFragment.project_id == project_id)
    out: dict[int, list[TaskType]] = {}
    for pid, task_type in db.execute(q):
        out.setdefault(pid, []).append(task_type)
    for types in out.values():
        types.sort(key=_TASK_TYPE_ORDER.__getitem__)
    return out


def _label_list_out(raw: object) -> list[LabelClass]:
    if not isinstance(raw, list):
        return []
    return [
        LabelClass(name=str(item.get("name", "")), color=str(item.get("color", "")))
        for item in raw
        if isinstance(item, dict)
    ]


def _validated_mos_scales(scales: list[MosScale]) -> list[dict]:
    """Validates the MOS scales list per contract: 1..5 scales, names non-empty
    (after strip) and unique — otherwise 422 'bad_mos_scales'. Returns a
    normalized list for the JSON column: names stripped, labels — only custom
    non-empty ones (default labels are localized by the frontend)."""
    if not 1 <= len(scales) <= 5:
        raise HTTPException(status_code=422, detail="bad_mos_scales")
    out: list[dict] = []
    seen: set[str] = set()
    for scale in scales:
        name = scale.name.strip()
        if not name or name in seen:
            raise HTTPException(status_code=422, detail="bad_mos_scales")
        seen.add(name)
        item: dict = {"name": name}
        if scale.labels:
            item["labels"] = dict(scale.labels)
        out.append(item)
    return out


def _mos_scales_out(project: Project) -> list[MosScale] | None:
    """The project's effective MOS scales: only for task_type='mos' (null for
    others); for a mos project without saved scales (legacy before backfill /
    direct creation in the DB) — the default."""
    if project.task_type != TaskType.mos:
        return None
    raw = project.mos_scales or DEFAULT_MOS_SCALES
    return [MosScale.model_validate(item) for item in raw]


def _validated_sbs_systems(systems: SbsSystems) -> dict[str, str]:
    """Validates the SBS system names: both non-empty (after strip) — otherwise 422
    'bad_sbs_systems'. Returns a normalized dict for the JSON column."""
    a = systems.a.strip()
    b = systems.b.strip()
    if not a or not b:
        raise HTTPException(status_code=422, detail="bad_sbs_systems")
    return {"a": a, "b": b}


def _sbs_systems_out(project: Project, admin_view: bool = True) -> SbsSystems | None:
    """The SBS project's system names in the response. Only for task_type='sbs' AND only
    in the ADMIN response — the names are NEVER given to the annotator (blind
    comparison), so with admin_view=False null is returned. For an sbs project
    without saved names (created bypassing the API) — the effective default."""
    if project.task_type != TaskType.sbs or not admin_view:
        return None
    raw = project.sbs_systems or DEFAULT_SBS_SYSTEMS
    return SbsSystems(a=raw.get("a", DEFAULT_SBS_SYSTEMS["a"]), b=raw.get("b", DEFAULT_SBS_SYSTEMS["b"]))


def _has_done_tasks(db: Session, project_id: int) -> bool:
    return bool(
        db.scalar(
            select(func.count())
            .select_from(Task)
            .join(AudioFragment, Task.fragment_id == AudioFragment.id)
            .where(
                AudioFragment.project_id == project_id,
                Task.status == TaskStatus.done,
            )
        )
    )


def _project_out(
    project: Project,
    counters: ProjectCounters,
    task_types: list[TaskType],
    admin_view: bool = True,
) -> ProjectOut:
    # Label classes are not applicable to sbs projects — null (like mos_scales for non-mos)
    label_list = None if project.task_type == TaskType.sbs else _label_list_out(project.label_list)
    return ProjectOut(
        id=project.id,
        name=project.name,
        description=project.description or "",
        instruction=project.instruction or "",
        label_list=label_list,
        participants=[
            ProjectParticipantOut(user_id=u.id, fio=u.fio, group=u.group_name)
            for u in project.participants
        ],
        task_type=project.task_type,
        task_types=task_types,
        consensus_overlap=project.consensus_overlap,
        mos_scales=_mos_scales_out(project),
        sbs_systems=_sbs_systems_out(project, admin_view),
        counters=counters,
        created_at=project.created_at,
    )


def _single_project_out(db: Session, project: Project, admin_view: bool = True) -> ProjectOut:
    counters = _counters_by_project(db, project.id).get(project.id, ProjectCounters())
    task_types = _task_types_by_project(db, project.id).get(project.id, [])
    return _project_out(project, counters, task_types, admin_view)


def _resolve_participants(db: Session, refs: list, groups: list[str]) -> list[User]:
    """ids/{user_id} objects + study groups -> users (without duplicates)."""
    ids: list[int] = [r if isinstance(r, int) else r.user_id for r in refs]
    users: list[User] = []
    if ids:
        found = db.execute(select(User).where(User.id.in_(ids))).scalars().all()
        if {u.id for u in found} != set(ids):
            raise HTTPException(status_code=404, detail="user_not_found")
        by_id = {u.id: u for u in found}
        users.extend(by_id[i] for i in dict.fromkeys(ids))
    if groups:
        users.extend(
            db.execute(
                select(User).where(User.group_name.in_(groups)).order_by(User.id)
            ).scalars()
        )
    seen: set[int] = set()
    unique: list[User] = []
    for u in users:
        if u.id not in seen:
            seen.add(u.id)
            unique.append(u)
    return unique


def _recount_open_tasks(db: Session, project_id: int, overlap: int) -> None:
    """Recompute fragments' open tasks for the new K = consensus_overlap.

    A fragment's pool of free tasks (open + skipped — both are handed out by
    /task/random) is brought to max(0, K - done - in_progress):
      - increasing K — additional open tasks are created (done/in_progress untouched);
      - decreasing K — the excess free tasks are deleted (newest first);
        done/in_progress are not touched, so done may remain > K —
        finished is recomputed on its own by the formula done >= K.

    Called INSIDE the PATCH /project/{id} transaction (without commit) —
    the K change and the task recompute are atomic.
    """
    free = (TaskStatus.open, TaskStatus.skipped)
    rows = db.execute(
        select(
            AudioFragment.id,
            func.count(case((Task.status.in_(free), 1))).label("pool"),
            func.count(
                case((Task.status.in_((TaskStatus.done, TaskStatus.in_progress)), 1))
            ).label("busy"),
        )
        .join(Task, Task.fragment_id == AudioFragment.id, isouter=True)
        .where(AudioFragment.project_id == project_id)
        .group_by(AudioFragment.id)
    ).all()
    for fragment_id, pool, busy in rows:
        target = max(0, overlap - int(busy or 0))
        pool = int(pool or 0)
        if pool < target:
            db.add_all(
                Task(fragment_id=fragment_id, status=TaskStatus.open)
                for _ in range(target - pool)
            )
        elif pool > target:
            excess_ids = db.scalars(
                select(Task.id)
                .where(Task.fragment_id == fragment_id, Task.status.in_(free))
                .order_by(Task.id.desc())
                .limit(pool - target)
            ).all()
            db.execute(delete(Task).where(Task.id.in_(excess_ids)))


# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[ProjectOut]:
    """List of projects with aggregates: fragments total/labeled, % done,
    participants, task types. The number of queries does not depend on the number of projects.

    Available to the annotator too: the "Annotation" hub picks a project from the
    list to read the instruction; an annotator sees only THEIR OWN projects
    (the ones they participate in), an admin — all.
    """
    query = select(Project).options(selectinload(Project.participants)).order_by(Project.id)
    projects = db.execute(query).scalars().all()
    admin_view = user.role == UserRole.admin
    if not admin_view:
        projects = [p for p in projects if any(u.id == user.id for u in p.participants)]
    counters = _counters_by_project(db)
    task_types = _task_types_by_project(db)
    # sbs_systems are visible ONLY to the admin — null for the annotator in the projects list
    return [
        _project_out(
            p, counters.get(p.id, ProjectCounters()), task_types.get(p.id, []), admin_view
        )
        for p in projects
    ]


@router.post("/projects", response_model=ProjectOut, status_code=201)
def create_project(
    body: ProjectCreate,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> ProjectOut:
    """Create a project: name, REQUIRED task_type (400 'task_type_required'),
    description, instruction, label_list, consensus_overlap (1..5, default 1),
    participants (by id and/or by groups).

    mos_scales — only for task_type='mos' (1..5 scales, names non-empty and
    unique, otherwise 422 'bad_mos_scales'); a mos project without explicit scales
    gets the default [{name: 'Качество звучания'}]. For NON-mos projects the field
    is ignored (stays NULL in the DB)."""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name_required")
    if body.task_type is None:
        raise HTTPException(status_code=400, detail="task_type_required")
    mos_scales: list | None = None
    if body.task_type == TaskType.mos:
        mos_scales = (
            _validated_mos_scales(body.mos_scales)
            if body.mos_scales is not None
            else [dict(s) for s in DEFAULT_MOS_SCALES]
        )
    # sbs_systems — only for sbs projects; without explicit names the default is set,
    # for other types the field is ignored (stays NULL in the DB)
    sbs_systems: dict | None = None
    if body.task_type == TaskType.sbs:
        sbs_systems = (
            _validated_sbs_systems(body.sbs_systems)
            if body.sbs_systems is not None
            else dict(DEFAULT_SBS_SYSTEMS)
        )
    project = Project(
        name=body.name.strip(),
        description=body.description,
        instruction=body.instruction,
        label_list=[label.model_dump() for label in body.label_list],
        task_type=body.task_type,
        consensus_overlap=body.consensus_overlap,
        mos_scales=mos_scales,
        sbs_systems=sbs_systems,
    )
    project.participants = _resolve_participants(db, body.participants, body.participant_groups)
    db.add(project)
    db.commit()
    db.refresh(project)
    return _project_out(project, ProjectCounters(), [])


@router.get("/project/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> ProjectOut:
    project = _project_or_404(db, project_id)
    return _single_project_out(db, project)


@router.patch("/project/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    body: ProjectUpdate,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> ProjectOut:
    """Edit a project: name, description, instruction, label_list,
    consensus_overlap, participants — by a list of ids/objects and/or by groups
    (they replace the current set).

    task_type may be changed only while the project has NO fragments —
    otherwise 409 'project_has_fragments' (the type is uniform per project, the
    fragments have already inherited the current one). Repeating the current value is a no-op.

    consensus_overlap (1..5) may be changed even when fragments exist:
    open tasks are recomputed in the SAME transaction (increase —
    create additional open tasks up to the new K, decrease — delete the excess;
    done/in_progress are not touched, finished is recomputed by the formula).

    mos_scales (only for mos projects; for others the field is ignored) may be
    changed WHILE the project has no done tasks — otherwise 409
    'project_has_results' (submitted scores are tied to scale names).
    Repeating the current value is a no-op. Composition validation — 422
    'bad_mos_scales'. On a task_type change (empty project): → mos — the scales
    from body or the default are set; mos → other — mos_scales is reset to NULL."""
    project = _project_or_404(db, project_id)
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=400, detail="name_required")
        project.name = body.name.strip()
    if body.description is not None:
        project.description = body.description
    if body.instruction is not None:
        project.instruction = body.instruction
    if body.label_list is not None:
        project.label_list = [label.model_dump() for label in body.label_list]
    if body.task_type is not None and body.task_type != project.task_type:
        has_fragments = db.scalar(
            select(func.count())
            .select_from(AudioFragment)
            .where(AudioFragment.project_id == project.id)
        )
        if has_fragments:
            raise HTTPException(status_code=409, detail="project_has_fragments")
        project.task_type = body.task_type
        # MOS scales live only on mos projects: switching the type to mos sets
        # the default (explicit scales from body are applied by the mos_scales block below),
        # switching away from mos — resets to NULL
        project.mos_scales = (
            [dict(s) for s in DEFAULT_MOS_SCALES]
            if body.task_type == TaskType.mos
            else None
        )
        # SBS system names live only on sbs projects: switching the type to sbs
        # sets the default (explicit names from body are applied by the sbs_systems block below),
        # switching away from sbs — resets to NULL
        project.sbs_systems = (
            dict(DEFAULT_SBS_SYSTEMS) if body.task_type == TaskType.sbs else None
        )
    if body.mos_scales is not None and project.task_type == TaskType.mos:
        new_scales = _validated_mos_scales(body.mos_scales)
        effective = project.mos_scales or [dict(s) for s in DEFAULT_MOS_SCALES]
        if new_scales != effective:
            if _has_done_tasks(db, project.id):
                raise HTTPException(status_code=409, detail="project_has_results")
            project.mos_scales = new_scales
    # sbs_systems (only for sbs projects) may be changed FREELY, including when
    # done tasks exist — it's merely a label for the admin/export, the result is stored
    # in terms of systems a/b and is not tied to their names
    if body.sbs_systems is not None and project.task_type == TaskType.sbs:
        project.sbs_systems = _validated_sbs_systems(body.sbs_systems)
    if (
        body.consensus_overlap is not None
        and body.consensus_overlap != project.consensus_overlap
    ):
        project.consensus_overlap = body.consensus_overlap
        _recount_open_tasks(db, project.id, body.consensus_overlap)
    if body.participants is not None or body.participant_groups is not None:
        project.participants = _resolve_participants(
            db, body.participants or [], body.participant_groups or []
        )
    db.commit()
    db.refresh(project)
    return _single_project_out(db, project)


@router.delete("/project/{project_id}", status_code=204)
def delete_project(
    project_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> Response:
    """Delete a project: fragments/tasks cascade, files — from storage.

    Objects of fragments from external S3 sources (source_id set) are NOT deleted
    (reference-in-place: the application does not own them) — from storage we clean
    only the objects of application-storage fragments (source_id=NULL)."""
    project = _project_or_404(db, project_id)
    keys = db.execute(
        select(AudioFragment.s3_key).where(
            AudioFragment.project_id == project_id,
            AudioFragment.source_id.is_(None),
        )
    ).scalars()
    storage = get_storage()
    for key in keys:
        try:
            storage.delete(key)
        except Exception:  # noqa: BLE001 — a storage failure does not block deletion
            pass
    db.delete(project)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Project instruction
# ---------------------------------------------------------------------------


@router.get("/project/{project_id}/instruction", response_model=InstructionOut)
def get_instruction(
    project_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InstructionOut:
    """Public reading of the instruction by an annotator (any authenticated user)."""
    project = _project_or_404(db, project_id)
    return InstructionOut(project_id=project.id, instruction=project.instruction or "")


# ---------------------------------------------------------------------------
# Aggregates
# ---------------------------------------------------------------------------


@router.get("/project/{project_id}/progress", response_model=ProjectProgress)
def project_progress(
    project_id: int,
    zombie_hours: float = Query(ZOMBIE_HOURS, gt=0),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> ProjectProgress:
    """Fragment counters (total/labeled/in-progress/zombie) and % done."""
    project = _project_or_404(db, project_id)
    counters = _counters_by_project(db, project.id, zombie_hours).get(
        project.id, ProjectCounters()
    )
    return ProjectProgress(project_id=project.id, **counters.model_dump())


@router.get("/project/{project_id}/agreement", response_model=AgreementStats)
def project_agreement(
    project_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AgreementStats:
    """Agreement metrics: the share of matching results across different annotators of one
    fragment (fragments with >=2 done tasks are counted)."""
    project = _project_or_404(db, project_id)

    multi = (
        select(Task.fragment_id)
        .join(AudioFragment, Task.fragment_id == AudioFragment.id)
        .where(Task.status == TaskStatus.done, AudioFragment.project_id == project_id)
        .group_by(Task.fragment_id)
        .having(func.count() >= 2)
        .subquery()
    )
    rows = db.execute(
        select(Task.fragment_id, Task.result, AudioFragment.task_type)
        .join(AudioFragment, Task.fragment_id == AudioFragment.id)
        .join(multi, multi.c.fragment_id == Task.fragment_id)
        .where(Task.status == TaskStatus.done)
    ).all()

    by_fragment: dict[int, tuple[TaskType, list[str]]] = {}
    for fragment_id, result, task_type in rows:
        by_fragment.setdefault(fragment_id, (task_type, []))[1].append(_canon(result))

    all_shares: list[float] = []
    shares_by_type: dict[TaskType, list[float]] = {}
    for task_type, canons in by_fragment.values():
        share = max(Counter(canons).values()) / len(canons) * 100.0
        all_shares.append(share)
        shares_by_type.setdefault(task_type, []).append(share)

    project_types = _task_types_by_project(db, project_id).get(project_id, [])
    per_type = [
        AgreementPerType(
            task_type=t,
            agreement_pct=round(sum(shares_by_type[t]) / len(shares_by_type[t]), 1)
            if t in shares_by_type
            else 0.0,
        )
        for t in project_types
    ]
    avg = round(sum(all_shares) / len(all_shares), 1) if all_shares else 0.0
    return AgreementStats(project_id=project_id, avg_agreement_pct=avg, per_type=per_type)


def _annotator_agreement(db: Session) -> dict[int, float]:
    """Annotator agreement: the average share of the fragment's other annotators
    whose result matched their result (over fragments with >=2 done tasks)."""
    multi = (
        select(Task.fragment_id)
        .where(Task.status == TaskStatus.done)
        .group_by(Task.fragment_id)
        .having(func.count() >= 2)
        .subquery()
    )
    rows = db.execute(
        select(Task.fragment_id, Task.user_id, Task.result)
        .join(multi, multi.c.fragment_id == Task.fragment_id)
        .where(Task.status == TaskStatus.done)
    ).all()

    by_fragment: dict[int, list[tuple[int | None, str]]] = {}
    for fragment_id, user_id, result in rows:
        by_fragment.setdefault(fragment_id, []).append((user_id, _canon(result)))

    shares: dict[int, list[float]] = {}
    for tasks in by_fragment.values():
        counts = Counter(canon for _, canon in tasks)
        n = len(tasks)
        for user_id, canon in tasks:
            if user_id is None or n < 2:
                continue
            shares.setdefault(user_id, []).append((counts[canon] - 1) / (n - 1))
    return {
        user_id: round(sum(values) / len(values) * 100.0, 1)
        for user_id, values in shares.items()
    }


@router.get("/dashboard", response_model=DashboardStats)
@router.get("/stats/dashboard", response_model=DashboardStats, include_in_schema=False)
def dashboard(
    zombie_hours: float = Query(ZOMBIE_HOURS, gt=0),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> DashboardStats:
    """Summary: projects/users/fragments, % labeled, zombie tasks
    (in_progress older than zombie_hours), top/outsider annotators."""
    projects_total = db.scalar(select(func.count()).select_from(Project)) or 0
    users_total = db.scalar(select(func.count()).select_from(User)) or 0

    counters = _counters_by_project(db, zombie_hours=zombie_hours)
    fragments_total = sum(c.fragments_total for c in counters.values())
    fragments_labeled = sum(c.fragments_labeled for c in counters.values())
    fragments_in_progress = sum(c.fragments_in_progress for c in counters.values())

    zombie_rows = db.execute(
        select(
            Task.id,
            Task.started_at,
            AudioFragment.project_id,
            Project.name,
            AudioFragment.filename,
            AudioFragment.task_type,
            User.fio,
        )
        .join(AudioFragment, Task.fragment_id == AudioFragment.id)
        .join(Project, AudioFragment.project_id == Project.id)
        .join(User, Task.user_id == User.id, isouter=True)
        .where(
            Task.status == TaskStatus.in_progress,
            Task.started_at.is_not(None),
            Task.started_at < _zombie_cutoff(zombie_hours),
        )
        .order_by(Task.started_at)
        .limit(ZOMBIE_LIST_LIMIT)
    ).all()
    zombies = [
        ZombieTask(
            id=task_id,
            project_id=project_id,
            project_name=project_name,
            fragment_filename=filename,
            task_type=task_type,
            taken_by=fio or "",
            taken_at=started_at,
            hours_stuck=round(_hours_since(started_at), 1),
        )
        for task_id, started_at, project_id, project_name, filename, task_type, fio in zombie_rows
    ]

    done_rows = db.execute(
        select(Task.user_id, func.count())
        .where(Task.status == TaskStatus.done, Task.user_id.is_not(None))
        .group_by(Task.user_id)
    ).all()
    scores: list[AnnotatorScore] = []
    if done_rows:
        agreement = _annotator_agreement(db)
        users_by_id = {
            u.id: u
            for u in db.execute(
                select(User).where(User.id.in_([user_id for user_id, _ in done_rows]))
            ).scalars()
        }
        for user_id, tasks_done in done_rows:
            user = users_by_id.get(user_id)
            if user is None:
                continue
            scores.append(
                AnnotatorScore(
                    user_id=user_id,
                    fio=user.fio,
                    group=user.group_name,
                    tasks_done=int(tasks_done),
                    agreement_pct=agreement.get(user_id, 0.0),
                )
            )
    top = sorted(scores, key=lambda s: (-s.tasks_done, s.user_id))[:ANNOTATORS_TOP_N]
    outsiders = sorted(scores, key=lambda s: (s.tasks_done, s.user_id))[:ANNOTATORS_TOP_N]

    return DashboardStats(
        projects_total=int(projects_total),
        users_total=int(users_total),
        fragments_total=fragments_total,
        fragments_labeled=fragments_labeled,
        fragments_in_progress=fragments_in_progress,
        labeled_pct=_pct(fragments_labeled, fragments_total),
        zombie_tasks=zombies,
        top_annotators=top,
        outsider_annotators=outsiders,
    )


# ---------------------------------------------------------------------------
# Fragment browser
# ---------------------------------------------------------------------------


def _presign_resolver(db: Session, fragments: list[AudioFragment]):
    """Presigned-URL routing by fragment.source_id (S3 feature contract):
    source_id=None → application storage (as before); otherwise — presigned
    against the source (S3Source). The page's sources are cached per request
    (no N+1 for a list of fragments from one source)."""
    source_ids = {f.source_id for f in fragments if f.source_id is not None}
    sources: dict[int, object] = {}
    if source_ids:
        for s in db.execute(select(S3Source).where(S3Source.id.in_(source_ids))).scalars():
            sources[s.id] = get_source_storage(s)
    app_storage = get_storage()

    def presign(source_id: int | None, key: str | None) -> str | None:
        if not key:
            return None
        if source_id is None:
            return app_storage.presigned_url(key)
        return sources[source_id].presigned_url(key)

    return presign


def _fragment_out(
    fragment: AudioFragment, done_count: int, overlap: int, presign
) -> AudioFragmentOut:
    meta = fragment.meta if isinstance(fragment.meta, dict) else {}
    # Variant B of the SBS pair: URL/metadata only if s3_key_b is filled
    # (sbs projects), null for other types. Presigned routing is by source_id.
    audio_url_b = presign(fragment.source_id, fragment.s3_key_b)
    return AudioFragmentOut(
        id=fragment.id,
        project_id=fragment.project_id,
        filename=fragment.filename,
        duration_sec=fragment.duration_sec,
        size_bytes=fragment.size_bytes,
        task_type=fragment.task_type,
        orig_trb=fragment.orig_trb,
        metadata={str(k): str(v) for k, v in meta.items()},
        finished=done_count >= overlap,
        task_count=int(done_count),
        tasks_done=int(done_count),
        tasks_required=int(overlap),
        audio_url=presign(fragment.source_id, fragment.s3_key),
        filename_b=fragment.filename_b,
        duration_sec_b=fragment.duration_sec_b,
        size_bytes_b=fragment.size_bytes_b,
        audio_url_b=audio_url_b,
        source_id=fragment.source_id,
    )


@router.get("/project/{project_id}/fragments", response_model=PaginatedFragments)
def list_fragments(
    project_id: int,
    offset: int = Query(0, ge=0),
    # Cap of 1000: the fragment browser (ProjectDetail) loads the first page with limit=1000
    limit: int = Query(50, ge=1, le=1000),
    task_type: TaskType | None = None,
    finished: bool | None = None,
    search: str | None = None,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> PaginatedFragments:
    """Paginated list of fragments with statuses (finished = done >=
    the project's consensus_overlap; task_count/tasks_done — number of done; the response
    also has tasks_required = consensus_overlap — the frontend shows "1/2")
    and a playback URL; filters task_type/finished/search. Statuses are computed
    with one GROUP BY query — works on 100k+ fragments."""
    project = _project_or_404(db, project_id)
    overlap = project.consensus_overlap

    task_agg = (
        select(
            Task.fragment_id.label("fragment_id"),
            func.count(case((Task.status == TaskStatus.done, 1))).label("done"),
        )
        .group_by(Task.fragment_id)
        .subquery()
    )
    done_col = func.coalesce(task_agg.c.done, 0)
    q = (
        select(AudioFragment, done_col.label("done"))
        .join(task_agg, task_agg.c.fragment_id == AudioFragment.id, isouter=True)
        .where(AudioFragment.project_id == project_id)
    )
    if task_type is not None:
        q = q.where(AudioFragment.task_type == task_type)
    if finished is not None:
        q = q.where(done_col >= overlap if finished else done_col < overlap)
    if search:
        q = q.where(AudioFragment.filename.ilike(f"%{search}%"))

    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.execute(q.order_by(AudioFragment.id).offset(offset).limit(limit)).all()
    presign = _presign_resolver(db, [fragment for fragment, _ in rows])
    return PaginatedFragments(
        items=[_fragment_out(fragment, done, overlap, presign) for fragment, done in rows],
        total=int(total),
        offset=offset,
        limit=limit,
    )


def _done_count(db: Session, fragment_id: int) -> int:
    return (
        db.scalar(
            select(func.count()).where(
                Task.fragment_id == fragment_id, Task.status == TaskStatus.done
            )
        )
        or 0
    )


@router.patch("/fragment/{fragment_id}", response_model=AudioFragmentOut)
def update_fragment(
    fragment_id: int,
    body: FragmentUpdate,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> AudioFragmentOut:
    """Edit a fragment. The task_type change is REMOVED (the type is uniform per project,
    inherited from Project.task_type): the task_type field in the body is IGNORED —
    kept for backward compatibility with the old client.ts setTaskType
    (an invalid value is still rejected by the schema as 422).
    The endpoint returns the fragment's current state."""
    fragment = _fragment_or_404(db, fragment_id)
    overlap = db.get(Project, fragment.project_id).consensus_overlap
    presign = _presign_resolver(db, [fragment])
    return _fragment_out(fragment, _done_count(db, fragment_id), overlap, presign)


@router.delete("/fragment/{fragment_id}", status_code=204)
def delete_fragment(
    fragment_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> Response:
    """Delete a fragment: tasks cascade, the file — from storage.

    A fragment from an external S3 source (source_id set) — the object in the source
    bucket is NOT touched (reference-in-place)."""
    fragment = _fragment_or_404(db, fragment_id)
    if fragment.source_id is None:
        try:
            get_storage().delete(fragment.s3_key)
        except Exception:  # noqa: BLE001 — a storage failure does not block deletion
            pass
    db.delete(fragment)
    db.commit()
    return Response(status_code=204)


@router.get("/fragment/{fragment_id}/presigned", response_model=PresignedUrl)
def fragment_presigned(
    fragment_id: int,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
) -> PresignedUrl:
    """Fragment playback URL (application storage: local /api/media/{key}
    or s3-presigned; a fragment from an external source — presigned against it)."""
    fragment = _fragment_or_404(db, fragment_id)
    presign = _presign_resolver(db, [fragment])
    return PresignedUrl(
        url=presign(fragment.source_id, fragment.s3_key),
        expires_at=utcnow() + timedelta(seconds=settings.PRESIGNED_URL_TTL_SEC),
    )

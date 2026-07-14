"""Pydantic schemas for project CRUD, fragments, aggregates and the
instruction.

Response shapes are 1:1 with the frontend contract src/api/types.ts:
Project / ProjectCounters / ProjectProgress / AgreementStats / AudioFragment /
PresignedUrl / Paginated<AudioFragment> / DashboardStats / ZombieTask /
AnnotatorScore. Errors — machine-readable codes in detail.

Contract extensions (backward compatible):
  - ProjectCreate/ProjectUpdate.participants accept both ids and objects
    {user_id: ...} (client.ts create sends number[], update — ProjectParticipant[]);
  - ProjectCreate/ProjectUpdate.participant_groups — adding participants by
    whole study groups ("participants — including adding groups").

The task type is a
PROJECT attribute (Project.task_type), required on creation; it can only be
changed while the project has no fragments (409 'project_has_fragments').
Changing the type of an individual fragment is removed (FragmentUpdate.task_type
is ignored — kept for client backward compatibility).
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_serializer

from src.models import TaskType

# ---------------------------------------------------------------------------
# Project (types.ts Project)
# ---------------------------------------------------------------------------


class LabelClass(BaseModel):
    """Label class (chip) and its color (types.ts LabelClass)."""

    name: str
    color: str


class MosScale(BaseModel):
    """Configurable scale of a MOS project (types.ts MosScale).

    The rating scale is always 1–5 (MOS standard); the scale NAME and the
    item LABELS are configurable. labels are optional: the default labels
    (1 bad · 2 poor · 3 fair · 4 good · 5 excellent)
    are localized on the frontend, only custom ones are stored in the data.

    Validation of the scale-list COMPOSITION (1..5 scales, names non-empty and
    unique, 422 detail='bad_mos_scales') — in routers/project.py; here — the shape
    of a single scale (junk labels keys are rejected as an ordinary pydantic 422).
    """

    name: str
    labels: dict[Literal["1", "2", "3", "4", "5"], str] | None = None

    @model_serializer
    def _serialize(self) -> dict:
        """labels in the response — custom only (ts: labels?: Record<...>):
        without custom labels the key is absent, not null."""
        out: dict = {"name": self.name}
        if self.labels:
            out["labels"] = dict(self.labels)
        return out


class SbsSystems(BaseModel):
    """System names of an SBS project (types.ts SbsSystems): {a, b}.

    Only a label for the admin/export — the names are NEVER given to the
    annotator (blind comparison). Validation of non-empty names (422
    detail='bad_sbs_systems') — in routers/project.py.
    """

    a: str
    b: str


class ProjectParticipantOut(BaseModel):
    """Project participant (types.ts ProjectParticipant)."""

    user_id: int
    fio: str
    group: str | None = None


class ProjectCounters(BaseModel):
    """Project counters/progress (types.ts ProjectCounters).

    Semantics with the consensus mechanism (K = Project.consensus_overlap):
    a fragment is "labeled" (finished) — the number of done tasks >= K; "in
    progress" — not labeled and (there is an in_progress task OR 0 < done < K);
    "zombie" — in_progress tasks older than N hours (task count). At K=1 a
    fragment is labeled once it has >=1 done task.
    """

    fragments_total: int = 0
    fragments_labeled: int = 0
    fragments_in_progress: int = 0
    zombie_tasks: int = 0
    # 0..100, rounded completion percentage
    progress_pct: int = 0


class ProjectOut(BaseModel):
    """Project (types.ts Project): aggregates + participants + task types."""

    id: int
    name: str
    description: str = ""
    # Instruction for the annotator, markdown/plain text
    instruction: str = ""
    # Label classes; not applicable to sbs projects — null
    label_list: list[LabelClass] | None = Field(default_factory=list)
    participants: list[ProjectParticipantOut] = Field(default_factory=list)
    # Project task type: chosen on creation, single for all fragments
    task_type: TaskType
    # Task types occurring in the fragments (derived; for legacy projects
    # with mixed-type fragments may differ from [task_type])
    task_types: list[TaskType] = Field(default_factory=list)
    # Consensus overlap: how many different annotators label each
    # fragment (1 = no consensus); finished = done >= consensus_overlap
    consensus_overlap: int = 1
    # Configurable MOS scales: only for task_type='mos' (a mos project —
    # always >=1 scale, at least the default), null for the others
    mos_scales: list[MosScale] | None = None
    # SBS comparison system names: only for task_type='sbs' AND only in the
    # admin output (always null for the annotator in GET /projects: blind
    # comparison), null for other types
    sbs_systems: SbsSystems | None = None
    counters: ProjectCounters = Field(default_factory=ProjectCounters)
    created_at: datetime


class ParticipantRef(BaseModel):
    """Participant in the request body: {user_id: ...} (extra fields ignored)."""

    user_id: int


class ProjectCreate(BaseModel):
    """Body of POST /projects (client.ts projectsApi.create).

    task_type is REQUIRED (the router returns 400 'task_type_required' —
    a machine-readable code, like 'name_required').
    """

    name: str = ""
    description: str = ""
    instruction: str = ""
    label_list: list[LabelClass] = Field(default_factory=list)
    # Project task type — required (None is validated by the router into 400)
    task_type: TaskType | None = None
    # Consensus overlap 1..5 (out of range — 422); backend default is 1
    # (no consensus, as before), the UI default for a new project is 2
    consensus_overlap: int = Field(1, ge=1, le=5)
    # MOS scales: taken into account only when task_type='mos' (ignored otherwise);
    # a mos project without explicit scales gets the default [{name: 'Качество звучания'}].
    # Composition validation (1..5 scales, names non-empty/unique) — in the router,
    # error — 422 detail='bad_mos_scales'
    mos_scales: list[MosScale] | None = None
    # SBS system names: taken into account only when task_type='sbs' (ignored
    # otherwise); an sbs project without explicit names gets the default
    # {a: 'Система A', b: 'Система B'}. Non-empty name validation — in the router,
    # error — 422 detail='bad_sbs_systems'
    sbs_systems: SbsSystems | None = None
    # user ids or {user_id} objects
    participants: list[int | ParticipantRef] = Field(default_factory=list)
    # Add all users of the specified groups (extension)
    participant_groups: list[str] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    """Body of PATCH /project/{id}: all fields optional (client.ts update).

    task_types in the body is ignored — task types are derived from fragments.
    task_type can only be changed while the project has no fragments
    (otherwise 409 'project_has_fragments').

    consensus_overlap (1..5) is ALLOWED to change even when fragments exist:
    open tasks are recomputed transactionally (increase — create additional
    open tasks up to the new K, decrease — delete surplus open tasks;
    done/in_progress are untouched, finished is recomputed by the formula).

    mos_scales (only for mos projects, ignored for others) is allowed to
    change WHILE the project has no done tasks — otherwise 409
    'project_has_results' (submitted scores are tied to scale names).
    Repeating the current value is a no-op. None = "do not change".

    sbs_systems (only for sbs projects, ignored for others) is allowed to
    change FREELY (including with done tasks): it is only a label for the
    admin/export, the result is stored in terms of systems a/b. Non-empty
    name validation — 422 'bad_sbs_systems'. None = "do not change".
    """

    name: str | None = None
    description: str | None = None
    instruction: str | None = None
    label_list: list[LabelClass] | None = None
    task_type: TaskType | None = None
    consensus_overlap: int | None = Field(None, ge=1, le=5)
    mos_scales: list[MosScale] | None = None
    sbs_systems: SbsSystems | None = None
    participants: list[int | ParticipantRef] | None = None
    participant_groups: list[str] | None = None


class InstructionOut(BaseModel):
    """Response of GET /project/{id}/instruction."""

    project_id: int
    instruction: str


# ---------------------------------------------------------------------------
# Aggregates
# ---------------------------------------------------------------------------


class ProjectProgress(ProjectCounters):
    """Project progress via a dedicated endpoint (types.ts ProjectProgress)."""

    project_id: int


class AgreementPerType(BaseModel):
    task_type: TaskType
    agreement_pct: float


class AgreementStats(BaseModel):
    """Agreement metrics for the project (types.ts AgreementStats).

    Fragment agreement = share of the largest group of matching results among
    the fragment's done tasks (fragments with >=2 done tasks); the aggregate is the mean.
    """

    project_id: int
    avg_agreement_pct: float
    per_type: list[AgreementPerType]


class ZombieTask(BaseModel):
    """Zombie task: in_progress older than N hours (types.ts ZombieTask)."""

    id: int
    project_id: int
    project_name: str
    fragment_filename: str
    task_type: TaskType
    taken_by: str
    taken_at: datetime
    hours_stuck: float


class AnnotatorScore(BaseModel):
    """Row of the top/bottom annotators list (types.ts AnnotatorScore)."""

    user_id: int
    fio: str
    group: str | None = None
    tasks_done: int
    agreement_pct: float


class DashboardStats(BaseModel):
    """Dashboard summary (types.ts DashboardStats)."""

    projects_total: int
    users_total: int
    fragments_total: int
    fragments_labeled: int
    fragments_in_progress: int
    # % labeled across all projects, 0..100
    labeled_pct: int
    zombie_tasks: list[ZombieTask]
    top_annotators: list[AnnotatorScore]
    outsider_annotators: list[AnnotatorScore]


# ---------------------------------------------------------------------------
# Fragments
# ---------------------------------------------------------------------------


class AudioFragmentOut(BaseModel):
    """Audio fragment (types.ts AudioFragment): statuses + playback URL."""

    id: int
    project_id: int
    filename: str
    # null — duration could not be read (shown as "—" in the list)
    duration_sec: float | None = None
    size_bytes: int
    task_type: TaskType
    # ASR draft, shown to the annotator
    orig_trb: str | None = None
    # key-value metadata of the batch/fragment (in the model — the meta field)
    metadata: dict[str, str] = Field(default_factory=dict)
    # Labeling finished: done tasks >= the project's consensus_overlap
    finished: bool
    # How many tasks for the fragment are submitted (done) — legacy name, = tasks_done
    task_count: int
    # Consensus progress "1/2": submitted / required (types.ts AudioFragment
    # tasks_done + tasks_required; required = Project.consensus_overlap)
    tasks_done: int
    tasks_required: int
    # Playback URL: local — /api/media/{key}, s3 — presigned URL.
    # In sbs projects the main fields/URL are variant A of the pair, *_b — variant B
    audio_url: str
    # Variant B of the SBS pair (sbs projects only, null for others)
    filename_b: str | None = None
    duration_sec_b: float | None = None
    size_bytes_b: int | None = None
    audio_url_b: str | None = None
    # S3 data source (reference-in-place): null — a fragment of the app's
    # storage (ordinary upload); otherwise the object lives in the source bucket
    source_id: int | None = None


class PaginatedFragments(BaseModel):
    """Page of fragments (types.ts Paginated<AudioFragment>)."""

    items: list[AudioFragmentOut]
    total: int
    offset: int
    limit: int


class FragmentUpdate(BaseModel):
    """Body of PATCH /fragment/{id}.

    task_type is DEPRECATED and IGNORED: the type is single per project
    (Project.task_type), changing the type of an individual fragment is removed.
    The field is kept for backward compatibility with the old client.ts setTaskType
    (the value is still validated as TaskType — junk returns 422).
    """

    task_type: TaskType | None = None


class PresignedUrl(BaseModel):
    """Response of GET /fragment/{id}/presigned (types.ts PresignedUrl)."""

    url: str
    expires_at: datetime

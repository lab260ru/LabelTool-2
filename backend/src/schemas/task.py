"""Pydantic schemas for annotator tasks.

Response shapes are 1:1 with the frontend contract src/api/types.ts:
Task (discriminated by the type field, payload depends on the type), AudioFragment,
SubmitResult, TaskHistoryItem, Paginated. Machine-readable error codes in detail —
the human-readable strings are produced by the UI via i18n.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from src.models import TaskType

# Status of a submitted task in the history (types.ts TaskHistoryItem.status)
HistoryStatus = Literal["accepted", "pending", "consensus"]


class AudioFragmentOut(BaseModel):
    """types.ts AudioFragment: finished = done tasks >= the project's
    consensus_overlap; tasks_done/tasks_required — consensus progress "1/2";
    audio_url — presigned storage URL (local: /api/media/{key})."""

    id: int
    project_id: int
    filename: str
    duration_sec: float | None = None
    size_bytes: int
    task_type: TaskType
    orig_trb: str | None = None
    metadata: dict = {}
    finished: bool
    # How many tasks are submitted (done) — legacy name, = tasks_done
    task_count: int
    # Consensus progress: submitted / required (= Project.consensus_overlap)
    tasks_done: int
    tasks_required: int
    audio_url: str
    # S3 data source (reference-in-place): null — the app's storage
    source_id: int | None = None


class TaskOut(BaseModel):
    """types.ts Task: base fields + type/payload by task type.

    payload:
      transcription  → {orig_trb}
      verification   → {text, author_fio}
      classification → {labels, multiple}
      segmentation   → {labels}
      diarization    → {max_speakers}
      mos            → {scale_min: 1, scale_max: 5,
                        mos_scales: [{name, labels?}]} — the project's
                       configurable scales (Project.mos_scales); rating 1..5 for each
      sbs            → {audio_url_1, audio_url_2} — two audio links in DISPLAY
                       order (the backend has already applied Task.swap; there are
                       no system names, blind comparison)
    """

    id: int
    project_id: int
    project_name: str
    fragment: AudioFragmentOut
    instruction: str
    type: TaskType
    payload: dict


class SubmitIn(BaseModel):
    """types.ts LabelingResult: task_id + type + result fields by type.

    extra='allow': the set of fields depends on the type (text/verdict/labels/segments…;
    mos → {scores: {scale_name: 1..5}} — all the project's scales and only them;
    sbs → {preference: -2..2} IN TERMS OF THE DISPLAYED order — the router
    normalizes it via Task.swap into system terms; invalid — 422 'bad_result'),
    saved to Task.result.
    """

    model_config = ConfigDict(extra="allow")

    task_id: int
    type: TaskType | None = None


class SubmitOut(BaseModel):
    """types.ts SubmitResult."""

    ok: bool = True
    task_id: int


class TaskHistoryItemOut(BaseModel):
    """types.ts TaskHistoryItem."""

    task_id: int
    task_type: TaskType
    project_id: int
    project_name: str
    fragment_filename: str
    submitted_at: datetime
    status: HistoryStatus = "accepted"


class TaskHistoryPage(BaseModel):
    """types.ts Paginated<TaskHistoryItem> (items/total/offset/limit)."""

    items: list[TaskHistoryItemOut]
    total: int
    offset: int
    limit: int

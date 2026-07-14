"""Shared export record model and consensus selection.

ExportRecord — a normalized dataset row from which each format
(jsonl/csv/nemo/textgrid/conll/srt_vtt) assembles its file. The structure of
`Task.result` follows the frontend contract LabelingResult (src/api/types.ts):
  transcription  → {text}
  verification   → {verdict: approve|reject, corrected_text}
  classification → {labels: [str]}
  segmentation   → {segments: [{start_sec, end_sec, label}]}
  diarization    → {segments: [{start_sec, end_sec, speaker}]}
  mos            → {scores: {scale_name: 1..5}} — ratings by the project's
                   configurable scales (Project.mos_scales); legacy results
                   {score: 1..5} are read as {scores: {"MOS": N}}

MOS tasks are fully serialized to jsonl (a scores object per scale) and
csv (a mos_<name> column per scale); the formats nemo/textgrid/conll/srt_vtt
are not applicable to mos projects — POST /project/{id}/export returns 422
'format_not_applicable' (see routers/export.py). The consensus majority
(pick_consensus) works over the canonical JSON result — unchanged.
"""

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone

from src.models import DEFAULT_SBS_SYSTEMS, AudioFragment, Task, TaskStatus, TaskType


@dataclass
class ExportRecord:
    fragment_id: int
    task_id: int | None
    filename: str
    duration_sec: float | None
    task_type: str
    text: str | None = None
    verdict: str | None = None
    # MOS ratings by the project's scales {scale_name: 1..5} (only task_type='mos');
    # legacy {score: N} is normalized to {"MOS": N}
    scores: dict[str, int] | None = None
    # Side-by-Side (only task_type='sbs'): filename of the pair's variant B,
    # preference in terms of SYSTEMS (minus = A better, plus = B) and system names
    filename_b: str | None = None
    preference: int | None = None
    systems: dict[str, str] | None = None
    labels: list[str] = field(default_factory=list)
    # Normalized segments: {"start_sec": float, "end_sec": float, "label": str}
    segments: list[dict] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    annotator: str | None = None
    orig_trb: str | None = None

    @property
    def best_text(self) -> str:
        """Best available text (for NeMo/CoNLL): result → ASR draft → ''."""
        return self.text or self.orig_trb or ""


def build_record(
    fragment: AudioFragment, task: Task, sbs_systems: dict | None = None
) -> ExportRecord:
    """Normalizes a fragment + task into an ExportRecord.

    sbs_systems (the project's system names) is needed only for task_type='sbs' —
    it goes into the record's systems field (not used for other types)."""
    result = task.result or {}
    rec = ExportRecord(
        fragment_id=fragment.id,
        task_id=task.id,
        filename=fragment.filename,
        duration_sec=fragment.duration_sec,
        task_type=fragment.task_type.value,
        metadata=dict(fragment.meta or {}),
        annotator=task.user.fio if task.user is not None else None,
        orig_trb=fragment.orig_trb,
    )
    ttype = fragment.task_type
    if ttype == TaskType.transcription:
        rec.text = result.get("text")
    elif ttype == TaskType.verification:
        rec.verdict = result.get("verdict")
        rec.text = result.get("corrected_text") or fragment.orig_trb
    elif ttype == TaskType.classification:
        rec.labels = [str(x) for x in (result.get("labels") or [])]
    elif ttype == TaskType.segmentation:
        rec.segments = _norm_segments(result.get("segments"), "label")
    elif ttype == TaskType.diarization:
        rec.segments = _norm_segments(result.get("segments"), "speaker")
    elif ttype == TaskType.mos:
        rec.scores = _norm_scores(result)
    elif ttype == TaskType.sbs:
        # Variant B of the pair + normalized (in system terms) preference
        # + system names for export readability (default if not set)
        rec.filename_b = fragment.filename_b
        rec.preference = _int_or_none(result.get("preference"))
        rec.systems = dict(sbs_systems) if sbs_systems else dict(DEFAULT_SBS_SYSTEMS)
    return rec


def _int_or_none(raw: object) -> int | None:
    if isinstance(raw, bool):  # bool is a subclass of int, but not a rating
        return None
    try:
        return int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _norm_scores(result: dict) -> dict[str, int] | None:
    """MOS result ratings: {scores: {scale: N}} — per scale;
    legacy {score: N} — as {"MOS": N} (export contract, item 5)."""
    raw = result.get("scores")
    if isinstance(raw, dict):
        out = {}
        for name, value in raw.items():
            score = _int_or_none(value)
            if score is not None:
                out[str(name)] = score
        return out or None
    legacy = _int_or_none(result.get("score"))
    if legacy is not None:
        return {"MOS": legacy}
    return None


def _norm_segments(raw: list | None, label_key: str) -> list[dict]:
    out: list[dict] = []
    for seg in raw or []:
        try:
            start = float(seg.get("start_sec", 0.0) or 0.0)
            end = float(seg.get("end_sec", start) or start)
        except (TypeError, ValueError):
            continue
        out.append(
            {"start_sec": start, "end_sec": end, "label": str(seg.get(label_key) or "")}
        )
    out.sort(key=lambda s: (s["start_sec"], s["end_sec"]))
    return out


# ---------------------------------------------------------------------------
# Consensus (scope=consensus)
# ---------------------------------------------------------------------------


def _ts(task: Task) -> tuple[float, int]:
    """Task submission moment for sorting (tz-naive values are treated as UTC)."""
    dt = task.finished_at or task.created_at
    if dt is None:
        return (0.0, task.id or 0)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt.timestamp(), task.id or 0)


def _canon(result: dict | None) -> str:
    return json.dumps(result or {}, sort_keys=True, ensure_ascii=False)


def pick_consensus(tasks: list[Task]) -> Task | None:
    """Consensus heuristic (scope=consensus): the majority of identical
    done results among the K submissions of a fragment (K = Project.consensus_overlap,
    the task duplication mechanism); on a tie — the group with the most
    recent submission. Returns a representative of the winning group (the last
    done task in it) or None if there are no done tasks. Correct for any
    number of done: 1 (no consensus), K>=2, and "extra" submissions beyond K.
    """
    done = [t for t in tasks if t.status == TaskStatus.done]
    if not done:
        return None
    groups: dict[str, list[Task]] = {}
    for t in done:
        groups.setdefault(_canon(t.result), []).append(t)
    best_group = max(groups.values(), key=lambda g: (len(g), max(_ts(t) for t in g)))
    return max(best_group, key=_ts)

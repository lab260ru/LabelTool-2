"""CSV — a table for quick analysis.

MOS ratings (task_type='mos'): a mos_<name> column per project scale
(the "Configurable MOS scales" contract, item 5). Columns are collected from the
actual records in order of first appearance; for non-MOS rows they are empty. A legacy
result {score: N} is normalized already in build_record as {"MOS": N} → column mos_MOS.

Side-by-Side (task_type='sbs'): the columns audio_b (variant B of the pair)
and sbs_preference (normalized preference: minus = A better, plus = B) are added —
only if the export contains sbs records (the "SBS" contract, item 7).
"""

import csv  # stdlib (absolute import, not this module)
import io
import json

from src.serializers.base import ExportRecord

_COLUMNS = [
    "fragment_id",
    "filename",
    "duration_sec",
    "task_type",
    "annotator",
    "text",
    "verdict",
    "labels",
    "segments",
]


def _mos_scale_names(records: list[ExportRecord]) -> list[str]:
    """MOS scale names across all records, in order of first appearance."""
    names: dict[str, None] = {}
    for r in records:
        for name in r.scores or {}:
            names.setdefault(name)
    return list(names)


def serialize(records: list[ExportRecord], include_metadata: bool) -> list[tuple[str, str]]:
    scale_names = _mos_scale_names(records)
    # The sbs columns are added only when there are sbs records in the export
    has_sbs = any(r.task_type == "sbs" for r in records)
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    columns = (
        _COLUMNS
        + [f"mos_{name}" for name in scale_names]
        + (["audio_b", "sbs_preference"] if has_sbs else [])
        + (["metadata"] if include_metadata else [])
    )
    writer.writerow(columns)
    for r in records:
        scores = r.scores or {}
        row = [
            r.fragment_id,
            r.filename,
            "" if r.duration_sec is None else r.duration_sec,
            r.task_type,
            r.annotator or "",
            r.text or "",
            r.verdict or "",
            "|".join(r.labels),
            json.dumps(r.segments, ensure_ascii=False) if r.segments else "",
        ]
        row.extend("" if scores.get(name) is None else scores[name] for name in scale_names)
        if has_sbs:
            row.append(r.filename_b or "")
            row.append("" if r.preference is None else r.preference)
        if include_metadata:
            row.append(json.dumps(r.metadata, ensure_ascii=False, sort_keys=True))
        writer.writerow(row)
    return [("dataset.csv", buf.getvalue())]

"""JSONL — universal exchange: one line per record (fragment/task)."""

import json

from src.serializers.base import ExportRecord


def serialize(records: list[ExportRecord], include_metadata: bool) -> list[tuple[str, str]]:
    lines = []
    for r in records:
        row = {
            "audio": r.filename,
            "duration_sec": r.duration_sec,
            "task_type": r.task_type,
            "text": r.text,
            "labels": r.labels,
            "segments": r.segments,
            "verdict": r.verdict,
            # MOS ratings by the project's scales {scale_name: 1..5} (task_type='mos'),
            # null for the other types; legacy {score: N} — as {"MOS": N}
            "scores": r.scores,
            # Side-by-Side (task_type='sbs'): variant B of the pair, normalized
            # preference (minus = A better, plus = B) and system names; null outside sbs
            "audio_b": r.filename_b,
            "preference": r.preference,
            "systems": r.systems,
            "annotator": r.annotator,
            "task_id": r.task_id,
        }
        if include_metadata:
            row["metadata"] = r.metadata
        lines.append(json.dumps(row, ensure_ascii=False))
    body = "\n".join(lines) + ("\n" if lines else "")
    return [("dataset.jsonl", body)]

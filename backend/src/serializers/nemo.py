"""NeMo manifest — ASR training in NVIDIA NeMo.

JSONL: one line per record with the keys audio_filepath, duration, text
(NeMo ignores extra keys, so metadata is an optional field).
"""

import json

from src.serializers.base import ExportRecord


def serialize(records: list[ExportRecord], include_metadata: bool) -> list[tuple[str, str]]:
    lines = []
    for r in records:
        row = {
            "audio_filepath": r.filename,
            "duration": r.duration_sec if r.duration_sec is not None else 0.0,
            "text": r.best_text,
        }
        if include_metadata:
            row["metadata"] = r.metadata
        lines.append(json.dumps(row, ensure_ascii=False))
    body = "\n".join(lines) + ("\n" if lines else "")
    return [("manifest.jsonl", body)]

"""Praat TextGrid — segments and alignment (academia/phonetics).

One .TextGrid per record; a single IntervalTier "labels". Intervals continuously
cover [0, xmax] (gaps are filled with empty intervals) — a requirement of a
valid TextGrid. For records without segments (transcription/classification)
— a single interval over the whole duration with the text/labels.
"""

from pathlib import PurePosixPath

from src.serializers.base import ExportRecord


def _esc(text: str) -> str:
    return text.replace('"', '""')


def _num(x: float) -> str:
    return repr(round(float(x), 6))


def _intervals(r: ExportRecord) -> tuple[list[tuple[float, float, str]], float]:
    xmax = float(r.duration_sec or 0.0)
    if r.segments:
        xmax = max(xmax, max(s["end_sec"] for s in r.segments))
    if not r.segments:
        xmax = max(xmax, 0.01)
        text = r.text or ", ".join(r.labels)
        return [(0.0, xmax, text)], xmax
    out: list[tuple[float, float, str]] = []
    cursor = 0.0
    for seg in r.segments:
        start, end = seg["start_sec"], seg["end_sec"]
        if start > cursor:
            out.append((cursor, start, ""))
        out.append((start, max(end, start), seg["label"]))
        cursor = max(cursor, end)
    if cursor < xmax:
        out.append((cursor, xmax, ""))
    return out, xmax


def _render(r: ExportRecord) -> str:
    intervals, xmax = _intervals(r)
    lines = [
        'File type = "ooTextFile"',
        'Object class = "TextGrid"',
        "",
        "xmin = 0",
        f"xmax = {_num(xmax)}",
        "tiers? <exists>",
        "size = 1",
        "item []:",
        "    item [1]:",
        '        class = "IntervalTier"',
        '        name = "labels"',
        "        xmin = 0",
        f"        xmax = {_num(xmax)}",
        f"        intervals: size = {len(intervals)}",
    ]
    for i, (start, end, text) in enumerate(intervals, start=1):
        lines += [
            f"        intervals [{i}]:",
            f"            xmin = {_num(start)}",
            f"            xmax = {_num(end)}",
            f'            text = "{_esc(text)}"',
        ]
    return "\n".join(lines) + "\n"


def serialize(records: list[ExportRecord], include_metadata: bool) -> list[tuple[str, str]]:
    members: list[tuple[str, str]] = []
    used: set[str] = set()
    for r in records:
        stem = PurePosixPath(r.filename).stem or f"fragment_{r.fragment_id}"
        name = f"{stem}.TextGrid"
        if name in used:  # scope=all: multiple tasks per fragment
            name = f"{stem}_task{r.task_id}.TextGrid"
        used.add(name)
        members.append((name, _render(r)))
    return members

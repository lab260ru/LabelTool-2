"""SRT / VTT — subtitles with segment timecodes.

Per record — a pair of files {stem}.srt and {stem}.vtt. Cues come from the segments
(segmentation: label, diarization: speaker); for records without segments — a single
cue over the whole duration with the record's text.
"""

from pathlib import PurePosixPath

from src.serializers.base import ExportRecord


def _timestamp(sec: float, sep: str) -> str:
    total_ms = max(0, round(float(sec) * 1000))
    ms = total_ms % 1000
    s = (total_ms // 1000) % 60
    m = (total_ms // 60_000) % 60
    h = total_ms // 3_600_000
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def _cues(r: ExportRecord) -> list[tuple[float, float, str]]:
    if r.segments:
        return [(s["start_sec"], s["end_sec"], s["label"]) for s in r.segments]
    end = float(r.duration_sec or 0.0) or 0.01
    return [(0.0, end, r.best_text)]


def _srt(cues: list[tuple[float, float, str]]) -> str:
    parts = []
    for i, (start, end, text) in enumerate(cues, start=1):
        parts.append(f"{i}\n{_timestamp(start, ',')} --> {_timestamp(end, ',')}\n{text}\n")
    return "\n".join(parts)


def _vtt(cues: list[tuple[float, float, str]]) -> str:
    parts = ["WEBVTT\n"]
    for start, end, text in cues:
        parts.append(f"{_timestamp(start, '.')} --> {_timestamp(end, '.')}\n{text}\n")
    return "\n".join(parts)


def serialize(records: list[ExportRecord], include_metadata: bool) -> list[tuple[str, str]]:
    members: list[tuple[str, str]] = []
    used: set[str] = set()
    for r in records:
        stem = PurePosixPath(r.filename).stem or f"fragment_{r.fragment_id}"
        if stem in used:  # scope=all: multiple tasks per fragment
            stem = f"{stem}_task{r.task_id}"
        used.add(stem)
        cues = _cues(r)
        members.append((f"{stem}.srt", _srt(cues)))
        members.append((f"{stem}.vtt", _vtt(cues)))
    return members

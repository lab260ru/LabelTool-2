"""Export format serializers.

Each format module exports
    serialize(records: list[ExportRecord], include_metadata: bool) -> list[(name, text)]
— a list of member files of the final archive. Archive: tar.gz for jsonl/nemo,
zip for the rest.
"""

import io
import tarfile
import zipfile

from src.serializers import conll, csv, jsonl, nemo, srt_vtt, textgrid
from src.serializers.base import ExportRecord, build_record, pick_consensus

SERIALIZERS = {
    "jsonl": jsonl.serialize,
    "csv": csv.serialize,
    "nemo": nemo.serialize,
    "textgrid": textgrid.serialize,
    "conll": conll.serialize,
    "srt_vtt": srt_vtt.serialize,
}

# Archive extension by format (tar.gz for jsonl/nemo, otherwise zip)
ARCHIVE_EXT = {
    "jsonl": "tar.gz",
    "nemo": "tar.gz",
    "csv": "zip",
    "textgrid": "zip",
    "conll": "zip",
    "srt_vtt": "zip",
}


def serialize_dataset(
    fmt: str, records: list[ExportRecord], include_metadata: bool
) -> list[tuple[str, str]]:
    return SERIALIZERS[fmt](records, include_metadata)


def build_archive(fmt: str, members: list[tuple[str, str]]) -> bytes:
    """Packs members (name, text) into tar.gz or zip according to ARCHIVE_EXT."""
    buf = io.BytesIO()
    if ARCHIVE_EXT[fmt] == "tar.gz":
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for name, text in members:
                data = text.encode("utf-8")
                info = tarfile.TarInfo(name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
    else:
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, text in members:
                zf.writestr(name, text)
    return buf.getvalue()


__all__ = [
    "ARCHIVE_EXT",
    "SERIALIZERS",
    "ExportRecord",
    "build_archive",
    "build_record",
    "pick_consensus",
    "serialize_dataset",
]

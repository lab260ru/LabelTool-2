"""CoNLL — tokens + tags for NER-like text labeling.

Format: a block per record, a line `token<TAB>tag`, a blank line between blocks,
a comment `# fragment = <file name>` at the start of a block. Tags: for
classification the fragment label expands into BIO (B-label on the first token,
I-label after), otherwise O.
"""

from src.serializers.base import ExportRecord


def serialize(records: list[ExportRecord], include_metadata: bool) -> list[tuple[str, str]]:
    blocks = []
    for r in records:
        lines = [f"# fragment = {r.filename}"]
        if include_metadata and r.metadata:
            pairs = " ".join(f"{k}={v}" for k, v in sorted(r.metadata.items()))
            lines.append(f"# metadata = {pairs}")
        tokens = r.best_text.split()
        label = r.labels[0] if r.labels else None
        for i, token in enumerate(tokens):
            tag = "O" if label is None else (f"B-{label}" if i == 0 else f"I-{label}")
            lines.append(f"{token}\t{tag}")
        blocks.append("\n".join(lines))
    body = "\n\n".join(blocks) + ("\n" if blocks else "")
    return [("dataset.conll", body)]

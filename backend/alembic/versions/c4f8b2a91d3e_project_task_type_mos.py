"""projects.task_type + the 'mos' value in TaskType

Revision ID: c4f8b2a91d3e
Revises: 86ef6db4e53c
Create Date: 2026-07-12

Model change:
the task type is a project attribute, fragments inherit it automatically.

On enum: in models.py all enums are declared via _enum(...) with
native_enum=False (and create_constraint defaults to False in SQLAlchemy 2.x) —
i.e. in both SQLite and PostgreSQL the task_type column is a plain VARCHAR without
a CHECK constraint and without a native PG type. Therefore the new value 'mos' does
NOT require ALTER TYPE ... ADD VALUE — value validation lives at the application
level (validate_strings=True). The migration adds only the
projects.task_type column.

Backfill: each existing project gets the MAJORITY type of its
fragments (on a tie — alphabetically first, deterministically); projects
without fragments keep server_default='transcription'.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4f8b2a91d3e'
down_revision: Union[str, Sequence[str], None] = '86ef6db4e53c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TASK_TYPES = (
    "transcription", "verification", "classification",
    "segmentation", "diarization", "mos",
)


def upgrade() -> None:
    """Upgrade schema."""
    # NOT NULL + server_default: SQLite supports such an ADD COLUMN directly
    op.add_column(
        "projects",
        sa.Column(
            "task_type",
            sa.Enum(*TASK_TYPES, name="tasktype", native_enum=False),
            nullable=False,
            server_default="transcription",
        ),
    )

    # Backfill: the majority type of the project's fragments
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT project_id, task_type, COUNT(*) AS cnt "
            "FROM audio_fragments GROUP BY project_id, task_type "
            "ORDER BY project_id, cnt DESC, task_type"
        )
    ).fetchall()
    winner: dict[int, str] = {}
    for project_id, task_type, _count in rows:
        # rows are already sorted by descending count — take the first
        winner.setdefault(project_id, task_type)
    for project_id, task_type in winner.items():
        conn.execute(
            sa.text("UPDATE projects SET task_type = :task_type WHERE id = :project_id"),
            {"task_type": task_type, "project_id": project_id},
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.drop_column("task_type")

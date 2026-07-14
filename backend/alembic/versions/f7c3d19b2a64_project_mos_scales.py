"""projects.mos_scales — configurable scales of a MOS project

Revision ID: f7c3d19b2a64
Revises: e2b7a41c9d05
Create Date: 2026-07-12

The "Configurable MOS scales" feature: the rating scale is always 1–5 (MOS standard),
the scale NAME and the item LABELS are configurable. The projects.mos_scales column
(JSON, nullable) stores a list [{"name": str, "labels"?: {"1".."5": str}}]
ONLY for projects with task_type='mos'; for the rest — NULL.

Backfill: existing mos projects get the default scale
[{"name": "Качество звучания"}] — submitted legacy results {"score": N}
stay readable (export treats them as {"scores": {"MOS": N}}).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7c3d19b2a64'
down_revision: Union[str, Sequence[str], None] = 'e2b7a41c9d05'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Default scale (a copy of models.DEFAULT_MOS_SCALES: the migration does not import
# application code — a snapshot of the value at the time of the revision)
DEFAULT_MOS_SCALES = [{"name": "Качество звучания"}]


def upgrade() -> None:
    """Upgrade schema."""
    # nullable JSON: SQLite and PostgreSQL support such an ADD COLUMN directly
    op.add_column("projects", sa.Column("mos_scales", sa.JSON(), nullable=True))

    # Backfill of the default scale for existing mos projects. The update goes
    # through sa.table with a JSON type — SQLAlchemy serializes the value per
    # dialect (text in SQLite, json in PostgreSQL), without a manual CAST.
    projects = sa.table(
        "projects",
        sa.column("task_type", sa.String),
        sa.column("mos_scales", sa.JSON),
    )
    op.execute(
        projects.update()
        .where(projects.c.task_type == "mos", projects.c.mos_scales.is_(None))
        .values(mos_scales=DEFAULT_MOS_SCALES)
    )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.drop_column("mos_scales")

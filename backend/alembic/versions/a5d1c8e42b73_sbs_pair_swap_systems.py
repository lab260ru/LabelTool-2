"""SBS comparison: fragment file pair + Task.swap + Project.sbs_systems

Revision ID: a5d1c8e42b73
Revises: f7c3d19b2a64
Create Date: 2026-07-12

The "Side-by-Side (SBS)" feature — the 7th task type 'sbs': blind pairwise
comparison of two audio variants (A/B, e.g. two TTS engines).

  - audio_fragments.{filename_b,s3_key_b,size_bytes_b,duration_sec_b}
    (nullable) — variant B of the pair; filled only in sbs projects,
    the regular fields = variant A. ONE fragment is created per pair.
  - tasks.swap (BOOLEAN, nullable; sbs only) — blind display order:
    random when each of the K tasks is created.
  - projects.sbs_systems (JSON, nullable; task_type='sbs' only) —
    system names {"a": str, "b": str}; visible to the admin only.

On enum: TaskType is declared with native_enum=False (VARCHAR without CHECK,
see c4f8b2a91d3e) — the new value 'sbs' requires no DDL, value validation
lives at the application level. No backfill needed: no sbs projects exist
before this revision, and for other rows the new columns are NULL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a5d1c8e42b73'
down_revision: Union[str, Sequence[str], None] = 'f7c3d19b2a64'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # nullable columns: SQLite and PostgreSQL support such an ADD COLUMN directly
    op.add_column("audio_fragments", sa.Column("filename_b", sa.String(length=512), nullable=True))
    op.add_column("audio_fragments", sa.Column("s3_key_b", sa.String(length=1024), nullable=True))
    op.add_column("audio_fragments", sa.Column("size_bytes_b", sa.Integer(), nullable=True))
    op.add_column("audio_fragments", sa.Column("duration_sec_b", sa.Float(), nullable=True))
    op.add_column("tasks", sa.Column("swap", sa.Boolean(), nullable=True))
    op.add_column("projects", sa.Column("sbs_systems", sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.drop_column("sbs_systems")
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_column("swap")
    with op.batch_alter_table("audio_fragments", schema=None) as batch_op:
        batch_op.drop_column("duration_sec_b")
        batch_op.drop_column("size_bytes_b")
        batch_op.drop_column("s3_key_b")
        batch_op.drop_column("filename_b")

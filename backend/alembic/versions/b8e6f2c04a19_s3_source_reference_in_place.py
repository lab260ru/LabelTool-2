"""Connecting data from S3: S3Source source + AudioFragment.source_id

Revision ID: b8e6f2c04a19
Revises: a5d1c8e42b73
Create Date: 2026-07-13

The "Connecting data from S3" feature (reference-in-place): objects of an external
bucket are imported BY REFERENCE, the bytes are not copied into the app storage.

  - the s3_sources table — a project data source (endpoint/bucket/prefix,
    access creds; secret_key is WRITE-ONLY, never returned by the API). project_id
    → projects.id ondelete CASCADE (deleting a project removes its sources).
  - audio_fragments.source_id (nullable) → s3_sources.id ondelete CASCADE:
    NULL = an app-storage fragment (as before); otherwise the object lives
    in the source bucket and the presigned URL is generated against it. CASCADE —
    deleting a source deletes its fragments.

No backfill needed: no sources exist before this revision, and all fragments have
source_id = NULL (app storage). No enum columns — the DDL is compatible with
both SQLite (batch) and PostgreSQL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b8e6f2c04a19"
down_revision: Union[str, Sequence[str], None] = "a5d1c8e42b73"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "s3_sources",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("endpoint_url", sa.String(length=1024), nullable=False),
        sa.Column("bucket", sa.String(length=255), nullable=False),
        sa.Column("prefix", sa.String(length=1024), server_default="", nullable=False),
        sa.Column("access_key", sa.String(length=255), nullable=False),
        sa.Column("secret_key", sa.String(length=512), nullable=False),
        sa.Column("region", sa.String(length=64), nullable=True),
        sa.Column("path_style", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_s3_sources_project_id", "s3_sources", ["project_id"])

    # nullable column + FK + index via batch (SQLite recreate; on PG — ALTER)
    with op.batch_alter_table("audio_fragments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("source_id", sa.Integer(), nullable=True))
        batch_op.create_index("ix_audio_fragments_source_id", ["source_id"])
        batch_op.create_foreign_key(
            "fk_audio_fragments_source_id",
            "s3_sources",
            ["source_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("audio_fragments", schema=None) as batch_op:
        batch_op.drop_constraint("fk_audio_fragments_source_id", type_="foreignkey")
        batch_op.drop_index("ix_audio_fragments_source_id")
        batch_op.drop_column("source_id")
    op.drop_index("ix_s3_sources_project_id", table_name="s3_sources")
    op.drop_table("s3_sources")

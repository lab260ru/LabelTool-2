"""projects.consensus_overlap — the project's consensus overlap

Revision ID: e2b7a41c9d05
Revises: c4f8b2a91d3e
Create Date: 2026-07-12

Consensus mechanism: for each fragment consensus_overlap open tasks are created
for DIFFERENT labelers; a fragment is finished when done >= consensus_overlap.

server_default='1' — backfill of existing projects: 1 task per fragment,
finished at 1 done — the pre-migration behavior does not change.

Repository enum style (see c4f8b2a91d3e): native_enum=False is already adopted,
but here it is just an integer column — ALTER TYPE is not required.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e2b7a41c9d05'
down_revision: Union[str, Sequence[str], None] = 'c4f8b2a91d3e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # NOT NULL + server_default: SQLite supports such an ADD COLUMN directly
    op.add_column(
        "projects",
        sa.Column(
            "consensus_overlap",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("projects", schema=None) as batch_op:
        batch_op.drop_column("consensus_overlap")

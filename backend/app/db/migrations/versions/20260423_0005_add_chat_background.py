"""add chat background url

Revision ID: 0005_add_chat_background
Revises: 0004_create_device_tables
Create Date: 2026-04-23
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005_add_chat_background"
down_revision: Union[str, None] = "0004_create_device_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("chats", sa.Column("background_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("chats", "background_url")

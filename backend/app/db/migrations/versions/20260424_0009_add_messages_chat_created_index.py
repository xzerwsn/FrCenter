"""add composite index for messages chat timeline

Revision ID: 0009_add_messages_chat_created_index
Revises: 0008_create_notifications
Create Date: 2026-04-24
"""

from typing import Sequence, Union

from alembic import op


revision: str = "0009_add_messages_chat_created_index"
down_revision: Union[str, None] = "0008_create_notifications"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_messages_chat_created_desc",
        "messages",
        ["chat_id", "created_at"],
        unique=False,
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_messages_chat_created_desc", table_name="messages", if_exists=True)

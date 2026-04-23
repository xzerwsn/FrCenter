"""create device tables

Revision ID: 0004_create_device_tables
Revises: 0003_create_chat_tables
Create Date: 2026-04-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004_create_device_tables"
down_revision: Union[str, None] = "0003_create_chat_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "devices",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("device_name", sa.String(length=120), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("encrypted_private_key", sa.Text(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "device_name", name="uq_devices_user_name"),
    )
    op.create_index(op.f("ix_devices_user_id"), "devices", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_devices_user_id"), table_name="devices")
    op.drop_table("devices")

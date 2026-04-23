"""create media assets table

Revision ID: 0007_create_media_assets
Revises: 0006_add_user_profile_fields
Create Date: 2026-04-23
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007_create_media_assets"
down_revision: Union[str, None] = "0006_add_user_profile_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "media_assets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("chat_id", sa.String(length=36), nullable=False),
        sa.Column("uploader_id", sa.String(length=36), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("encrypted_bytes", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploader_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_media_assets_chat_id"), "media_assets", ["chat_id"], unique=False)
    op.create_index(op.f("ix_media_assets_uploader_id"), "media_assets", ["uploader_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_media_assets_uploader_id"), table_name="media_assets")
    op.drop_index(op.f("ix_media_assets_chat_id"), table_name="media_assets")
    op.drop_table("media_assets")

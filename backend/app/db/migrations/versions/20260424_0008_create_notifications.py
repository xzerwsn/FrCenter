"""create notifications and user notification settings

Revision ID: 0008_create_notifications
Revises: 0007_create_media_assets
Create Date: 2026-04-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008_create_notifications"
down_revision: Union[str, None] = "0007_create_media_assets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_NOTIFICATION_SOUND_URL = "https://www.myinstants.com/media/sounds/hell_AJWSn3e.mp3"


def upgrade() -> None:
    op.add_column("users", sa.Column("notification_sound_url", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("notification_volume", sa.Float(), server_default=sa.text("0.7"), nullable=False))
    op.execute(
        sa.text(
            "UPDATE users SET notification_sound_url = :sound_url WHERE notification_sound_url IS NULL"
        ).bindparams(sound_url=DEFAULT_NOTIFICATION_SOUND_URL)
    )

    op.create_table(
        "notifications",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=140), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("dedupe_key", sa.String(length=140), nullable=True),
        sa.Column("data_json", sa.Text(), nullable=True),
        sa.Column("is_read", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "kind", "dedupe_key", name="uq_notifications_user_kind_dedupe"),
    )
    op.create_index(op.f("ix_notifications_user_id"), "notifications", ["user_id"], unique=False)
    op.create_index(op.f("ix_notifications_kind"), "notifications", ["kind"], unique=False)
    op.create_index(op.f("ix_notifications_is_read"), "notifications", ["is_read"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_notifications_is_read"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_kind"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_user_id"), table_name="notifications")
    op.drop_table("notifications")
    op.drop_column("users", "notification_volume")
    op.drop_column("users", "notification_sound_url")

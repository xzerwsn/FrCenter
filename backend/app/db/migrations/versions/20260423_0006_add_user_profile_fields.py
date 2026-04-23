"""0006 add user profile fields

Revision ID: 20260423_0006_add_user_profile_fields
Revises: 20260423_0005_add_chat_background
Create Date: 2026-04-23 23:30:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260423_0006_add_user_profile_fields"
down_revision: str | None = "20260423_0005_add_chat_background"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(length=120), nullable=True))
    op.add_column("users", sa.Column("nickname", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("profile_status", sa.String(length=160), nullable=True))
    op.add_column("users", sa.Column("profile_photos", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("profile_banner_url", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("profile_background_url", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("avatar_ring_style", sa.String(length=32), nullable=True))
    op.create_index(op.f("ix_users_nickname"), "users", ["nickname"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_nickname"), table_name="users")
    op.drop_column("users", "avatar_ring_style")
    op.drop_column("users", "profile_background_url")
    op.drop_column("users", "profile_banner_url")
    op.drop_column("users", "profile_photos")
    op.drop_column("users", "profile_status")
    op.drop_column("users", "nickname")
    op.drop_column("users", "display_name")


"""create game integrations tables

Revision ID: 0011_game_integrations
Revises: 0010_chat_summary_storage
Create Date: 2026-04-29
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0011_game_integrations"
down_revision: Union[str, None] = "0010_chat_summary_storage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "game_accounts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("platform", sa.String(length=32), nullable=False),
        sa.Column("external_user_id", sa.Text(), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=True),
        sa.Column("access_token_encrypted", sa.Text(), nullable=True),
        sa.Column("refresh_token_encrypted", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "platform", name="uq_game_accounts_user_platform"),
    )
    op.create_index(op.f("ix_game_accounts_platform"), "game_accounts", ["platform"], unique=False)
    op.create_index(op.f("ix_game_accounts_user_id"), "game_accounts", ["user_id"], unique=False)

    op.create_table(
        "game_activities",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("platform", sa.String(length=32), nullable=False),
        sa.Column("game_name", sa.Text(), nullable=False),
        sa.Column("activity_type", sa.String(length=32), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_game_activities_platform"), "game_activities", ["platform"], unique=False)
    op.create_index(op.f("ix_game_activities_user_id"), "game_activities", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_game_activities_user_id"), table_name="game_activities")
    op.drop_index(op.f("ix_game_activities_platform"), table_name="game_activities")
    op.drop_table("game_activities")

    op.drop_index(op.f("ix_game_accounts_user_id"), table_name="game_accounts")
    op.drop_index(op.f("ix_game_accounts_platform"), table_name="game_accounts")
    op.drop_table("game_accounts")

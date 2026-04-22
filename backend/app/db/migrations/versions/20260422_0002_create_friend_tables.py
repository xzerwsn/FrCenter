"""create friend tables

Revision ID: 0002_create_friend_tables
Revises: 0001_create_auth_tables
Create Date: 2026-04-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_create_friend_tables"
down_revision: Union[str, None] = "0001_create_auth_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "friend_requests",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("from_user_id", sa.String(length=36), nullable=False),
        sa.Column("to_user_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("from_user_id <> to_user_id", name="ck_friend_requests_not_self"),
        sa.ForeignKeyConstraint(["from_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("from_user_id", "to_user_id", name="uq_friend_requests_pair"),
    )
    op.create_index(op.f("ix_friend_requests_from_user_id"), "friend_requests", ["from_user_id"], unique=False)
    op.create_index(op.f("ix_friend_requests_to_user_id"), "friend_requests", ["to_user_id"], unique=False)

    op.create_table(
        "friendships",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_a_id", sa.String(length=36), nullable=False),
        sa.Column("user_b_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("user_a_id < user_b_id", name="ck_friendships_ordered_pair"),
        sa.ForeignKeyConstraint(["user_a_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_b_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_a_id", "user_b_id", name="uq_friendships_pair"),
    )
    op.create_index(op.f("ix_friendships_user_a_id"), "friendships", ["user_a_id"], unique=False)
    op.create_index(op.f("ix_friendships_user_b_id"), "friendships", ["user_b_id"], unique=False)

    op.create_table(
        "invite_codes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("owner_id", sa.String(length=36), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("max_uses", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("used_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_invite_codes_code"), "invite_codes", ["code"], unique=True)
    op.create_index(op.f("ix_invite_codes_owner_id"), "invite_codes", ["owner_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_invite_codes_owner_id"), table_name="invite_codes")
    op.drop_index(op.f("ix_invite_codes_code"), table_name="invite_codes")
    op.drop_table("invite_codes")
    op.drop_index(op.f("ix_friendships_user_b_id"), table_name="friendships")
    op.drop_index(op.f("ix_friendships_user_a_id"), table_name="friendships")
    op.drop_table("friendships")
    op.drop_index(op.f("ix_friend_requests_to_user_id"), table_name="friend_requests")
    op.drop_index(op.f("ix_friend_requests_from_user_id"), table_name="friend_requests")
    op.drop_table("friend_requests")

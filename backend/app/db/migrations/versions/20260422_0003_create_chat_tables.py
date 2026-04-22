"""create chat tables

Revision ID: 0003_create_chat_tables
Revises: 0002_create_friend_tables
Create Date: 2026-04-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003_create_chat_tables"
down_revision: Union[str, None] = "0002_create_friend_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chats",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chats_created_by"), "chats", ["created_by"], unique=False)

    op.create_table(
        "chat_members",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("chat_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=16), server_default=sa.text("'member'"), nullable=False),
        sa.Column("encrypted_group_key", sa.Text(), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("chat_id", "user_id", name="uq_chat_members_chat_user"),
    )
    op.create_index(op.f("ix_chat_members_chat_id"), "chat_members", ["chat_id"], unique=False)
    op.create_index(op.f("ix_chat_members_user_id"), "chat_members", ["user_id"], unique=False)

    op.create_table(
        "messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("chat_id", sa.String(length=36), nullable=False),
        sa.Column("sender_id", sa.String(length=36), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
        sa.Column("nonce", sa.String(length=128), nullable=False),
        sa.Column("message_type", sa.String(length=16), server_default=sa.text("'text'"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_messages_chat_id"), "messages", ["chat_id"], unique=False)
    op.create_index(op.f("ix_messages_expires_at"), "messages", ["expires_at"], unique=False)
    op.create_index(op.f("ix_messages_sender_id"), "messages", ["sender_id"], unique=False)

    op.create_table(
        "message_recipients",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("recipient_user_id", sa.String(length=36), nullable=False),
        sa.Column("encrypted_message_key", sa.Text(), nullable=True),
        sa.Column("delivery_status", sa.String(length=16), server_default=sa.text("'sent'"), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "recipient_user_id", name="uq_message_recipients_pair"),
    )
    op.create_index(op.f("ix_message_recipients_message_id"), "message_recipients", ["message_id"], unique=False)
    op.create_index(
        op.f("ix_message_recipients_recipient_user_id"),
        "message_recipients",
        ["recipient_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_message_recipients_recipient_user_id"), table_name="message_recipients")
    op.drop_index(op.f("ix_message_recipients_message_id"), table_name="message_recipients")
    op.drop_table("message_recipients")
    op.drop_index(op.f("ix_messages_sender_id"), table_name="messages")
    op.drop_index(op.f("ix_messages_expires_at"), table_name="messages")
    op.drop_index(op.f("ix_messages_chat_id"), table_name="messages")
    op.drop_table("messages")
    op.drop_index(op.f("ix_chat_members_user_id"), table_name="chat_members")
    op.drop_index(op.f("ix_chat_members_chat_id"), table_name="chat_members")
    op.drop_table("chat_members")
    op.drop_index(op.f("ix_chats_created_by"), table_name="chats")
    op.drop_table("chats")

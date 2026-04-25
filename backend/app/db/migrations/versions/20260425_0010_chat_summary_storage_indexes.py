"""add chat summary fields, storage keys and read path indexes

Revision ID: 0010_chat_summary_storage
Revises: 0009_msg_chat_created_idx
Create Date: 2026-04-25
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010_chat_summary_storage"
down_revision: Union[str, None] = "0009_msg_chat_created_idx"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("chats", sa.Column("last_message_id", sa.String(length=36), nullable=True))
    op.add_column("chats", sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("chats", sa.Column("member_count", sa.Integer(), nullable=False, server_default="0"))
    op.create_index(op.f("ix_chats_last_message_at"), "chats", ["last_message_at"], unique=False)

    op.add_column("chat_members", sa.Column("unread_count", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_chat_members_user_left_chat", "chat_members", ["user_id", "left_at", "chat_id"], unique=False)
    op.create_index("ix_chat_members_chat_left_user", "chat_members", ["chat_id", "left_at", "user_id"], unique=False)

    op.create_index(
        "ix_message_recipients_user_read_message",
        "message_recipients",
        ["recipient_user_id", "read_at", "message_id"],
        unique=False,
    )

    op.add_column("media_assets", sa.Column("storage_backend", sa.String(length=32), nullable=False, server_default="filesystem"))
    op.add_column("media_assets", sa.Column("storage_key", sa.Text(), nullable=True))
    op.alter_column("media_assets", "encrypted_bytes", existing_type=sa.LargeBinary(), nullable=True)

    op.execute(
        sa.text(
            """
            UPDATE chats
            SET member_count = COALESCE(summary.active_members, 0),
                last_message_id = summary.last_message_id,
                last_message_at = summary.last_message_at
            FROM (
                SELECT
                    chats.id AS chat_id,
                    (
                        SELECT COUNT(*)
                        FROM chat_members
                        WHERE chat_members.chat_id = chats.id
                          AND chat_members.left_at IS NULL
                    ) AS active_members,
                    (
                        SELECT messages.id
                        FROM messages
                        WHERE messages.chat_id = chats.id
                        ORDER BY messages.created_at DESC, messages.id DESC
                        LIMIT 1
                    ) AS last_message_id,
                    (
                        SELECT messages.created_at
                        FROM messages
                        WHERE messages.chat_id = chats.id
                        ORDER BY messages.created_at DESC, messages.id DESC
                        LIMIT 1
                    ) AS last_message_at
                FROM chats
            ) AS summary
            WHERE chats.id = summary.chat_id
            """
        )
    )

    op.execute(
        sa.text(
            """
            UPDATE chat_members
            SET unread_count = COALESCE(unread.count, 0)
            FROM (
                SELECT
                    message_recipients.recipient_user_id AS user_id,
                    messages.chat_id AS chat_id,
                    COUNT(message_recipients.id) AS count
                FROM message_recipients
                JOIN messages ON messages.id = message_recipients.message_id
                WHERE message_recipients.read_at IS NULL
                  AND messages.sender_id != message_recipients.recipient_user_id
                GROUP BY message_recipients.recipient_user_id, messages.chat_id
            ) AS unread
            WHERE chat_members.user_id = unread.user_id
              AND chat_members.chat_id = unread.chat_id
            """
        )
    )

    op.alter_column("chats", "member_count", server_default=None)
    op.alter_column("chat_members", "unread_count", server_default=None)
    op.alter_column("media_assets", "storage_backend", server_default=None)


def downgrade() -> None:
    op.alter_column("media_assets", "encrypted_bytes", existing_type=sa.LargeBinary(), nullable=False)
    op.drop_column("media_assets", "storage_key")
    op.drop_column("media_assets", "storage_backend")

    op.drop_index("ix_message_recipients_user_read_message", table_name="message_recipients")
    op.drop_index("ix_chat_members_chat_left_user", table_name="chat_members")
    op.drop_index("ix_chat_members_user_left_chat", table_name="chat_members")
    op.drop_column("chat_members", "unread_count")

    op.drop_index(op.f("ix_chats_last_message_at"), table_name="chats")
    op.drop_column("chats", "member_count")
    op.drop_column("chats", "last_message_at")
    op.drop_column("chats", "last_message_id")

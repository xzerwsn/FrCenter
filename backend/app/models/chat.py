from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str | None] = mapped_column(String(120))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    members: Mapped[list["ChatMember"]] = relationship(
        back_populates="chat",
        cascade="all, delete-orphan",
    )


class ChatMember(Base):
    __tablename__ = "chat_members"
    __table_args__ = (UniqueConstraint("chat_id", "user_id", name="uq_chat_members_chat_user"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    chat_id: Mapped[str] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16), default="member", nullable=False)
    encrypted_group_key: Mapped[str | None] = mapped_column(Text)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    chat: Mapped["Chat"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship()


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    chat_id: Mapped[str] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    nonce: Mapped[str] = mapped_column(String(128), nullable=False)
    message_type: Mapped[str] = mapped_column(String(16), default="text", nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sender: Mapped["User"] = relationship()


class MessageRecipient(Base):
    __tablename__ = "message_recipients"
    __table_args__ = (UniqueConstraint("message_id", "recipient_user_id", name="uq_message_recipients_pair"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    message_id: Mapped[str] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    recipient_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    encrypted_message_key: Mapped[str | None] = mapped_column(Text)
    delivery_status: Mapped[str] = mapped_column(String(16), default="sent", nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

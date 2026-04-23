from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.email_confirmation import EmailConfirmation


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    cloud_password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_email_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    display_name: Mapped[str | None] = mapped_column(String(120))
    nickname: Mapped[str | None] = mapped_column(String(32), unique=True, index=True)
    profile_status: Mapped[str | None] = mapped_column(String(160))
    profile_photos: Mapped[str | None] = mapped_column(Text)
    profile_banner_url: Mapped[str | None] = mapped_column(Text)
    profile_background_url: Mapped[str | None] = mapped_column(Text)
    avatar_ring_style: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="offline", nullable=False)
    current_game: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    email_confirmations: Mapped[list["EmailConfirmation"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )

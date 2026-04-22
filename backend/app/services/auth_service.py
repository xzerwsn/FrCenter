from datetime import UTC, datetime, timedelta

from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_email_code, hash_secret, verify_secret
from app.models.email_confirmation import EmailConfirmation
from app.models.user import User
from app.schemas.auth import RegisterRequest
from app.services.email_service import email_service


class AuthError(Exception):
    pass


class EmailAlreadyRegistered(AuthError):
    pass


class UsernameAlreadyTaken(AuthError):
    pass


class InvalidCredentials(AuthError):
    pass


class EmailNotConfirmed(AuthError):
    pass


class InvalidConfirmationCode(AuthError):
    pass


async def register_user(db: AsyncSession, payload: RegisterRequest) -> tuple[User, str]:
    existing_email = await _scalar(db, select(User).where(User.email == payload.email.lower()))
    if existing_email:
        raise EmailAlreadyRegistered

    existing_username = await _scalar(db, select(User).where(User.username == payload.username))
    if existing_username:
        raise UsernameAlreadyTaken

    user = User(
        email=payload.email.lower(),
        username=payload.username,
        password_hash=hash_secret(payload.password),
        cloud_password_hash=hash_secret(payload.cloud_password),
    )
    db.add(user)
    await db.flush()

    confirmation_code = create_email_code()
    confirmation = EmailConfirmation(
        user_id=user.id,
        code_hash=hash_secret(confirmation_code),
        expires_at=datetime.now(UTC) + timedelta(minutes=settings.email_confirmation_expire_minutes),
    )
    db.add(confirmation)
    await db.commit()
    await db.refresh(user)

    await email_service.send_confirmation_code(user.email, confirmation_code)
    return user, confirmation_code


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User:
    user = await _scalar(db, select(User).where(User.email == email.lower()))
    if not user or not verify_secret(password, user.password_hash):
        raise InvalidCredentials
    if not user.is_email_confirmed:
        raise EmailNotConfirmed
    return user


async def confirm_email(db: AsyncSession, email: str, code: str) -> User:
    user = await _scalar(db, select(User).where(User.email == email.lower()))
    if not user:
        raise InvalidConfirmationCode

    stmt = (
        select(EmailConfirmation)
        .where(EmailConfirmation.user_id == user.id)
        .where(EmailConfirmation.used_at.is_(None))
        .order_by(EmailConfirmation.created_at.desc())
    )
    confirmation = await _scalar(db, stmt)
    now = datetime.now(UTC)

    if not confirmation or confirmation.expires_at < now:
        raise InvalidConfirmationCode
    if not verify_secret(code, confirmation.code_hash):
        raise InvalidConfirmationCode

    user.is_email_confirmed = True
    confirmation.used_at = now
    await db.commit()
    await db.refresh(user)
    return user


async def _scalar(db: AsyncSession, stmt: Select[tuple[Any]]) -> Any | None:
    result = await db.execute(stmt)
    return result.scalar_one_or_none()

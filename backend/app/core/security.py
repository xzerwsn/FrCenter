from datetime import UTC, datetime, timedelta
from secrets import randbelow

from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
JWT_ALGORITHM = "HS256"


def hash_secret(secret: str) -> str:
    return pwd_context.hash(secret)


def verify_secret(secret: str, secret_hash: str) -> bool:
    return pwd_context.verify(secret, secret_hash)


def create_access_token(subject: str) -> str:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "exp": expires_at}
    return jwt.encode(payload, settings.app_secret_key, algorithm=JWT_ALGORITHM)


def create_email_code() -> str:
    return f"{randbelow(1_000_000):06d}"

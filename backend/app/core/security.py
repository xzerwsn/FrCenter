from datetime import UTC, datetime, timedelta
from hashlib import sha256
import base64
import json
from secrets import randbelow

from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
JWT_ALGORITHM = "HS256"
STATE_TOKEN_TTL_MINUTES = 10


def _build_fernet() -> Fernet:
    key = base64.urlsafe_b64encode(sha256(settings.app_secret_key.encode("utf-8")).digest())
    return Fernet(key)


def hash_secret(secret: str) -> str:
    return pwd_context.hash(secret)


def verify_secret(secret: str, secret_hash: str) -> bool:
    return pwd_context.verify(secret, secret_hash)


def create_access_token(subject: str) -> str:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "exp": expires_at}
    return jwt.encode(payload, settings.app_secret_key, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.app_secret_key, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None

    subject = payload.get("sub")
    return subject if isinstance(subject, str) else None


def create_oauth_state(subject: str, provider: str) -> str:
    expires_at = datetime.now(UTC) + timedelta(minutes=STATE_TOKEN_TTL_MINUTES)
    payload = {"sub": subject, "provider": provider, "exp": expires_at}
    return jwt.encode(payload, settings.app_secret_key, algorithm=JWT_ALGORITHM)


def decode_oauth_state(token: str) -> tuple[str, str] | None:
    try:
        payload = jwt.decode(token, settings.app_secret_key, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None

    subject = payload.get("sub")
    provider = payload.get("provider")
    if not isinstance(subject, str) or not isinstance(provider, str):
        return None
    return subject, provider


def encrypt_json_payload(payload: dict[str, object]) -> str:
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return _build_fernet().encrypt(raw).decode("utf-8")


def decrypt_json_payload(value: str | None) -> dict[str, object] | None:
    if not value:
        return None
    try:
        decrypted = _build_fernet().decrypt(value.encode("utf-8"))
    except (InvalidToken, ValueError):
        return None
    try:
        decoded = json.loads(decrypted.decode("utf-8"))
    except json.JSONDecodeError:
        return None
    return decoded if isinstance(decoded, dict) else None


def create_email_code() -> str:
    return f"{randbelow(1_000_000):06d}"

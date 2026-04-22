from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.schemas.auth import (
    ConfirmEmailRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
)
from app.services.auth_service import (
    EmailAlreadyRegistered,
    EmailNotConfirmed,
    InvalidConfirmationCode,
    InvalidCredentials,
    UsernameAlreadyTaken,
    authenticate_user,
    confirm_email,
    register_user,
)

router = APIRouter()


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_202_ACCEPTED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)) -> RegisterResponse:
    try:
        user, confirmation_code = await register_user(db, payload)
    except EmailAlreadyRegistered as exc:
        raise HTTPException(status_code=409, detail="Email уже зарегистрирован") from exc
    except UsernameAlreadyTaken as exc:
        raise HTTPException(status_code=409, detail="Username уже занят") from exc

    dev_code = confirmation_code if settings.app_env == "development" else None
    return RegisterResponse(
        status="confirmation_sent",
        email=user.email,
        dev_confirmation_code=dev_code,
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    try:
        user = await authenticate_user(db, payload.email, payload.password)
    except InvalidCredentials as exc:
        raise HTTPException(status_code=401, detail="Неверный email или пароль") from exc
    except EmailNotConfirmed as exc:
        raise HTTPException(status_code=403, detail="Email не подтвержден") from exc

    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/confirm-email", response_model=MessageResponse)
async def confirm_email_endpoint(
    payload: ConfirmEmailRequest,
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    try:
        await confirm_email(db, payload.email, payload.code)
    except InvalidConfirmationCode as exc:
        raise HTTPException(status_code=400, detail="Неверный или истекший код") from exc

    return MessageResponse(status="email_confirmed")

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.device import Device
from app.models.user import User
from app.schemas.device import (
    DeviceListResponse,
    DevicePublicKeyListResponse,
    DeviceRegisterRequest,
    DeviceResponse,
)
from app.services.device_service import (
    PublicKeysForbidden,
    list_my_devices,
    list_public_keys_for_user,
    register_device,
)

router = APIRouter()


@router.post("", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
async def create_or_update_device(
    payload: DeviceRegisterRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Device:
    return await register_device(
        db,
        current_user,
        payload.device_name,
        payload.public_key,
        payload.encrypted_private_key,
    )


@router.get("/me", response_model=DeviceListResponse)
async def read_my_devices(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeviceListResponse:
    return DeviceListResponse(devices=await list_my_devices(db, current_user))


@router.get("/users/{user_id}/public-keys", response_model=DevicePublicKeyListResponse)
async def read_user_public_keys(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DevicePublicKeyListResponse:
    try:
        devices = await list_public_keys_for_user(db, current_user, user_id)
    except PublicKeysForbidden as exc:
        raise HTTPException(status_code=403, detail="Публичные ключи доступны только друзьям") from exc

    return DevicePublicKeyListResponse(devices=devices)

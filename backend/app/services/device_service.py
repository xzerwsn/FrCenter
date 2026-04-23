from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device import Device
from app.models.friend import Friendship
from app.models.user import User


class DeviceError(Exception):
    pass


class PublicKeysForbidden(DeviceError):
    pass


async def register_device(
    db: AsyncSession,
    current_user: User,
    device_name: str,
    public_key: str,
    encrypted_private_key: str,
) -> Device:
    result = await db.execute(
        select(Device).where(Device.user_id == current_user.id, Device.device_name == device_name)
    )
    device = result.scalar_one_or_none()

    if device is None:
        device = Device(user_id=current_user.id, device_name=device_name)
        db.add(device)

    device.public_key = public_key
    device.encrypted_private_key = encrypted_private_key
    device.last_seen_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(device)
    return device


async def list_my_devices(db: AsyncSession, current_user: User) -> list[Device]:
    result = await db.execute(
        select(Device).where(Device.user_id == current_user.id).order_by(Device.created_at.desc())
    )
    return list(result.scalars().all())


async def list_public_keys_for_user(
    db: AsyncSession,
    current_user: User,
    user_id: str,
) -> list[Device]:
    if user_id != current_user.id and not await _are_friends(db, current_user.id, user_id):
        raise PublicKeysForbidden

    result = await db.execute(
        select(Device).where(Device.user_id == user_id).order_by(Device.created_at.desc())
    )
    return list(result.scalars().all())


async def _are_friends(db: AsyncSession, user_a_id: str, user_b_id: str) -> bool:
    ordered_a, ordered_b = _ordered_pair(user_a_id, user_b_id)
    result = await db.execute(
        select(Friendship.id).where(Friendship.user_a_id == ordered_a, Friendship.user_b_id == ordered_b)
    )
    return result.scalar_one_or_none() is not None


def _ordered_pair(user_a_id: str, user_b_id: str) -> tuple[str, str]:
    return (user_a_id, user_b_id) if user_a_id < user_b_id else (user_b_id, user_a_id)

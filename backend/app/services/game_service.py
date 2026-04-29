import json

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.game_account import GameAccount
from app.models.game_activity import GameActivity
from app.models.user import User

SUPPORTED_GAME_PLATFORMS = {"steam", "riot"}


async def list_accounts(db: AsyncSession, current_user: User) -> list[GameAccount]:
    result = await db.execute(
        select(GameAccount)
        .where(GameAccount.user_id == current_user.id)
        .order_by(GameAccount.platform.asc(), GameAccount.created_at.asc())
    )
    return list(result.scalars().all())


async def list_active_activities(db: AsyncSession, current_user: User) -> list[GameActivity]:
    accounts = await list_accounts(db, current_user)
    latest_by_platform: dict[str, GameActivity] = {}
    for account in accounts:
        result = await db.execute(
            select(GameActivity)
            .where(GameActivity.user_id == current_user.id, GameActivity.platform == account.platform)
            .order_by(GameActivity.created_at.desc(), GameActivity.id.desc())
            .limit(1)
        )
        activity = result.scalar_one_or_none()
        if activity is not None:
            latest_by_platform[account.platform] = activity
    return sorted(latest_by_platform.values(), key=lambda item: item.created_at, reverse=True)


async def upsert_account(
    db: AsyncSession,
    current_user: User,
    *,
    platform: str,
    external_user_id: str,
    display_name: str | None,
) -> GameAccount:
    normalized_platform = _normalize_platform(platform)
    result = await db.execute(
        select(GameAccount).where(GameAccount.user_id == current_user.id, GameAccount.platform == normalized_platform)
    )
    account = result.scalar_one_or_none()
    if account is None:
        account = GameAccount(
            user_id=current_user.id,
            platform=normalized_platform,
            external_user_id=external_user_id.strip(),
            display_name=(display_name or "").strip() or None,
        )
        db.add(account)
    else:
        account.external_user_id = external_user_id.strip()
        account.display_name = (display_name or "").strip() or None
    await db.commit()
    await db.refresh(account)
    return account


async def remove_account(db: AsyncSession, current_user: User, platform: str) -> None:
    normalized_platform = _normalize_platform(platform)
    await db.execute(delete(GameAccount).where(GameAccount.user_id == current_user.id, GameAccount.platform == normalized_platform))
    await db.execute(delete(GameActivity).where(GameActivity.user_id == current_user.id, GameActivity.platform == normalized_platform))
    await _sync_current_game(db, current_user)
    await db.commit()


async def create_activity(
    db: AsyncSession,
    current_user: User,
    *,
    platform: str,
    game_name: str,
    activity_type: str,
) -> GameActivity:
    normalized_platform = _normalize_platform(platform)
    result = await db.execute(
        select(GameAccount).where(GameAccount.user_id == current_user.id, GameAccount.platform == normalized_platform)
    )
    account = result.scalar_one_or_none()
    if account is None:
        account = GameAccount(
            user_id=current_user.id,
            platform=normalized_platform,
            external_user_id=f"manual-{normalized_platform}-{current_user.id[:8]}",
            display_name=current_user.display_name or current_user.username,
        )
        db.add(account)
        await db.flush()

    activity = GameActivity(
        user_id=current_user.id,
        platform=normalized_platform,
        game_name=game_name.strip(),
        activity_type=activity_type.strip(),
        payload_json=json.dumps({"source": "manual"}, ensure_ascii=False),
    )
    db.add(activity)
    current_user.current_game = f"{_platform_label(normalized_platform)}: {activity.game_name}"
    await db.commit()
    await db.refresh(activity)
    return activity


async def clear_activity(db: AsyncSession, current_user: User, platform: str) -> None:
    normalized_platform = _normalize_platform(platform)
    await db.execute(delete(GameActivity).where(GameActivity.user_id == current_user.id, GameActivity.platform == normalized_platform))
    await _sync_current_game(db, current_user)
    await db.commit()


async def _sync_current_game(db: AsyncSession, current_user: User) -> None:
    result = await db.execute(
        select(GameActivity)
        .where(GameActivity.user_id == current_user.id)
        .order_by(GameActivity.created_at.desc(), GameActivity.id.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    current_user.current_game = f"{_platform_label(latest.platform)}: {latest.game_name}" if latest is not None else None


def _normalize_platform(platform: str) -> str:
    normalized = (platform or "").strip().lower()
    if normalized not in SUPPORTED_GAME_PLATFORMS:
      raise ValueError("Unsupported game platform")
    return normalized


def _platform_label(platform: str) -> str:
    return "Steam" if platform == "steam" else "Riot"

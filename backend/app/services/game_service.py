import json
import re
from urllib.parse import urlencode

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.game_account import GameAccount
from app.models.game_activity import GameActivity
from app.models.user import User

STEAM_CLAIMED_ID_RE = re.compile(r"^https?://steamcommunity\.com/openid/id/(?P<steamid>\d+)$")


class GameIntegrationError(Exception):
    pass


class ProviderNotConfigured(GameIntegrationError):
    pass


class InvalidProviderResponse(GameIntegrationError):
    pass


async def get_account_by_platform(db: AsyncSession, current_user: User, platform: str = "steam") -> GameAccount | None:
    result = await db.execute(select(GameAccount).where(GameAccount.user_id == current_user.id, GameAccount.platform == platform))
    return result.scalar_one_or_none()


def build_steam_connect_url(*, state: str) -> str:
    params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.realm": settings.backend_url.rstrip("/"),
        "openid.return_to": f"{settings.steam_callback_url}?state={state}",
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    return f"{settings.steam_openid_login_url}?{urlencode(params)}"


async def verify_steam_openid(query_params: dict[str, str]) -> str:
    params = dict(query_params)
    params["openid.mode"] = "check_authentication"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(settings.steam_openid_login_url, data=params)
    response.raise_for_status()
    if "is_valid:true" not in response.text:
        raise InvalidProviderResponse("Steam не подтвердил OpenID-ответ")

    claimed_id = query_params.get("openid.claimed_id", "")
    match = STEAM_CLAIMED_ID_RE.match(claimed_id)
    if not match:
        raise InvalidProviderResponse("Steam вернул некорректный SteamID")
    return match.group("steamid")


async def connect_steam_account(db: AsyncSession, current_user: User, steam_id: str) -> GameAccount:
    if not settings.steam_enabled:
        raise ProviderNotConfigured("Steam API key не настроен")

    steam_stats = await fetch_steam_stats(steam_id)
    account = await get_account_by_platform(db, current_user, "steam")
    if account is None:
        account = GameAccount(
            user_id=current_user.id,
            platform="steam",
            external_user_id=steam_id,
            display_name=steam_stats.get("persona_name") if isinstance(steam_stats.get("persona_name"), str) else None,
        )
        db.add(account)
    else:
        account.external_user_id = steam_id
        account.display_name = steam_stats.get("persona_name") if isinstance(steam_stats.get("persona_name"), str) else None
    await db.flush()

    await db.execute(delete(GameActivity).where(GameActivity.user_id == current_user.id, GameActivity.platform == "steam"))
    game_name = steam_stats.get("current_game")
    if isinstance(game_name, str) and game_name:
        current_game = game_name
    else:
        current_game = "Steam подключен"
    db.add(
        GameActivity(
            user_id=current_user.id,
            platform="steam",
            game_name=current_game,
            activity_type="linked",
            payload_json=json.dumps(steam_stats, ensure_ascii=False),
        )
    )
    current_user.current_game = f"Steam: {game_name}" if isinstance(game_name, str) and game_name else current_user.current_game
    await db.commit()
    await db.refresh(account)
    return account


async def disconnect_account(db: AsyncSession, current_user: User, platform: str = "steam") -> None:
    await db.execute(delete(GameAccount).where(GameAccount.user_id == current_user.id, GameAccount.platform == platform))
    await db.execute(delete(GameActivity).where(GameActivity.user_id == current_user.id, GameActivity.platform == platform))
    latest = await db.execute(
        select(GameActivity).where(GameActivity.user_id == current_user.id).order_by(GameActivity.created_at.desc(), GameActivity.id.desc()).limit(1)
    )
    activity = latest.scalar_one_or_none()
    current_user.current_game = f"Steam: {activity.game_name}" if activity is not None and activity.platform == "steam" else None
    await db.commit()


async def build_games_overview(db: AsyncSession, current_user: User) -> dict[str, object]:
    steam_account = await get_account_by_platform(db, current_user, "steam")
    steam_stats = await _load_steam_stats(db, steam_account)
    return {
        "steam": {
            "enabled": settings.steam_enabled,
            "connected": steam_account is not None,
            "connect_url": f"{settings.backend_url.rstrip('/')}/api/games/steam/connect" if settings.steam_enabled else None,
            "account": steam_account,
            "steam_stats": steam_stats,
            "status_hint": None if settings.steam_enabled else "Нужен STEAM_WEB_API_KEY",
        }
    }


async def fetch_steam_stats(steam_id: str) -> dict[str, object]:
    headers = {"x-webapi-key": settings.steam_web_api_key}
    async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
        summary_response = await client.get(
            f"{settings.steam_web_api_base_url.rstrip('/')}/ISteamUser/GetPlayerSummaries/v2/",
            params={"steamids": steam_id},
        )
        summary_response.raise_for_status()
        summary_payload = summary_response.json()

        recent_response = await client.get(
            f"{settings.steam_web_api_base_url.rstrip('/')}/IPlayerService/GetRecentlyPlayedGames/v1/",
            params={"steamid": steam_id, "count": 5},
        )
        recent_response.raise_for_status()
        recent_payload = recent_response.json()

    players = summary_payload.get("response", {}).get("players", [])
    player = players[0] if players else {}
    recent_games = recent_payload.get("response", {}).get("games", []) or []
    return {
        "persona_name": player.get("personaname"),
        "profile_url": player.get("profileurl"),
        "avatar_url": player.get("avatarfull") or player.get("avatarmedium") or player.get("avatar"),
        "current_game": player.get("gameextrainfo"),
        "recent_games": [
            {
                "app_id": int(game.get("appid", 0)),
                "name": game.get("name") or f"App {game.get('appid', '')}",
                "playtime_hours": round(float(game.get("playtime_forever", 0)) / 60, 1),
            }
            for game in recent_games
        ],
    }


async def _load_steam_stats(db: AsyncSession, account: GameAccount | None) -> dict[str, object] | None:
    if account is None:
        return None
    if not settings.steam_enabled:
        return await _get_latest_activity_payload(db, account)
    try:
        return await fetch_steam_stats(account.external_user_id)
    except Exception:
        return await _get_latest_activity_payload(db, account)


async def _get_latest_activity_payload(db: AsyncSession, account: GameAccount) -> dict[str, object] | None:
    result = await db.execute(
        select(GameActivity)
        .where(GameActivity.user_id == account.user_id, GameActivity.platform == "steam")
        .order_by(GameActivity.created_at.desc(), GameActivity.id.desc())
        .limit(1)
    )
    activity = result.scalar_one_or_none()
    if activity is None or not activity.payload_json:
        return None
    try:
        payload = json.loads(activity.payload_json)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None

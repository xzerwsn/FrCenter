import base64
import json
import re
from urllib.parse import urlencode

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decrypt_json_payload, encrypt_json_payload
from app.models.game_account import GameAccount
from app.models.game_activity import GameActivity
from app.models.user import User

SUPPORTED_GAME_PLATFORMS = {"steam", "riot"}
STEAM_CLAIMED_ID_RE = re.compile(r"^https?://steamcommunity\.com/openid/id/(?P<steamid>\d+)$")


class GameIntegrationError(Exception):
    pass


class ProviderNotConfigured(GameIntegrationError):
    pass


class InvalidProviderResponse(GameIntegrationError):
    pass


async def get_account_by_platform(db: AsyncSession, current_user: User, platform: str) -> GameAccount | None:
    result = await db.execute(
        select(GameAccount).where(GameAccount.user_id == current_user.id, GameAccount.platform == _normalize_platform(platform))
    )
    return result.scalar_one_or_none()


async def list_accounts(db: AsyncSession, current_user: User) -> list[GameAccount]:
    result = await db.execute(
        select(GameAccount).where(GameAccount.user_id == current_user.id).order_by(GameAccount.platform.asc(), GameAccount.created_at.asc())
    )
    return list(result.scalars().all())


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


def build_riot_connect_url(*, state: str) -> str:
    params = {
        "client_id": settings.riot_client_id,
        "redirect_uri": settings.riot_callback_url,
        "response_type": "code",
        "scope": "openid offline_access",
        "state": state,
    }
    return f"{settings.riot_authorize_url}?{urlencode(params)}"


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
    account = await _upsert_account(
        db,
        current_user,
        platform="steam",
        external_user_id=steam_id,
        display_name=steam_stats.get("persona_name"),
        token_payload=None,
    )
    await _replace_activity(
        db,
        current_user,
        platform="steam",
        game_name=(steam_stats.get("current_game") or "Steam подключен"),
        payload=steam_stats,
        keep_current_game=bool(steam_stats.get("current_game")),
    )
    await db.commit()
    await db.refresh(account)
    return account


async def connect_riot_account(db: AsyncSession, current_user: User, code: str) -> GameAccount:
    if not settings.riot_enabled:
        raise ProviderNotConfigured("Riot RSO не настроен")

    tokens = await exchange_riot_code(code)
    valorant_stats = await fetch_riot_valorant_stats(tokens["access_token"])
    account = await _upsert_account(
        db,
        current_user,
        platform="riot",
        external_user_id=valorant_stats.get("puuid") or "",
        display_name=_build_riot_display_name(valorant_stats),
        token_payload=tokens,
    )
    await _replace_activity(
        db,
        current_user,
        platform="riot",
        game_name="VALORANT",
        payload=valorant_stats,
        keep_current_game=True,
    )
    await db.commit()
    await db.refresh(account)
    return account


async def disconnect_account(db: AsyncSession, current_user: User, platform: str) -> None:
    normalized_platform = _normalize_platform(platform)
    await db.execute(delete(GameAccount).where(GameAccount.user_id == current_user.id, GameAccount.platform == normalized_platform))
    await db.execute(delete(GameActivity).where(GameActivity.user_id == current_user.id, GameActivity.platform == normalized_platform))
    await _sync_current_game(db, current_user)
    await db.commit()


async def build_games_overview(db: AsyncSession, current_user: User) -> dict[str, object]:
    steam_account = await get_account_by_platform(db, current_user, "steam")
    riot_account = await get_account_by_platform(db, current_user, "riot")

    steam_stats = await _load_steam_stats(db, steam_account)
    riot_stats = await _load_riot_stats(db, riot_account)

    return {
        "steam": {
            "enabled": settings.steam_enabled,
            "connected": steam_account is not None,
            "connect_url": f"{settings.backend_url.rstrip('/')}/api/games/steam/connect" if settings.steam_enabled else None,
            "account": steam_account,
            "steam_stats": steam_stats,
            "game": None,
            "status_hint": None if settings.steam_enabled else "Нужен STEAM_WEB_API_KEY",
        },
        "riot": {
            "enabled": settings.riot_enabled,
            "connected": riot_account is not None,
            "connect_url": f"{settings.backend_url.rstrip('/')}/api/games/riot/connect" if settings.riot_enabled else None,
            "account": riot_account,
            "valorant_stats": riot_stats,
            "game": "VALORANT",
            "status_hint": None if settings.riot_enabled else "Нужны RIOT_CLIENT_ID и RIOT_CLIENT_SECRET с production RSO access",
        },
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


async def exchange_riot_code(code: str) -> dict[str, str]:
    basic = base64.b64encode(f"{settings.riot_client_id}:{settings.riot_client_secret}".encode("utf-8")).decode("utf-8")
    headers = {"Authorization": f"Basic {basic}"}
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.riot_callback_url,
    }
    async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
        response = await client.post(settings.riot_token_url, data=data)
    response.raise_for_status()
    payload = response.json()
    access_token = payload.get("access_token")
    refresh_token = payload.get("refresh_token")
    if not isinstance(access_token, str) or not isinstance(refresh_token, str):
        raise InvalidProviderResponse("Riot не вернул access/refresh token")
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
    }


async def refresh_riot_access_token(refresh_token: str) -> dict[str, str]:
    basic = base64.b64encode(f"{settings.riot_client_id}:{settings.riot_client_secret}".encode("utf-8")).decode("utf-8")
    headers = {"Authorization": f"Basic {basic}"}
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
        response = await client.post(settings.riot_token_url, data=data)
    response.raise_for_status()
    payload = response.json()
    access_token = payload.get("access_token")
    next_refresh_token = payload.get("refresh_token") or refresh_token
    if not isinstance(access_token, str) or not isinstance(next_refresh_token, str):
        raise InvalidProviderResponse("Riot не вернул обновленный access token")
    return {
        "access_token": access_token,
        "refresh_token": next_refresh_token,
    }


async def fetch_riot_valorant_stats(access_token: str) -> dict[str, object]:
    headers = {"Authorization": f"Bearer {access_token}"}
    account_payload: dict[str, object] | None = None
    for url in settings.riot_account_api_urls:
        async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
            response = await client.get(url)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict):
                account_payload = data
                break
        if response.status_code not in {401, 403, 404}:
            response.raise_for_status()
    if account_payload is None:
        raise InvalidProviderResponse("Не удалось получить Riot account profile")

    puuid = account_payload.get("puuid")
    if not isinstance(puuid, str) or not puuid:
        raise InvalidProviderResponse("Riot не вернул puuid")

    recent_match_ids: list[str] = []
    async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
        for region in settings.riot_val_match_regions:
            response = await client.get(
                f"https://{region}.api.riotgames.com/val/match/v1/matchlists/by-puuid/{puuid}",
                params={"size": 5},
            )
            if response.status_code == 200:
                payload = response.json()
                history = payload.get("history", [])
                if isinstance(history, list):
                    recent_match_ids = [item.get("matchId") for item in history if isinstance(item, dict) and isinstance(item.get("matchId"), str)]
                    break
            elif response.status_code not in {400, 401, 403, 404, 429}:
                response.raise_for_status()

    return {
        "puuid": puuid,
        "game_name": account_payload.get("gameName"),
        "tag_line": account_payload.get("tagLine"),
        "recent_match_ids": recent_match_ids,
    }


async def _load_steam_stats(db: AsyncSession, account: GameAccount | None) -> dict[str, object] | None:
    if account is None:
        return None
    if not settings.steam_enabled:
        return await _get_latest_activity_payload(db, account, "steam")
    try:
        return await fetch_steam_stats(account.external_user_id)
    except Exception:
        return await _get_latest_activity_payload(db, account, "steam")


async def _load_riot_stats(db: AsyncSession, account: GameAccount | None) -> dict[str, object] | None:
    if account is None:
        return None
    token_payload = decrypt_json_payload(account.refresh_token_encrypted)
    if not settings.riot_enabled or token_payload is None:
        return await _get_latest_activity_payload(db, account, "riot")

    refresh_token = token_payload.get("refresh_token")
    if not isinstance(refresh_token, str) or not refresh_token:
        return await _get_latest_activity_payload(db, account, "riot")
    try:
        refreshed = await refresh_riot_access_token(refresh_token)
        riot_stats = await fetch_riot_valorant_stats(refreshed["access_token"])
        account.refresh_token_encrypted = encrypt_json_payload(refreshed)
        account.display_name = _build_riot_display_name(riot_stats)
        await db.commit()
        return riot_stats
    except Exception:
        return await _get_latest_activity_payload(db, account, "riot")


async def _upsert_account(
    db: AsyncSession,
    current_user: User,
    *,
    platform: str,
    external_user_id: str,
    display_name: str | None,
    token_payload: dict[str, str] | None,
) -> GameAccount:
    account = await get_account_by_platform(db, current_user, platform)
    encrypted_payload = encrypt_json_payload(token_payload) if token_payload else None
    if account is None:
        account = GameAccount(
            user_id=current_user.id,
            platform=platform,
            external_user_id=external_user_id,
            display_name=display_name,
            access_token_encrypted=encrypted_payload,
            refresh_token_encrypted=encrypted_payload,
        )
        db.add(account)
    else:
        account.external_user_id = external_user_id
        account.display_name = display_name
        account.access_token_encrypted = encrypted_payload
        account.refresh_token_encrypted = encrypted_payload
    await db.flush()
    return account


async def _replace_activity(
    db: AsyncSession,
    current_user: User,
    *,
    platform: str,
    game_name: str,
    payload: dict[str, object],
    keep_current_game: bool,
) -> None:
    await db.execute(delete(GameActivity).where(GameActivity.user_id == current_user.id, GameActivity.platform == platform))
    db.add(
        GameActivity(
            user_id=current_user.id,
            platform=platform,
            game_name=game_name,
            activity_type="linked",
            payload_json=json.dumps(payload, ensure_ascii=False),
        )
    )
    current_user.current_game = f"{_platform_label(platform)}: {game_name}" if keep_current_game else current_user.current_game
    await db.flush()


async def _sync_current_game(db: AsyncSession, current_user: User) -> None:
    result = await db.execute(
        select(GameActivity).where(GameActivity.user_id == current_user.id).order_by(GameActivity.created_at.desc(), GameActivity.id.desc()).limit(1)
    )
    latest = result.scalar_one_or_none()
    current_user.current_game = f"{_platform_label(latest.platform)}: {latest.game_name}" if latest is not None else None


async def _get_latest_activity_payload(db: AsyncSession, account: GameAccount | None, platform: str | None) -> dict[str, object] | None:
    if account is None or platform is None:
        return None
    result = await db.execute(
        select(GameActivity)
        .where(GameActivity.user_id == account.user_id, GameActivity.platform == platform)
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


def _normalize_platform(platform: str) -> str:
    normalized = (platform or "").strip().lower()
    if normalized not in SUPPORTED_GAME_PLATFORMS:
        raise ValueError("Unsupported game platform")
    return normalized


def _platform_label(platform: str) -> str:
    return "Steam" if platform == "steam" else "Riot"


def _build_riot_display_name(payload: dict[str, object]) -> str | None:
    game_name = payload.get("game_name")
    tag_line = payload.get("tag_line")
    if isinstance(game_name, str) and isinstance(tag_line, str) and game_name and tag_line:
        return f"{game_name}#{tag_line}"
    return None

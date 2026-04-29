from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.security import create_oauth_state, decode_oauth_state
from app.db.session import get_db
from app.models.user import User
from app.schemas.game import GamesOverviewResponse
from app.services.game_service import (
    GameIntegrationError,
    ProviderNotConfigured,
    build_games_overview,
    build_steam_connect_url,
    connect_steam_account,
    disconnect_account,
    verify_steam_openid,
)

router = APIRouter()


@router.get("/overview", response_model=GamesOverviewResponse)
async def games_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GamesOverviewResponse:
    overview = await build_games_overview(db, current_user)
    return GamesOverviewResponse.model_validate(overview)


@router.get("/steam/connect")
async def steam_connect(current_user: User = Depends(get_current_user)) -> RedirectResponse:
    if not settings.steam_enabled:
        raise HTTPException(status_code=503, detail="Steam API key not configured")
    state = create_oauth_state(current_user.id, "steam")
    return RedirectResponse(build_steam_connect_url(state=state), status_code=status.HTTP_302_FOUND)


@router.get("/steam/callback")
async def steam_callback(
    request: Request,
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    decoded = decode_oauth_state(state)
    if decoded is None:
        return _redirect_frontend("steam_error", "Некорректный state")
    user_id, provider = decoded
    if provider != "steam":
        return _redirect_frontend("steam_error", "State не относится к Steam")

    user = await db.get(User, user_id)
    if user is None:
        return _redirect_frontend("steam_error", "Пользователь не найден")

    query_params = {key: value for key, value in request.query_params.multi_items()}
    try:
        steam_id = await verify_steam_openid(query_params)
        await connect_steam_account(db, user, steam_id)
    except ProviderNotConfigured as exc:
        return _redirect_frontend("steam_error", str(exc))
    except GameIntegrationError as exc:
        return _redirect_frontend("steam_error", str(exc))
    except Exception:
        return _redirect_frontend("steam_error", "Не удалось подключить Steam")

    return _redirect_frontend("steam_connected")


@router.delete("/accounts/steam", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_steam_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await disconnect_account(db, current_user, "steam")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _redirect_frontend(status_value: str, message: str | None = None) -> RedirectResponse:
    params = {"games": status_value}
    if message:
        params["games_message"] = message
    return RedirectResponse(f"{settings.frontend_url}?{urlencode(params)}", status_code=status.HTTP_302_FOUND)

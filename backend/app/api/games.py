from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.game import (
    GameAccountResponse,
    GameAccountUpsertRequest,
    GameActivityResponse,
    GameActivityUpsertRequest,
    GamesOverviewResponse,
)
from app.services.game_service import (
    clear_activity,
    create_activity,
    list_accounts,
    list_active_activities,
    remove_account,
    upsert_account,
)

router = APIRouter()


@router.get("/overview", response_model=GamesOverviewResponse)
async def games_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GamesOverviewResponse:
    accounts = await list_accounts(db, current_user)
    activities = await list_active_activities(db, current_user)
    return GamesOverviewResponse(
        accounts=[GameAccountResponse.model_validate(item) for item in accounts],
        active_activities=[GameActivityResponse.model_validate(item) for item in activities],
    )


@router.post("/accounts", response_model=GameAccountResponse)
async def connect_account(
    payload: GameAccountUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GameAccountResponse:
    try:
        account = await upsert_account(
            db,
            current_user,
            platform=payload.platform,
            external_user_id=payload.external_user_id,
            display_name=payload.display_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GameAccountResponse.model_validate(account)


@router.delete("/accounts/{platform}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_account(
    platform: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    try:
        await remove_account(db, current_user, platform)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/activity", response_model=GameActivityResponse)
async def update_game_activity(
    payload: GameActivityUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GameActivityResponse:
    try:
        activity = await create_activity(
            db,
            current_user,
            platform=payload.platform,
            game_name=payload.game_name,
            activity_type=payload.activity_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return GameActivityResponse.model_validate(activity)


@router.delete("/activity/{platform}", status_code=status.HTTP_204_NO_CONTENT)
async def clear_game_activity(
    platform: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    try:
        await clear_activity(db, current_user, platform)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)

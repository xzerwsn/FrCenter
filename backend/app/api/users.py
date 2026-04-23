import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import UserMeResponse, UserMeUpdateRequest, UserPublicResponse
from app.services.friend_service import search_users

router = APIRouter()


def _to_user_me_response(user: User) -> UserMeResponse:
    photos: list[str] = []
    if user.profile_photos:
        try:
            parsed = json.loads(user.profile_photos)
            if isinstance(parsed, list):
                photos = [item for item in parsed if isinstance(item, str)]
        except json.JSONDecodeError:
            photos = []
    return UserMeResponse.model_validate(
        {
            "id": user.id,
            "email": user.email,
            "username": user.username,
            "display_name": user.display_name,
            "nickname": user.nickname,
            "profile_status": user.profile_status,
            "profile_photos": photos,
            "profile_banner_url": user.profile_banner_url,
            "profile_background_url": user.profile_background_url,
            "avatar_ring_style": user.avatar_ring_style,
            "is_email_confirmed": user.is_email_confirmed,
            "avatar_url": user.avatar_url,
            "status": user.status,
            "current_game": user.current_game,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
        }
    )


@router.get("/me", response_model=UserMeResponse)
async def me(current_user: User = Depends(get_current_user)) -> UserMeResponse:
    return _to_user_me_response(current_user)


@router.patch("/me", response_model=UserMeResponse)
async def update_me(
    payload: UserMeUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserMeResponse:
    updates = payload.model_dump(exclude_unset=True)
    if "username" in updates:
        if updates["username"]:
            current_user.username = updates["username"]
    if "display_name" in updates:
        current_user.display_name = updates["display_name"]
    if "nickname" in updates:
        current_user.nickname = updates["nickname"]
    if "profile_status" in updates:
        current_user.profile_status = updates["profile_status"]
    if "avatar_url" in updates:
        current_user.avatar_url = updates["avatar_url"]
    if "profile_banner_url" in updates:
        current_user.profile_banner_url = updates["profile_banner_url"]
    if "profile_background_url" in updates:
        current_user.profile_background_url = updates["profile_background_url"]
    if "avatar_ring_style" in updates:
        current_user.avatar_ring_style = updates["avatar_ring_style"]
    if "profile_photos" in updates:
        current_user.profile_photos = json.dumps(updates["profile_photos"] or [], ensure_ascii=False)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Username or nickname already exists") from exc
    await db.refresh(current_user)
    return _to_user_me_response(current_user)


@router.get("/search", response_model=list[UserPublicResponse])
async def search(
    username: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[User]:
    return await search_users(db, current_user, username)

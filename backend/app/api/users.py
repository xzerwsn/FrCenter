from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import UserMeResponse, UserPublicResponse
from app.services.friend_service import search_users

router = APIRouter()


@router.get("/me", response_model=UserMeResponse)
async def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.get("/search", response_model=list[UserPublicResponse])
async def search(
    username: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[User]:
    return await search_users(db, current_user, username)

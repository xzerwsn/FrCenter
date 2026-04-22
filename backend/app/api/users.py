from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.user import UserMeResponse

router = APIRouter()


@router.get("/me", response_model=UserMeResponse)
async def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user

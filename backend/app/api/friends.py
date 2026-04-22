from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.friend import (
    AddByInviteCodeRequest,
    FriendListResponse,
    FriendRequestCreate,
    FriendRequestResponse,
    InviteCodeCreate,
    InviteCodeResponse,
)
from app.services.friend_service import (
    AlreadyFriends,
    CannotFriendSelf,
    FriendRequestAlreadyExists,
    FriendRequestNotFound,
    InvalidInviteCode,
    UserNotFound,
    accept_friend_request,
    add_by_invite_code,
    create_friend_request,
    create_invite_code,
    list_friends as list_user_friends,
)

router = APIRouter()


@router.get("", response_model=FriendListResponse)
async def list_friends(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FriendListResponse:
    friends = await list_user_friends(db, current_user)
    return FriendListResponse(friends=friends)


@router.post("/request", response_model=FriendRequestResponse, status_code=status.HTTP_201_CREATED)
async def request_friend(
    payload: FriendRequestCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FriendRequestResponse:
    try:
        return await create_friend_request(db, current_user, payload.username)
    except UserNotFound as exc:
        raise HTTPException(status_code=404, detail="Пользователь не найден") from exc
    except CannotFriendSelf as exc:
        raise HTTPException(status_code=400, detail="Нельзя добавить себя в друзья") from exc
    except AlreadyFriends as exc:
        raise HTTPException(status_code=409, detail="Вы уже друзья") from exc
    except FriendRequestAlreadyExists as exc:
        raise HTTPException(status_code=409, detail="Заявка уже существует") from exc


@router.post("/accept/{request_id}", response_model=FriendRequestResponse)
async def accept_request(
    request_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FriendRequestResponse:
    try:
        return await accept_friend_request(db, current_user, request_id)
    except FriendRequestNotFound as exc:
        raise HTTPException(status_code=404, detail="Заявка не найдена") from exc


@router.post("/invite-code", response_model=InviteCodeResponse, status_code=status.HTTP_201_CREATED)
async def generate_invite_code(
    payload: InviteCodeCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InviteCodeResponse:
    return await create_invite_code(db, current_user, payload.max_uses)


@router.post("/add-by-code", status_code=status.HTTP_204_NO_CONTENT)
async def add_friend_by_code(
    payload: AddByInviteCodeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    try:
        await add_by_invite_code(db, current_user, payload.code)
    except InvalidInviteCode as exc:
        raise HTTPException(status_code=400, detail="Неверный или использованный invite-код") from exc
    except CannotFriendSelf as exc:
        raise HTTPException(status_code=400, detail="Нельзя добавить себя в друзья") from exc
    except AlreadyFriends as exc:
        raise HTTPException(status_code=409, detail="Вы уже друзья") from exc

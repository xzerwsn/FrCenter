from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.chat import Chat, Message
from app.models.user import User
from app.schemas.chat import (
    ChatListResponse,
    ChatResponse,
    DirectChatCreate,
    GroupChatCreate,
    MessageResponse,
    MessageSendRequest,
)
from app.services.chat_service import (
    ChatNotFound,
    NotChatMember,
    NotFriends,
    UserNotFound,
    create_direct_chat,
    create_group_chat,
    get_chat,
    list_chats as list_user_chats,
    list_messages,
    send_message,
)

router = APIRouter()


@router.get("", response_model=ChatListResponse)
async def list_chats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChatListResponse:
    chats = await list_user_chats(db, current_user)
    return ChatListResponse(chats=chats)


@router.post("/direct", response_model=ChatResponse, status_code=status.HTTP_201_CREATED)
async def create_direct(
    payload: DirectChatCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Chat:
    try:
        return await create_direct_chat(db, current_user, payload.username)
    except UserNotFound as exc:
        raise HTTPException(status_code=404, detail="Пользователь не найден") from exc
    except NotFriends as exc:
        raise HTTPException(status_code=403, detail="Direct-чат можно создать только с другом") from exc


@router.post("/group", response_model=ChatResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    payload: GroupChatCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Chat:
    try:
        return await create_group_chat(
            db,
            current_user,
            payload.title,
            payload.usernames,
            payload.encrypted_group_key,
        )
    except UserNotFound as exc:
        raise HTTPException(status_code=404, detail="Один или несколько пользователей не найдены") from exc


@router.get("/{chat_id}", response_model=ChatResponse)
async def read_chat(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Chat:
    try:
        return await get_chat(db, current_user, chat_id)
    except (ChatNotFound, NotChatMember) as exc:
        raise HTTPException(status_code=404, detail="Чат не найден") from exc


@router.get("/{chat_id}/messages", response_model=list[MessageResponse])
async def read_messages(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Message]:
    try:
        return await list_messages(db, current_user, chat_id)
    except NotChatMember as exc:
        raise HTTPException(status_code=404, detail="Чат не найден") from exc


@router.post("/{chat_id}/messages", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def create_message(
    chat_id: str,
    payload: MessageSendRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Message:
    try:
        return await send_message(
            db,
            current_user,
            chat_id,
            payload.ciphertext,
            payload.nonce,
            payload.message_type,
            payload.encrypted_message_keys,
        )
    except NotChatMember as exc:
        raise HTTPException(status_code=404, detail="Чат не найден") from exc

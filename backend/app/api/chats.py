from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.websocket import connection_manager
from app.db.session import get_db
from app.models.chat import Chat, Message
from app.models.user import User
from app.schemas.chat import (
    ChatListResponse,
    ChatMemberAddRequest,
    ChatMemberRemoveRequest,
    ChatMemberRoleUpdateRequest,
    ChatResponse,
    DirectChatCreate,
    GroupChatCreate,
    MessageResponse,
    MessageSendRequest,
    MessageUpdateRequest,
)
from app.services.chat_service import (
    ChatNotFound,
    ForbiddenChatAction,
    MessageNotFound,
    NotChatMember,
    NotFriends,
    UserNotFound,
    add_group_member,
    create_direct_chat,
    create_group_chat,
    get_active_member_ids,
    get_chat,
    list_chats as list_user_chats,
    list_messages,
    update_message,
    delete_message,
    remove_group_member,
    send_message,
    update_group_member_role,
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
        raise HTTPException(status_code=404, detail="User not found") from exc
    except NotFriends as exc:
        raise HTTPException(status_code=403, detail="Direct chat can be created only with a friend") from exc


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
        raise HTTPException(status_code=404, detail="One or more users were not found") from exc


@router.post("/{chat_id}/members", response_model=ChatResponse)
async def add_member(
    chat_id: str,
    payload: ChatMemberAddRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Chat:
    try:
        return await add_group_member(db, current_user, chat_id, payload.username, payload.encrypted_group_key)
    except NotChatMember as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc


@router.patch("/{chat_id}/messages/{message_id}", response_model=MessageResponse)
async def edit_message(
    chat_id: str,
    message_id: str,
    payload: MessageUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Message:
    try:
        message = await update_message(
            db,
            current_user,
            chat_id,
            message_id,
            payload.ciphertext,
            payload.nonce,
            payload.message_type,
        )
        member_ids = await get_active_member_ids(db, chat_id)
        message_payload = MessageResponse.model_validate(message).model_dump(mode="json")
        await connection_manager.broadcast_to_users(
            member_ids,
            {
                "type": "message.updated",
                "chat_id": chat_id,
                "message": message_payload,
            },
        )
        return message
    except NotChatMember as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc
    except MessageNotFound as exc:
        raise HTTPException(status_code=404, detail="Message not found") from exc
    except ForbiddenChatAction as exc:
        raise HTTPException(status_code=403, detail="Not enough permissions") from exc


@router.delete("/{chat_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_message(
    chat_id: str,
    message_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    try:
        await delete_message(db, current_user, chat_id, message_id)
        member_ids = await get_active_member_ids(db, chat_id)
        await connection_manager.broadcast_to_users(
            member_ids,
            {
                "type": "message.deleted",
                "chat_id": chat_id,
                "message_id": message_id,
            },
        )
    except NotChatMember as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc
    except MessageNotFound as exc:
        raise HTTPException(status_code=404, detail="Message not found") from exc
    except ForbiddenChatAction as exc:
        raise HTTPException(status_code=403, detail="Not enough permissions") from exc
    except ChatNotFound as exc:
        raise HTTPException(status_code=404, detail="Group chat not found") from exc
    except UserNotFound as exc:
        raise HTTPException(status_code=404, detail="User not found") from exc
    except ForbiddenChatAction as exc:
        raise HTTPException(status_code=403, detail="Not enough permissions") from exc


@router.patch("/{chat_id}/members/role", response_model=ChatResponse)
async def update_member_role(
    chat_id: str,
    payload: ChatMemberRoleUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Chat:
    try:
        return await update_group_member_role(db, current_user, chat_id, payload.user_id, payload.role)
    except NotChatMember as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc
    except ChatNotFound as exc:
        raise HTTPException(status_code=404, detail="Group chat not found") from exc
    except UserNotFound as exc:
        raise HTTPException(status_code=404, detail="Member not found") from exc
    except ForbiddenChatAction as exc:
        raise HTTPException(status_code=403, detail="Not enough permissions") from exc


@router.delete("/{chat_id}/members", response_model=ChatResponse)
async def remove_member(
    chat_id: str,
    payload: ChatMemberRemoveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Chat:
    try:
        return await remove_group_member(db, current_user, chat_id, payload.user_id, payload.encrypted_group_key)
    except NotChatMember as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc
    except ChatNotFound as exc:
        raise HTTPException(status_code=404, detail="Group chat not found") from exc
    except UserNotFound as exc:
        raise HTTPException(status_code=404, detail="Member not found") from exc
    except ForbiddenChatAction as exc:
        raise HTTPException(status_code=403, detail="Not enough permissions") from exc


@router.get("/{chat_id}", response_model=ChatResponse)
async def read_chat(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Chat:
    try:
        return await get_chat(db, current_user, chat_id)
    except (ChatNotFound, NotChatMember) as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc


@router.get("/{chat_id}/messages", response_model=list[MessageResponse])
async def read_messages(
    chat_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Message]:
    try:
        return await list_messages(db, current_user, chat_id)
    except NotChatMember as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc


@router.post("/{chat_id}/messages", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def create_message(
    chat_id: str,
    payload: MessageSendRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Message:
    try:
        message = await send_message(
            db,
            current_user,
            chat_id,
            payload.ciphertext,
            payload.nonce,
            payload.message_type,
            payload.encrypted_message_keys,
        )
        member_ids = await get_active_member_ids(db, chat_id)
        message_payload = MessageResponse.model_validate(message).model_dump(mode="json")
        await connection_manager.broadcast_to_users(
            member_ids,
            {
                "type": "message.new",
                "chat_id": chat_id,
                "message": message_payload,
            },
        )
        return message
    except NotChatMember as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc

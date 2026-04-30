from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.core.config import settings
from app.models.chat import Chat, ChatMember, Message, MessageRecipient
from app.models.friend import Friendship
from app.models.user import User


class ChatError(Exception):
    pass


class UserNotFound(ChatError):
    pass


class NotFriends(ChatError):
    pass


class ChatNotFound(ChatError):
    pass


class NotChatMember(ChatError):
    pass


class ForbiddenChatAction(ChatError):
    pass


class MessageNotFound(ChatError):
    pass


@dataclass(slots=True)
class MessagePage:
    messages: list[dict[str, Any]]
    next_offset: int | None
    has_more: bool
    limit: int
    offset: int


async def ensure_chat_member(db: AsyncSession, user_id: str, chat_id: str) -> None:
    await _ensure_member(db, user_id, chat_id)


async def list_chats(db: AsyncSession, current_user: User) -> list[Chat]:
    result = await db.execute(
        select(Chat, ChatMember.unread_count)
        .join(ChatMember, ChatMember.chat_id == Chat.id)
        .where(ChatMember.user_id == current_user.id, ChatMember.left_at.is_(None))
        .order_by(Chat.last_message_at.desc().nullslast(), Chat.updated_at.desc())
    )
    rows = list(result.all())
    chats = [chat for chat, _unread_count in rows]
    unread_counts = {chat.id: unread_count for chat, unread_count in rows}
    direct_chat_ids = [chat.id for chat in chats if chat.type == "direct"]
    peer_map = await _get_direct_chat_peers(db, current_user.id, direct_chat_ids)
    for chat in chats:
        setattr(chat, "unread_count", unread_counts.get(chat.id, 0))
        setattr(chat, "peer", peer_map.get(chat.id))
    return chats


async def create_direct_chat(db: AsyncSession, current_user: User, username: str) -> Chat:
    target = await _get_user_by_username(db, username)
    if target is None:
        raise UserNotFound
    if not await _are_friends(db, current_user.id, target.id):
        raise NotFriends

    existing = await _get_existing_direct_chat(db, current_user.id, target.id)
    if existing:
        return existing

    chat = Chat(type="direct", created_by=current_user.id, member_count=2)
    db.add(chat)
    await db.flush()
    db.add_all(
        [
            ChatMember(chat_id=chat.id, user_id=current_user.id, role="member"),
            ChatMember(chat_id=chat.id, user_id=target.id, role="member"),
        ]
    )
    await db.commit()
    return await get_chat(db, current_user, chat.id)


async def create_group_chat(
    db: AsyncSession,
    current_user: User,
    title: str,
    usernames: list[str],
    encrypted_group_key: str | None,
    avatar_url: str | None,
    background_url: str | None,
) -> Chat:
    users = await _get_users_by_usernames(db, usernames)
    if len(users) != len(set(usernames)):
        raise UserNotFound

    member_ids = {current_user.id, *[user.id for user in users]}
    chat = Chat(
        type="group",
        title=title,
        avatar_url=avatar_url,
        background_url=background_url,
        created_by=current_user.id,
        member_count=len(member_ids),
    )
    db.add(chat)
    await db.flush()
    db.add(ChatMember(chat_id=chat.id, user_id=current_user.id, role="owner", encrypted_group_key=encrypted_group_key))
    db.add_all(
        ChatMember(chat_id=chat.id, user_id=user.id, role="member", encrypted_group_key=encrypted_group_key)
        for user in users
        if user.id != current_user.id
    )
    await db.commit()
    return await get_chat(db, current_user, chat.id)


async def get_chat(db: AsyncSession, current_user: User, chat_id: str) -> Chat:
    chat = await _get_chat_with_members_for_user(db, current_user.id, chat_id)
    if chat is None:
        raise NotChatMember
    return _strip_inactive_members(chat)


async def list_messages(
    db: AsyncSession,
    current_user: User,
    chat_id: str,
    *,
    limit: int = 30,
    offset: int = 0,
) -> MessagePage:
    await _ensure_member(db, current_user.id, chat_id)
    safe_limit = max(1, min(limit, 100))
    safe_offset = max(offset, 0)
    result = await db.execute(
        text(
            """
            SELECT
                page.id,
                page.chat_id,
                page.ciphertext,
                page.nonce,
                page.message_type,
                page.expires_at,
                page.created_at,
                sender.id AS sender_id,
                sender.username AS sender_username,
                sender.display_name AS sender_display_name,
                sender.nickname AS sender_nickname,
                sender.profile_status AS sender_profile_status,
                sender.profile_banner_url AS sender_profile_banner_url,
                sender.profile_background_url AS sender_profile_background_url,
                sender.profile_photos AS sender_profile_photos,
                sender.avatar_ring_style AS sender_avatar_ring_style,
                sender.avatar_url AS sender_avatar_url,
                sender.status AS sender_status,
                sender.current_game AS sender_current_game
            FROM (
                SELECT
                    m.id,
                    m.chat_id,
                    m.sender_id,
                    m.ciphertext,
                    m.nonce,
                    m.message_type,
                    m.expires_at,
                    m.created_at
                FROM messages AS m
                WHERE m.chat_id = :chat_id
                  AND m.expires_at > :now_utc
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT :page_limit OFFSET :page_offset
            ) AS page
            JOIN users AS sender ON sender.id = page.sender_id
            ORDER BY page.created_at ASC, page.id ASC
            """
        ),
        {
            "chat_id": chat_id,
            "now_utc": datetime.now(UTC),
            "page_limit": safe_limit + 1,
            "page_offset": safe_offset,
        },
    )
    rows = list(result.mappings().all())
    has_more = len(rows) > safe_limit
    page_rows = rows[1:] if has_more else rows
    next_offset = safe_offset + safe_limit if has_more else None
    return MessagePage(
        messages=[_serialize_message_row(row) for row in page_rows],
        next_offset=next_offset,
        has_more=has_more,
        limit=safe_limit,
        offset=safe_offset,
    )


async def mark_chat_read(db: AsyncSession, user_id: str, chat_id: str) -> None:
    member = await _get_active_member(db, chat_id, user_id)
    if member is None:
        raise NotChatMember
    member.unread_count = 0
    await db.execute(
        update(MessageRecipient)
        .where(
            MessageRecipient.recipient_user_id == user_id,
            MessageRecipient.read_at.is_(None),
            MessageRecipient.message_id.in_(
                select(Message.id).where(
                    Message.chat_id == chat_id,
                    Message.sender_id != user_id,
                )
            ),
        )
        .values(read_at=datetime.now(UTC), delivery_status="read")
    )
    await db.commit()


async def get_active_member_ids(db: AsyncSession, chat_id: str) -> list[str]:
    result = await db.execute(
        select(ChatMember.user_id).where(ChatMember.chat_id == chat_id, ChatMember.left_at.is_(None))
    )
    return list(result.scalars().all())


async def send_message(
    db: AsyncSession,
    current_user: User,
    chat_id: str,
    ciphertext: str,
    nonce: str,
    message_type: str,
    encrypted_message_keys: dict[str, str],
) -> Message:
    members = await _get_active_members(db, chat_id)
    if current_user.id not in {member.user_id for member in members}:
        raise NotChatMember
    chat = await _get_chat_by_id(db, chat_id)
    if chat is None:
        raise ChatNotFound
    message_created_at = datetime.now(UTC)

    message = Message(
        chat_id=chat_id,
        sender_id=current_user.id,
        ciphertext=ciphertext,
        nonce=nonce,
        message_type=message_type,
        expires_at=datetime.now(UTC) + timedelta(seconds=settings.message_ttl_seconds),
        created_at=message_created_at,
    )
    db.add(message)
    await db.flush()
    chat.last_message_id = message.id
    chat.last_message_at = message_created_at
    chat.updated_at = message_created_at

    db.add_all(
        MessageRecipient(
            message_id=message.id,
            recipient_user_id=member.user_id,
            encrypted_message_key=encrypted_message_keys.get(member.user_id),
        )
        for member in members
    )
    for member in members:
        if member.user_id != current_user.id:
            member.unread_count += 1
    await db.commit()

    result = await db.execute(select(Message).where(Message.id == message.id).options(joinedload(Message.sender)))
    return result.scalar_one()


async def update_message(
    db: AsyncSession,
    current_user: User,
    chat_id: str,
    message_id: str,
    ciphertext: str,
    nonce: str,
    message_type: str,
) -> Message:
    actor_member = await _get_active_member(db, chat_id, current_user.id)
    if actor_member is None:
        raise NotChatMember

    message = await _get_message_in_chat(db, chat_id, message_id)
    if message is None:
        raise MessageNotFound

    if not _can_manage_message(actor_member.role, message.sender_id, current_user.id):
        raise ForbiddenChatAction

    message.ciphertext = ciphertext
    message.nonce = nonce
    message.message_type = message_type
    await db.commit()

    result = await db.execute(select(Message).where(Message.id == message.id).options(joinedload(Message.sender)))
    return result.scalar_one()


async def delete_message(
    db: AsyncSession,
    current_user: User,
    chat_id: str,
    message_id: str,
) -> None:
    actor_member = await _get_active_member(db, chat_id, current_user.id)
    if actor_member is None:
        raise NotChatMember

    message = await _get_message_in_chat(db, chat_id, message_id)
    if message is None:
        raise MessageNotFound

    if not _can_manage_message(actor_member.role, message.sender_id, current_user.id):
        raise ForbiddenChatAction

    await db.delete(message)
    await db.commit()


async def add_group_member(
    db: AsyncSession,
    current_user: User,
    chat_id: str,
    username: str,
    encrypted_group_key: str | None,
) -> Chat:
    actor_member = await _get_active_member(db, chat_id, current_user.id)
    if actor_member is None:
        raise NotChatMember
    if actor_member.role not in {"owner", "admin"}:
        raise ForbiddenChatAction

    chat = await _get_chat_by_id(db, chat_id)
    if chat is None or chat.type != "group":
        raise ChatNotFound

    target = await _get_user_by_username(db, username)
    if target is None:
        raise UserNotFound

    existing_member = await _get_active_member(db, chat_id, target.id)
    if existing_member is not None:
        return await get_chat(db, current_user, chat_id)
    chat.member_count += 1

    db.add(
        ChatMember(
            chat_id=chat_id,
            user_id=target.id,
            role="member",
            encrypted_group_key=encrypted_group_key,
        )
    )
    if encrypted_group_key:
        await _set_group_key_for_active_members(db, chat_id, encrypted_group_key)
    await db.commit()
    return await get_chat(db, current_user, chat_id)


async def update_group_member_role(
    db: AsyncSession,
    current_user: User,
    chat_id: str,
    target_user_id: str,
    role: str,
) -> Chat:
    actor_member = await _get_active_member(db, chat_id, current_user.id)
    if actor_member is None:
        raise NotChatMember

    chat = await _get_chat_by_id(db, chat_id)
    if chat is None or chat.type != "group":
        raise ChatNotFound

    target_member = await _get_active_member(db, chat_id, target_user_id)
    if target_member is None:
        raise UserNotFound

    if target_member.role == "owner":
        raise ForbiddenChatAction

    if actor_member.role != "owner":
        raise ForbiddenChatAction

    target_member.role = role

    await db.commit()
    return await get_chat(db, current_user, chat_id)


async def update_group_chat(
    db: AsyncSession,
    current_user: User,
    chat_id: str,
    *,
    title: str | None | object = ...,
    avatar_url: str | None | object = ...,
    background_url: str | None | object = ...,
) -> Chat:
    actor_member = await _get_active_member(db, chat_id, current_user.id)
    if actor_member is None:
        raise NotChatMember
    if actor_member.role not in {"owner", "admin"}:
        raise ForbiddenChatAction

    chat = await _get_chat_by_id(db, chat_id)
    if chat is None or chat.type != "group":
        raise ChatNotFound

    if title is not ...:
        chat.title = title
    if avatar_url is not ...:
        chat.avatar_url = avatar_url
    if background_url is not ...:
        chat.background_url = background_url

    await db.commit()
    return await get_chat(db, current_user, chat_id)


async def remove_group_member(
    db: AsyncSession,
    current_user: User,
    chat_id: str,
    target_user_id: str,
    encrypted_group_key: str | None = None,
) -> Chat:
    actor_member = await _get_active_member(db, chat_id, current_user.id)
    if actor_member is None:
        raise NotChatMember

    chat = await _get_chat_by_id(db, chat_id)
    if chat is None or chat.type != "group":
        raise ChatNotFound

    target_member = await _get_active_member(db, chat_id, target_user_id)
    if target_member is None:
        raise UserNotFound

    is_self = target_user_id == current_user.id
    if target_member.role == "owner" and not is_self:
        raise ForbiddenChatAction

    if actor_member.role == "owner":
        pass
    elif actor_member.role == "admin":
        if target_member.role != "member" and not is_self:
            raise ForbiddenChatAction
    elif not is_self:
        raise ForbiddenChatAction

    target_member.left_at = datetime.now(UTC)
    chat.member_count = max(chat.member_count - 1, 0)
    if encrypted_group_key:
        await _set_group_key_for_active_members(db, chat_id, encrypted_group_key)
    await db.commit()
    if target_user_id == current_user.id:
        chat = await _get_chat_with_members(db, chat_id)
        if chat is None:
            raise ChatNotFound
        return _strip_inactive_members(chat)
    return await get_chat(db, current_user, chat_id)


async def _get_user_by_username(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def _get_users_by_usernames(db: AsyncSession, usernames: list[str]) -> list[User]:
    normalized = list(set(usernames))
    result = await db.execute(select(User).where(User.username.in_(normalized)))
    return list(result.scalars().all())


async def _are_friends(db: AsyncSession, user_a_id: str, user_b_id: str) -> bool:
    ordered_a, ordered_b = _ordered_pair(user_a_id, user_b_id)
    result = await db.execute(
        select(Friendship.id).where(Friendship.user_a_id == ordered_a, Friendship.user_b_id == ordered_b)
    )
    return result.scalar_one_or_none() is not None


async def _get_existing_direct_chat(db: AsyncSession, user_a_id: str, user_b_id: str) -> Chat | None:
    result = await db.execute(
        select(Chat)
        .join(ChatMember, ChatMember.chat_id == Chat.id)
        .where(Chat.type == "direct", ChatMember.user_id.in_([user_a_id, user_b_id]))
        .group_by(Chat.id)
        .having(func.count(ChatMember.user_id) == 2)
        .options(selectinload(Chat.members).selectinload(ChatMember.user))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _ensure_member(db: AsyncSession, user_id: str, chat_id: str) -> None:
    result = await db.execute(
        select(ChatMember.id).where(
            ChatMember.chat_id == chat_id,
            ChatMember.user_id == user_id,
            ChatMember.left_at.is_(None),
        )
    )
    if result.scalar_one_or_none() is None:
        raise NotChatMember


async def _get_active_members(db: AsyncSession, chat_id: str) -> list[ChatMember]:
    result = await db.execute(select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.left_at.is_(None)))
    return list(result.scalars().all())


async def _get_active_member(db: AsyncSession, chat_id: str, user_id: str) -> ChatMember | None:
    result = await db.execute(
        select(ChatMember).where(
            ChatMember.chat_id == chat_id,
            ChatMember.user_id == user_id,
            ChatMember.left_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def _get_chat_by_id(db: AsyncSession, chat_id: str) -> Chat | None:
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    return result.scalar_one_or_none()


async def _get_chat_with_members(db: AsyncSession, chat_id: str) -> Chat | None:
    result = await db.execute(
        select(Chat)
        .where(Chat.id == chat_id)
        .options(selectinload(Chat.members).selectinload(ChatMember.user))
    )
    return result.scalar_one_or_none()


async def _get_chat_with_members_for_user(db: AsyncSession, user_id: str, chat_id: str) -> Chat | None:
    result = await db.execute(
        select(Chat)
        .join(
            ChatMember,
            (ChatMember.chat_id == Chat.id)
            & (ChatMember.user_id == user_id)
            & ChatMember.left_at.is_(None),
        )
        .where(Chat.id == chat_id)
        .options(selectinload(Chat.members).selectinload(ChatMember.user))
    )
    return result.scalar_one_or_none()


async def _get_direct_chat_peers(db: AsyncSession, current_user_id: str, chat_ids: list[str]) -> dict[str, User]:
    if not chat_ids:
        return {}
    result = await db.execute(
        select(ChatMember.chat_id, User)
        .join(User, User.id == ChatMember.user_id)
        .where(
            ChatMember.chat_id.in_(chat_ids),
            ChatMember.user_id != current_user_id,
            ChatMember.left_at.is_(None),
        )
    )
    return {chat_id: user for chat_id, user in result.all()}


async def _set_group_key_for_active_members(db: AsyncSession, chat_id: str, encrypted_group_key: str) -> None:
    await db.execute(
        update(ChatMember)
        .where(ChatMember.chat_id == chat_id, ChatMember.left_at.is_(None))
        .values(encrypted_group_key=encrypted_group_key)
    )


async def _get_message_in_chat(db: AsyncSession, chat_id: str, message_id: str) -> Message | None:
    result = await db.execute(select(Message).where(Message.id == message_id, Message.chat_id == chat_id))
    return result.scalar_one_or_none()


def _can_manage_message(actor_role: str, message_sender_id: str, actor_user_id: str) -> bool:
    if actor_role in {"owner", "admin"}:
        return True
    return message_sender_id == actor_user_id


def _ordered_pair(user_a_id: str, user_b_id: str) -> tuple[str, str]:
    return (user_a_id, user_b_id) if user_a_id < user_b_id else (user_b_id, user_a_id)


def _strip_inactive_members(chat: Chat) -> Chat:
    chat.members = [member for member in chat.members if member.left_at is None]
    return chat


def _serialize_message_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "chat_id": row["chat_id"],
        "ciphertext": row["ciphertext"],
        "nonce": row["nonce"],
        "message_type": row["message_type"],
        "expires_at": row["expires_at"],
        "created_at": row["created_at"],
        "sender": {
            "id": row["sender_id"],
            "username": row["sender_username"],
            "display_name": row["sender_display_name"],
            "nickname": row["sender_nickname"],
            "profile_status": row["sender_profile_status"],
            "profile_banner_url": row["sender_profile_banner_url"],
            "profile_background_url": row["sender_profile_background_url"],
            "profile_photos": row["sender_profile_photos"],
            "avatar_ring_style": row["sender_avatar_ring_style"],
            "avatar_url": row["sender_avatar_url"],
            "status": row["sender_status"],
            "current_game": row["sender_current_game"],
        },
    }

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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


async def ensure_chat_member(db: AsyncSession, user_id: str, chat_id: str) -> None:
    await _ensure_member(db, user_id, chat_id)


async def list_chats(db: AsyncSession, current_user: User) -> list[Chat]:
    result = await db.execute(
        select(Chat)
        .join(ChatMember, ChatMember.chat_id == Chat.id)
        .where(ChatMember.user_id == current_user.id, ChatMember.left_at.is_(None))
        .options(selectinload(Chat.members).selectinload(ChatMember.user))
        .order_by(Chat.updated_at.desc())
    )
    chats = list(result.scalars().unique().all())
    return [_strip_inactive_members(chat) for chat in chats]


async def create_direct_chat(db: AsyncSession, current_user: User, username: str) -> Chat:
    target = await _get_user_by_username(db, username)
    if target is None:
        raise UserNotFound
    if not await _are_friends(db, current_user.id, target.id):
        raise NotFriends

    existing = await _get_existing_direct_chat(db, current_user.id, target.id)
    if existing:
        return existing

    chat = Chat(type="direct", created_by=current_user.id)
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

    chat = Chat(
        type="group",
        title=title,
        avatar_url=avatar_url,
        background_url=background_url,
        created_by=current_user.id,
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
    await _ensure_member(db, current_user.id, chat_id)
    result = await db.execute(
        select(Chat)
        .where(Chat.id == chat_id)
        .options(selectinload(Chat.members).selectinload(ChatMember.user))
    )
    chat = result.scalar_one_or_none()
    if chat is None:
        raise ChatNotFound
    return _strip_inactive_members(chat)


async def list_messages(db: AsyncSession, current_user: User, chat_id: str) -> list[Message]:
    await _ensure_member(db, current_user.id, chat_id)
    result = await db.execute(
        select(Message)
        .where(Message.chat_id == chat_id)
        .where(Message.expires_at > datetime.now(UTC))
        .options(selectinload(Message.sender))
        .order_by(Message.created_at.asc())
        .limit(100)
    )
    return list(result.scalars().all())


async def get_active_member_ids(db: AsyncSession, chat_id: str) -> list[str]:
    members = await _get_active_members(db, chat_id)
    return [member.user_id for member in members]


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

    message = Message(
        chat_id=chat_id,
        sender_id=current_user.id,
        ciphertext=ciphertext,
        nonce=nonce,
        message_type=message_type,
        expires_at=datetime.now(UTC) + timedelta(seconds=settings.message_ttl_seconds),
    )
    db.add(message)
    await db.flush()

    db.add_all(
        MessageRecipient(
            message_id=message.id,
            recipient_user_id=member.user_id,
            encrypted_message_key=encrypted_message_keys.get(member.user_id),
        )
        for member in members
    )
    await db.commit()

    result = await db.execute(select(Message).where(Message.id == message.id).options(selectinload(Message.sender)))
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

    result = await db.execute(select(Message).where(Message.id == message.id).options(selectinload(Message.sender)))
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


async def _set_group_key_for_active_members(db: AsyncSession, chat_id: str, encrypted_group_key: str) -> None:
    members = await _get_active_members(db, chat_id)
    for member in members:
        member.encrypted_group_key = encrypted_group_key


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

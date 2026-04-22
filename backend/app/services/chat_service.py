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


async def list_chats(db: AsyncSession, current_user: User) -> list[Chat]:
    result = await db.execute(
        select(Chat)
        .join(ChatMember, ChatMember.chat_id == Chat.id)
        .where(ChatMember.user_id == current_user.id, ChatMember.left_at.is_(None))
        .options(selectinload(Chat.members).selectinload(ChatMember.user))
        .order_by(Chat.updated_at.desc())
    )
    return list(result.scalars().unique().all())


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
) -> Chat:
    users = await _get_users_by_usernames(db, usernames)
    if len(users) != len(set(usernames)):
        raise UserNotFound

    chat = Chat(type="group", title=title, created_by=current_user.id)
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
    return chat


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


def _ordered_pair(user_a_id: str, user_b_id: str) -> tuple[str, str]:
    return (user_a_id, user_b_id) if user_a_id < user_b_id else (user_b_id, user_a_id)

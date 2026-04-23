from secrets import token_urlsafe

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.friend import FriendRequest, Friendship, InviteCode
from app.models.user import User

PERSONAL_INVITE_MAX_USES = 1_000_000


class FriendError(Exception):
    pass


class UserNotFound(FriendError):
    pass


class CannotFriendSelf(FriendError):
    pass


class AlreadyFriends(FriendError):
    pass


class FriendRequestAlreadyExists(FriendError):
    pass


class FriendRequestNotFound(FriendError):
    pass


class InvalidInviteCode(FriendError):
    pass


async def search_users(db: AsyncSession, current_user: User, username: str) -> list[User]:
    stmt = (
        select(User)
        .where(User.id != current_user.id)
        .where(User.username.ilike(f"%{username}%"))
        .order_by(User.username)
        .limit(20)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def list_friends(db: AsyncSession, current_user: User) -> list[User]:
    friendship_result = await db.execute(
        select(Friendship).where(
            or_(Friendship.user_a_id == current_user.id, Friendship.user_b_id == current_user.id)
        )
    )
    friendships = friendship_result.scalars().all()
    friend_ids = [
        item.user_b_id if item.user_a_id == current_user.id else item.user_a_id for item in friendships
    ]
    if not friend_ids:
        return []

    result = await db.execute(select(User).where(User.id.in_(friend_ids)).order_by(User.username))
    return list(result.scalars().all())


async def create_friend_request(db: AsyncSession, current_user: User, username: str) -> FriendRequest:
    target = await _get_user_by_username(db, username)
    if target is None:
        raise UserNotFound
    if target.id == current_user.id:
        raise CannotFriendSelf
    if await _are_friends(db, current_user.id, target.id):
        raise AlreadyFriends

    existing = await _get_request_between(db, current_user.id, target.id)
    if existing:
        raise FriendRequestAlreadyExists

    request = FriendRequest(from_user_id=current_user.id, to_user_id=target.id)
    db.add(request)
    await db.commit()
    return await _get_request_by_id(db, request.id)


async def accept_friend_request(db: AsyncSession, current_user: User, request_id: str) -> FriendRequest:
    request = await _get_request_by_id(db, request_id)
    if request is None or request.to_user_id != current_user.id or request.status != "pending":
        raise FriendRequestNotFound

    user_a_id, user_b_id = _ordered_pair(request.from_user_id, request.to_user_id)
    if not await _are_friends(db, user_a_id, user_b_id):
        db.add(Friendship(user_a_id=user_a_id, user_b_id=user_b_id))

    request.status = "accepted"
    await db.commit()
    return await _get_request_by_id(db, request.id)


async def create_invite_code(db: AsyncSession, current_user: User, max_uses: int) -> InviteCode:
    # Keep one stable personal code per user instead of issuing a new one on each request.
    result = await db.execute(select(InviteCode).where(InviteCode.owner_id == current_user.id).order_by(InviteCode.created_at.desc()))
    invite = result.scalars().first()
    if invite is not None:
        desired_max_uses = max(invite.max_uses, max_uses, PERSONAL_INVITE_MAX_USES)
        if invite.max_uses != desired_max_uses:
            invite.max_uses = desired_max_uses
            await db.commit()
            await db.refresh(invite)
        return invite

    invite = InviteCode(
        owner_id=current_user.id,
        code=token_urlsafe(12),
        max_uses=max(max_uses, PERSONAL_INVITE_MAX_USES),
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return invite


async def add_by_invite_code(db: AsyncSession, current_user: User, code: str) -> Friendship:
    result = await db.execute(select(InviteCode).where(InviteCode.code == code))
    invite = result.scalar_one_or_none()
    if invite is None or invite.used_count >= invite.max_uses:
        raise InvalidInviteCode
    if invite.owner_id == current_user.id:
        raise CannotFriendSelf
    if await _are_friends(db, current_user.id, invite.owner_id):
        raise AlreadyFriends

    user_a_id, user_b_id = _ordered_pair(current_user.id, invite.owner_id)
    friendship = Friendship(user_a_id=user_a_id, user_b_id=user_b_id)
    invite.used_count += 1
    db.add(friendship)
    await db.commit()
    await db.refresh(friendship)
    return friendship


async def _get_user_by_username(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def _get_request_between(db: AsyncSession, user_a_id: str, user_b_id: str) -> FriendRequest | None:
    result = await db.execute(
        select(FriendRequest).where(
            or_(
                and_(FriendRequest.from_user_id == user_a_id, FriendRequest.to_user_id == user_b_id),
                and_(FriendRequest.from_user_id == user_b_id, FriendRequest.to_user_id == user_a_id),
            )
        )
    )
    return result.scalar_one_or_none()


async def _get_request_by_id(db: AsyncSession, request_id: str) -> FriendRequest | None:
    result = await db.execute(
        select(FriendRequest)
        .options(selectinload(FriendRequest.from_user), selectinload(FriendRequest.to_user))
        .where(FriendRequest.id == request_id)
    )
    return result.scalar_one_or_none()


async def _are_friends(db: AsyncSession, user_a_id: str, user_b_id: str) -> bool:
    ordered_a, ordered_b = _ordered_pair(user_a_id, user_b_id)
    result = await db.execute(
        select(Friendship.id).where(
            Friendship.user_a_id == ordered_a,
            Friendship.user_b_id == ordered_b,
        )
    )
    return result.scalar_one_or_none() is not None


def _ordered_pair(user_a_id: str, user_b_id: str) -> tuple[str, str]:
    return (user_a_id, user_b_id) if user_a_id < user_b_id else (user_b_id, user_a_id)

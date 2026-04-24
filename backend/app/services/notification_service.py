from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.user import User


class NotificationNotFound(Exception):
    pass


async def create_notification(
    db: AsyncSession,
    *,
    user_id: str,
    kind: str,
    title: str,
    body: str,
    data: dict | None = None,
    dedupe_key: str | None = None,
) -> Notification:
    if dedupe_key:
        existing = await db.execute(
            select(Notification).where(
                Notification.user_id == user_id,
                Notification.kind == kind,
                Notification.dedupe_key == dedupe_key,
            )
        )
        found = existing.scalar_one_or_none()
        if found is not None:
            return found

    notification = Notification(
        user_id=user_id,
        kind=kind,
        title=title,
        body=body,
        data_json=json.dumps(data or {}, ensure_ascii=False),
        dedupe_key=dedupe_key,
    )
    db.add(notification)
    await db.flush()
    await db.refresh(notification)
    return notification


async def list_notifications(db: AsyncSession, current_user: User, limit: int = 50) -> tuple[list[Notification], int]:
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(desc(Notification.created_at))
        .limit(limit)
    )
    unread_result = await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == current_user.id,
            Notification.is_read.is_(False),
        )
    )
    return list(result.scalars().all()), int(unread_result.scalar_one() or 0)


async def mark_notification_read(db: AsyncSession, current_user: User, notification_id: str) -> Notification:
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
    )
    notification = result.scalar_one_or_none()
    if notification is None:
        raise NotificationNotFound

    if not notification.is_read:
        notification.is_read = True
        notification.read_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(notification)
    return notification


async def mark_all_notifications_read(db: AsyncSession, current_user: User) -> int:
    result = await db.execute(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.is_read.is_(False),
        )
    )
    notifications = list(result.scalars().all())
    if not notifications:
        return 0

    now = datetime.now(timezone.utc)
    for notification in notifications:
        notification.is_read = True
        notification.read_at = now
    await db.commit()
    return len(notifications)


def serialize_notification(notification: Notification) -> dict:
    try:
        data = json.loads(notification.data_json) if notification.data_json else {}
    except json.JSONDecodeError:
        data = {}

    return {
        "id": notification.id,
        "kind": notification.kind,
        "title": notification.title,
        "body": notification.body,
        "data": data,
        "is_read": notification.is_read,
        "created_at": notification.created_at.isoformat() if notification.created_at else None,
        "read_at": notification.read_at.isoformat() if notification.read_at else None,
    }


async def create_deploy_notifications(
    db: AsyncSession,
    *,
    title: str,
    body: str,
    deployment_key: str,
) -> int:
    result = await db.execute(select(User.id))
    user_ids = list(result.scalars().all())
    created = 0
    for user_id in user_ids:
        existing = await db.execute(
            select(Notification.id).where(
                Notification.user_id == user_id,
                Notification.kind == "deploy",
                Notification.dedupe_key == deployment_key,
            )
        )
        if existing.scalar_one_or_none() is not None:
            continue
        notification = await create_notification(
            db,
            user_id=user_id,
            kind="deploy",
            title=title,
            body=body,
            data={"deployment_key": deployment_key},
            dedupe_key=deployment_key,
        )
        if notification is not None:
            created += 1
    await db.commit()
    return created

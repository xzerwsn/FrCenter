from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.notification import NotificationListResponse, NotificationResponse
from app.services.notification_service import (
    NotificationNotFound,
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
    serialize_notification,
)

router = APIRouter()


@router.get("", response_model=NotificationListResponse)
async def get_notifications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationListResponse:
    notifications, unread_count = await list_notifications(db, current_user)
    return NotificationListResponse(
        notifications=[NotificationResponse.model_validate(serialize_notification(item)) for item in notifications],
        unread_count=unread_count,
    )


@router.post("/{notification_id}/read", response_model=NotificationResponse)
async def read_notification(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationResponse:
    try:
        notification = await mark_notification_read(db, current_user, notification_id)
    except NotificationNotFound as exc:
        raise HTTPException(status_code=404, detail="Notification not found") from exc
    return NotificationResponse.model_validate(serialize_notification(notification))


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def read_all_notifications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await mark_all_notifications_read(db, current_user)

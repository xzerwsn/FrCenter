import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User

router = APIRouter()


class FeedPublicationResponse(BaseModel):
    author_id: str
    author_username: str
    author_display_name: str | None
    author_avatar_url: str | None
    caption: str | None
    image_url: str


@router.get("", response_model=list[FeedPublicationResponse])
async def feed(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FeedPublicationResponse]:
    result = await db.execute(select(User).where(User.profile_photos.is_not(None)))
    users = result.scalars().all()
    publications: list[FeedPublicationResponse] = []
    for user in users:
        if not user.profile_photos:
            continue
        try:
            photos = json.loads(user.profile_photos)
        except json.JSONDecodeError:
            continue
        if not isinstance(photos, list):
            continue
        for item in photos:
            if isinstance(item, str) and item:
                publications.append(
                    FeedPublicationResponse(
                        author_id=user.id,
                        author_username=user.username,
                        author_display_name=user.display_name,
                        author_avatar_url=user.avatar_url,
                        caption=None,
                        image_url=item,
                    )
                )
                continue
            if isinstance(item, dict):
                url = item.get("url")
                if not isinstance(url, str) or not url:
                    continue
                caption = item.get("caption")
                publications.append(
                    FeedPublicationResponse(
                        author_id=user.id,
                        author_username=user.username,
                        author_display_name=user.display_name,
                        author_avatar_url=user.avatar_url,
                        caption=caption if isinstance(caption, str) else None,
                        image_url=url,
                    )
                )
    publications.reverse()
    return publications

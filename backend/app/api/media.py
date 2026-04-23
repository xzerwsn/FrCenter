from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.media_asset import MediaAsset
from app.models.user import User
from app.services.chat_service import NotChatMember, ensure_chat_member

router = APIRouter()


class MediaUploadResponse(BaseModel):
    media_id: str
    media_url: str
    size: int
    mime_type: str
    filename: str


@router.post("/upload", response_model=MediaUploadResponse)
async def upload_media(
    chat_id: str = Form(...),
    encrypted_file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MediaUploadResponse:
    try:
        await ensure_chat_member(db, current_user.id, chat_id)
    except NotChatMember as exc:
        raise HTTPException(status_code=403, detail="No access to this chat") from exc

    payload = await encrypted_file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Encrypted file is empty")
    if len(payload) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File is too large (max 25 MB)")

    media = MediaAsset(
        chat_id=chat_id,
        uploader_id=current_user.id,
        filename=encrypted_file.filename or "encrypted.bin",
        mime_type=encrypted_file.content_type or "application/octet-stream",
        size=len(payload),
        encrypted_bytes=payload,
    )
    db.add(media)
    await db.commit()
    await db.refresh(media)

    return MediaUploadResponse(
        media_id=media.id,
        media_url=f"{settings.backend_url}/api/media/{media.id}",
        size=media.size,
        mime_type="application/octet-stream",
        filename=media.filename,
    )


@router.get("/{media_id}")
async def download_media(
    media_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    result = await db.execute(select(MediaAsset).where(MediaAsset.id == media_id))
    media = result.scalar_one_or_none()
    if media is None:
        raise HTTPException(status_code=404, detail="Media not found")

    try:
        await ensure_chat_member(db, current_user.id, media.chat_id)
    except NotChatMember as exc:
        raise HTTPException(status_code=403, detail="No access to this media") from exc

    return Response(
        content=media.encrypted_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{media.filename}"'},
    )

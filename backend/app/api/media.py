import asyncio
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.media_asset import MediaAsset
from app.models.user import User
from app.services.chat_service import NotChatMember, ensure_chat_member
from app.storage.media_storage import MissingMediaObject, get_media_storage

router = APIRouter()


class MediaUploadResponse(BaseModel):
    media_id: str
    media_url: str
    media_path: str
    size: int
    mime_type: str
    filename: str


class PublicMediaUploadResponse(BaseModel):
    asset_url: str
    storage_key: str
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

    storage = get_media_storage()
    media_id = str(uuid4())
    try:
        storage_key, size = await storage.store_upload(media_id, encrypted_file, max_size_bytes=25 * 1024 * 1024)
    except Exception as exc:
        detail = exc.args[0] if exc.args else "Failed to store encrypted media"
        status_code = 413 if "too large" in detail.lower() else 500
        raise HTTPException(status_code=status_code, detail=detail) from exc
    if size == 0:
        storage.delete(storage_key)
        raise HTTPException(status_code=400, detail="Encrypted file is empty")
    media = MediaAsset(
        id=media_id,
        chat_id=chat_id,
        uploader_id=current_user.id,
        filename=encrypted_file.filename or "encrypted.bin",
        mime_type=encrypted_file.content_type or "application/octet-stream",
        size=size,
        storage_backend=settings.media_storage_backend,
        storage_key=storage_key,
    )
    db.add(media)
    try:
        await db.commit()
    except Exception:
        storage.delete(storage_key)
        raise
    await db.refresh(media)

    return MediaUploadResponse(
        media_id=media.id,
        media_url=f"{settings.backend_url}/api/media/{media.id}",
        media_path=f"/api/media/{media.id}",
        size=media.size,
        mime_type="application/octet-stream",
        filename=media.filename,
    )


@router.post("/public-upload", response_model=PublicMediaUploadResponse)
async def upload_public_media(
    file: UploadFile = File(...),
    category: str = Form("avatar"),
    current_user: User = Depends(get_current_user),
) -> PublicMediaUploadResponse:
    _ = current_user
    storage = get_media_storage()
    asset_id = str(uuid4())
    try:
        normalized_category = (category or "").strip().lower()
        storage_key, size = await storage.store_public_upload(
            asset_id,
            file,
            category=category,
            max_size_bytes=10 * 1024 * 1024,
            require_image=not normalized_category.startswith("notification-sound"),
        )
    except Exception as exc:
        detail = exc.args[0] if exc.args else "Failed to store public asset"
        status_code = 413 if "too large" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail) from exc
    if size == 0:
        storage.delete(storage_key)
        raise HTTPException(status_code=400, detail="Public asset is empty")

    return PublicMediaUploadResponse(
        asset_url=f"{settings.backend_url}/api/media/public/{storage_key}",
        storage_key=storage_key,
        size=size,
        mime_type=file.content_type or "application/octet-stream",
        filename=file.filename or Path(storage_key).name,
    )


@router.get("/{media_id}")
async def download_media(
    media_id: str,
    request: Request,
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

    etag = f'W/"{sha256(f"{media.id}:{media.size}:{media.created_at.isoformat()}".encode("utf-8")).hexdigest()}"'
    expires_at = (datetime.now(UTC) + timedelta(days=7)).strftime("%a, %d %b %Y %H:%M:%S GMT")
    if request.headers.get("if-none-match") == etag:
        return Response(
            status_code=304,
            headers={
                "ETag": etag,
                "Cache-Control": "private, max-age=604800, stale-while-revalidate=86400",
                "Expires": expires_at,
            },
        )

    headers = {
        "Content-Disposition": f'inline; filename="{media.filename}"',
        "Cache-Control": "private, max-age=604800, stale-while-revalidate=86400",
        "ETag": etag,
        "Expires": expires_at,
    }
    if media.storage_key:
        storage = get_media_storage()
        try:
            file_path = storage.resolve_path(media.storage_key)
        except MissingMediaObject as exc:
            if media.encrypted_bytes is None:
                raise HTTPException(status_code=404, detail="Media object missing") from exc
            return Response(content=media.encrypted_bytes, media_type="application/octet-stream", headers=headers)
        return FileResponse(
            file_path,
            media_type="application/octet-stream",
            filename=media.filename,
            headers=headers,
        )

    if media.encrypted_bytes is None:
        raise HTTPException(status_code=404, detail="Media object missing")

    return Response(content=media.encrypted_bytes, media_type="application/octet-stream", headers=headers)


@router.get("/public/{asset_path:path}")
async def download_public_media(asset_path: str) -> FileResponse:
    storage = get_media_storage()
    try:
        file_path = storage.resolve_path(asset_path)
    except MissingMediaObject as exc:
        raise HTTPException(status_code=404, detail="Public asset not found") from exc

    return FileResponse(
        file_path,
        headers={
            "Cache-Control": "public, max-age=2592000, immutable",
        },
    )

import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.user import User
from app.services.chat_service import NotChatMember, ensure_chat_member

router = APIRouter()

MEDIA_ROOT = Path(settings.media_storage_path).resolve() / "encrypted_media"
MEDIA_INDEX_PATH = MEDIA_ROOT / "index.json"


class MediaUploadResponse(BaseModel):
    media_id: str
    media_url: str
    size: int
    mime_type: str
    filename: str


def _load_media_index() -> dict[str, dict[str, str | int]]:
    if not MEDIA_INDEX_PATH.exists():
        return {}
    try:
        return json.loads(MEDIA_INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save_media_index(index: dict[str, dict[str, str | int]]) -> None:
    MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    MEDIA_INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")


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

    media_id = str(uuid4())
    stored_name = f"{media_id}.bin"
    MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    stored_path = MEDIA_ROOT / stored_name
    stored_path.write_bytes(payload)

    index = _load_media_index()
    index[media_id] = {
        "chat_id": chat_id,
        "stored_name": stored_name,
        "filename": encrypted_file.filename or "encrypted.bin",
        "mime_type": encrypted_file.content_type or "application/octet-stream",
        "size": len(payload),
    }
    _save_media_index(index)

    return MediaUploadResponse(
        media_id=media_id,
        media_url=f"{settings.backend_url}/api/media/{media_id}",
        size=len(payload),
        mime_type="application/octet-stream",
        filename=encrypted_file.filename or "encrypted.bin",
    )


@router.get("/{media_id}")
async def download_media(
    media_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    index = _load_media_index()
    payload = index.get(media_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Media not found")

    chat_id = str(payload["chat_id"])
    try:
        await ensure_chat_member(db, current_user.id, chat_id)
    except NotChatMember as exc:
        raise HTTPException(status_code=403, detail="No access to this media") from exc

    stored_name = str(payload["stored_name"])
    stored_path = MEDIA_ROOT / stored_name
    if not stored_path.exists():
        raise HTTPException(status_code=404, detail="Stored file not found")

    return FileResponse(
        path=stored_path,
        media_type="application/octet-stream",
        filename=str(payload.get("filename", "encrypted.bin")),
    )

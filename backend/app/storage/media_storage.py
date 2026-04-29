from __future__ import annotations

import asyncio
import mimetypes
import re
from pathlib import Path

from fastapi import UploadFile

from app.core.config import settings


class MediaStorageError(Exception):
    pass


class UnsupportedMediaStorage(MediaStorageError):
    pass


class MissingMediaObject(MediaStorageError):
    pass


class FilesystemMediaStorage:
    def __init__(self, root: Path) -> None:
        self._root = root

    async def store_upload(self, media_id: str, upload: UploadFile, *, max_size_bytes: int) -> tuple[str, int]:
        storage_key = self._build_storage_key(media_id)
        target_path = self.planned_path(storage_key)
        temp_path = target_path.with_suffix(".tmp")
        await asyncio.to_thread(target_path.parent.mkdir, parents=True, exist_ok=True)

        size = 0
        try:
            with temp_path.open("wb") as handle:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_size_bytes:
                        raise MediaStorageError("File is too large (max 25 MB)")
                    handle.write(chunk)
        except Exception:
            await asyncio.to_thread(_safe_unlink, temp_path)
            raise
        finally:
            await upload.close()

        await asyncio.to_thread(temp_path.replace, target_path)
        return storage_key, size

    async def store_public_upload(
        self,
        object_id: str,
        upload: UploadFile,
        *,
        category: str,
        max_size_bytes: int,
        require_image: bool = True,
    ) -> tuple[str, int]:
        category_key = _normalize_public_category(category)
        content_type = (upload.content_type or "").strip().lower()
        if require_image and not content_type.startswith("image/"):
            await upload.close()
            raise MediaStorageError("Only image uploads are supported")

        storage_key = self._build_public_storage_key(object_id, category_key, upload.filename, content_type)
        target_path = self.planned_path(storage_key)
        temp_path = target_path.with_suffix(f"{target_path.suffix}.tmp")
        await asyncio.to_thread(target_path.parent.mkdir, parents=True, exist_ok=True)

        size = 0
        try:
            with temp_path.open("wb") as handle:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_size_bytes:
                        raise MediaStorageError("File is too large (max 10 MB)")
                    handle.write(chunk)
        except Exception:
            await asyncio.to_thread(_safe_unlink, temp_path)
            raise
        finally:
            await upload.close()

        await asyncio.to_thread(temp_path.replace, target_path)
        return storage_key, size

    def resolve_path(self, storage_key: str) -> Path:
        return self._resolve_under_root(storage_key, require_exists=True)

    def planned_path(self, storage_key: str) -> Path:
        return self._resolve_under_root(storage_key, require_exists=False)

    def delete(self, storage_key: str) -> None:
        path = self._resolve_under_root(storage_key, require_exists=False)
        _safe_unlink(path)

    def _resolve_under_root(self, storage_key: str, *, require_exists: bool) -> Path:
        path = (self._root / storage_key).resolve()
        root = self._root.resolve()
        if root not in path.parents and path != root:
            raise MissingMediaObject
        if require_exists and not path.exists():
            raise MissingMediaObject
        return path

    def _build_storage_key(self, media_id: str) -> str:
        return str(Path("encrypted_media") / media_id[:2] / media_id[2:4] / f"{media_id}.bin")

    def _build_public_storage_key(
        self,
        object_id: str,
        category: str,
        original_filename: str | None,
        content_type: str,
    ) -> str:
        extension = _guess_public_extension(original_filename, content_type)
        return str(Path("avatars") / category / object_id[:2] / object_id[2:4] / f"{object_id}{extension}")


def get_media_storage() -> FilesystemMediaStorage:
    backend = settings.media_storage_backend.strip().lower()
    if backend != "filesystem":
        raise UnsupportedMediaStorage(f"Unsupported media storage backend: {settings.media_storage_backend}")
    root = Path(settings.media_storage_path).resolve()
    return FilesystemMediaStorage(root)


def _safe_unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except TypeError:
        if path.exists():
            path.unlink()


def _normalize_public_category(value: str) -> str:
    normalized = (value or "asset").strip().lower().replace(" ", "-")
    if not normalized or not re.fullmatch(r"[a-z0-9_-]{1,40}", normalized):
        raise MediaStorageError("Invalid public asset category")
    return normalized


def _guess_public_extension(original_filename: str | None, content_type: str) -> str:
    suffix = Path(original_filename or "").suffix.lower()
    if re.fullmatch(r"\.[a-z0-9]{1,10}", suffix):
        return suffix
    guessed = mimetypes.guess_extension(content_type or "") or ""
    if re.fullmatch(r"\.[a-z0-9]{1,10}", guessed):
        return guessed
    return ".bin"

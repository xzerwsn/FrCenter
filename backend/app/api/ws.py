from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from app.core.config import settings
from app.core.security import decode_access_token
from app.core.websocket import connection_manager
from app.db.session import AsyncSessionLocal
from app.models.user import User

try:
    import orjson
except ImportError:
    orjson = None

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str | None = None) -> None:
    cookie_token = websocket.cookies.get(settings.auth_cookie_name)
    user_id = await _authenticate_websocket(cookie_token or token)
    if user_id is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await connection_manager.connect(user_id, websocket)
    try:
        while True:
            raw_message = await websocket.receive_text()
            message = _decode_websocket_message(raw_message)
            if message.get("type") == "ping":
                await websocket.send_text(_encode_websocket_message({"type": "pong"}))
    except WebSocketDisconnect:
        connection_manager.disconnect(user_id, websocket)
    except Exception:
        connection_manager.disconnect(user_id, websocket)
        raise


async def _authenticate_websocket(token: str | None) -> str | None:
    if not token:
        return None

    user_id = decode_access_token(token)
    if user_id is None:
        return None

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User.id).where(User.id == user_id))
        return result.scalar_one_or_none()


def _decode_websocket_message(payload: str) -> dict:
    if orjson is not None:
        decoded = orjson.loads(payload)
        return decoded if isinstance(decoded, dict) else {}
    import json

    decoded = json.loads(payload)
    return decoded if isinstance(decoded, dict) else {}


def _encode_websocket_message(payload: dict) -> str:
    if orjson is not None:
        return orjson.dumps(payload).decode("utf-8")
    import json

    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)

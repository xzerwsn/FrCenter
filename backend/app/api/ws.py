from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from app.core.config import settings
from app.core.security import decode_access_token
from app.core.websocket import connection_manager
from app.db.session import AsyncSessionLocal
from app.models.user import User

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str | None = None) -> None:
    cookie_token = websocket.cookies.get(settings.auth_cookie_name)
    user = await _authenticate_websocket(cookie_token or token)
    if user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await connection_manager.connect(user.id, websocket)
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        connection_manager.disconnect(user.id, websocket)


async def _authenticate_websocket(token: str | None) -> User | None:
    if not token:
        return None

    user_id = decode_access_token(token)
    if user_id is None:
        return None

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

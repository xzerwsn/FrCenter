from collections import defaultdict
import asyncio

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[user_id].add(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        self._connections[user_id].discard(websocket)
        if not self._connections[user_id]:
            del self._connections[user_id]

    async def send_to_user(self, user_id: str, payload: dict) -> None:
        stale_connections: list[WebSocket] = []
        for websocket in self._connections.get(user_id, set()):
            try:
                await websocket.send_json(payload)
            except RuntimeError:
                stale_connections.append(websocket)

        for websocket in stale_connections:
            self.disconnect(user_id, websocket)

    async def broadcast_to_users(self, user_ids: list[str], payload: dict) -> None:
        await asyncio.gather(*(self.send_to_user(user_id, payload) for user_id in user_ids))


connection_manager = ConnectionManager()

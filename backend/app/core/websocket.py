from __future__ import annotations

import asyncio
import base64
import gzip
import json
from collections import defaultdict

from fastapi import WebSocket

try:
    import orjson
except ImportError:
    orjson = None


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._pending_payloads: dict[str, list[dict]] = defaultdict(list)
        self._flush_tasks: dict[str, asyncio.Task[None]] = {}
        self._batch_window_seconds = 0.03
        self._compression_threshold = 1024

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[user_id].add(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        self._connections[user_id].discard(websocket)
        if not self._connections[user_id]:
            self._connections.pop(user_id, None)
            self._pending_payloads.pop(user_id, None)
            task = self._flush_tasks.pop(user_id, None)
            if task is not None:
                task.cancel()

    async def send_to_user(self, user_id: str, payload: dict) -> None:
        if user_id not in self._connections:
            return
        self._pending_payloads[user_id].append(payload)
        if user_id not in self._flush_tasks:
            self._flush_tasks[user_id] = asyncio.create_task(self._flush_user_payloads(user_id))

    async def broadcast_to_users(self, user_ids: list[str], payload: dict) -> None:
        unique_user_ids = tuple(dict.fromkeys(user_ids))
        await asyncio.gather(*(self.send_to_user(user_id, payload) for user_id in unique_user_ids))

    async def _flush_user_payloads(self, user_id: str) -> None:
        try:
            await asyncio.sleep(self._batch_window_seconds)
            payloads = self._pending_payloads.pop(user_id, [])
            if not payloads:
                return
            connections = list(self._connections.get(user_id, set()))
            if not connections:
                return

            batch_payload = self._encode_bytes({"events": payloads})
            if len(payloads) == 1 and len(batch_payload) < self._compression_threshold:
                message_text = self._encode_text(payloads[0])
            elif len(batch_payload) >= self._compression_threshold:
                compressed = gzip.compress(batch_payload)
                message_text = self._encode_text(
                    {
                        "type": "batch.compressed",
                        "encoding": "gzip+base64",
                        "payload": base64.b64encode(compressed).decode("ascii"),
                    }
                )
            else:
                message_text = self._encode_text({"type": "batch", "events": payloads})

            stale_connections: list[WebSocket] = []
            for websocket in connections:
                try:
                    await websocket.send_text(message_text)
                except Exception:
                    stale_connections.append(websocket)

            for websocket in stale_connections:
                self.disconnect(user_id, websocket)
        finally:
            self._flush_tasks.pop(user_id, None)

    @staticmethod
    def _encode_bytes(payload: dict) -> bytes:
        if orjson is not None:
            return orjson.dumps(payload)
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    @classmethod
    def _encode_text(cls, payload: dict) -> str:
        return cls._encode_bytes(payload).decode("utf-8")


connection_manager = ConnectionManager()

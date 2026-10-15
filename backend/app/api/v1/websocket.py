"""
WebSocket — real-time run state broadcasting.
Frontend subscribes to /ws/runs/{run_id} for live progress updates.
"""
import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["websocket"])
logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages active WebSocket connections per run_id."""

    def __init__(self):
        self.active: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, run_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active[run_id].append(websocket)
        logger.info("WS connected: run_id=%s (total=%d)", run_id, len(self.active[run_id]))

    def disconnect(self, run_id: str, websocket: WebSocket):
        self.active[run_id] = [ws for ws in self.active[run_id] if ws != websocket]
        logger.info("WS disconnected: run_id=%s (remaining=%d)", run_id, len(self.active[run_id]))

    async def broadcast(self, run_id: str, message: dict[str, Any]):
        """Send message to all subscribers of a run."""
        dead = []
        for ws in self.active.get(run_id, []):
            try:
                await ws.send_text(json.dumps(message, default=str))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(run_id, ws)


manager = ConnectionManager()


@router.websocket("/ws/runs/{run_id}")
async def websocket_endpoint(websocket: WebSocket, run_id: str):
    await manager.connect(run_id, websocket)
    try:
        while True:
            # Keep connection alive; server pushes messages via manager.broadcast()
            data = await websocket.receive_text()
            # Handle ping/pong
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        manager.disconnect(run_id, websocket)

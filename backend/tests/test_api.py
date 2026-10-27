"""
Integration tests for the database-free FastAPI endpoints.
"""
import pytest
from httpx import AsyncClient, ASGITransport
from fastapi.testclient import TestClient

from app.main import app, server_instance_id
from app.agent.inspection import INSPECTION_TRACES
from app.api.v1.lineage_routes import _VIEW_GRAPHS, _VIEW_HISTORY, _VIEW_REDO
from app.api.v1.plan_routes import PLAN_SESSIONS
from app.api.v1.websocket import manager as websocket_manager


def test_runtime_identity_and_startup_clear_generated_state():
    PLAN_SESSIONS["stale"] = {}
    _VIEW_GRAPHS["stale"] = {}
    _VIEW_HISTORY["stale"] = []
    _VIEW_REDO["stale"] = []
    INSPECTION_TRACES["stale"] = None
    websocket_manager.active["stale"] = []

    with TestClient(app) as client:
        response = client.get("/api/runtime")

        assert response.status_code == 200
        assert response.json() == {"instance_id": server_instance_id}
        assert not PLAN_SESSIONS
        assert not _VIEW_GRAPHS
        assert not _VIEW_HISTORY
        assert not _VIEW_REDO
        assert not INSPECTION_TRACES
        assert not websocket_manager.active


@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "app" in data


@pytest.mark.asyncio
async def test_root_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "DS ModelForge" in data["message"]


def test_database_backed_routes_are_not_mounted():
    mounted_paths = {route.path for route in app.routes if hasattr(route, "path")}
    assert not mounted_paths.intersection({
        "/api/v1/auth/login",
        "/api/v1/connections",
        "/api/v1/runs",
        "/api/v1/catalog",
        "/api/v1/compress-json",
        "/api/v1/impact",
    })

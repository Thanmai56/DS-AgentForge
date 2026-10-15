"""
Integration tests for the database-free FastAPI endpoints.
"""
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


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

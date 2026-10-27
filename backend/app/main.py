"""Database-free FastAPI entry point."""
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from uuid import uuid4
from pathlib import Path
from dotenv import load_dotenv

# Automatically load .env from backend/ or project root
_root = Path(__file__).resolve().parent.parent.parent
load_dotenv(_root / "backend" / ".env")
load_dotenv(_root / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.api.v1.websocket import manager as websocket_manager, router as ws_router
from app.api.v1.plan_routes import PLAN_SESSIONS, router as plan_router
from app.api.v1.lineage_routes import (
    _VIEW_GRAPHS,
    _VIEW_HISTORY,
    _VIEW_REDO,
    router as lineage_router,
)
from app.agent.inspection import clear_inspection_traces


settings = get_settings()
server_instance_id = str(uuid4())


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None, None]:
    PLAN_SESSIONS.clear()
    _VIEW_GRAPHS.clear()
    _VIEW_HISTORY.clear()
    _VIEW_REDO.clear()
    clear_inspection_traces()
    websocket_manager.active.clear()
    yield


app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    description="AI Agent Tool for SAP Datasphere Semantic Layer Generation",
    lifespan=lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins if settings.allowed_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(ws_router)
app.include_router(plan_router, prefix="/api")
app.include_router(lineage_router, prefix="/api")


@app.get("/api/runtime", tags=["system"])
async def runtime_identity():
    return {"instance_id": server_instance_id}


@app.get("/health", tags=["system"])
async def health_check():
    return {
        "status": "ok",
        "app": settings.app_title,
        "version": settings.app_version,
        "env": settings.app_env,
    }


@app.get("/", tags=["system"])
async def root():
    return {
        "message": "Welcome to DS ModelForge API",
        "docs": "/docs",
        "health": "/health",
        "version": settings.app_version,
    }

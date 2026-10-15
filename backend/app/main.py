"""Database-free FastAPI entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.api.v1.websocket import router as ws_router


settings = get_settings()

app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    description="AI Agent Tool for SAP Datasphere Semantic Layer Generation",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins if settings.allowed_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The stateful API routers require the database-backed models and are not
# mounted in this database-free deployment.
app.include_router(ws_router)



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

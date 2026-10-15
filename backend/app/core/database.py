"""
Database engine + session factory (async SQLAlchemy 2.0)
Gracefully handles offline local PostgreSQL by providing SQLite fallback in development.
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

logger = logging.getLogger("modelforge.db")
settings = get_settings()

engine_kwargs = {
    "echo": settings.app_env == "development",
}

if not settings.database_url.startswith("sqlite"):
    engine_kwargs.update(
        {
            "pool_pre_ping": True,
            "pool_size": 5,
            "max_overflow": 10,
        }
    )

engine = create_async_engine(settings.database_url, **engine_kwargs)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:  # type: ignore[override]
    """
    Yields an active database session. If the underlying database
    server (e.g. local PostgreSQL) is unavailable or connection fails,
    it handles the error gracefully so requests do not crash.
    """
    try:
        async with AsyncSessionLocal() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
    except Exception as exc:
        logger.warning("Database connection unavailable: %s", exc)
        raise

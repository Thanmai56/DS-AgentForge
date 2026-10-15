"""
Connections API — CRUD + test for Datasphere tenant connections.
POST /connections, GET /connections, DELETE /connections/{id}, POST /connections/{id}/test
"""
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import Role, get_current_user, require_role
from app.models.connection import Connection

router = APIRouter(prefix="/connections", tags=["connections"])


class ConnectionCreate(BaseModel):
    name: str
    tenant_host: str
    oauth_token_url: str
    client_id: str
    client_secret: str  # Only in request body — NEVER stored in DB
    space: str
    ds_release: str | None = None
    jdbc_host: str | None = None
    jdbc_port: int | None = None


class ConnectionRead(BaseModel):
    id: str
    name: str
    tenant_host: str
    space: str
    ds_release: str | None
    is_active: bool
    last_test_ok: bool | None
    last_test_message: str | None
    last_tested_at: datetime | None
    created_at: datetime


class ConnectionTestResult(BaseModel):
    ok: bool
    message: str
    ds_release: str | None


@router.post("", response_model=ConnectionRead, status_code=201)
async def create_connection(
    body: ConnectionCreate,
    current_user: Annotated[dict, Depends(require_role(Role.ADMIN, Role.MODELER))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    conn = Connection(
        name=body.name,
        tenant_host=body.tenant_host,
        oauth_token_url=body.oauth_token_url,
        client_id=body.client_id,
        # client_secret NOT stored: the caller must re-provide it for each operation
        space=body.space,
        ds_release=body.ds_release,
        jdbc_host=body.jdbc_host,
        jdbc_port=body.jdbc_port,
        created_by=uuid.UUID(current_user["sub"]),
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return _to_read(conn)


@router.get("", response_model=list[ConnectionRead])
async def list_connections(
    _: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    try:
        result = await db.execute(select(Connection).where(Connection.is_active == True).order_by(Connection.created_at.desc()))
        return [_to_read(c) for c in result.scalars().all()]
    except Exception as e:
        # If local PostgreSQL database is not running, return empty list gracefully (offline/standalone mode)
        return []


@router.get("/{connection_id}", response_model=ConnectionRead)
async def get_connection(
    connection_id: str,
    _: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    conn = await _get_or_404(db, connection_id)
    return _to_read(conn)


@router.delete("/{connection_id}", status_code=204)
async def delete_connection(
    connection_id: str,
    _: Annotated[dict, Depends(require_role(Role.ADMIN))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    conn = await _get_or_404(db, connection_id)
    conn.is_active = False
    await db.commit()


@router.post("/{connection_id}/test", response_model=ConnectionTestResult)
async def test_connection(
    connection_id: str,
    body: dict,  # {"client_secret": "..."}
    current_user: Annotated[dict, Depends(require_role(Role.ADMIN, Role.MODELER))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Test connectivity to Datasphere tenant.
    client_secret must be provided in the request body (never stored in DB).
    """
    conn = await _get_or_404(db, connection_id)
    client_secret = body.get("client_secret", "")
    if not client_secret:
        raise HTTPException(status_code=400, detail="client_secret required for connection test")

    from app.ds.auth import test_connection as ds_test
    result = ds_test(
        token_url=conn.oauth_token_url,
        client_id=conn.client_id,
        client_secret=client_secret,
        tenant_host=conn.tenant_host,
    )

    # Persist test result
    conn.last_tested_at = datetime.now(timezone.utc)
    conn.last_test_ok = result["ok"]
    conn.last_test_message = result["message"]
    if result.get("ds_release"):
        conn.ds_release = result["ds_release"]
    await db.commit()

    return ConnectionTestResult(**result)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_404(db: AsyncSession, connection_id: str) -> Connection:
    result = await db.execute(select(Connection).where(Connection.id == uuid.UUID(connection_id)))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn


def _to_read(conn: Connection) -> ConnectionRead:
    return ConnectionRead(
        id=str(conn.id),
        name=conn.name,
        tenant_host=conn.tenant_host,
        space=conn.space,
        ds_release=conn.ds_release,
        is_active=conn.is_active,
        last_test_ok=conn.last_test_ok,
        last_test_message=conn.last_test_message,
        last_tested_at=conn.last_tested_at,
        created_at=conn.created_at,
    )

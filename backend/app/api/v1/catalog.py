"""
Catalog API — Browse, search, scan, and profile Datasphere space tables/views.
GET /catalog/tables, GET /catalog/tables/{id}, POST /catalog/scan, POST /catalog/tables/{id}/profile
"""
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, status
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import Role, get_current_user, require_role
from app.models.connection import Connection
from app.models.catalog import CatalogTable, CatalogColumn, CatalogProfile
from app.ds.reader import discover_space
from app.ds.profiler import profile_table
from app.agent.sap_dictionary import classify_column

router = APIRouter(prefix="/catalog", tags=["catalog"])


class ColumnRead(BaseModel):
    id: str
    table_id: str
    column_name: str
    data_type: str | None
    length: int | None
    scale: int | None
    is_nullable: bool
    is_key: bool
    position: int | None
    semantic_role: str | None
    business_name: str | None
    description: str | None
    classification_confidence: float | None
    classification_source: str | None
    is_pii: bool


class TableSummary(BaseModel):
    id: str
    connection_id: str
    space: str
    object_name: str
    object_type: str
    business_name: str | None
    description: str | None
    row_count: int | None
    column_count: int
    is_pii: bool
    is_remote: bool = False
    remote_source: str | None = None
    remote_object_name: str | None = None
    is_replicated: bool = False
    replication_status: str | None = None
    replication_mode: str | None = None
    existing_associations: list | None = None
    profile_status: str
    profiled_at: datetime | None
    discovered_at: datetime


class TableDetail(TableSummary):
    columns: list[ColumnRead]


class ScanRequest(BaseModel):
    connection_id: str
    client_secret: str  # provided in-memory for the JDBC connection


class ProfileRequest(BaseModel):
    connection_id: str
    client_secret: str


@router.get("/tables")
async def list_tables(
    connection_id: str | None = None,
    space: str | None = None,
    object_type: str | None = None,
    search: str | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: Annotated[dict, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
):
    """List catalog tables with optional filtering and search."""
    stmt = select(CatalogTable).options(selectinload(CatalogTable.columns))

    if connection_id:
        stmt = stmt.where(CatalogTable.connection_id == uuid.UUID(connection_id))
    if space:
        stmt = stmt.where(CatalogTable.space.ilike(f"%{space}%"))
    if object_type:
        stmt = stmt.where(CatalogTable.object_type == object_type.upper())
    if search:
        search_pattern = f"%{search}%"
        stmt = stmt.where(
            or_(
                CatalogTable.object_name.ilike(search_pattern),
                CatalogTable.business_name.ilike(search_pattern),
                CatalogTable.description.ilike(search_pattern),
            )
        )

    try:
        # Count total
        count_stmt = select(func.count(CatalogTable.id))
        if connection_id:
            count_stmt = count_stmt.where(CatalogTable.connection_id == uuid.UUID(connection_id))
        if space:
            count_stmt = count_stmt.where(CatalogTable.space.ilike(f"%{space}%"))
        if object_type:
            count_stmt = count_stmt.where(CatalogTable.object_type == object_type.upper())
        if search:
            count_stmt = count_stmt.where(
                or_(
                    CatalogTable.object_name.ilike(search_pattern),
                    CatalogTable.business_name.ilike(search_pattern),
                    CatalogTable.description.ilike(search_pattern),
                )
            )

        total_res = await db.execute(count_stmt)
        total = total_res.scalar() or 0

        stmt = stmt.order_by(CatalogTable.object_name).limit(limit).offset(offset)
        result = await db.execute(stmt)
        tables = result.scalars().all()

        items = []
        for t in tables:
            items.append({
                "id": str(t.id),
                "connection_id": str(t.connection_id),
                "space": t.space,
                "object_name": t.object_name,
                "object_type": t.object_type,
                "business_name": t.business_name,
                "description": t.description,
                "row_count": t.row_count,
                "column_count": len(t.columns),
                "is_pii": t.is_pii,
                "is_remote": getattr(t, "is_remote", False),
                "remote_source": getattr(t, "remote_source", None),
                "remote_object_name": getattr(t, "remote_object_name", None),
                "is_replicated": getattr(t, "is_replicated", False),
                "replication_status": getattr(t, "replication_status", "not_configured"),
                "replication_mode": getattr(t, "replication_mode", "none"),
                "existing_associations": getattr(t, "existing_associations", None),
                "profile_status": t.profile_status,
                "profiled_at": t.profiled_at,
                "discovered_at": t.discovered_at,
            })

        return {"items": items, "total": total, "limit": limit, "offset": offset}
    except Exception:
        return {"items": [], "total": 0, "limit": limit, "offset": offset}


@router.get("/tables/{table_id}")
async def get_table(
    table_id: str,
    current_user: Annotated[dict, Depends(get_current_user)] = None,
    db: AsyncSession = Depends(get_db),
):
    """Get full details of a catalog table including columns and their profile info."""
    stmt = (
        select(CatalogTable)
        .options(selectinload(CatalogTable.columns))
        .where(CatalogTable.id == uuid.UUID(table_id))
    )
    result = await db.execute(stmt)
    table = result.scalar_one_or_none()
    if not table:
        raise HTTPException(status_code=404, detail="Catalog table not found")

    columns = [
        {
            "id": str(c.id),
            "table_id": str(c.table_id),
            "column_name": c.column_name,
            "data_type": c.data_type,
            "length": c.length,
            "scale": c.scale,
            "is_nullable": c.is_nullable,
            "is_key": c.is_key,
            "position": c.position,
            "semantic_role": c.semantic_role,
            "business_name": c.business_name,
            "description": c.description,
            "classification_confidence": c.classification_confidence,
            "classification_source": c.classification_source,
            "is_pii": c.is_pii,
        }
        for c in sorted(table.columns, key=lambda x: x.position or 0)
    ]

    return {
        "id": str(table.id),
        "connection_id": str(table.connection_id),
        "space": table.space,
        "object_name": table.object_name,
        "object_type": table.object_type,
        "business_name": table.business_name,
        "description": table.description,
        "row_count": table.row_count,
        "column_count": len(table.columns),
        "is_pii": table.is_pii,
        "is_remote": getattr(table, "is_remote", False),
        "remote_source": getattr(table, "remote_source", None),
        "remote_object_name": getattr(table, "remote_object_name", None),
        "is_replicated": getattr(table, "is_replicated", False),
        "replication_status": getattr(table, "replication_status", "not_configured"),
        "replication_mode": getattr(table, "replication_mode", "none"),
        "existing_associations": getattr(table, "existing_associations", None),
        "profile_status": table.profile_status,
        "profiled_at": table.profiled_at,
        "discovered_at": table.discovered_at,
        "columns": columns,
    }


@router.post("/scan")
async def scan_catalog(
    body: ScanRequest,
    current_user: Annotated[dict, Depends(require_role(Role.ADMIN, Role.MODELER))],
    db: AsyncSession = Depends(get_db),
):
    """Trigger space metadata scan from Datasphere and persist catalog tables & columns."""
    conn_stmt = select(Connection).where(Connection.id == uuid.UUID(body.connection_id))
    conn_res = await db.execute(conn_stmt)
    conn = conn_res.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    try:
        discovery = discover_space(
            tenant_host=conn.tenant_host,
            space=conn.space,
            token_url=conn.oauth_token_url,
            client_id=conn.client_id,
            client_secret=body.client_secret,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Datasphere space discovery failed: {str(e)}",
        )

    scanned_tables = discovery.get("tables", [])
    now = datetime.now(timezone.utc)
    added_or_updated = 0

    for item in scanned_tables:
        obj_name = item["object_name"]
        existing_stmt = select(CatalogTable).where(
            CatalogTable.connection_id == conn.id,
            CatalogTable.object_name == obj_name,
        )
        existing_res = await db.execute(existing_stmt)
        existing = existing_res.scalar_one_or_none()

        if existing:
            existing.object_type = item["object_type"]
            existing.description = item.get("description")
            existing.schema_hash = item.get("schema_hash")
            existing.is_remote = item.get("is_remote", False)
            existing.remote_source = item.get("remote_source")
            existing.remote_object_name = item.get("remote_object_name")
            existing.is_replicated = item.get("is_replicated", False)
            existing.replication_status = item.get("replication_status")
            existing.replication_mode = item.get("replication_mode")
            existing.existing_associations = item.get("existing_associations")
            existing.discovered_at = now
            table_obj = existing
        else:
            table_obj = CatalogTable(
                connection_id=conn.id,
                space=conn.space,
                schema_name=item.get("schema_name", conn.space.upper()),
                object_name=obj_name,
                object_type=item["object_type"],
                description=item.get("description"),
                schema_hash=item.get("schema_hash"),
                is_remote=item.get("is_remote", False),
                remote_source=item.get("remote_source"),
                remote_object_name=item.get("remote_object_name"),
                is_replicated=item.get("is_replicated", False),
                replication_status=item.get("replication_status"),
                replication_mode=item.get("replication_mode"),
                existing_associations=item.get("existing_associations"),
                discovered_at=now,
            )
            db.add(table_obj)
            await db.flush()

        # Delete existing columns if refreshing
        if existing:
            await db.execute(
                CatalogColumn.__table__.delete().where(CatalogColumn.table_id == table_obj.id)
            )

        for col in item.get("columns", []):
            classified = classify_column(table_obj.object_name, col["column_name"], col.get("data_type"))
            new_col = CatalogColumn(
                table_id=table_obj.id,
                column_name=col["column_name"],
                data_type=col.get("data_type"),
                length=col.get("length"),
                scale=col.get("scale"),
                is_nullable=col.get("is_nullable", True),
                is_key=col.get("is_key", False),
                position=col.get("position"),
                semantic_role=classified.get("semantic_role"),
                business_name=classified.get("business_name"),
                description=classified.get("description"),
                classification_confidence=classified.get("confidence", 0.8),
                classification_source=classified.get("source", "dictionary"),
                is_pii=classified.get("is_pii", False),
            )
            db.add(new_col)
        added_or_updated += 1

    await db.commit()
    return {"status": "success", "scanned_count": added_or_updated}

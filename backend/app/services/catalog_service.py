"""
Catalog Service — retrieves table profiles from the DB catalog cache.
Used by agent nodes to get pre-fetched column/stat data without re-querying Datasphere.
Falls back to a live JDBC profile if the cache is empty.
"""
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


async def get_table_profile(connection_id: str, table_name: str) -> dict[str, Any]:
    """
    Return the pre-fetched profile for a table.
    Shape: {
      "table": str,
      "row_count": int,
      "columns": { col_name: { n_rows, n_dist, n_null, mn, mx, top_k, is_pii } }
    }
    """
    async with AsyncSessionLocal() as db:
        from app.models.catalog import CatalogTable, CatalogColumn, CatalogProfile

        # Get the table record
        result = await db.execute(
            select(CatalogTable)
            .where(CatalogTable.connection_id == connection_id)
            .where(CatalogTable.object_name == table_name)
        )
        table = result.scalar_one_or_none()

        if table is None:
            logger.warning("Catalog miss for table=%s conn=%s — returning empty profile", table_name, connection_id)
            return _empty_profile(table_name)

        # Get columns
        col_result = await db.execute(
            select(CatalogColumn).where(CatalogColumn.table_id == table.id)
        )
        columns = col_result.scalars().all()

        # Get profiles
        prof_result = await db.execute(
            select(CatalogProfile).where(CatalogProfile.table_id == table.id)
        )
        profiles = {str(p.column_id): p for p in prof_result.scalars().all()}

        col_dict: dict[str, Any] = {}
        for col in columns:
            prof = profiles.get(str(col.id))
            col_dict[col.column_name] = {
                "data_type": col.data_type,
                "is_key": col.is_key,
                "is_nullable": col.is_nullable,
                "semantic_role": col.semantic_role,
                "business_name": col.business_name,
                "is_pii": col.is_pii,
                # profile stats (may be None if not yet profiled)
                "n_rows": prof.n_rows if prof else None,
                "n_distinct": prof.n_distinct if prof else None,
                "n_null": prof.n_null if prof else None,
                "min_val": prof.min_val if prof else None,
                "max_val": prof.max_val if prof else None,
                "top_k": prof.top_k_values if prof else [],
                "key_duplicates": prof.key_duplicates if prof else None,
                "sampled": prof.sampled if prof else False,
            }

        return {
            "table": table_name,
            "object_type": table.object_type,
            "is_remote": getattr(table, "is_remote", False),
            "remote_source": getattr(table, "remote_source", None),
            "row_count": table.row_count or 0,
            "profile_status": table.profile_status,
            "columns": col_dict,
        }


async def get_tables_for_connection(connection_id: str) -> list[dict[str, Any]]:
    """Return all catalog table summaries for a connection."""
    async with AsyncSessionLocal() as db:
        from app.models.catalog import CatalogTable
        result = await db.execute(
            select(CatalogTable).where(CatalogTable.connection_id == connection_id)
        )
        tables = result.scalars().all()
        return [
            {
                "id": str(t.id),
                "object_name": t.object_name,
                "object_type": t.object_type,
                "business_name": t.business_name,
                "description": t.description,
                "row_count": t.row_count,
                "is_remote": getattr(t, "is_remote", False),
                "remote_source": getattr(t, "remote_source", None),
                "replication_status": getattr(t, "replication_status", "not_configured"),
                "profile_status": t.profile_status,
                "is_pii": t.is_pii,
            }
            for t in tables
        ]


def _empty_profile(table_name: str) -> dict[str, Any]:
    return {
        "table": table_name,
        "object_type": "TABLE",
        "is_remote": False,
        "remote_source": None,
        "row_count": 0,
        "profile_status": "not_found",
        "columns": {},
    }

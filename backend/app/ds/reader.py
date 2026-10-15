"""
Datasphere Space Reader — discovers tables/views/columns via HANA JDBC.
Writes to catalog_cache with schema_hash for incremental refresh.

JDBC driver (ngdbc.jar) must be placed at JDBC_DRIVER_PATH.
Read-only service user only — no DDL/DML ever issued.
"""
import hashlib
import logging
import os
from typing import Any

from app.core.config import get_settings
from app.ds.auth import get_token

settings = get_settings()
logger = logging.getLogger(__name__)

# ── JDBC connection management ────────────────────────────────────────────────

def _get_jdbc_connection(tenant_host: str, token_url: str, client_id: str, client_secret: str):
    """
    Open a JayDeBeApi JDBC connection to the Datasphere space SQL endpoint.
    Requires ngdbc.jar at JDBC_DRIVER_PATH.
    """
    try:
        import jaydebeapi  # type: ignore
    except ImportError:
        raise RuntimeError("JayDeBeApi not installed. Run: pip install JayDeBeApi JPype1")

    jar_path = settings.jdbc_driver_path
    if not os.path.exists(jar_path):
        raise FileNotFoundError(
            f"HANA JDBC driver not found at {jar_path}. "
            "Download ngdbc.jar from SAP Service Marketplace and place it at that path."
        )

    token = get_token(token_url, client_id, client_secret)
    jdbc_url = f"jdbc:sap://{tenant_host.replace('https://', '').rstrip('/')}:443"

    conn = jaydebeapi.connect(
        settings.jdbc_driver_class,
        jdbc_url,
        {"accessToken": token, "encrypt": "true", "sslValidateCertificate": "true"},
        jar_path,
    )
    return conn


def _compute_schema_hash(columns: list[dict]) -> str:
    """Deterministic hash of column names + types for change detection."""
    signature = "|".join(
        f"{c['column_name']}:{c['data_type']}" for c in sorted(columns, key=lambda x: x["column_name"])
    )
    return hashlib.md5(signature.encode()).hexdigest()


# ── Metadata discovery ────────────────────────────────────────────────────────

# ── Universal Metadata discovery queries ────────────────────────────────────────

UNIVERSAL_OBJECTS_QUERY = """
SELECT
    o.OBJECT_NAME,
    o.OBJECT_TYPE,
    o.SCHEMA_NAME,
    o.COMMENTS,
    CASE WHEN rt.OBJECT_NAME IS NOT NULL THEN 'TRUE' ELSE 'FALSE' END AS IS_REMOTE,
    rt.REMOTE_SOURCE_NAME,
    rt.REMOTE_OBJECT_NAME
FROM SYS.OBJECTS o
LEFT JOIN SYS.REMOTE_TABLES rt
    ON rt.SCHEMA_NAME = o.SCHEMA_NAME AND rt.OBJECT_NAME = o.OBJECT_NAME
WHERE o.SCHEMA_NAME = ?
ORDER BY o.OBJECT_TYPE, o.OBJECT_NAME
"""

REMOTE_SOURCES_QUERY = """
SELECT SOURCE_NAME, ADAPTER_NAME, CONNECTION_TYPE
FROM SYS.REMOTE_SOURCES
"""

REPLICATION_SUBSCRIPTIONS_QUERY = """
SELECT TABLE_NAME, REPLICATION_STATUS, REPLICATION_MODE, LAST_LOAD_DATE
FROM SYS.REPLICATION_SUBSCRIPTIONS
WHERE SCHEMA_NAME = ?
"""

REFERENTIAL_CONSTRAINTS_QUERY = """
SELECT CONSTRAINT_NAME,
       TABLE_NAME AS SOURCE_OBJECT,
       REFERENCED_TABLE_NAME AS TARGET_OBJECT
FROM SYS.REFERENTIAL_CONSTRAINTS
WHERE SCHEMA_NAME = ?
"""

TABLES_QUERY = """
SELECT
    TABLE_NAME AS OBJECT_NAME,
    'TABLE' AS OBJECT_TYPE,
    COMMENTS,
    'FALSE' AS IS_REMOTE,
    NULL AS REMOTE_SOURCE_NAME,
    NULL AS REMOTE_OBJECT_NAME
FROM SYS.TABLES
WHERE SCHEMA_NAME = ?
ORDER BY TABLE_NAME
"""

VIEWS_QUERY = """
SELECT
    VIEW_NAME AS OBJECT_NAME,
    'VIEW' AS OBJECT_TYPE,
    COMMENTS,
    'FALSE' AS IS_REMOTE,
    NULL AS REMOTE_SOURCE_NAME,
    NULL AS REMOTE_OBJECT_NAME
FROM SYS.VIEWS
WHERE SCHEMA_NAME = ?
ORDER BY VIEW_NAME
"""

COLUMNS_QUERY = """
SELECT
    COLUMN_NAME,
    DATA_TYPE_NAME AS DATA_TYPE,
    LENGTH,
    SCALE,
    IS_NULLABLE,
    POSITION,
    COMMENTS
FROM SYS.TABLE_COLUMNS
WHERE SCHEMA_NAME = ? AND TABLE_NAME = ?
ORDER BY POSITION
"""

KEY_COLUMNS_QUERY = """
SELECT COLUMN_NAME
FROM SYS.CONSTRAINTS c
JOIN SYS.CONSTRAINT_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
    AND c.SCHEMA_NAME = cc.SCHEMA_NAME
WHERE c.SCHEMA_NAME = ? AND c.TABLE_NAME = ? AND c.IS_PRIMARY_KEY = 'TRUE'
"""

ROW_COUNT_QUERY = "SELECT COUNT(*) FROM \"{schema}\".\"{table}\""


def _exec_query(conn, sql: str, params: list | None = None) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        if params:
            cur.execute(sql, params)
        else:
            cur.execute(sql)
        cols = [d[0].lower() for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def discover_space(
    tenant_host: str,
    space: str,
    token_url: str,
    client_id: str,
    client_secret: str,
) -> dict[str, Any]:
    """
    Universal object discovery across ALL Datasphere objects in space:
    Remote Tables, Local Tables, Graphical Views, SQL Views, Business Entities,
    Analytic Models, Transformation Flows, and Custom Objects.
    Enriched with replication status, remote source, and referential constraints.
    """
    logger.info("Starting universal space discovery: space=%s", space)
    conn = _get_jdbc_connection(tenant_host, token_url, client_id, client_secret)

    try:
        schema = space.upper()

        # 1. Attempt Universal Objects query; fallback to TABLES + VIEWS if restricted
        all_objects = []
        try:
            all_objects = _exec_query(conn, UNIVERSAL_OBJECTS_QUERY, [schema])
            logger.info("Discovered %d objects via SYS.OBJECTS in space=%s", len(all_objects), space)
        except Exception as exc:
            logger.warning("SYS.OBJECTS query unavailable (%s), falling back to TABLES + VIEWS", exc)
            tables = _exec_query(conn, TABLES_QUERY, [schema])
            views = _exec_query(conn, VIEWS_QUERY, [schema])
            all_objects = tables + views

        # 2. Discover replication subscriptions if available
        replication_map: dict[str, dict] = {}
        try:
            replications = _exec_query(conn, REPLICATION_SUBSCRIPTIONS_QUERY, [schema])
            for r in replications:
                tname = (r.get("table_name") or "").upper()
                replication_map[tname] = r
        except Exception as exc:
            logger.debug("Replication subscriptions not readable: %s", exc)

        # 3. Discover declared referential constraints / associations
        associations_by_table: dict[str, list[dict]] = {}
        try:
            constraints = _exec_query(conn, REFERENTIAL_CONSTRAINTS_QUERY, [schema])
            for c in constraints:
                src_tbl = (c.get("source_object") or "").upper()
                associations_by_table.setdefault(src_tbl, []).append(c)
        except Exception as exc:
            logger.debug("Referential constraints not readable: %s", exc)

        result_objects = []
        all_columns_flat = []

        for obj in all_objects:
            obj_name = obj.get("object_name") or obj.get("table_name")
            if not obj_name:
                continue

            # Query columns
            columns = []
            key_cols = set()
            try:
                columns = _exec_query(conn, COLUMNS_QUERY, [schema, obj_name])
                key_cols_rows = _exec_query(conn, KEY_COLUMNS_QUERY, [schema, obj_name])
                key_cols = {r["column_name"] for r in key_cols_rows}
            except Exception as e:
                logger.debug("Could not fetch columns for %s: %s", obj_name, e)

            enriched_cols = []
            for col in columns:
                enriched_cols.append({
                    **col,
                    "is_key": col.get("column_name") in key_cols,
                })
            all_columns_flat.extend(enriched_cols)

            is_remote_flag = str(obj.get("is_remote", "FALSE")).upper() in ("TRUE", "1")
            rep_info = replication_map.get(obj_name.upper(), {})

            # Canonical taxonomy classification
            raw_type = (obj.get("object_type") or "TABLE").upper()
            if is_remote_flag:
                canonical_type = "REMOTE_TABLE"
            elif "GRAPHICAL" in raw_type or "CALC" in raw_type:
                canonical_type = "GRAPHICAL_VIEW"
            elif "SQL" in raw_type:
                canonical_type = "SQL_VIEW"
            elif "ENTITY" in raw_type:
                canonical_type = "BUSINESS_ENTITY"
            elif "ANALYTIC" in raw_type or "CUBE" in raw_type:
                canonical_type = "ANALYTIC_MODEL"
            elif raw_type == "VIEW":
                canonical_type = "VIEW"
            else:
                canonical_type = "LOCAL_TABLE" if rep_info else "TABLE"

            result_objects.append({
                "object_name": obj_name,
                "object_type": canonical_type,
                "description": obj.get("comments"),
                "schema_name": schema,
                "is_remote": is_remote_flag,
                "remote_source": obj.get("remote_source_name"),
                "remote_object_name": obj.get("remote_object_name"),
                "is_replicated": bool(rep_info),
                "replication_status": rep_info.get("replication_status", "not_configured"),
                "replication_mode": rep_info.get("replication_mode", "none"),
                "existing_associations": associations_by_table.get(obj_name.upper(), []),
                "columns": enriched_cols,
                "schema_hash": _compute_schema_hash(enriched_cols) if enriched_cols else None,
            })

        logger.info("Universal discovery complete: %d objects in space=%s", len(result_objects), space)
        return {
            "tables": result_objects,
            "total": len(result_objects),
        }
    finally:
        conn.close()


def get_row_count(
    tenant_host: str,
    space: str,
    table_name: str,
    token_url: str,
    client_id: str,
    client_secret: str,
) -> int:
    """Get approximate row count for a table."""
    conn = _get_jdbc_connection(tenant_host, token_url, client_id, client_secret)
    try:
        sql = ROW_COUNT_QUERY.format(schema=space.upper(), table=table_name)
        rows = _exec_query(conn, sql)
        return rows[0].get("count(*)", 0) if rows else 0
    finally:
        conn.close()

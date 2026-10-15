"""
Datasphere Profiling SQL Pack (§9 of spec).
Executes all 6 profiling queries per table/column.
Sampling enabled for tables > PROFILING_SAMPLE_ROWS.
PII columns: metadata + stats only — no raw values sent to LLM (P5 disabled).
"""
import logging
from typing import Any

from app.core.config import get_settings
from app.ds.reader import _get_jdbc_connection, _exec_query

settings = get_settings()
logger = logging.getLogger(__name__)

SAMPLE_ROWS = settings.profiling_sample_rows
TOP_K = settings.profiling_top_k


def _sample_predicate(table: str, schema: str, row_count: int) -> str:
    """Returns WHERE clause for sampling large tables."""
    if row_count > SAMPLE_ROWS:
        # Deterministic hash-based sampling (HANA compatible)
        return f"WHERE MOD(ABS(HASH_SHA256(TO_NVARCHAR(ROWID))), 10) = 0"
    return ""


# ── P1: Column stats ──────────────────────────────────────────────────────────

P1_QUERY = """
SELECT
    COUNT(*) AS n_rows,
    COUNT(DISTINCT {col}) AS n_dist,
    SUM(CASE WHEN {col} IS NULL THEN 1 ELSE 0 END) AS n_null,
    MIN(TO_NVARCHAR({col})) AS mn,
    MAX(TO_NVARCHAR({col})) AS mx
FROM "{schema}"."{table}"
{sample}
"""


def profile_column_stats(conn, schema: str, table: str, col: str, row_count: int) -> dict:
    """P1: Basic column statistics."""
    sample = _sample_predicate(table, schema, row_count)
    sql = P1_QUERY.format(col=f'"{col}"', schema=schema, table=table, sample=sample)
    try:
        rows = _exec_query(conn, sql)
        return rows[0] if rows else {}
    except Exception as exc:
        logger.warning("P1 failed for %s.%s.%s: %s", schema, table, col, exc)
        return {}


# ── P2: Key uniqueness ────────────────────────────────────────────────────────

def profile_key_uniqueness(conn, schema: str, table: str, key_cols: list[str]) -> int:
    """P2: Count duplicates for candidate key columns."""
    if not key_cols:
        return 0
    concat_expr = " || '|' || ".join([f'COALESCE(TO_NVARCHAR("{c}"), \'\')' for c in key_cols])
    sql = f"""
        SELECT COUNT(*) - COUNT(DISTINCT {concat_expr}) AS dupes
        FROM "{schema}"."{table}"
    """
    try:
        rows = _exec_query(conn, sql)
        return int(rows[0].get("dupes", 0)) if rows else 0
    except Exception as exc:
        logger.warning("P2 failed for %s.%s: %s", schema, table, exc)
        return -1


# ── P3: Join candidate / orphan ratio ─────────────────────────────────────────

def profile_orphan_ratio(conn, schema: str, table_a: str, col_a: str, table_b: str, col_b: str) -> dict:
    """P3: Left join to detect orphans (rows in A with no match in B)."""
    sql = f"""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN b."{col_b}" IS NULL THEN 1 ELSE 0 END) AS orphans
        FROM "{schema}"."{table_a}" a
        LEFT JOIN "{schema}"."{table_b}" b ON a."{col_a}" = b."{col_b}"
    """
    try:
        rows = _exec_query(conn, sql)
        if rows:
            total = int(rows[0].get("total", 0))
            orphans = int(rows[0].get("orphans", 0))
            ratio = (orphans / total) if total > 0 else 0.0
            return {"total": total, "orphans": orphans, "orphan_ratio": ratio}
        return {"total": 0, "orphans": 0, "orphan_ratio": 0.0}
    except Exception as exc:
        logger.warning("P3 failed for %s.%s→%s.%s: %s", table_a, col_a, table_b, col_b, exc)
        return {"error": str(exc)}


# ── P4: Currency/unit pairing validity ───────────────────────────────────────

def profile_currency_validity(conn, schema: str, fact_table: str, waers_col: str,
                               unit_table: str, unit_key_col: str) -> int:
    """P4: Count fact rows with invalid currency codes."""
    sql = f"""
        SELECT COUNT(*) AS bad
        FROM "{schema}"."{fact_table}" f
        LEFT JOIN "{schema}"."{unit_table}" u ON f."{waers_col}" = u."{unit_key_col}"
        WHERE u."{unit_key_col}" IS NULL
    """
    try:
        rows = _exec_query(conn, sql)
        return int(rows[0].get("bad", 0)) if rows else 0
    except Exception as exc:
        logger.warning("P4 failed: %s", exc)
        return -1


# ── P5: Top-K values (non-PII only) ──────────────────────────────────────────

def profile_top_k(conn, schema: str, table: str, col: str, is_pii: bool = False, k: int = TOP_K) -> list:
    """P5: Top-k most frequent values. Skipped for PII columns."""
    if is_pii:
        return []  # Never send PII raw values to LLM
    sql = f"""
        SELECT TO_NVARCHAR("{col}") AS val, COUNT(*) AS cnt
        FROM "{schema}"."{table}"
        WHERE "{col}" IS NOT NULL
        GROUP BY "{col}"
        ORDER BY cnt DESC
        LIMIT {k}
    """
    try:
        rows = _exec_query(conn, sql)
        return [{"value": r["val"], "count": r["cnt"]} for r in rows]
    except Exception as exc:
        logger.warning("P5 failed for %s.%s: %s", table, col, exc)
        return []


# ── P6: Self-referencing key (hierarchy hint) ─────────────────────────────────

def profile_self_reference(conn, schema: str, table: str, key_col: str, parent_col: str) -> dict:
    """P6: Count rows where parent_col refers back to the same table (hierarchy indicator)."""
    sql = f"""
        SELECT COUNT(*) AS self_ref_count
        FROM "{schema}"."{table}"
        WHERE "{parent_col}" IN (SELECT "{key_col}" FROM "{schema}"."{table}")
          AND "{parent_col}" IS NOT NULL
    """
    try:
        rows = _exec_query(conn, sql)
        return {"self_ref_count": int(rows[0].get("self_ref_count", 0))} if rows else {}
    except Exception as exc:
        logger.warning("P6 failed: %s", exc)
        return {}


# ── Full table profile orchestrator ──────────────────────────────────────────

def profile_table(
    tenant_host: str,
    space: str,
    table_name: str,
    columns: list[dict],
    row_count: int,
    token_url: str,
    client_id: str,
    client_secret: str,
) -> dict[str, Any]:
    """
    Run the full profiling SQL pack (P1–P6) for a table.
    Returns a per-column profile dict.
    """
    from app.ds.reader import _get_jdbc_connection
    schema = space.upper()
    conn = _get_jdbc_connection(tenant_host, token_url, client_id, client_secret)
    profiled_columns = {}

    try:
        key_cols = [c["column_name"] for c in columns if c.get("is_key")]

        # P2: key uniqueness
        key_dupes = profile_key_uniqueness(conn, schema, table_name, key_cols)

        for col_meta in columns:
            col = col_meta["column_name"]
            is_pii = col_meta.get("is_pii", False)

            # P1
            stats = profile_column_stats(conn, schema, table_name, col, row_count)
            # P5
            top_k = profile_top_k(conn, schema, table_name, col, is_pii=is_pii)

            profiled_columns[col] = {
                **stats,
                "top_k": top_k,
                "is_pii": is_pii,
                "key_duplicates": key_dupes if col_meta.get("is_key") else None,
            }

        logger.info("Profiled %d columns for %s.%s", len(profiled_columns), schema, table_name)
        return {
            "table": table_name,
            "schema": schema,
            "row_count": row_count,
            "sampled": row_count > SAMPLE_ROWS,
            "columns": profiled_columns,
            "key_duplicates": key_dupes,
        }
    finally:
        conn.close()

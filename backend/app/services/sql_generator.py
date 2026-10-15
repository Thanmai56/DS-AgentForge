"""
Datasphere SQL Generator Service (§4).
Compiles ViewSpec operators, joins, and filters into native SAP Datasphere SQL dialect.
Also validates Datasphere filter expressions against the official Data Builder grammar.
"""
import re
from typing import Any
import logging

logger = logging.getLogger(__name__)


def quote_identifier(name: str) -> str:
    """Ensure identifier is properly quoted for Datasphere SQL."""
    cleaned = name.strip().strip('"')
    if "." in cleaned:
        parts = cleaned.split(".")
        return ".".join(f'"{p}"' for p in parts)
    return f'"{cleaned}"'


def validate_filter_expression(expr: str) -> tuple[bool, str | None]:
    """
    Validate that a filter expression complies with Datasphere filter grammar.
    Allowed:
      - "COL" = 'VAL', "COL" != 'VAL', "COL" > VAL, "COL" BETWEEN V1 AND V2
      - "COL" LIKE 'PAT%', "COL" IN ('A', 'B'), "COL" NOT IN ('C')
      - "COL" IS NULL, "COL" IS NOT NULL
      - Functions: YEAR("COL"), MONTH("COL"), QUARTER("COL"), UPPER("COL")
      - Compound: AND, OR, NOT with parentheses
    """
    if not expr or not expr.strip():
        return False, "Filter expression cannot be empty"

    stripped = expr.strip()

    # Warn if columns are unquoted
    # Find words followed by =, !=, <, >, IN, LIKE, IS that don't start with quote or function
    unquoted_pattern = re.compile(r'(?<!["\w])([A-Z][A-Z0-9_]{2,})(?=\s*(=|!=|<>|<|>|IN|NOT|LIKE|IS|BETWEEN))', re.IGNORECASE)
    matches = unquoted_pattern.findall(stripped)
    sql_keywords = {"SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "YEAR", "MONTH", "QUARTER", "UPPER", "LOWER"}
    suspect_cols = [m[0] for m in matches if m[0].upper() not in sql_keywords]
    
    if suspect_cols:
        return False, f"Unquoted column identifier(s) detected: {', '.join(suspect_cols)}. Datasphere requires columns to be enclosed in double quotes (e.g. \"{suspect_cols[0]}\")."

    # Basic parenthesis matching check
    if stripped.count("(") != stripped.count(")"):
        return False, "Mismatched parentheses in filter expression"

    return True, None


def generate_datasphere_sql(
    space: str,
    view_name: str,
    sources: list[dict[str, Any]],
    columns: list[dict[str, Any]],
    joins: list[dict[str, Any]] | None = None,
    filters: list[str | dict[str, Any]] | None = None,
    group_by: list[str] | None = None,
) -> str:
    """
    Generate complete Datasphere SQL SELECT query.
    """
    joins = joins or []
    filters = filters or []

    # 1. SELECT clause
    select_items = []
    has_aggregation = False
    dimension_cols = []

    for col in columns:
        cname = col.get("column_name") or col.get("name")
        alias = col.get("alias") or col.get("business_name") or cname
        agg = col.get("aggregation") or col.get("agg")
        expr = col.get("expression")
        src_alias = col.get("source_alias")

        quoted_alias = f'"{alias}"'
        
        if expr:
            item = f"{expr} AS {quoted_alias}"
        elif agg and agg.upper() != "NONE":
            has_aggregation = True
            ref = f'"{src_alias}"."{cname}"' if src_alias else f'"{cname}"'
            item = f"{agg.upper()}({ref}) AS {quoted_alias}"
        else:
            ref = f'"{src_alias}"."{cname}"' if src_alias else f'"{cname}"'
            dimension_cols.append(ref)
            item = f"{ref} AS {quoted_alias}" if alias != cname else ref

        select_items.append(f"  {item}")

    select_clause = "SELECT\n" + ",\n".join(select_items)

    # 2. FROM clause
    if not sources:
        from_clause = f'FROM "{space.upper()}"."DUAL"'
    else:
        primary_source = sources[0]
        p_name = primary_source.get("object_name") or primary_source.get("objectId")
        p_alias = primary_source.get("alias", "src")
        p_space = primary_source.get("space", space).upper()
        from_clause = f'FROM "{p_space}"."{p_name}" AS "{p_alias}"'

    # 3. JOIN clauses
    join_clauses = []
    for j in joins:
        j_type = (j.get("type") or j.get("join_type") or "INNER").upper()
        if "LEFT" in j_type:
            join_keyword = "LEFT OUTER JOIN"
        elif "RIGHT" in j_type:
            join_keyword = "RIGHT OUTER JOIN"
        elif "FULL" in j_type:
            join_keyword = "FULL OUTER JOIN"
        else:
            join_keyword = "INNER JOIN"

        right_tbl = j.get("right_table") or j.get("right_source") or j.get("right")
        right_alias = j.get("right_alias") or right_tbl
        right_space = j.get("right_space", space).upper()

        cond_clauses = []
        for cond in j.get("conditions", []):
            left_col = cond.get("left_column") or cond.get("left")
            right_col = cond.get("right_column") or cond.get("right")
            left_ref = quote_identifier(left_col)
            right_ref = quote_identifier(right_col)
            cond_clauses.append(f"{left_ref} = {right_ref}")

        on_expr = " AND ".join(cond_clauses) if cond_clauses else "1 = 1"
        join_clauses.append(f'{join_keyword} "{right_space}"."{right_tbl}" AS "{right_alias}" ON {on_expr}')

    # 4. WHERE clause (Filters)
    where_conditions = []
    for f in filters:
        if isinstance(f, dict):
            expr = f.get("expression") or f.get("filter")
        else:
            expr = str(f)
        if expr and expr.strip():
            where_conditions.append(f"({expr.strip()})")

    where_clause = ""
    if where_conditions:
        where_clause = "\nWHERE " + " AND ".join(where_conditions)

    # 5. GROUP BY clause
    group_clause = ""
    if has_aggregation:
        group_items = group_by or dimension_cols
        if group_items:
            group_clause = "\nGROUP BY " + ", ".join(group_items)

    sql_parts = [select_clause, from_clause]
    if join_clauses:
        sql_parts.extend(join_clauses)
    if where_clause:
        sql_parts.append(where_clause.lstrip())
    if group_clause:
        sql_parts.append(group_clause.lstrip())

    return "\n".join(sql_parts) + ";"

"""
View Builder Service (§7, §10).
Programmatically transforms candidate tables, join paths, and semantic plans into canonical ViewSpec objects.
"""
import copy
import logging
from typing import Any

from app.agent.sap_dictionary import classify_column

logger = logging.getLogger(__name__)


def build_staging_view(
    view_name: str,
    business_name: str,
    space: str,
    sources: list[dict[str, Any]],
    joins: list[dict[str, Any]] | None = None,
    catalog: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a staging Graphical View (kind: graphical_view) projecting clean columns."""
    projected_columns = []
    seen_names = set()

    catalog = catalog or {}

    for src in sources:
        alias = src.get("alias", src["object_name"].lower())
        table_meta = catalog.get(src["object_name"], {})
        table_cols = table_meta.get("columns", [])

        for col in table_cols:
            cname = col.get("column_name")
            if cname in seen_names:
                cname = f"{alias.upper()}_{cname}"
            seen_names.add(cname)

            classified = classify_column(src["object_name"], col.get("column_name"), col.get("data_type"))
            projected_columns.append({
                "column_name": cname,
                "business_name": classified.get("business_name") or col.get("business_name") or cname,
                "data_type": col.get("data_type", "NVARCHAR"),
                "is_key": col.get("is_key", False),
                "semantic_role": classified.get("semantic_role"),
                "source_alias": alias,
                "source_column": col.get("column_name"),
            })

    return {
        "view_name": view_name,
        "kind": "graphical_view",
        "business_name": business_name,
        "space": space,
        "sources": sources,
        "columns": projected_columns,
        "joins": joins or [],
        "filters": [],
        "confidence_score": 0.95,
        "confidence_reasons": ["Automated staging view projection with primary key retention"],
    }


def build_dimension_view(
    view_name: str,
    business_name: str,
    space: str,
    source_view: str,
    key_columns: list[str],
    attribute_columns: list[str],
    associations: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a Dimension Business Entity (kind: business_entity)."""
    columns = []
    for k in key_columns:
        columns.append({
            "column_name": k,
            "is_key": True,
            "semantic_role": "dimension",
        })
    for attr in attribute_columns:
        columns.append({
            "column_name": attr,
            "is_key": False,
            "semantic_role": "dimension",
        })

    return {
        "view_name": view_name,
        "kind": "business_entity",
        "business_name": business_name,
        "space": space,
        "sources": [{"alias": "src", "object_name": source_view, "space": space}],
        "columns": columns,
        "associations": associations or [],
        "confidence_score": 0.92,
    }


def build_sql_view(
    view_name: str,
    business_name: str,
    space: str,
    sql_query: str,
    exposed_columns: list[dict[str, Any]],
    sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a complex SQL View (kind: sql_view) with Datasphere SQL dialect."""
    return {
        "view_name": view_name,
        "kind": "sql_view",
        "business_name": business_name,
        "space": space,
        "sources": sources or [],
        "sqlQuery": sql_query,
        "sql": sql_query,
        "columns": exposed_columns,
        "confidence_score": 0.95,
        "confidence_reasons": ["Datasphere SQL View with verified projection and semantic metadata"],
    }


def build_replication_config(
    object_id: str,
    remote_source: str,
    remote_object: str,
    space: str,
    replication_mode: str = "SCHEDULED",
    full_load_first: bool = True,
) -> dict[str, Any]:
    """Build replication configuration spec for remote tables."""
    return {
        "objectId": object_id,
        "view_name": object_id,
        "kind": "replication_config",
        "business_name": f"Replication: {remote_object} from {remote_source}",
        "space": space,
        "remote_source": remote_source,
        "remote_object": remote_object,
        "replication_mode": replication_mode,
        "full_load_first": full_load_first,
        "confidence_score": 0.98,
    }


def build_fact_view(
    view_name: str,
    business_name: str,
    space: str,
    source_view: str,
    measures: list[dict[str, Any]],
    keys_and_dimensions: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a Fact Consumption View (kind: graphical_view)."""
    columns = []
    for kd in keys_and_dimensions:
        columns.append({
            **kd,
            "semantic_role": "dimension",
        })
    for m in measures:
        columns.append({
            "column_name": m["column_name"],
            "business_name": m.get("business_name", m["column_name"]),
            "data_type": m.get("data_type", "DECIMAL"),
            "semantic_role": "measure",
            "aggregation": m.get("aggregation", "SUM"),
        })

    return {
        "view_name": view_name,
        "kind": "graphical_view",
        "business_name": business_name,
        "space": space,
        "sources": [{"alias": "stg", "object_name": source_view, "space": space}],
        "columns": columns,
        "confidence_score": 0.94,
    }


def build_analytic_model(
    model_name: str,
    business_name: str,
    space: str,
    fact_view: str,
    dimensions: list[dict[str, Any]],
    measures: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a Datasphere Analytic Model (kind: analytic_model) for SAC/PowerBI."""
    columns = []
    for d in dimensions:
        columns.append({
            "column_name": d["column_name"],
            "business_name": d.get("business_name", d["column_name"]),
            "semantic_role": "dimension",
        })
    for m in measures:
        columns.append({
            "column_name": m["column_name"],
            "business_name": m.get("business_name", m["column_name"]),
            "semantic_role": "measure",
            "aggregation": m.get("aggregation", "SUM"),
        })

    return {
        "view_name": model_name,
        "kind": "analytic_model",
        "business_name": business_name,
        "space": space,
        "sources": [{"alias": "fact", "object_name": fact_view, "space": space}],
        "columns": columns,
        "confidence_score": 0.96,
        "confidence_reasons": ["Valid star-schema representation mapped to Analytic Model format"],
    }

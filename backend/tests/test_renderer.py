"""
Unit tests for formatlib renderer.py.
Verifies ViewSpec converts to DS native structures predictably.
"""
import pytest
from formatlib.v1_scaffold.renderer import render_datasphere_object
from app.services.ds_native_renderer import render_ds_native
from app.services.replication_builder import generate_replication_spec, plan_replication_strategy


def test_render_graphical_view():
    view_spec = {
        "view_name": "V_SALES_FACT",
        "kind": "graphical_view",
        "business_name": "Sales Fact View",
        "description": "Aggregated sales facts",
        "space": "SALES_SPACE",
        "sources": [{"alias": "orders", "object_name": "VBAK", "space": "SALES_SPACE"}],
        "columns": [
            {"column_name": "VBELN", "business_name": "Sales Document", "data_type": "NVARCHAR", "is_key": True},
            {"column_name": "NETWR", "business_name": "Net Value", "data_type": "DECIMAL", "is_key": False}
        ],
        "associations": [],
        "filters": []
    }

    result = render_datasphere_object(view_spec, release="2024.Q3")
    assert result is not None
    assert "data" in result or "version" in result or "name" in result or "view" in result
    # Validate structure contains key metadata
    assert result.get("name") == "V_SALES_FACT" or "V_SALES_FACT" in str(result)


def test_render_analytic_model():
    view_spec = {
        "view_name": "AM_SALES_OVERVIEW",
        "kind": "analytic_model",
        "business_name": "Sales Analytics Model",
        "space": "SALES_SPACE",
        "sources": [{"alias": "fact", "object_name": "V_SALES_FACT", "space": "SALES_SPACE"}],
        "columns": [
            {"column_name": "VBELN", "semantic_role": "dimension", "is_key": True},
            {"column_name": "NETWR", "semantic_role": "measure", "aggregation": "SUM"}
        ],
        "associations": []
    }

    result = render_datasphere_object(view_spec)
    assert result is not None
    assert "AM_SALES_OVERVIEW" in str(result)


def test_render_replication_config_does_not_emit_delta_column():
    spec = {
        "objectId": "ORDERS_LOCAL",
        "kind": "replication_config",
        "remote_source": "REMOTE_SOURCE",
        "remote_object": "ORDERS",
        "target_local_table": "ORDERS_LOCAL",
        "delta_column": "CHANGED_AT",
    }
    result = render_datasphere_object(spec)
    native_result = render_ds_native(spec)

    assert "deltaColumn" not in result["content"]
    assert "deltaColumn" not in native_result
    assert all("deltaColumn" not in node.get("data", {}) for node in native_result["canvas"]["nodes"])


def test_replication_specs_do_not_detect_or_emit_delta_columns():
    strategy = plan_replication_strategy(
        "ORDERS",
        200001,
        True,
    )
    spec = generate_replication_spec(
        "REMOTE_SOURCE",
        "ORDERS",
        "SPACE",
        columns=[{"column_name": "AEDAT"}],
    )

    assert strategy["mode"] == "SNAPSHOT"
    assert "delta_column" not in strategy
    assert "delta_column" not in spec

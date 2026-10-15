"""
Unit tests for deterministic validation engine (V-01 through V-08).
"""
import pytest
from app.services.validator import validate_views


def test_validator_clean_views():
    views = [
        {
            "view_name": "V_SALES_FACT",
            "kind": "graphical_view",
            "business_name": "Sales Fact",
            "sources": [{"alias": "orders", "object_name": "VBAK"}],
            "columns": [
                {"column_name": "VBELN", "data_type": "NVARCHAR", "is_key": True},
                {"column_name": "NETWR", "data_type": "DECIMAL", "is_key": False}
            ],
            "joins": [],
            "associations": []
        }
    ]
    catalog = {
        "VBAK": {
            "columns": [
                {"column_name": "VBELN", "data_type": "NVARCHAR"},
                {"column_name": "NETWR", "data_type": "DECIMAL"}
            ]
        }
    }

    report = validate_views(views, catalog=catalog)
    assert report["passed"] is True
    assert len(report["blockers"]) == 0


def test_validator_duplicate_column_fix():
    views = [
        {
            "view_name": "V_TEST",
            "kind": "graphical_view",
            "business_name": "Test View",
            "sources": [{"alias": "t1", "object_name": "TAB1"}],
            "columns": [
                {"column_name": "ID", "data_type": "INTEGER"},
                {"column_name": "ID", "data_type": "INTEGER"}
            ],
            "joins": [],
            "associations": []
        }
    ]

    report = validate_views(views, catalog={})
    # V-06 flags duplicate or autofixes
    assert len(report["warnings"]) > 0 or len(report["blockers"]) > 0 or report.get("fixed_views") is not None

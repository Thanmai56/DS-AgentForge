"""
Unit tests for Step 2: Light In-Memory Data Profiler (DuckDB + pandas).
Tests:
- Row counts, distinct counts, null counts, low-cardinality values
- Key match % and cardinality (1:1, 1:N) calculation
- Evidence sentence generation for prompt quoting
- Profile fallback when no mock data is provided
- Sample rows formatting
"""
import pytest
import pandas as pd

from app.agent.cds_extractor import parse_csn_metadata
from app.agent.profiler import profile_data, DataProfile


def test_profiler_with_mock_csv_data():
    """Verify DuckDB computes exact row counts, distinct counts, key match %, and 1:N cardinality."""
    metadata = parse_csn_metadata({
        "definitions": {
            "ZIPOHDRAPT": {
                "kind": "entity",
                "elements": {
                    "PURCHASEORDER": {"type": "cds.String", "key": True},
                    "COMPANYCODE": {"type": "cds.String"},
                    "SUPPLIER": {"type": "cds.String"},
                },
            },
            "ZIPOHISTEXT": {
                "kind": "entity",
                "elements": {
                    "PURCHASEORDER": {"type": "cds.String", "key": True},
                    "GOODSMOVEMENTTYPE": {"type": "cds.String"},
                    "DELIVERYDATE": {"type": "cds.String"},
                },
            },
        }
    })

    # Header has 3 unique POs (1:1 per PO)
    header_csv = """PURCHASEORDER,COMPANYCODE,SUPPLIER
PO100,1000,SUP_A
PO200,1000,SUP_B
PO300,2000,SUP_C
"""

    # History has multiple items for PO100, PO200 (1:N per PO)
    history_csv = """PURCHASEORDER,GOODSMOVEMENTTYPE,DELIVERYDATE
PO100,101,20260115
PO100,101,20260120
PO100,102,20260122
PO200,101,20260201
PO200,101,20260205
PO400,101,20260301
"""

    tables_data = {
        "ZIPOHDRAPT": header_csv,
        "ZIPOHISTEXT": history_csv,
    }

    profile: DataProfile = profile_data(metadata, tables_data)

    assert profile.has_mock_data is True
    assert "ZIPOHDRAPT" in profile.tables
    assert "ZIPOHISTEXT" in profile.tables

    # 1. Row counts
    assert profile.tables["ZIPOHDRAPT"].row_count == 3
    assert profile.tables["ZIPOHISTEXT"].row_count == 6

    # 2. Distinct counts & low cardinality
    hdr_cols = profile.tables["ZIPOHDRAPT"].columns
    assert hdr_cols["PURCHASEORDER"].distinct_count == 3
    assert hdr_cols["COMPANYCODE"].distinct_count == 2
    assert hdr_cols["COMPANYCODE"].is_low_cardinality is True
    assert set(hdr_cols["COMPANYCODE"].low_cardinality_values) == {"1000", "2000"}

    hist_cols = profile.tables["ZIPOHISTEXT"].columns
    assert hist_cols["GOODSMOVEMENTTYPE"].distinct_count == 2
    assert set(hist_cols["GOODSMOVEMENTTYPE"].low_cardinality_values) == {"101", "102"}

    # 3. Join Candidate Profiling: PO100 and PO200 match out of PO100, PO200, PO300 = 66.7%
    assert len(profile.joins) == 1
    join_info = profile.joins[0]
    assert join_info.col_a == "PURCHASEORDER"
    assert join_info.match_pct_a_to_b == 66.67
    assert join_info.max_rows_per_key_a == 1
    assert join_info.max_rows_per_key_b == 3  # PO100 has 3 rows in history
    assert join_info.cardinality == "1:N"

    # 4. Evidence sentence must quote key match and cardinality
    assert "66.7%" in join_info.evidence_sentence
    assert "1:N" in join_info.evidence_sentence
    assert "up to 3 rows per key" in join_info.evidence_sentence

    # 5. Formatted text output
    text_profile = profile.to_text()
    assert "=== DATA PROFILE ===" in text_profile
    assert "TABLE ZIPOHDRAPT: 3 rows" in text_profile
    assert "TABLE ZIPOHISTEXT: 6 rows" in text_profile
    assert "JOIN CANDIDATES & CARDINALITY EVIDENCE:" in text_profile

    # 6. Sample rows
    sample_text = profile.sample_rows_text()
    assert "=== SAMPLE ROWS ===" in sample_text
    assert "PO100" in sample_text


def test_profiler_without_mock_data():
    """Verify fallback to metadata-inferred profile when no mock CSV is provided."""
    metadata = parse_csn_metadata({
        "definitions": {
            "ORDERS": {
                "kind": "entity",
                "elements": {
                    "ORDER_ID": {"type": "cds.String", "key": True},
                    "CUSTOMER_ID": {"type": "cds.String"},
                },
            },
            "ITEMS": {
                "kind": "entity",
                "elements": {
                    "ORDER_ID": {"type": "cds.String"},
                    "ITEM_NO": {"type": "cds.Integer", "key": True},
                },
            },
        }
    })

    profile: DataProfile = profile_data(metadata, tables_data=None)

    assert profile.has_mock_data is False
    assert "ORDERS" in profile.tables
    assert "ITEMS" in profile.tables

    # Inferred join candidate on ORDER_ID
    assert len(profile.joins) == 1
    join_info = profile.joins[0]
    assert join_info.col_a == "ORDER_ID"
    assert join_info.cardinality == "1:N"

    # Formatted text indicates metadata inference
    text_profile = profile.to_text()
    assert "[METADATA-INFERRED PROFILE" in text_profile
    assert "TABLE/VIEW ORDERS: (row count unknown)" in text_profile

    sample_text = profile.sample_rows_text()
    assert "No sample rows available" in sample_text

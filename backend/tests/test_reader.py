"""
Unit tests for Datasphere Space Reader schema hashing and discovery helpers (§8).
"""
import pytest
from app.ds.reader import _compute_schema_hash


def test_schema_hash_determinism():
    cols_1 = [
        {"column_name": "VBELN", "data_type": "NVARCHAR"},
        {"column_name": "NETWR", "data_type": "DECIMAL"},
    ]
    # Same columns in reverse order should yield the same hash
    cols_2 = [
        {"column_name": "NETWR", "data_type": "DECIMAL"},
        {"column_name": "VBELN", "data_type": "NVARCHAR"},
    ]

    hash_1 = _compute_schema_hash(cols_1)
    hash_2 = _compute_schema_hash(cols_2)

    assert hash_1 == hash_2
    assert len(hash_1) == 32


def test_schema_hash_detects_changes():
    cols_original = [
        {"column_name": "VBELN", "data_type": "NVARCHAR"},
    ]
    cols_modified = [
        {"column_name": "VBELN", "data_type": "VARCHAR"},
    ]

    assert _compute_schema_hash(cols_original) != _compute_schema_hash(cols_modified)

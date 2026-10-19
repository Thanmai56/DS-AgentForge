"""
Unit Tests for Step 2 & 3: inspection.py and /inspect API.

Verifies:
1. Metadata inspection stage records objects, types, column counts, keys, filter capabilities
2. Compaction stage records retained vs omitted attributes and character counts
3. Sample mapping stage records mapped tables, row counts, unknown columns, and malformed rows
4. End-to-end trace correlation via request_id and plan_id
5. Redaction of sensitive API keys and tokens in trace prompts and responses
6. Development inspection endpoint GET /api/plan/{id}/inspect (JSON and ?format=text)
7. POST /api/plan with pasted sample data populates inspection trace
Runs 100% offline with fake metadata (no DB, network, or real API key).
"""
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.agent.cds_extractor import ExtractedMetadata, CDSObject, ColumnMeta, parse_csn_metadata
from app.agent.sample_mapper import parse_and_map_sample_data
from app.agent.llm_provider import FakeLLMProvider
from app.agent.inspection import (
    InspectionTrace,
    record_metadata_stage,
    record_compaction_stage,
    record_sample_mapping_stage,
    save_inspection_trace,
    get_inspection_trace,
    clear_inspection_traces,
    _redact_sensitive_text,
)

client = TestClient(app)

FIXTURE_PATH = Path(__file__).parent.parent.parent / "fixtures" / "reference" / "F_PO_PROCESSING_TIME_APT (1).json"


@pytest.fixture(autouse=True)
def clean_traces(monkeypatch):
    """Ensure in-memory traces and sessions are isolated."""
    clear_inspection_traces()
    monkeypatch.setenv("LLM_PROVIDER", "fake")
    from app.api.v1 import plan_routes
    monkeypatch.setattr(plan_routes, "get_llm_provider", lambda *args, **kwargs: FakeLLMProvider())


@pytest.fixture
def fake_metadata() -> ExtractedMetadata:
    meta = ExtractedMetadata(source_filename="test_source.json")
    meta.objects["EKET"] = CDSObject(
        name="EKET",
        object_type="table",
        label="PO Scheduling Line",
        columns={
            "EBELN": ColumnMeta(name="EBELN", data_type="NVARCHAR(10)", is_key=True, label="Purchasing Document"),
            "EBELP": ColumnMeta(name="EBELP", data_type="NUMC(5)", is_key=True, label="Item Number"),
            "MENGE": ColumnMeta(name="MENGE", data_type="DECIMAL(13,3)", is_measure=True, label="Scheduled Quantity"),
        },
        keys=["EBELN", "EBELP"],
        measures=["MENGE"],
    )
    meta.parsing_warnings.append("Sample warning for testing.")
    meta.unsupported_structures.append("Omitted non-entity CDS type.")
    return meta


def test_metadata_inspection_stage(fake_metadata):
    """Verify metadata inspection extracts complete technical and descriptive schema."""
    stage = record_metadata_stage(fake_metadata, filename="test_source.json")

    assert stage.filename == "test_source.json"
    assert stage.parsing_status == "warnings"
    assert stage.total_objects_discovered == 1
    assert len(stage.discovered_objects) == 1

    obj = stage.discovered_objects[0]
    assert obj.name == "EKET"
    assert obj.object_type == "table"
    assert obj.column_count == 3
    assert obj.keys == ["EBELN", "EBELP"]

    # Verify column details
    col_map = {c.name: c for c in obj.columns}
    assert col_map["EBELN"].is_key is True
    assert col_map["EBELN"].filter_capable is True
    assert col_map["MENGE"].is_measure is True

    # Verify warnings and unsupported structures
    assert "Sample warning for testing." in stage.parsing_warnings
    assert "Omitted non-entity CDS type." in stage.unsupported_structures


def test_compaction_inspection_stage(fake_metadata):
    """Verify compaction stage records retained vs omitted attributes and character counts."""
    stage = record_compaction_stage(fake_metadata)

    assert "EKET" in stage.retained_objects
    assert len(stage.omitted_attributes) > 0
    assert stage.compact_text_chars > 0
    assert "[TABLE] EKET" in stage.compact_text_preview


def test_sample_mapping_inspection_stage(fake_metadata):
    """Verify sample mapping stage logs mapped tables, row counts, and warnings."""
    sample_text = """
    EBELN,EBELP,UNKNOWN_COL
    4500000001,00010,EXTRA_VAL
    MALFORMED_LINE_ONE_COL
    """
    mapping_res = parse_and_map_sample_data(sample_text, fake_metadata, row_limit=5)
    stage = record_sample_mapping_stage(mapping_res)

    assert stage.has_samples is True
    assert stage.mapped_tables == ["EKET"]
    assert stage.total_rows_parsed == 2
    assert stage.total_rows_retained == 1
    assert "UNKNOWN_COL" in stage.unknown_columns["EKET"]
    assert stage.malformed_rows_count == 1
    assert len(stage.warnings) > 0


def test_sensitive_text_redaction():
    """Verify API keys, bearer tokens, and credentials are redacted."""
    sensitive_prompt = "Using key sk-testdummy1234567890abcdef12345 and Bearer eyJhbGciOiJIUzI1Ni.secret and AQ.testdummykey1234567890abcdefghijklmnopqrstuvwxyz12"
    redacted = _redact_sensitive_text(sensitive_prompt)

    assert "sk-" not in redacted
    assert "AQ." not in redacted
    assert "[REDACTED_API_KEY]" in redacted
    assert "[REDACTED_TOKEN]" in redacted


def test_trace_save_and_retrieve():
    """Verify InspectionTrace is saved and retrievable by request_id and plan_id."""
    trace = InspectionTrace(
        request_id="req-12345",
        plan_id="plan-67890",
        timestamp="2026-10-16T00:00:00Z",
        requirement="Compute PO APT",
    )
    save_inspection_trace(trace)

    by_req = get_inspection_trace("req-12345")
    assert by_req is not None
    assert by_req.request_id == "req-12345"

    by_plan = get_inspection_trace("plan-67890")
    assert by_plan is not None
    assert by_plan.plan_id == "plan-67890"

    # Human readable summary test
    summary = trace.to_human_readable_summary()
    assert "DS MODELFORGE PIPELINE INSPECTION TRACE" in summary
    assert "Request ID: req-12345" in summary


def test_inspect_endpoint_json_and_text(monkeypatch):
    """Verify GET /api/plan/{id}/inspect returns JSON and plain text formats."""
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        csn_payload = json.load(f)

    # 1. Post a plan with pasted sample data
    sample_csv = "Table: ZIPOHDRAPT\nPURCHASEORDER,COMPANYCODE,SUPPLIER\nPO100,1000,VEND01\n"
    res = client.post(
        "/api/plan",
        json={
            "requirement": "Calculate PO APT grouped by supplier.",
            "metadata": csn_payload,
            "sample_data": sample_csv,
            "row_limit": 3,
            "filename": "F_PO_PROCESSING_TIME_APT.json",
        },
    )
    assert res.status_code == 201
    data = res.json()
    plan_id = data["plan_id"]
    request_id = data["request_id"]

    assert request_id is not None
    assert data["sample_data_summary"] != ""
    assert "[SAMPLE:" in data["sample_data_summary"]

    # 2. Inspect via plan_id (JSON format)
    inspect_res = client.get(f"/api/plan/{plan_id}/inspect")
    assert inspect_res.status_code == 200
    inspect_data = inspect_res.json()
    assert inspect_data["request_id"] == request_id
    assert inspect_data["plan_id"] == plan_id
    assert inspect_data["stage_metadata"]["filename"] == "F_PO_PROCESSING_TIME_APT.json"
    assert inspect_data["stage_sample_mapping"]["has_samples"] is True
    assert "ZIPOHDRAPT" in inspect_data["stage_sample_mapping"]["mapped_tables"]

    # 3. Inspect via request_id
    req_inspect_res = client.get(f"/api/plan/{request_id}/inspect")
    assert req_inspect_res.status_code == 200

    # 4. Inspect via plain-text format
    text_res = client.get(f"/api/plan/{plan_id}/inspect?format=text")
    assert text_res.status_code == 200
    assert "text/plain" in text_res.headers["content-type"]
    text_content = text_res.text
    assert "DS MODELFORGE PIPELINE INSPECTION TRACE" in text_content
    assert "1. BUSINESS REQUIREMENT:" in text_content
    assert "2. PARSER & METADATA EXTRACTION:" in text_content
    assert "4. SAMPLE ROW MAPPING:" in text_content
    assert "5. LLM CONTEXT & REASONING:" in text_content

    # 5. Non-existent ID returns 404
    bad_res = client.get("/api/plan/non-existent-id/inspect")
    assert bad_res.status_code == 404

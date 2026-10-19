"""
Unit Tests for Step 1: sample_mapper.py.

Verifies:
1. Pasted CSV, TSV (spreadsheet), and pipe-delimited parsing
2. Multiple tables with explicit hints and dynamic inference
3. Mapping raw headers and labels to technical column names
4. Detection and reporting of unknown columns
5. Detection and reporting of ambiguous table mappings
6. Detection and reporting of malformed rows
7. Configurable row limits
8. Empty sample fallback and compact text generation
Runs 100% offline with fake metadata (no DB, network, or API key).
"""
import pytest
from app.agent.cds_extractor import ExtractedMetadata, CDSObject, ColumnMeta
from app.agent.sample_mapper import (
    parse_and_map_sample_data,
    SampleMappingResult,
    _detect_delimiter,
)


@pytest.fixture
def sample_metadata() -> ExtractedMetadata:
    """Fixture with two distinct source tables and one ambiguous pair."""
    meta = ExtractedMetadata()

    # Table 1: PO Header
    meta.objects["ZIPOHDRAPT"] = CDSObject(
        name="ZIPOHDRAPT",
        object_type="table",
        label="Purchase Order Header",
        columns={
            "PURCHASEORDER": ColumnMeta(name="PURCHASEORDER", data_type="NVARCHAR(10)", is_key=True, label="Purchase Order Number"),
            "COMPANYCODE": ColumnMeta(name="COMPANYCODE", data_type="NVARCHAR(4)", label="Company Code"),
            "SUPPLIER": ColumnMeta(name="SUPPLIER", data_type="NVARCHAR(10)", label="Supplier"),
            "CREATIONDATE": ColumnMeta(name="CREATIONDATE", data_type="NVARCHAR(8)", label="Creation Date"),
            "/CWM/MENGE": ColumnMeta(name="/CWM/MENGE", data_type="DECIMAL(13,3)", label="Catch Weight Quantity"),
        },
        keys=["PURCHASEORDER"],
    )

    # Table 2: PO History
    meta.objects["ZIPOHISTEXT"] = CDSObject(
        name="ZIPOHISTEXT",
        object_type="table",
        label="Purchase Order History",
        columns={
            "PURCHASEORDER": ColumnMeta(name="PURCHASEORDER", data_type="NVARCHAR(10)", is_key=True),
            "PURCHASEORDERITEM": ColumnMeta(name="PURCHASEORDERITEM", data_type="INTEGER", is_key=True),
            "GOODSMOVEMENTTYPE": ColumnMeta(name="GOODSMOVEMENTTYPE", data_type="NVARCHAR(3)"),
            "POSTINGDATE": ColumnMeta(name="POSTINGDATE", data_type="NVARCHAR(8)"),
        },
        keys=["PURCHASEORDER", "PURCHASEORDERITEM"],
    )

    # Table 3 & 4: Ambiguous Pair (both have identical schema)
    meta.objects["KNA1_EU"] = CDSObject(
        name="KNA1_EU",
        object_type="table",
        columns={
            "KUNNR": ColumnMeta(name="KUNNR", data_type="NVARCHAR(10)", is_key=True),
            "NAME1": ColumnMeta(name="NAME1", data_type="NVARCHAR(35)"),
        },
        keys=["KUNNR"],
    )
    meta.objects["KNA1_US"] = CDSObject(
        name="KNA1_US",
        object_type="table",
        columns={
            "KUNNR": ColumnMeta(name="KUNNR", data_type="NVARCHAR(10)", is_key=True),
            "NAME1": ColumnMeta(name="NAME1", data_type="NVARCHAR(35)"),
        },
        keys=["KUNNR"],
    )

    return meta


def test_detect_delimiters():
    """Verify delimiter detection for comma, tab, pipe, and semicolon."""
    assert _detect_delimiter("col1,col2,col3") == ","
    assert _detect_delimiter("col1\tcol2\tcol3") == "\t"
    assert _detect_delimiter("| col1 | col2 |") == "|"
    assert _detect_delimiter("col1;col2;col3") == ";"


def test_empty_sample_fallback(sample_metadata):
    """Verify empty or None sample string returns has_samples=False and fallback text."""
    res_none = parse_and_map_sample_data(None, sample_metadata)
    assert res_none.has_samples is False
    assert "No sample data provided" in res_none.to_compact_text()

    res_empty = parse_and_map_sample_data("   \n\n  ", sample_metadata)
    assert res_empty.has_samples is False
    assert "No sample data provided" in res_empty.to_compact_text()


def test_single_table_csv_dynamic_inference(sample_metadata):
    """Verify unhinted CSV automatically maps to ZIPOHDRAPT via column matching."""
    csv_text = """
    PURCHASEORDER,COMPANYCODE,SUPPLIER
    4500000001,1000,VEND01
    4500000002,1000,VEND02
    """
    res = parse_and_map_sample_data(csv_text, sample_metadata)

    assert res.has_samples is True
    assert "ZIPOHDRAPT" in res.tables
    mapped = res.tables["ZIPOHDRAPT"]
    assert mapped.total_rows_parsed == 2
    assert mapped.rows_retained == 2
    assert mapped.rows[0]["PURCHASEORDER"] == "4500000001"
    assert mapped.rows[0]["COMPANYCODE"] == "1000"
    assert mapped.rows[0]["SUPPLIER"] == "VEND01"


def test_spreadsheet_tsv_and_label_matching(sample_metadata):
    """Verify tab-delimited spreadsheet paste matching technical columns via labels and case-insensitivity."""
    # User copied from Excel: labels 'Purchase Order Number' and 'Company Code', plus normalized 'cwm_menge'
    tsv_text = "Purchase Order Number\tcompanycode\tSupplier\tcwm_menge\n4500000001\t1000\tVEND01\t150.500\n"

    res = parse_and_map_sample_data(tsv_text, sample_metadata)

    assert "ZIPOHDRAPT" in res.tables
    mapped = res.tables["ZIPOHDRAPT"]
    assert mapped.delimiter == "\t"
    assert mapped.rows_retained == 1

    # Check resolved technical names
    row = mapped.rows[0]
    assert row["PURCHASEORDER"] == "4500000001"
    assert row["COMPANYCODE"] == "1000"
    assert row["SUPPLIER"] == "VEND01"
    assert row["/CWM/MENGE"] == "150.500"


def test_markdown_pipe_table(sample_metadata):
    """Verify markdown pipe-delimited table parsing."""
    pipe_text = """
    | PURCHASEORDER | GOODSMOVEMENTTYPE | POSTINGDATE |
    | 4500000001    | 101               | 20260115    |
    | 4500000001    | 102               | 20260118    |
    """
    res = parse_and_map_sample_data(pipe_text, sample_metadata)

    assert "ZIPOHISTEXT" in res.tables
    mapped = res.tables["ZIPOHISTEXT"]
    assert mapped.total_rows_parsed == 2
    assert mapped.rows[0]["GOODSMOVEMENTTYPE"] == "101"
    assert mapped.rows[1]["GOODSMOVEMENTTYPE"] == "102"


def test_multiple_tables_with_hints(sample_metadata):
    """Verify multi-table sample text with explicit table hints."""
    multi_text = """
    Table: ZIPOHDRAPT
    PURCHASEORDER,COMPANYCODE,SUPPLIER
    4500000001,1000,VEND01

    [ZIPOHISTEXT]
    PURCHASEORDER,GOODSMOVEMENTTYPE,POSTINGDATE
    4500000001,101,20260115
    4500000002,101,20260116
    """
    res = parse_and_map_sample_data(multi_text, sample_metadata)

    assert "ZIPOHDRAPT" in res.tables
    assert "ZIPOHISTEXT" in res.tables
    assert res.tables["ZIPOHDRAPT"].rows_retained == 1
    assert res.tables["ZIPOHISTEXT"].rows_retained == 2


def test_configurable_row_limit(sample_metadata):
    """Verify configurable row limit truncates rows while recording total parsed count."""
    rows = ["PURCHASEORDER,COMPANYCODE,SUPPLIER"]
    for i in range(10):
        rows.append(f"450000000{i},1000,VEND{i}")
    csv_text = "\n".join(rows)

    res = parse_and_map_sample_data(csv_text, sample_metadata, row_limit=3)

    mapped = res.tables["ZIPOHDRAPT"]
    assert mapped.total_rows_parsed == 10
    assert mapped.rows_retained == 3
    assert len(mapped.rows) == 3


def test_report_unknown_columns(sample_metadata):
    """Verify unknown columns are reported in unknown_columns and warnings rather than guessed."""
    csv_text = """
    PURCHASEORDER,COMPANYCODE,GHOST_COLUMN_NOT_IN_SCHEMA
    4500000001,1000,MYSTERY_VALUE
    """
    res = parse_and_map_sample_data(csv_text, sample_metadata)

    assert "ZIPOHDRAPT" in res.tables
    mapped = res.tables["ZIPOHDRAPT"]
    assert "GHOST_COLUMN_NOT_IN_SCHEMA" in mapped.unknown_columns
    assert "GHOST_COLUMN_NOT_IN_SCHEMA" in res.unknown_columns["ZIPOHDRAPT"]
    assert any("GHOST_COLUMN_NOT_IN_SCHEMA" in w for w in res.warnings)

    # Valid columns are still mapped properly
    assert mapped.rows[0]["PURCHASEORDER"] == "4500000001"
    assert "GHOST_COLUMN_NOT_IN_SCHEMA" not in mapped.rows[0]


def test_report_ambiguous_source_mappings(sample_metadata):
    """Verify ambiguous table mapping is flagged without guessing when columns match equally."""
    # KNA1_EU and KNA1_US have identical columns KUNNR and NAME1
    ambiguous_text = """
    KUNNR,NAME1
    0001000001,Acme Corporation
    """
    res = parse_and_map_sample_data(ambiguous_text, sample_metadata)

    # Must NOT map to either table randomly
    assert "KNA1_EU" not in res.tables
    assert "KNA1_US" not in res.tables
    assert len(res.ambiguous_blocks) == 1
    amb = res.ambiguous_blocks[0]
    assert set(amb.candidate_tables) == {"KNA1_EU", "KNA1_US"}
    assert any("Ambiguous mapping" in w for w in res.warnings)


def test_report_malformed_rows(sample_metadata):
    """Verify rows with mismatched column counts are flagged in malformed_rows and omitted from valid rows."""
    csv_text = """
    PURCHASEORDER,COMPANYCODE,SUPPLIER
    4500000001,1000,VEND01
    MALFORMED_LINE_TOO_FEW_COLUMNS
    4500000002,1000,VEND02,EXTRA_COLUMN_VAL
    4500000003,1000,VEND03
    """
    res = parse_and_map_sample_data(csv_text, sample_metadata)

    assert "ZIPOHDRAPT" in res.tables
    mapped = res.tables["ZIPOHDRAPT"]
    # 2 valid rows, 2 malformed rows
    assert mapped.rows_retained == 2
    assert len(res.malformed_rows) == 2
    assert res.malformed_rows[0].reason.startswith("Column count mismatch")
    assert res.malformed_rows[1].reason.startswith("Column count mismatch")


def test_to_compact_text_formatting(sample_metadata):
    """Verify to_compact_text formats clean pipe-separated prompt representation."""
    csv_text = """
    PURCHASEORDER,COMPANYCODE,SUPPLIER
    4500000001,1000,VEND01
    """
    res = parse_and_map_sample_data(csv_text, sample_metadata)
    compact = res.to_compact_text()

    assert "[SAMPLE: ZIPOHDRAPT]" in compact
    assert "PURCHASEORDER | COMPANYCODE | SUPPLIER" in compact
    assert "4500000001 | 1000 | VEND01" in compact


def test_generic_headers_positional_inference(sample_metadata):
    """Verify tables with generic headers (Column 1, Column 2...) are dynamically inferred by schema profile."""
    # ZIPOHISTEXT has 4 columns: PURCHASEORDER, PURCHASEORDERITEM, GOODSMOVEMENTTYPE, POSTINGDATE
    tsv_text = (
        "Column 1\tColumn 2\tColumn 3\tColumn 4\n"
        "4500000001\t10\t101\t20260305\n"
        "4500000002\t20\t101\t20260306\n"
    )
    res = parse_and_map_sample_data(tsv_text, sample_metadata)

    assert "ZIPOHISTEXT" in res.tables
    mapped = res.tables["ZIPOHISTEXT"]
    assert mapped.rows_retained == 2
    assert mapped.rows[0]["PURCHASEORDER"] == "4500000001"
    assert mapped.rows[0]["PURCHASEORDERITEM"] == "10"
    assert mapped.rows[0]["GOODSMOVEMENTTYPE"] == "101"
    assert mapped.rows[0]["POSTINGDATE"] == "20260305"
    assert all(mc.matched_by == "positional" for mc in mapped.mapped_columns)


def test_multi_table_generic_headers_and_glued_lines(sample_metadata):
    """Verify multi-table pasted samples with generic headers and glued headers are split and mapped distinctly."""
    # Block 1 (4 cols) -> ZIPOHISTEXT
    # Glued row: '... 20260306Column 1\tColumn 2...'
    # Block 2 (5 cols) -> ZIPOHDRAPT
    glued_text = (
        "Column 1\tColumn 2\tColumn 3\tColumn 4\n"
        "4500000001\t10\t101\t20260305\n"
        "4500000002\t20\t101\t20260306Column 1\tColumn 2\tColumn 3\tColumn 4\tColumn 5\n"
        "4500000001\t1000\tVEND01\t20260301\t150.000\n"
        "4500000002\t1000\tVEND02\t20260302\t250.000\n"
    )
    res = parse_and_map_sample_data(glued_text, sample_metadata)

    assert "ZIPOHISTEXT" in res.tables
    assert "ZIPOHDRAPT" in res.tables
    assert res.tables["ZIPOHISTEXT"].rows_retained == 2
    assert res.tables["ZIPOHDRAPT"].rows_retained == 2
    assert res.tables["ZIPOHDRAPT"].rows[0]["COMPANYCODE"] == "1000"
    assert res.tables["ZIPOHDRAPT"].rows[0]["/CWM/MENGE"] == "150.000"


def test_clean_trailing_user_commentary(sample_metadata):
    """Verify trailing conversational text glued to the last cell is cleaned."""
    tsv_text = (
        "PURCHASEORDER\tCOMPANYCODE\tSUPPLIER\tCREATIONDATE\t/CWM/MENGE\n"
        "4500000001\t1000\tVEND01\t20260301\t150.000soo like update parser dont hardcode anything\n"
    )
    res = parse_and_map_sample_data(tsv_text, sample_metadata)

    assert "ZIPOHDRAPT" in res.tables
    mapped = res.tables["ZIPOHDRAPT"]
    assert mapped.rows_retained == 1
    assert mapped.rows[0]["/CWM/MENGE"] == "150.000"


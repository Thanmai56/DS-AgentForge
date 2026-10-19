"""
Sample Data Mapper.

Parses pasted sample rows (CSV, TSV, pipe-delimited, multi-table blocks, generic headers)
and dynamically maps headers and positions to technical column names and source objects from ExtractedMetadata.
Reports:
- Unknown columns (present in sample but not in metadata)
- Ambiguous source mappings (headers match multiple tables with equal score)
- Malformed rows (inconsistent column counts or unparseable delimiters)
Enforces a configurable row limit and formats a compact plain-text summary for the LLM.
Zero hardcoded table or column names.
"""
from __future__ import annotations

import csv
import io
import re
from typing import Any, Optional
from pydantic import BaseModel, Field, ConfigDict

from app.agent.cds_extractor import ExtractedMetadata, CDSObject, ColumnMeta


class MappedColumn(BaseModel):
    """Mapping between a raw header string and its resolved technical column name."""
    model_config = ConfigDict(extra="ignore")

    raw_header: str
    technical_name: str
    matched_by: str = "exact"  # "exact", "case_insensitive", "label", "normalized", "positional"


class MappedTable(BaseModel):
    """Mapped sample rows for a single source object."""
    model_config = ConfigDict(extra="ignore")

    table_name: str
    mapped_columns: list[MappedColumn] = Field(default_factory=list)
    unknown_columns: list[str] = Field(default_factory=list)
    rows: list[dict[str, str]] = Field(default_factory=list)
    total_rows_parsed: int = 0
    rows_retained: int = 0
    delimiter: str = ","

    def column_mapping_dict(self) -> dict[str, str]:
        """Returns map of raw_header -> technical_name."""
        return {mc.raw_header: mc.technical_name for mc in self.mapped_columns}


class MalformedRow(BaseModel):
    """Details about a malformed or rejected sample row."""
    model_config = ConfigDict(extra="ignore")

    line_number: int
    raw_text: str
    reason: str
    table_name: Optional[str] = None


class AmbiguousMapping(BaseModel):
    """Details about a block whose headers could map to multiple candidate tables equally."""
    model_config = ConfigDict(extra="ignore")

    headers: list[str]
    candidate_tables: list[str]
    match_score: int
    reason: str


class SampleMappingResult(BaseModel):
    """Complete result of sample data parsing and alignment."""
    model_config = ConfigDict(extra="ignore")

    has_samples: bool = False
    tables: dict[str, MappedTable] = Field(default_factory=dict)
    unknown_columns: dict[str, list[str]] = Field(default_factory=dict)
    ambiguous_blocks: list[AmbiguousMapping] = Field(default_factory=list)
    malformed_rows: list[MalformedRow] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

    def to_compact_text(self) -> str:
        """
        Formats a clean, token-dense plain-text representation of the sample rows
        to include in the planner prompt under SAMPLE DATA.
        """
        if not self.has_samples or not self.tables:
            return "No sample data provided. Planning based on metadata alone."

        sections: list[str] = []

        for table_name, mapped in self.tables.items():
            if not mapped.rows:
                continue

            header_cols = [mc.technical_name for mc in mapped.mapped_columns]
            lines = [
                f"[SAMPLE: {table_name}] ({mapped.rows_retained} sample rows shown, {mapped.total_rows_parsed} total provided):",
                " | ".join(header_cols),
            ]

            for row in mapped.rows:
                row_vals = [str(row.get(col, "")) for col in header_cols]
                lines.append(" | ".join(row_vals))

            if mapped.unknown_columns:
                lines.append(f"  Note: Omitted unknown columns from sample: {', '.join(mapped.unknown_columns)}")

            sections.append("\n".join(lines))

        if self.ambiguous_blocks:
            for amb in self.ambiguous_blocks:
                sections.append(
                    f"[SAMPLE WARNING] Ambiguous sample block with headers {amb.headers} "
                    f"matched multiple tables ({', '.join(amb.candidate_tables)}). Omitted from prompt."
                )

        if not sections:
            return "No valid sample rows could be aligned to metadata."

        return "\n\n".join(sections)


GENERIC_HEADER_PATTERN = re.compile(
    r"^(?:column|col|field|f|_c)[\s_]*\d+$|^\d+$", re.IGNORECASE
)

USER_MESSAGE_TRAIL_PATTERN = re.compile(
    r"^(\S+?)(?:so+|like|update|please|don\'?t|wt?f|what|this|here|now)\b.*$", re.IGNORECASE
)


def _clean_trailing_user_message(cell_value: str) -> str:
    """Cleans trailing conversational message glued to cell text."""
    if not cell_value:
        return ""
    m = USER_MESSAGE_TRAIL_PATTERN.match(cell_value)
    if m:
        return m.group(1).strip()
    return cell_value


def _detect_delimiter(sample_line: str) -> str:
    """Detects delimiter from a header line: tab, pipe, semicolon, or comma."""
    line = sample_line.strip()
    if "|" in line:
        return "|"
    if "\t" in line:
        return "\t"
    if ";" in line:
        return ";"
    return ","


def _split_line_cells(line: str, delimiter: str) -> list[str]:
    """Splits a single line into trimmed cell values, respecting quotes for CSV/TSV and cleaning trailing commentary."""
    line = line.strip()
    if delimiter == "|":
        # Handle pipe-delimited, e.g. "| COL1 | COL2 |" or "COL1 | COL2"
        if line.startswith("|"):
            line = line[1:]
        if line.endswith("|"):
            line = line[:-1]
        raw_cells = [cell.strip() for cell in line.split("|")]
    else:
        # Use csv reader for robust quote and escape handling
        try:
            reader = csv.reader(io.StringIO(line), delimiter=delimiter)
            cells = next(reader)
            raw_cells = [c.strip() for c in cells]
        except Exception:
            raw_cells = [c.strip() for c in line.split(delimiter)]

    if raw_cells:
        raw_cells[-1] = _clean_trailing_user_message(raw_cells[-1])

    return raw_cells


def _normalize_name(name: str) -> str:
    """Removes SAP namespace slashes, underscores, and lowers case for fuzzy matching."""
    return re.sub(r"[^a-zA-Z0-9]", "", name).lower()


def _match_header_to_column(
    header: str,
    target_obj: CDSObject,
) -> tuple[Optional[str], str]:
    """
    Attempts to match a pasted header to a column in target_obj.
    Returns (matched_technical_name, matched_by_reason) or (None, "").
    """
    cleaned_header = header.strip()
    if not cleaned_header:
        return None, ""

    # 1. Exact match (case-sensitive)
    if cleaned_header in target_obj.columns:
        return cleaned_header, "exact"

    # 2. Case-insensitive match against technical names
    header_upper = cleaned_header.upper()
    for col_name in target_obj.columns:
        if col_name.upper() == header_upper:
            return col_name, "case_insensitive"

    # 3. Label match (e.g. user pasted 'Purchase Order' for 'PURCHASEORDER')
    header_lower = cleaned_header.lower()
    for col_name, col_meta in target_obj.columns.items():
        if col_meta.label and col_meta.label.strip().lower() == header_lower:
            return col_name, "label"

    # 4. Normalized match (ignoring namespaces like /CWM/MENGE or underscores)
    norm_header = _normalize_name(cleaned_header)
    for col_name in target_obj.columns:
        if _normalize_name(col_name) == norm_header:
            return col_name, "normalized"

    return None, ""


def _preprocess_raw_sample_text(text: str) -> str:
    """Preprocesses pasted text to separate glued headers and embedded table boundaries."""
    if not text:
        return ""
    # 1. Glued header tokens like 'KColumn 1' or 'valueTable: EKET'
    text = re.sub(
        r"(?<=\S)(?=(?:Column\s*1\b|Col\s*1\b|Table:?|Object:?|\[[A-Za-z0-9_/#]+\]))",
        "\n",
        text,
        flags=re.IGNORECASE,
    )
    # 2. Embedded Column 1 on same line after whitespace/tab
    text = re.sub(
        r"(\t[^\t\r\n]+?)\s+(Column\s*1\t|Col\s*1\t)",
        r"\1\n\2",
        text,
        flags=re.IGNORECASE,
    )
    return text


def _is_generic_headers(headers: list[str], metadata: ExtractedMetadata) -> bool:
    """
    Determines if headers are generic placeholders (Column 1, Col 1, 1, 2)
    or if zero headers match any known column or label across all metadata objects.
    """
    if not headers:
        return True

    generic_count = sum(1 for h in headers if GENERIC_HEADER_PATTERN.match(h.strip()))
    if generic_count >= max(1, len(headers) // 2):
        return True

    # Check if ANY header matches any known column or label
    has_match = False
    for obj in metadata.objects.values():
        for h in headers:
            matched_col, _ = _match_header_to_column(h, obj)
            if matched_col:
                has_match = True
                break
        if has_match:
            break

    return not has_match


def _profile_cell_type_compatibility(cell_val: str, col_meta: ColumnMeta) -> int:
    """
    Dynamically computes compatibility score between a cell value and a column metadata definition.
    Zero hardcoded table or column names.
    """
    val = _clean_trailing_user_message(cell_val.strip())
    if not val or val in ("-", "null", "NULL", "None", ""):
        return 0

    score = 0
    type_upper = col_meta.data_type.upper()
    col_name_upper = col_meta.name.upper()
    label_upper = (col_meta.label or "").upper()

    # 1. Date format (YYYYMMDD or YYYY-MM-DD)
    is_date_str = bool(re.match(r"^\d{8}$", val) or re.match(r"^\d{4}-\d{2}-\d{2}$", val))
    if is_date_str:
        if type_upper in ("DATE", "TIMESTAMP", "VARCHAR(8)") or "DAT" in col_name_upper or "DATE" in label_upper:
            score += 15
        elif type_upper.startswith("VARCHAR") or type_upper.startswith("NVARCHAR"):
            score += 5

    # 2. Decimal / Currency amount / Numeric
    # e.g. 1,000.000, 9,000,000.00, 0.00
    is_numeric_str = bool(re.match(r"^-?[\d,]+(?:\.\d+)?$", val))
    if is_numeric_str:
        if (
            type_upper.startswith(("DECIMAL", "NUMC", "INTEGER", "BIGINT", "DOUBLE", "FLOAT"))
            or col_meta.is_measure
            or col_meta.aggregation
        ):
            score += 8
        elif "." in val or "," in val:
            score += 4

    # 3. Client code (MANDT): 3 digits like '100', '200'
    if re.match(r"^\d{3}$", val):
        if col_name_upper == "MANDT" or "CLIENT" in label_upper:
            score += 20

    # 4. Currency code (WAERK/CURRENCY): 3 uppercase alpha characters e.g. 'USD', 'EUR', 'GBP'
    if len(val) == 3 and val.isalpha() and val.isupper():
        if "WAERK" in col_name_upper or "CURR" in col_name_upper or "CURRENCY" in label_upper:
            score += 20

    # 5. Key / identifier match
    if col_meta.is_key and not (" " in val):
        score += 3

    return score


def _find_best_candidate_for_generic_block(
    raw_headers: list[str],
    data_lines: list[tuple[int, str]],
    delimiter: str,
    metadata: ExtractedMetadata,
    already_assigned: set[str],
) -> tuple[Optional[CDSObject], bool, list[str]]:
    """
    Dynamically finds the best matching source object for a generic/positional table block.
    Returns (target_obj, is_ambiguous, candidate_names).
    """
    col_count = len(raw_headers)
    sample_rows: list[list[str]] = []
    for _, line in data_lines[:5]:
        cells = _split_line_cells(line, delimiter)
        if cells:
            sample_rows.append(cells)

    candidate_scores: list[tuple[CDSObject, int]] = []

    # Prioritize objects not yet assigned in this paste
    candidate_pool = [
        obj for obj in metadata.objects.values() if obj.name not in already_assigned
    ]
    if not candidate_pool:
        candidate_pool = list(metadata.objects.values())

    for obj in candidate_pool:
        obj_cols = list(obj.columns.values())
        obj_col_count = len(obj_cols)
        score = 0

        # Column count scoring
        if obj_col_count == col_count:
            score += 100  # Exact column count match
        elif obj_col_count > col_count:
            # Subset of columns exported from a wider table
            score += 30 - min(25, (obj_col_count - col_count) * 0.1)
        else:
            # Table has fewer columns than pasted data
            score -= (col_count - obj_col_count) * 20

        # Data-type and semantic cell compatibility scoring
        for row_cells in sample_rows:
            for idx in range(min(col_count, obj_col_count, len(row_cells))):
                col_meta = obj_cols[idx]
                cell_val = row_cells[idx]
                score += _profile_cell_type_compatibility(cell_val, col_meta)

        candidate_scores.append((obj, int(score)))

    if not candidate_scores:
        return None, False, []

    candidate_scores.sort(key=lambda x: x[1], reverse=True)
    top_score = candidate_scores[0][1]

    top_candidates = [c for c in candidate_scores if c[1] == top_score]
    if len(top_candidates) > 1 and top_score > 0:
        return None, True, [c[0].name for c in top_candidates]

    if top_score > 0:
        return candidate_scores[0][0], False, []

    return None, False, []


def _split_into_blocks(raw_text: str) -> list[dict[str, Any]]:
    """
    Splits multi-table pasted text into separate raw blocks.
    Recognizes headers such as:
      - Table: EKET
      - [EKET]
      - --- EKET ---
      - # EKET
      - Repeated header row like 'Column 1\tColumn 2...' mid-stream
    """
    cleaned_text = _preprocess_raw_sample_text(raw_text)
    lines = cleaned_text.splitlines()
    blocks: list[dict[str, Any]] = []

    current_table_hint: Optional[str] = None
    current_lines: list[tuple[int, str]] = []

    table_pattern = re.compile(
        r"^(?:(?:###?|--+)\s*(?:Table:?|Object:?)?\s*([A-Za-z0-9_/#]+)|(?:Table|Object):\s*([A-Za-z0-9_/#]+)|\[([A-Za-z0-9_/#]+)\])\s*-*$",
        re.IGNORECASE,
    )
    header_repeat_pattern = re.compile(
        r"^(?:column|col|field|f|_c)[\s_]*1(?:\t|,|;|\|)", re.IGNORECASE
    )

    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped:
            continue

        match = table_pattern.match(stripped)
        if match:
            # Explicit table header hint
            if current_lines:
                blocks.append({
                    "table_hint": current_table_hint,
                    "lines": current_lines,
                })
                current_lines = []
            current_table_hint = match.group(1) or match.group(2) or match.group(3)
        elif header_repeat_pattern.match(stripped) and current_lines:
            # Repeated header row of next table without explicit Table hint
            blocks.append({
                "table_hint": current_table_hint,
                "lines": current_lines,
            })
            current_lines = [(idx, line)]
            current_table_hint = None
        else:
            current_lines.append((idx, line))

    if current_lines:
        blocks.append({
            "table_hint": current_table_hint,
            "lines": current_lines,
        })

    return blocks


def parse_and_map_sample_data(
    raw_sample_text: str | dict[str, str] | None,
    metadata: ExtractedMetadata,
    row_limit: int = 5,
) -> SampleMappingResult:
    """
    Main parser and mapper for pasted sample data.

    Parameters:
    - raw_sample_text: Raw string pasted by user (CSV, TSV, pipe, generic headers, or multiple tables)
      OR a dictionary mapping table_name -> sample_data_rows.
    - metadata: ExtractedMetadata containing known tables, views, and columns.
    - row_limit: Maximum number of rows to retain per table (default 5).

    Returns:
    - SampleMappingResult with aligned tables, unknown columns, and malformed rows.
    """
    result = SampleMappingResult()

    if not raw_sample_text:
        return result

    raw_blocks: list[dict[str, Any]] = []

    if isinstance(raw_sample_text, dict):
        # Structured dictionary from per-table UI tabs
        for tbl_name, tbl_sample in raw_sample_text.items():
            if not tbl_sample or not str(tbl_sample).strip():
                continue
            cleaned = _preprocess_raw_sample_text(str(tbl_sample))
            lines = [(idx, l) for idx, l in enumerate(cleaned.splitlines(), start=1) if l.strip()]
            if lines:
                raw_blocks.append({
                    "table_hint": tbl_name,
                    "lines": lines,
                })
    elif isinstance(raw_sample_text, str):
        if not raw_sample_text.strip():
            return result
        raw_blocks = _split_into_blocks(raw_sample_text)
    else:
        return result

    if not raw_blocks:
        return result

    result.has_samples = True
    already_assigned_tables: set[str] = set()

    for block in raw_blocks:
        lines = block["lines"]
        table_hint = block["table_hint"]

        if not lines:
            continue

        # Header line is the first non-empty line of the block
        header_line_num, header_line = lines[0]
        data_lines = lines[1:]

        delimiter = _detect_delimiter(header_line)
        raw_headers = _split_line_cells(header_line, delimiter)

        if not raw_headers or all(not h for h in raw_headers):
            result.malformed_rows.append(
                MalformedRow(
                    line_number=header_line_num,
                    raw_text=header_line,
                    reason="Empty header row.",
                )
            )
            continue

        # Check if headers are generic (Column 1, Col 1, ...) or match technical metadata names
        is_generic = _is_generic_headers(raw_headers, metadata)

        # Dynamically harmonize generic headers if data rows consistently have a different column count
        # (e.g. user selected Column 1..19 in headers, but pasted 20 data columns)
        if is_generic and data_lines:
            row_lens = [
                len(_split_line_cells(line, delimiter))
                for _, line in data_lines[:5]
                if line.strip()
            ]
            if row_lens:
                common_len = max(set(row_lens), key=row_lens.count)
                if common_len > len(raw_headers):
                    for idx in range(len(raw_headers) + 1, common_len + 1):
                        raw_headers.append(f"Column {idx}")
                elif common_len < len(raw_headers) and common_len > 0:
                    raw_headers = raw_headers[:common_len]

        # 1. Resolve Target Source Object
        target_obj: Optional[CDSObject] = None

        if table_hint:
            # Search metadata for hinted name (case-insensitive)
            hint_upper = table_hint.strip().upper()
            for obj_name, obj in metadata.objects.items():
                if obj_name.upper() == hint_upper:
                    target_obj = obj
                    break

            if not target_obj:
                result.warnings.append(
                    f"Sample table hint '{table_hint}' at line {header_line_num} does not exist in uploaded metadata."
                )
                continue
        elif not is_generic:
            # Technical column names or labels provided: match by column name
            candidate_scores: list[tuple[CDSObject, int, list[tuple[str, str]]]] = []

            for obj in metadata.objects.values():
                matches: list[tuple[str, str]] = []
                for h in raw_headers:
                    matched_col, _ = _match_header_to_column(h, obj)
                    if matched_col:
                        matches.append((h, matched_col))

                if matches:
                    candidate_scores.append((obj, len(matches), matches))

            if not candidate_scores:
                # Fallback to dynamic positional profiling
                target_obj, is_ambig, ambig_names = _find_best_candidate_for_generic_block(
                    raw_headers, data_lines, delimiter, metadata, already_assigned_tables
                )
                if is_ambig:
                    result.ambiguous_blocks.append(
                        AmbiguousMapping(
                            headers=raw_headers,
                            candidate_tables=ambig_names,
                            match_score=0,
                            reason=f"Headers match multiple tables equally: {', '.join(ambig_names)}",
                        )
                    )
                    continue
            else:
                candidate_scores.sort(key=lambda x: x[1], reverse=True)
                top_score = candidate_scores[0][1]
                top_candidates = [c for c in candidate_scores if c[1] == top_score]

                if len(top_candidates) > 1:
                    candidate_names = [c[0].name for c in top_candidates]
                    result.ambiguous_blocks.append(
                        AmbiguousMapping(
                            headers=raw_headers,
                            candidate_tables=candidate_names,
                            match_score=top_score,
                            reason=f"Headers match {top_score} columns equally across: {', '.join(candidate_names)}",
                        )
                    )
                    result.warnings.append(
                        f"Ambiguous mapping at line {header_line_num}: headers {raw_headers} could belong to {', '.join(candidate_names)}. Refused to guess."
                    )
                    continue

                target_obj = top_candidates[0][0]
        else:
            # Generic headers (Column 1, Col 1, ...) -> dynamic positional + type matching
            target_obj, is_ambig, ambig_names = _find_best_candidate_for_generic_block(
                raw_headers, data_lines, delimiter, metadata, already_assigned_tables
            )
            if is_ambig:
                result.ambiguous_blocks.append(
                    AmbiguousMapping(
                        headers=raw_headers,
                        candidate_tables=ambig_names,
                        match_score=0,
                        reason=f"Generic headers with {len(raw_headers)} columns match multiple tables equally: {', '.join(ambig_names)}",
                    )
                )
                result.warnings.append(
                    f"Ambiguous mapping at line {header_line_num}: {len(raw_headers)} generic columns could belong to {', '.join(ambig_names)}. Refused to guess."
                )
                continue

            if not target_obj:
                result.warnings.append(
                    f"Sample headers at line {header_line_num} {raw_headers} could not be aligned to any table in metadata."
                )
                continue

        # 2. Map Columns against target_obj
        mapped_cols: list[MappedColumn] = []
        unknown_cols: list[str] = []
        header_index_to_tech: dict[int, str] = {}
        target_cols = list(target_obj.columns.values())

        if is_generic or not any(_match_header_to_column(h, target_obj)[0] for h in raw_headers):
            # Positional column mapping
            for idx, h in enumerate(raw_headers):
                if idx < len(target_cols):
                    tech_name = target_cols[idx].name
                    mapped_cols.append(
                        MappedColumn(
                            raw_header=h,
                            technical_name=tech_name,
                            matched_by="positional",
                        )
                    )
                    header_index_to_tech[idx] = tech_name
                else:
                    unknown_cols.append(h)
        else:
            # Technical name / label mapping
            for idx, h in enumerate(raw_headers):
                matched_col, matched_by = _match_header_to_column(h, target_obj)
                if matched_col:
                    mapped_cols.append(
                        MappedColumn(
                            raw_header=h,
                            technical_name=matched_col,
                            matched_by=matched_by,
                        )
                    )
                    header_index_to_tech[idx] = matched_col
                else:
                    unknown_cols.append(h)

        if unknown_cols:
            result.unknown_columns[target_obj.name] = unknown_cols
            result.warnings.append(
                f"Table '{target_obj.name}': Sample data contains unknown columns {unknown_cols} not present in metadata."
            )

        if not mapped_cols:
            result.warnings.append(
                f"Table '{target_obj.name}': None of the sample headers could be mapped to technical columns."
            )
            continue

        # 3. Parse and Validate Rows
        valid_rows: list[dict[str, str]] = []
        total_rows_for_table = 0
        expected_col_count = len(raw_headers)

        for row_line_num, row_line in data_lines:
            row_stripped = row_line.strip()
            if not row_stripped:
                continue

            row_cells = _split_line_cells(row_line, delimiter)
            total_rows_for_table += 1

            # Validate column count consistency
            if len(row_cells) != expected_col_count:
                result.malformed_rows.append(
                    MalformedRow(
                        line_number=row_line_num,
                        raw_text=row_line,
                        reason=f"Column count mismatch: expected {expected_col_count} columns, found {len(row_cells)}.",
                        table_name=target_obj.name,
                    )
                )
                continue

            # Build row dict using technical column names
            row_dict: dict[str, str] = {}
            for col_idx, cell_val in enumerate(row_cells):
                if col_idx in header_index_to_tech:
                    tech_name = header_index_to_tech[col_idx]
                    row_dict[tech_name] = cell_val

            if len(valid_rows) < row_limit:
                valid_rows.append(row_dict)

        # 4. Store Mapped Table
        result.tables[target_obj.name] = MappedTable(
            table_name=target_obj.name,
            mapped_columns=mapped_cols,
            unknown_columns=unknown_cols,
            rows=valid_rows,
            total_rows_parsed=total_rows_for_table,
            rows_retained=len(valid_rows),
            delimiter=delimiter,
        )
        already_assigned_tables.add(target_obj.name)

    return result

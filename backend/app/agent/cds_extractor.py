"""
CDS / CSN Metadata Extractor.

Parses uploaded SAP Datasphere CSN JSON definitions and extracts:
- Object technical names, business labels, and detected object types (table, view, fact, analytic_model, dimension).
- Column definitions (data types, lengths, keys, nullability, measures).
- Existing view queries: upstream source dependencies, join definitions, WHERE filters, GROUP BY keys.
- Existing calculated columns, expressions, and measures.
- Associations and cardinality.

Produces structured CDSObject models and a compact token-efficient text representation
for the LLM prompt so the LLM can reuse existing CDS views without hallucinations.
"""
from __future__ import annotations

import json
from typing import Any
from pydantic import BaseModel, Field, ConfigDict


def _is_delta_entity_name(name: str) -> bool:
    leaf_name = name.rsplit(".", 1)[-1].strip()
    return leaf_name.upper().endswith(("_DELTA", "-DELTA"))


class ColumnMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    data_type: str = "NVARCHAR"
    is_key: bool = False
    label: str = ""
    is_measure: bool = False
    aggregation: str = ""
    filter_capable: bool = True


class JoinMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")

    join_type: str = "inner"
    left_source: str = ""
    right_source: str = ""
    on: list[list[str]] = Field(default_factory=list)


class CalcColMeta(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    formula: str = ""
    label: str = ""


class CDSObject(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    object_type: str  # table, view, fact, analytic_model, dimension
    label: str = ""
    is_existing: bool = True
    columns: dict[str, ColumnMeta] = Field(default_factory=dict)
    keys: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    joins: list[JoinMeta] = Field(default_factory=list)
    filters: list[str] = Field(default_factory=list)
    group_by: list[str] = Field(default_factory=list)
    calculated_columns: list[CalcColMeta] = Field(default_factory=list)
    measures: list[str] = Field(default_factory=list)
    associations: list[dict[str, Any]] = Field(default_factory=list)

    def column_names(self) -> set[str]:
        return set(self.columns.keys())


class ExtractedMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")

    objects: dict[str, CDSObject] = Field(default_factory=dict)
    parsing_warnings: list[str] = Field(default_factory=list)
    unsupported_structures: list[str] = Field(default_factory=list)
    source_filename: str = "uploaded_metadata.json"

    def get_object(self, name: str) -> CDSObject | None:
        return self.objects.get(name)

    def get_columns(self, name: str) -> set[str]:
        obj = self.get_object(name)
        return obj.column_names() if obj else set()

    def to_compact_text(self) -> str:
        """
        Formats a token-dense, plain-text summary of all existing objects
        suitable for feeding to the LLM prompt under SOURCE METADATA.
        """
        if not self.objects:
            return "No source metadata provided."

        sections = []
        for obj in self.objects.values():
            type_str = obj.object_type.upper()
            header = f"[{type_str}] {obj.name}"
            if obj.label and obj.label != obj.name:
                header += f" ({obj.label})"
            if obj.is_existing and obj.object_type != "table":
                header += " [EXISTING CDS VIEW]"

            lines = [header]

            if obj.sources:
                lines.append(f"  SOURCES: {', '.join(obj.sources)}")

            if obj.keys:
                lines.append(f"  KEYS: {', '.join(obj.keys)}")

            col_strs = []
            for col in obj.columns.values():
                role = "key" if col.is_key else ("measure" if col.is_measure else "")
                parts = [col.data_type]
                if role:
                    parts.append(role)
                if col.aggregation:
                    parts.append(f"agg:{col.aggregation}")
                col_strs.append(f"{col.name} ({', '.join(parts)})")
            if col_strs:
                lines.append(f"  COLUMNS: {', '.join(col_strs)}")

            if obj.filters:
                lines.append(f"  FILTERS: {' AND '.join(obj.filters)}")

            if obj.group_by:
                lines.append(f"  GROUP BY: {', '.join(obj.group_by)}")

            for j in obj.joins:
                on_clause = " AND ".join(f"{pair[0]} = {pair[1]}" for pair in j.on if len(pair) == 2)
                lines.append(f"  JOIN: {j.left_source} {j.join_type.upper()} JOIN {j.right_source} ON {on_clause}")

            for c in obj.calculated_columns:
                lines.append(f"  CALC: {c.name} = {c.formula}")

            if obj.measures:
                lines.append(f"  MEASURES: {', '.join(obj.measures)}")

            sections.append("\n".join(lines))

        return "\n\n".join(sections)


def parse_csn_metadata(raw: Any, filename: str = "uploaded_metadata.json") -> ExtractedMetadata:
    """
    Main parser: takes a raw JSON string, dictionary, or CSN structure
    and returns an ExtractedMetadata object with recorded warnings and filename.
    """
    if not raw:
        return ExtractedMetadata(source_filename=filename, parsing_warnings=["Empty metadata payload."])

    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return ExtractedMetadata(source_filename=filename, parsing_warnings=["Empty metadata string."])
        try:
            raw = json.loads(raw)
        except Exception as exc:
            return ExtractedMetadata(
                source_filename=filename,
                parsing_warnings=[f"Failed to parse metadata JSON string: {exc}"]
            )

    extracted = ExtractedMetadata(source_filename=filename)

    # Case 1: SAP CSN with "definitions" dict
    if isinstance(raw, dict) and "definitions" in raw and isinstance(raw["definitions"], dict):
        delta_entities: set[str] = set()
        for defn in raw["definitions"].values():
            if not isinstance(defn, dict):
                continue
            delta_metadata = defn.get("@DataWarehouse.delta", {})
            delta_refs: list[Any] = []
            if isinstance(delta_metadata, dict):
                nested_refs = delta_metadata.get("deltaFromEntities", [])
                if isinstance(nested_refs, str):
                    delta_refs.append(nested_refs)
                elif isinstance(nested_refs, list):
                    delta_refs.extend(nested_refs)
            direct_refs = defn.get("@DataWarehouse.delta.deltaFromEntities", [])
            if isinstance(direct_refs, str):
                delta_refs.append(direct_refs)
            elif isinstance(direct_refs, list):
                delta_refs.extend(direct_refs)
            if isinstance(delta_refs, list):
                delta_entities.update(
                    str(ref).rsplit(".", 1)[-1].casefold()
                    for ref in delta_refs
                    if isinstance(ref, str)
                )

        for name, defn in raw["definitions"].items():
            if _is_delta_entity_name(name) or name.rsplit(".", 1)[-1].casefold() in delta_entities:
                continue
            if not isinstance(defn, dict):
                extracted.unsupported_structures.append(f"Definition '{name}' is not a dictionary.")
                continue
            kind = defn.get("kind", "entity")
            if kind not in ("entity", "type", "context", "service"):
                extracted.unsupported_structures.append(f"Definition '{name}' has unsupported kind '{kind}'.")
            cds_obj = _parse_csn_entity(name, defn)
            if not cds_obj.columns:
                extracted.parsing_warnings.append(f"Entity '{name}' defines no columns or elements.")
            extracted.objects[name] = cds_obj
        return extracted

    # Case 2: List of tables/views
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                name = item.get("name") or item.get("technicalName") or item.get("table_name") or "UNKNOWN"
                if _is_delta_entity_name(str(name)):
                    continue
                cds_obj = _parse_generic_table(name, item)
                if not cds_obj.columns:
                    extracted.parsing_warnings.append(f"Table '{name}' defines no columns.")
                extracted.objects[name] = cds_obj
            else:
                extracted.unsupported_structures.append(f"List item is not a table dictionary: {str(item)[:50]}")
        return extracted

    # Case 3: Dict mapping names to column lists or table defs
    if isinstance(raw, dict):
        if "tables" in raw and isinstance(raw["tables"], list):
            return parse_csn_metadata(raw["tables"], filename=filename)
        for name, item in raw.items():
            if _is_delta_entity_name(name):
                continue
            if isinstance(item, dict) and ("columns" in item or "elements" in item or "fields" in item):
                cds_obj = _parse_generic_table(name, item)
                if not cds_obj.columns:
                    extracted.parsing_warnings.append(f"Object '{name}' defines no columns.")
                extracted.objects[name] = cds_obj
            else:
                extracted.unsupported_structures.append(f"Object '{name}' does not contain recognized column definitions.")
        return extracted

    return extracted


def _parse_csn_entity(name: str, defn: dict[str, Any]) -> CDSObject:
    """Extract a single CSN entity definition into a CDSObject."""
    label = defn.get("@EndUserText.label") or defn.get("label") or name

    # Detect object type
    modeling_pattern = str(defn.get("@ObjectModel.modelingPattern", {}).get("#", "")).upper()
    data_category = str(defn.get("@Analytics.dataCategory", {}).get("#", "")).upper()
    has_query = "query" in defn

    if modeling_pattern == "ANALYTICAL_CUBE" or data_category == "CUBE" or name.startswith("AM_"):
        obj_type = "analytic_model"
    elif modeling_pattern == "ANALYTICAL_FACT" or data_category == "FACT" or name.startswith("F_"):
        obj_type = "fact"
    elif modeling_pattern == "DIMENSION" or data_category == "DIMENSION" or name.startswith("E_"):
        obj_type = "dimension"
    elif has_query or name.startswith("V_"):
        obj_type = "view"
    else:
        obj_type = "table"

    # Extract elements / columns
    columns: dict[str, ColumnMeta] = {}
    keys: list[str] = []
    measures: list[str] = []
    raw_elements = defn.get("elements", {})

    if isinstance(raw_elements, dict):
        for col_name, col_def in raw_elements.items():
            if not isinstance(col_def, dict):
                columns[col_name] = ColumnMeta(name=col_name)
                continue

            dt = col_def.get("@DataWarehouse.native.dataType") or col_def.get("type", "cds.String")
            if "length" in col_def:
                dt = f"{dt}({col_def['length']})"
            elif "precision" in col_def and "scale" in col_def:
                dt = f"{dt}({col_def['precision']},{col_def['scale']})"

            is_key = bool(col_def.get("key"))
            col_label = col_def.get("@EndUserText.label") or col_name

            # Check measure annotations
            measure_type = col_def.get("@AnalyticsDetails.measureType", {}).get("#", "")
            agg_def = col_def.get("@Aggregation.default", {}).get("#", "")
            is_measure = (
                bool(measure_type)
                or bool(agg_def)
                or bool(col_def.get("@Analytics.measure"))
                or "DECIMAL" in str(dt).upper()
            )

            if is_key:
                keys.append(col_name)
            if is_measure:
                measures.append(col_name)

            columns[col_name] = ColumnMeta(
                name=col_name,
                data_type=str(dt),
                is_key=is_key,
                label=col_label,
                is_measure=is_measure,
                aggregation=str(agg_def or ""),
            )

    # Extract Query details if present
    sources: list[str] = []
    joins: list[JoinMeta] = []
    filters: list[str] = []
    group_by: list[str] = []
    calculated_columns: list[CalcColMeta] = []

    if has_query:
        query = defn.get("query", {})
        _extract_query_info(
            query=query,
            sources=sources,
            joins=joins,
            filters=filters,
            group_by=group_by,
            calculated_columns=calculated_columns,
        )

    # Dedup sources
    unique_sources = list(dict.fromkeys(sources))

    return CDSObject(
        name=name,
        object_type=obj_type,
        label=label,
        is_existing=True,
        columns=columns,
        keys=keys,
        sources=unique_sources,
        joins=joins,
        filters=filters,
        group_by=group_by,
        calculated_columns=calculated_columns,
        measures=measures,
    )


def _extract_query_info(
    query: dict[str, Any],
    sources: list[str],
    joins: list[JoinMeta],
    filters: list[str],
    group_by: list[str],
    calculated_columns: list[CalcColMeta],
) -> None:
    """Recursively walks CSN query structure to pull sources, joins, filters, calcs."""
    select = query.get("SELECT") if isinstance(query, dict) else None
    if not isinstance(select, dict):
        return

    # 1. From clause
    from_clause = select.get("from")
    _walk_from_clause(from_clause, sources, joins)

    # 2. Where clause
    where_clause = select.get("where")
    if isinstance(where_clause, list):
        where_str = _format_csn_where(where_clause)
        if where_str:
            filters.append(where_str)

    # 3. Group by clause
    group_clause = select.get("groupBy")
    if isinstance(group_clause, list):
        for g in group_clause:
            if isinstance(g, dict) and "ref" in g:
                ref = g["ref"]
                group_by.append(ref[-1] if isinstance(ref, list) else str(ref))

    # 4. Columns: detect calculations / formulas
    for col in select.get("columns", []):
        if not isinstance(col, dict):
            continue
        as_name = col.get("as")
        if as_name:
            if "xpr" in col:
                formula_str = _format_csn_expr(col["xpr"])
                calculated_columns.append(CalcColMeta(name=as_name, formula=formula_str))
            elif "func" in col:
                func_name = col.get("func")
                args = [_format_csn_expr(a) for a in col.get("args", [])]
                formula_str = f"{func_name}({', '.join(args)})"
                calculated_columns.append(CalcColMeta(name=as_name, formula=formula_str))
            elif "val" in col:
                calculated_columns.append(CalcColMeta(name=as_name, formula=str(col["val"])))


def _walk_from_clause(node: Any, sources: list[str], joins: list[JoinMeta]) -> None:
    """Walks the from clause which may contain nested joins, aliases, or sub-selects."""
    if not node or not isinstance(node, dict):
        return

    # Direct reference: {"ref": ["TABLENAME"]}
    if "ref" in node and isinstance(node["ref"], list):
        source_name = str(node["ref"][0])
        if not _is_delta_entity_name(source_name):
            sources.append(source_name)
        return

    # Sub-select: {"SELECT": {...}}
    if "SELECT" in node:
        _walk_from_clause(node["SELECT"].get("from"), sources, joins)
        return

    # Join node: {"join": "inner", "args": [...], "on": [...]}
    if "join" in node:
        j_type = node.get("join", "inner")
        args = node.get("args", [])
        left_src = ""
        right_src = ""
        left_object = ""
        right_object = ""

        if len(args) >= 1 and isinstance(args[0], dict):
            left_src = args[0].get("as") or (args[0].get("ref", [None])[0] if "ref" in args[0] else "")
            left_object = args[0].get("ref", [left_src])[0]
            _walk_from_clause(args[0], sources, joins)
        if len(args) >= 2 and isinstance(args[1], dict):
            right_src = args[1].get("as") or (args[1].get("ref", [None])[0] if "ref" in args[1] else "")
            right_object = args[1].get("ref", [right_src])[0]
            _walk_from_clause(args[1], sources, joins)

        # Parse on conditions: e.g. [{"ref": ["T1", "C1"]}, "=", {"ref": ["T2", "C2"]}]
        on_pairs = []
        on_clause = node.get("on", [])
        if isinstance(on_clause, list):
            i = 0
            while i < len(on_clause):
                token = on_clause[i]
                if isinstance(token, dict) and "ref" in token and i + 2 < len(on_clause):
                    next_token = on_clause[i + 1]
                    third_token = on_clause[i + 2]
                    if next_token == "=" and isinstance(third_token, dict) and "ref" in third_token:
                        l_col = ".".join(token["ref"])
                        r_col = ".".join(third_token["ref"])
                        on_pairs.append([l_col, r_col])
                        i += 3
                        continue
                i += 1

        contains_delta_source = any(_from_clause_contains_delta(arg) for arg in args)
        if (
            not contains_delta_source
            and not _is_delta_entity_name(str(left_object))
            and not _is_delta_entity_name(str(right_object))
        ):
            joins.append(
                JoinMeta(
                    join_type=j_type,
                    left_source=left_src,
                    right_source=right_src,
                    on=on_pairs,
                )
            )


def _from_clause_contains_delta(node: Any) -> bool:
    if not isinstance(node, dict):
        return False
    reference = node.get("ref")
    if isinstance(reference, list) and reference and _is_delta_entity_name(str(reference[0])):
        return True
    if "SELECT" in node:
        select = node["SELECT"]
        return isinstance(select, dict) and _from_clause_contains_delta(select.get("from"))
    return any(
        _from_clause_contains_delta(child)
        for child in node.get("args", [])
        if isinstance(child, dict)
    )


def _format_csn_expr(expr: Any) -> str:
    """Converts a CSN expression structure to a human-readable string."""
    if isinstance(expr, dict):
        if "ref" in expr:
            ref = expr["ref"]
            return ".".join(ref) if isinstance(ref, list) else str(ref)
        if "val" in expr:
            v = expr["val"]
            return f"'{v}'" if isinstance(v, str) else str(v)
        if "func" in expr:
            args = [_format_csn_expr(a) for a in expr.get("args", [])]
            return f"{expr['func']}({', '.join(args)})"
        if "xpr" in expr:
            return _format_csn_expr(expr["xpr"])
    elif isinstance(expr, list):
        parts = [_format_csn_expr(item) for item in expr]
        return " ".join(parts)
    return str(expr)


def _format_csn_where(where_tokens: list[Any]) -> str:
    """Formats where clause tokens into a readable SQL condition."""
    parts = []
    for t in where_tokens:
        if isinstance(t, str):
            parts.append(t.upper() if t.lower() in ("and", "or", "not", "is", "null") else t)
        elif isinstance(t, dict):
            parts.append(_format_csn_expr(t))
        else:
            parts.append(str(t))
    return " ".join(parts)


def _parse_generic_table(name: str, item: dict[str, Any]) -> CDSObject:
    """Fallback parser for generic flat table structures."""
    label = item.get("business_name") or item.get("label") or name
    raw_cols = item.get("columns") or item.get("elements") or item.get("fields") or []

    columns: dict[str, ColumnMeta] = {}
    keys: list[str] = []
    measures: list[str] = []

    if isinstance(raw_cols, list):
        for c in raw_cols:
            if not isinstance(c, dict):
                continue
            c_name = c.get("name") or c.get("column_name") or "COL"
            dt = c.get("data_type") or c.get("dataType") or c.get("type") or "NVARCHAR"
            is_k = bool(c.get("is_key") or c.get("key"))
            c_label = c.get("label") or c.get("business_name") or c_name
            role = str(c.get("semantic_role") or c.get("role") or "").lower()
            is_m = role == "measure" or "DECIMAL" in str(dt).upper()

            if is_k:
                keys.append(c_name)
            if is_m:
                measures.append(c_name)

            columns[c_name] = ColumnMeta(
                name=c_name,
                data_type=str(dt),
                is_key=is_k,
                label=c_label,
                is_measure=is_m,
                aggregation=str(c.get("aggregation") or ""),
            )

    return CDSObject(
        name=name,
        object_type=item.get("kind") or "table",
        label=label,
        is_existing=True,
        columns=columns,
        keys=keys,
        measures=measures,
    )

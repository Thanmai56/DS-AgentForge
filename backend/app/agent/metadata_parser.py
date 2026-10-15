"""
Parser and normalizer for human-provided metadata.
Supports:
1. Structured JSON: {"tables": [{"name": "VBAK", "columns": [...]}]}
2. List of tables: [{"name": "VBAK", "columns": [...]}]
3. DDL-like text statements (CREATE TABLE ...)
4. Simple CSV / text column definitions
"""
import json
import re
from typing import Any


def parse_human_metadata(raw_metadata: Any) -> list[dict[str, Any]]:
    """
    Normalizes any human-provided metadata into a canonical list of table definitions:
    [
        {
            "name": "VBAK",
            "business_name": "Sales Document Header",
            "description": "...",
            "columns": [
                {
                    "name": "VBELN",
                    "data_type": "NVARCHAR(10)",
                    "is_key": True,
                    "semantic_role": "key",
                    "description": "Sales Document Number"
                },
                ...
            ],
            "associations": [
                {
                    "target": "KNA1",
                    "cardinality": "n..1",
                    "conditions": [{"left": "KUNNR", "right": "KUNNR"}]
                }
            ],
            "hierarchies": [...]
        }
    ]
    """
    if not raw_metadata:
        return []

    # If it's a string, try JSON parse first
    if isinstance(raw_metadata, str):
        raw_metadata = raw_metadata.strip()
        if not raw_metadata:
            return []
        try:
            parsed = json.loads(raw_metadata)
            return parse_human_metadata(parsed)
        except json.JSONDecodeError:
            # Fall back to DDL / text parsing
            return _parse_text_or_ddl(raw_metadata)

    # If dict with CSN "definitions" key
    if isinstance(raw_metadata, dict):
        if "definitions" in raw_metadata and isinstance(raw_metadata["definitions"], dict):
            tables = []
            for ent_name, ent_def in raw_metadata["definitions"].items():
                if not isinstance(ent_def, dict):
                    continue
                label = ent_def.get("@EndUserText.label") or ent_def.get("label") or ent_name
                raw_elements = ent_def.get("elements", {})
                cols = []
                if isinstance(raw_elements, dict):
                    for col_name, col_def in raw_elements.items():
                        if not isinstance(col_def, dict):
                            cols.append({"name": col_name, "data_type": "NVARCHAR(255)"})
                            continue
                        dt = col_def.get("@DataWarehouse.native.dataType") or col_def.get("type", "NVARCHAR")
                        if "length" in col_def:
                            dt = f"{dt}({col_def['length']})"
                        elif "precision" in col_def and "scale" in col_def:
                            dt = f"{dt}({col_def['precision']},{col_def['scale']})"
                        cols.append({
                            "name": col_name,
                            "data_type": str(dt),
                            "is_key": bool(col_def.get("key")),
                            "semantic_role": "measure" if col_def.get("@Analytics.measure") or "DECIMAL" in str(dt).upper() else ("key" if col_def.get("key") else "dimension"),
                            "description": col_def.get("@EndUserText.label") or col_name,
                            "business_name": col_def.get("@EndUserText.label") or col_name,
                        })
                tables.append({
                    "name": ent_name,
                    "business_name": label,
                    "description": label,
                    "columns": cols,
                    "kind": ent_def.get("kind", "entity"),
                    "query": ent_def.get("query"),
                })
            return [_normalize_table(t) for t in tables]

        if "tables" in raw_metadata and isinstance(raw_metadata["tables"], list):
            tables = raw_metadata["tables"]
        elif "tables" in raw_metadata and isinstance(raw_metadata["tables"], dict):
            tables = [{"name": k, **(v if isinstance(v, dict) else {})} for k, v in raw_metadata["tables"].items()]
        else:
            # Maybe the dict is a single table or map of table_name -> columns
            tables = []
            for k, v in raw_metadata.items():
                if isinstance(v, list):
                    tables.append({"name": k, "columns": v})
                elif isinstance(v, dict) and "columns" in v:
                    tables.append({"name": k, **v})
                else:
                    tables.append(raw_metadata)
                    break
        return [_normalize_table(t) for t in tables if isinstance(t, dict)]

    # If list of table dicts
    if isinstance(raw_metadata, list):
        return [_normalize_table(t) for t in raw_metadata if isinstance(t, dict)]

    return []


def _normalize_table(tbl: dict[str, Any]) -> dict[str, Any]:
    name = (tbl.get("name") or tbl.get("table_name") or tbl.get("object_name") or "UNKNOWN").upper().strip()
    business_name = tbl.get("business_name") or tbl.get("businessName") or tbl.get("label") or name
    description = tbl.get("description", f"Table {name}")

    raw_columns = tbl.get("columns", [])
    normalized_columns = []

    if isinstance(raw_columns, list):
        for col in raw_columns:
            if isinstance(col, str):
                col_name = col.strip()
                normalized_columns.append({
                    "name": col_name,
                    "data_type": "NVARCHAR(255)",
                    "is_key": "ID" in col_name.upper() or col_name.upper().endswith("_ID"),
                    "semantic_role": "key" if "ID" in col_name.upper() else "dimension",
                    "description": col_name,
                })
            elif isinstance(col, dict):
                col_name = (col.get("name") or col.get("column_name") or "COL").strip()
                data_type = col.get("data_type") or col.get("type") or col.get("dataType") or "NVARCHAR(255)"
                is_key = bool(col.get("is_key") or col.get("key") or col.get("isKey") or False)
                semantic_role = col.get("semantic_role") or col.get("semantic") or col.get("semanticUsage")
                
                # Infer semantic role if missing
                if not semantic_role:
                    dt_upper = data_type.upper()
                    if is_key:
                        semantic_role = "key"
                    elif any(num in dt_upper for num in ("DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "INT", "AMOUNT")):
                        semantic_role = "measure"
                    elif any(d in dt_upper for d in ("DATE", "TIME", "TIMESTAMP")):
                        semantic_role = "date"
                    else:
                        semantic_role = "dimension"

                normalized_columns.append({
                    "name": col_name,
                    "data_type": data_type,
                    "is_key": is_key,
                    "semantic_role": semantic_role,
                    "description": col.get("description") or col.get("business_name") or col_name,
                    "business_name": col.get("business_name") or col_name,
                    "aggregation": col.get("aggregation") or ("SUM" if semantic_role == "measure" else None),
                    "currency_key": col.get("currency_key") or col.get("currencyKey"),
                    "unit_key": col.get("unit_key") or col.get("unitKey"),
                })

    # Associations
    raw_assocs = tbl.get("associations") or tbl.get("relationships") or []
    normalized_assocs = []
    if isinstance(raw_assocs, list):
        for a in raw_assocs:
            if isinstance(a, dict):
                normalized_assocs.append({
                    "name": a.get("name") or f"Assoc_{name}_{a.get('target', 'DIM')}",
                    "target": a.get("target") or a.get("target_view") or a.get("to"),
                    "cardinality": a.get("cardinality") or "n..1",
                    "conditions": a.get("conditions") or a.get("foreign_key_mappings") or [],
                })

    # Hierarchies
    hierarchies = tbl.get("hierarchies", [])

    return {
        "name": name,
        "business_name": business_name,
        "description": description,
        "columns": normalized_columns,
        "associations": normalized_assocs,
        "hierarchies": hierarchies,
    }


def _parse_text_or_ddl(text: str) -> list[dict[str, Any]]:
    """Parse basic CREATE TABLE ... DDL or key: value text blocks."""
    tables = []
    # Match CREATE TABLE <name> (...)
    ddl_matches = re.finditer(
        r"create\s+table\s+([A-Za-z0-9_]+)\s*\((.*?)\);?",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    found_any = False
    for m in ddl_matches:
        found_any = True
        tbl_name = m.group(1).upper()
        cols_body = m.group(2)
        columns = []
        for line in cols_body.split(","):
            line = line.strip()
            if not line or line.upper().startswith(("PRIMARY KEY", "CONSTRAINT", "FOREIGN KEY")):
                continue
            parts = line.split()
            if parts:
                c_name = parts[0].strip('"`[]')
                c_type = parts[1].strip() if len(parts) > 1 else "NVARCHAR(255)"
                is_pk = "PRIMARY KEY" in line.upper()
                columns.append({
                    "name": c_name,
                    "type": c_type,
                    "key": is_pk,
                })
        tables.append({"name": tbl_name, "columns": columns})

    if found_any:
        return [_normalize_table(t) for t in tables]

    # Simple bullet points or line based table: columns format
    current_table = None
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.endswith(":") or line.upper().startswith("TABLE "):
            tbl_name = line.replace("TABLE", "").replace(":", "").strip().upper()
            current_table = {"name": tbl_name, "columns": []}
            tables.append(current_table)
        elif current_table and (line.startswith("-") or line.startswith("*")):
            col_part = line.lstrip("-* ").strip()
            parts = col_part.split()
            c_name = parts[0].strip('"`[]')
            c_type = parts[1] if len(parts) > 1 else "NVARCHAR(255)"
            current_table["columns"].append({"name": c_name, "type": c_type})

    return [_normalize_table(t) for t in tables]


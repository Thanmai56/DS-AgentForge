"""
JSON Compressor for LLM Input Optimization.

Reduces token consumption by 50% - 85% by:
1. Removing empty, null, and non-informative values (None, "", [], {}).
2. Pruning internal noisy metadata fields (IDs, timestamps, technical logs, default metrics).
3. Compacting tabular schemas into token-dense representations.
4. Minifying JSON serialization without whitespace.
5. Providing structured schema compacting for tables, columns, ViewSpecs, and associations.
"""
from __future__ import annotations

import json
import re
from typing import Any


# Internal / noisy fields that LLMs do not need for semantic reasoning
IGNORED_LLM_KEYS = {
    "id",
    "uuid",
    "table_id",
    "connection_id",
    "run_id",
    "user_id",
    "created_at",
    "updated_at",
    "discovered_at",
    "profiled_at",
    "last_tested_at",
    "last_test_ok",
    "last_test_message",
    "classification_source",
    "classification_confidence",
    "confidence_reasons",
    "profile_status",
    "position",
    "is_pii",
    "scale",
    "__v",
    "_id",
    "tenant_host",
    "oauth_token_url",
    "client_id",
    "client_secret",
}


def clean_and_prune_dict(obj: Any, preserve_keys: set[str] | None = None) -> Any:
    """
    Recursively remove nulls, empty collections, and non-essential system keys.
    """
    if preserve_keys is None:
        preserve_keys = set()

    if isinstance(obj, dict):
        cleaned = {}
        for k, v in obj.items():
            # Skip ignored system keys unless explicitly preserved
            if k in IGNORED_LLM_KEYS and k not in preserve_keys:
                continue

            cleaned_val = clean_and_prune_dict(v, preserve_keys)

            # Skip None / empty string / empty dict / empty list
            if cleaned_val is None or cleaned_val == "" or cleaned_val == {} or cleaned_val == []:
                continue

            # Simplify booleans where false is the obvious default
            if k in ("is_nullable", "is_remote", "is_replicated") and cleaned_val is False:
                continue

            cleaned[k] = cleaned_val

        return cleaned

    elif isinstance(obj, list):
        cleaned_list = [
            clean_and_prune_dict(item, preserve_keys)
            for item in obj
        ]
        # Filter out empty elements
        return [
            item for item in cleaned_list
            if item is not None and item != "" and item != {} and item != []
        ]

    elif isinstance(obj, float):
        # Round floats to 2 decimal places to save tokens
        return round(obj, 2)

    return obj


def compress_json(obj: Any, max_depth: int = 6) -> str:
    """
    Minify JSON without unnecessary whitespace or noise.
    Returns token-optimized minified JSON string.
    """
    if isinstance(obj, str):
        try:
            parsed = json.loads(obj)
            cleaned = clean_and_prune_dict(parsed)
            return json.dumps(cleaned, separators=(",", ":"), ensure_ascii=False)
        except Exception:
            # Not valid JSON, return stripped string
            return obj.strip()

    cleaned = clean_and_prune_dict(obj)
    return json.dumps(cleaned, separators=(",", ":"), ensure_ascii=False)


def compress_tables_schema_for_llm(tables: list[dict[str, Any]] | dict[str, Any]) -> str:
    """
    Compress full database or human-provided schemas into a dense notation.
    Example output:
    TABLE: VBAK [Sales Document Header]
      COLS: VBELN* (NVARCHAR(10), role:key), ERDAT (DATE, role:date), NETWR (DECIMAL(15,2), role:measure, agg:SUM)
    TABLE: VBRP [Sales Document Item]
      COLS: VBELN* (NVARCHAR(10)), POSNR* (NUMC(6)), NETWR (DECIMAL(15,2), agg:SUM)
    """
    if isinstance(tables, dict):
        if "tables" in tables and isinstance(tables["tables"], list):
            tables = tables["tables"]
        else:
            tables = [tables]

    if not isinstance(tables, list):
        return compress_json(tables)

    lines = []
    for t in tables:
        t_name = t.get("name") or t.get("object_name") or t.get("table_name") or "TABLE"
        b_name = t.get("business_name") or ""
        header = f"TABLE {t_name}" + (f" [{b_name}]" if b_name and b_name != t_name else "")

        col_parts = []
        raw_cols = t.get("columns") or []
        if isinstance(raw_cols, dict):
            # Form: {"COL_NAME": {"data_type": "...", ...}}
            raw_cols = [{"name": k, **v} if isinstance(v, dict) else {"name": k} for k, v in raw_cols.items()]

        for c in raw_cols:
            c_name = c.get("name") or c.get("column_name") or "COL"
            c_type = c.get("data_type") or c.get("dataType") or "NVARCHAR"
            is_key = c.get("is_key") or c.get("isKey") or False
            role = c.get("semantic_role") or c.get("semantic") or None
            agg = c.get("aggregation") or None
            expr = c.get("expression") or None

            key_marker = "*" if is_key else ""
            meta_tokens = []
            if role and role != "dimension":
                meta_tokens.append(f"role:{role}")
            if agg:
                meta_tokens.append(f"agg:{agg}")
            if expr:
                meta_tokens.append(f"calc:{expr}")

            meta_str = f" [{', '.join(meta_tokens)}]" if meta_tokens else ""
            col_parts.append(f"{c_name}{key_marker}({c_type}){meta_str}")

        lines.append(f"{header}:\n  COLS: {', '.join(col_parts)}")

        # Include associations if any
        assocs = t.get("associations") or []
        if assocs:
            assoc_tokens = []
            for a in assocs:
                target = a.get("target") or a.get("target_view")
                card = a.get("cardinality") or "1:N"
                assoc_tokens.append(f"-> {target} ({card})")
            lines.append(f"  ASSOC: {', '.join(assoc_tokens)}")

    return "\n".join(lines)


def compress_view_spec_for_llm(view_spec: dict[str, Any]) -> dict[str, Any]:
    """
    Extracts only the core modeling parameters of a ViewSpec (sources, operators, joins, filters, columns),
    stripping the heavy rendered_artifact, catalog references, and null fields.
    """
    compact = {
        "view": view_spec.get("view_name") or view_spec.get("objectId"),
        "kind": view_spec.get("kind"),
        "layer": view_spec.get("layer"),
        "businessName": view_spec.get("business_name") or view_spec.get("businessName"),
    }

    if view_spec.get("sources"):
        compact["sources"] = [
            {"name": s.get("object_name"), "alias": s.get("alias")}
            for s in view_spec["sources"]
        ]

    if view_spec.get("joins"):
        compact["joins"] = [
            {
                "left": j.get("left_source") or j.get("left"),
                "right": j.get("right_source") or j.get("right"),
                "type": j.get("join_type") or j.get("type"),
                "on": j.get("conditions"),
            }
            for j in view_spec["joins"]
        ]

    if view_spec.get("filters"):
        compact["filters"] = view_spec["filters"]

    if view_spec.get("columns"):
        compact["columns"] = [
            {
                "col": c.get("column_name") or c.get("name"),
                "type": c.get("data_type") or c.get("dataType"),
                "key": True if (c.get("is_key") or c.get("isKey")) else None,
                "role": c.get("semantic_role") or c.get("semantic"),
                "agg": c.get("aggregation"),
                "expr": c.get("expression"),
            }
            for c in view_spec["columns"]
        ]
        # Remove null keys in columns
        compact["columns"] = clean_and_prune_dict(compact["columns"])

    if view_spec.get("associations"):
        compact["associations"] = [
            {
                "target": a.get("target_view") or a.get("target"),
                "cardinality": a.get("cardinality"),
                "fk": a.get("foreign_key_mappings"),
            }
            for a in view_spec["associations"]
        ]

    if view_spec.get("hierarchies"):
        compact["hierarchies"] = view_spec["hierarchies"]

    return clean_and_prune_dict(compact)


def compress_for_llm(data: Any, optimize_schema: bool = True) -> str:
    """
    Master compression function to pass into LiteLLM/OpenAI prompts.
    Handles dict, list, stringified JSON, or complex schema trees.
    """
    if data is None:
        return ""

    if isinstance(data, str):
        stripped = data.strip()
        # Check if it's a JSON string
        if (stripped.startswith("{") and stripped.endswith("}")) or (stripped.startswith("[") and stripped.endswith("]")):
            try:
                parsed = json.loads(stripped)
                data = parsed
            except Exception:
                return stripped
        else:
            return stripped

    # If it's a list of tables or metadata dictionary, use high-density schema compressor
    if optimize_schema and isinstance(data, (list, dict)):
        is_table_schema = False
        if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
            if any(k in data[0] for k in ("name", "object_name", "columns", "table_name")):
                is_table_schema = True
        elif isinstance(data, dict) and ("tables" in data or ("name" in data and "columns" in data)):
            is_table_schema = True

        if is_table_schema:
            return compress_tables_schema_for_llm(data)

    # General minified & pruned JSON
    return compress_json(data)


def compute_compression_stats(original: Any, compressed: str) -> dict[str, Any]:
    """
    Calculate bytes and approximate token savings between original and compressed representations.
    """
    if isinstance(original, str):
        orig_str = original
    else:
        orig_str = json.dumps(original, indent=2, default=str)

    orig_bytes = len(orig_str.encode("utf-8"))
    comp_bytes = len(compressed.encode("utf-8"))

    # Approximate token calculation: ~4 chars per token for English/JSON
    orig_tokens = max(1, orig_bytes // 4)
    comp_tokens = max(1, comp_bytes // 4)

    savings_pct = round(((orig_bytes - comp_bytes) / max(1, orig_bytes)) * 100, 1)

    return {
        "original_bytes": orig_bytes,
        "compressed_bytes": comp_bytes,
        "original_tokens_est": orig_tokens,
        "compressed_tokens_est": comp_tokens,
        "tokens_saved_est": max(0, orig_tokens - comp_tokens),
        "savings_percentage": max(0.0, savings_pct),
    }


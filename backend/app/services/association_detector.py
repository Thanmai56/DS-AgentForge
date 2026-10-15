"""
Association Detector Service.
Detects join candidates between tables using:
1. Column name matching (same name in both tables)
2. SAP FK patterns (KUNNR, MATNR, LIFNR etc.)
3. Orphan ratio statistics via profiler P3
4. Data type compatibility
"""
import itertools
import logging
from typing import Any

from app.agent.sap_dictionary import SAP_DICTIONARY, classify_column
from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# SAP well-known FK column pairs
SAP_FK_PAIRS = {
    "KUNNR": {"table_hints": ["KNA1", "KNB1", "KNVV"], "semantic": "customer_id"},
    "LIFNR": {"table_hints": ["LFA1", "LFB1"], "semantic": "vendor_id"},
    "MATNR": {"table_hints": ["MARA", "MAKT", "MARC"], "semantic": "material_id"},
    "WERKS": {"table_hints": ["T001W", "MARD"], "semantic": "plant"},
    "VBELN": {"table_hints": ["VBAK", "VBAP", "VBRK", "VBRP", "LIKP", "LIPS"], "semantic": "order_id"},
    "BUKRS": {"table_hints": ["T001"], "semantic": "company_code"},
    "GJAHR": {"table_hints": [], "semantic": "fiscal_year"},
    "KOSTL": {"table_hints": ["CSKS"], "semantic": "cost_center"},
    "PRCTR": {"table_hints": ["CEPC"], "semantic": "profit_center"},
}


async def detect_join_candidates(
    tables: list[str],
    profiles: dict[str, dict],
    connection_id: str,
) -> list[dict[str, Any]]:
    """
    For each pair of tables, find join candidates.
    Returns list of candidate joins with orphan ratios from profile cache.
    """
    candidates = []
    table_pairs = list(itertools.combinations(tables, 2))

    for table_a, table_b in table_pairs:
        profile_a = profiles.get(table_a, {})
        profile_b = profiles.get(table_b, {})

        cols_a = set(profile_a.get("columns", {}).keys())
        cols_b = set(profile_b.get("columns", {}).keys())

        # 1. Direct column name matches
        shared_cols = cols_a & cols_b
        for col in shared_cols:
            meta_a = profile_a["columns"].get(col, {})
            meta_b = profile_b["columns"].get(col, {})

            # Skip mismatched data types
            if meta_a.get("data_type") and meta_b.get("data_type"):
                if _base_type(meta_a["data_type"]) != _base_type(meta_b["data_type"]):
                    continue

            # Get orphan ratio from pre-computed profile stats
            orphan_ratio = _get_orphan_ratio(profile_a, col, profile_b, col)

            classification = classify_column(col)
            semantic_type = classification.get("semantic_type") if classification else None

            candidates.append({
                "table_a": table_a,
                "col_a": col,
                "table_b": table_b,
                "col_b": col,
                "match_type": "column_name_match",
                "orphan_ratio": orphan_ratio,
                "total": profile_a.get("row_count", 0),
                "orphans": int((profile_a.get("row_count", 0) or 0) * orphan_ratio),
                "col_a_meta": meta_a,
                "col_b_meta": meta_b,
                "semantic_type": semantic_type,
                "confirmed": None,
                "cardinality": None,
                "business_verb": None,
                "confidence": _estimate_confidence(orphan_ratio, col, table_a, table_b),
            })

        # 2. SAP FK pattern matches (different column names)
        for fk_col, fk_info in SAP_FK_PAIRS.items():
            if fk_col in cols_a and fk_col not in cols_b:
                # table_b might be the dimension table for this FK
                for hint in fk_info["table_hints"]:
                    if hint.upper() in table_b.upper():
                        orphan_ratio = _get_orphan_ratio(profile_a, fk_col, profile_b, fk_col)
                        candidates.append({
                            "table_a": table_a,
                            "col_a": fk_col,
                            "table_b": table_b,
                            "col_b": fk_col,
                            "match_type": "sap_fk_pattern",
                            "orphan_ratio": orphan_ratio,
                            "total": profile_a.get("row_count", 0),
                            "orphans": int((profile_a.get("row_count", 0) or 0) * orphan_ratio),
                            "col_a_meta": profile_a.get("columns", {}).get(fk_col, {}),
                            "col_b_meta": profile_b.get("columns", {}).get(fk_col, {}),
                            "semantic_type": fk_info["semantic"],
                            "confirmed": None,
                            "cardinality": "N:1",  # hint from SAP knowledge
                            "business_verb": None,
                            "confidence": 0.85,
                        })

    # Deduplicate and sort by confidence
    seen = set()
    unique_candidates = []
    for c in sorted(candidates, key=lambda x: x.get("confidence", 0), reverse=True):
        key = f"{c['table_a']}.{c['col_a']}--{c['table_b']}.{c['col_b']}"
        if key not in seen:
            seen.add(key)
            unique_candidates.append(c)

    return unique_candidates


def _base_type(dtype: str) -> str:
    """Normalize data type for comparison (strip length/precision)."""
    if not dtype:
        return ""
    return dtype.upper().split("(")[0].strip()


def _get_orphan_ratio(profile_a: dict, col_a: str, profile_b: dict, col_b: str) -> float:
    """
    Get orphan ratio from the pre-computed profile stats.
    If not available, estimate from distinct value counts.
    """
    # Try direct from profile stats
    col_stats_a = profile_a.get("columns", {}).get(col_a, {})
    col_stats_b = profile_b.get("columns", {}).get(col_b, {})

    n_dist_a = col_stats_a.get("n_distinct") or 0
    n_dist_b = col_stats_b.get("n_distinct") or 0

    if n_dist_a > 0 and n_dist_b > 0:
        # Rough estimate: if B has fewer distinct values than A, some A rows have no match
        ratio = max(0.0, (n_dist_a - n_dist_b) / n_dist_a)
        return min(ratio, 1.0)

    return 0.1  # conservative default


def _estimate_confidence(orphan_ratio: float, col: str, table_a: str, table_b: str) -> float:
    """Estimate join confidence score."""
    base = 1.0 - orphan_ratio  # lower orphan = higher confidence

    # Boost if it's a well-known SAP column
    if col.upper() in SAP_DICTIONARY:
        base = min(base + 0.1, 1.0)

    # Boost if table names suggest a typical FK relationship
    if any(hint in table_a.upper() or hint in table_b.upper()
           for hint in ["KNA1", "MARA", "T001", "CSKS", "VBAK"]):
        base = min(base + 0.05, 1.0)

    return round(base, 3)

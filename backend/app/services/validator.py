"""
Deterministic Validation Engine — Rules V-01..V-08 (§13).
Runs AFTER build_views, regardless of confidence scores.
LLM output is never trusted directly — all views pass through here.
"""
import copy
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Datasphere reserved words (partial list — extend with real DS reserved words)
DS_RESERVED_WORDS = {
    "SELECT", "FROM", "WHERE", "JOIN", "ON", "AS", "AND", "OR", "NOT",
    "NULL", "TRUE", "FALSE", "CASE", "WHEN", "THEN", "ELSE", "END",
    "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "UNION", "ALL", "DISTINCT",
    "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "TABLE", "VIEW",
    "KEY", "INDEX", "PRIMARY", "FOREIGN", "CONSTRAINT",
    # DS-specific
    "MEASURE", "DIMENSION", "ATTRIBUTE", "ASSOCIATION", "ANALYTIC", "ENTITY",
}

NUMERIC_TYPES = {"INTEGER", "DECIMAL", "FLOAT", "DOUBLE", "BIGINT", "SMALLINT", "TINYINT", "NUMERIC"}
AMOUNT_SEMANTIC_TYPES = {"currency_amount", "amount"}
BALANCE_PRICE_SEMANTICS = {"balance", "price", "rate", "unit_price"}


def _get_col_data_type(col: dict) -> str:
    return (col.get("dataType") or col.get("data_type") or "").upper()


def _is_numeric_type(dtype: str) -> bool:
    return any(t in dtype for t in NUMERIC_TYPES)


ValidationIssue = dict[str, Any]


def validate_views(view_specs: list[dict], catalog: dict[str, dict] | None = None) -> dict[str, Any]:
    """Compatibility wrapper expected by the test suite and external callers."""
    profiles = catalog or {}
    report = validate_all(view_specs, profiles)
    blockers: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []
    for issues in report.values():
        for issue in issues:
            if issue.get("severity") == "BLOCKER":
                blockers.append(issue)
            else:
                warnings.append(issue)

    fixed_views = apply_auto_fixes(view_specs) if blockers else view_specs
    return {
        "passed": len(blockers) == 0,
        "blockers": blockers,
        "warnings": warnings,
        "fixed_views": fixed_views,
        "total_issues": len(blockers) + len(warnings),
    }


def validate_all(view_specs: list[dict], profiles: dict[str, dict]) -> dict[str, list[ValidationIssue]]:
    """
    Run all V-01..V-08 rules over all view specs.
    Returns {spec_object_id: [issues]} where each issue has severity, rule, message, field.
    """
    report: dict[str, list[ValidationIssue]] = {}

    for spec in view_specs:
        obj_id = spec.get("objectId", spec.get("object_id", "UNKNOWN"))
        issues: list[ValidationIssue] = []

        issues.extend(_v01_join_type_mismatch(spec, profiles))
        issues.extend(_v02_orphan_ratio(spec))
        issues.extend(_v03_key_uniqueness(spec, profiles))
        issues.extend(_v04_currency_binding(spec))
        issues.extend(_v05_non_additive_measure(spec))
        issues.extend(_v06_duplicate_reserved_column(spec))
        issues.extend(_v07_object_id_exists(spec, []))  # catalog passed separately
        issues.extend(_v08_viewspec_schema(spec))
        issues.extend(_v09_datasphere_filter_dialect(spec))
        issues.extend(_v10_performance_checks(spec, profiles))

        if issues:
            report[obj_id] = issues
            logger.info("Validation: %s → %d issues", obj_id, len(issues))

    return report


# ── V-01: Join column data type mismatch ─────────────────────────────────────

def _v01_join_type_mismatch(spec: dict, profiles: dict) -> list[ValidationIssue]:
    issues = []
    for op in spec.get("operators", []):
        if op.get("op") != "join":
            continue
        for cond in op.get("conditions", []):
            left_col = cond.get("left", "")
            right_col = cond.get("right", "")
            # Try to resolve data types from profile or projection
            left_type = _resolve_type(spec, profiles, left_col)
            right_type = _resolve_type(spec, profiles, right_col)
            if left_type and right_type and not _types_compatible(left_type, right_type):
                issues.append({
                    "rule": "V-01",
                    "severity": "BLOCKER",
                    "message": f"Join type mismatch: {left_col} ({left_type}) ↔ {right_col} ({right_type})",
                    "field": f"operators[join].conditions[{left_col}→{right_col}]",
                })
    return issues


def _resolve_type(spec: dict, profiles: dict, col_ref: str) -> str | None:
    """Resolve data type for a column reference like 'alias.COLUMN'."""
    for op in spec.get("operators", []):
        if op.get("op") == "projection":
            for col in op.get("columns", []):
                if col.get("name") == col_ref.split(".")[-1]:
                    return col.get("dataType", "")
    return None


def _types_compatible(t1: str, t2: str) -> bool:
    t1, t2 = t1.upper(), t2.upper()
    if t1 == t2:
        return True
    # VARCHAR/NVARCHAR compatible
    if all(x in ("VARCHAR", "NVARCHAR", "CHAR", "NCHAR") for x in [t1.split("(")[0], t2.split("(")[0]]):
        return True
    # Numeric compatible
    if all(_is_numeric_type(x) for x in [t1, t2]):
        return True
    return False


# ── V-02: Orphan ratio warning ────────────────────────────────────────────────

def _v02_orphan_ratio(spec: dict) -> list[ValidationIssue]:
    issues = []
    from app.core.config import get_settings
    threshold = get_settings().association_orphan_threshold

    for assoc in spec.get("associations", []):
        evidence = assoc.get("evidence", {})
        ratio = evidence.get("orphanRatio", 0.0)
        if ratio is None:
            continue
        if float(ratio) > threshold:
            issues.append({
                "rule": "V-02",
                "severity": "WARNING",
                "message": f"Association '{assoc.get('name')}' has orphan ratio {ratio:.1%} > {threshold:.0%}",
                "field": f"associations[{assoc.get('name')}]",
                "action": "needs_review",
            })
    return issues


# ── V-03: Key uniqueness ──────────────────────────────────────────────────────

def _v03_key_uniqueness(spec: dict, profiles: dict) -> list[ValidationIssue]:
    issues = []
    obj_id = spec.get("objectId", "")
    for op in spec.get("operators", []):
        if op.get("op") != "projection":
            continue
        for col in op.get("columns", []):
            if col.get("semantic") == "key":
                # Check profile for key duplicates
                source_ref = col.get("source", "")
                table = source_ref.split(".")[0] if "." in source_ref else obj_id
                col_name = source_ref.split(".")[-1]
                profile = profiles.get(table, {})
                col_profile = profile.get("columns", {}).get(col_name, {})
                dupes = col_profile.get("key_duplicates")
                if dupes is not None and int(dupes) > 0:
                    issues.append({
                        "rule": "V-03",
                        "severity": "BLOCKER",
                        "message": f"Key column '{col.get('name')}' has {dupes} duplicate value(s) — not unique",
                        "field": f"operators[projection].columns[{col.get('name')}]",
                    })
    return issues


# ── V-04: Measure without currency/unit binding ───────────────────────────────

def _v04_currency_binding(spec: dict) -> list[ValidationIssue]:
    issues = []
    for op in spec.get("operators", []):
        if op.get("op") != "projection":
            continue
        cols = op.get("columns", [])
        col_names = {c.get("name") for c in cols}
        for col in cols:
            if col.get("semantic") != "measure":
                continue
            semantic_type = col.get("semanticType") or col.get("semantic_type") or ""
            if semantic_type.lower() in AMOUNT_SEMANTIC_TYPES:
                # Must have currencyKey or unitKey
                currency_key = col.get("currencyKey") or col.get("currency_key")
                unit_key = col.get("unitKey") or col.get("unit_key")
                if not currency_key and not unit_key:
                    issues.append({
                        "rule": "V-04",
                        "severity": "ERROR",
                        "message": f"Measure '{col.get('name')}' has amount semantic type but no currencyKey/unitKey binding",
                        "field": f"operators[projection].columns[{col.get('name')}]",
                        "action": "Add currencyKey or convert to plain measure",
                    })
                elif currency_key and currency_key not in col_names:
                    issues.append({
                        "rule": "V-04",
                        "severity": "ERROR",
                        "message": f"Measure '{col.get('name')}' references missing currencyKey '{currency_key}'",
                        "field": f"operators[projection].columns[{col.get('name')}]",
                    })
    return issues


# ── V-05: Non-additive measure with SUM ──────────────────────────────────────

def _v05_non_additive_measure(spec: dict) -> list[ValidationIssue]:
    issues = []
    for op in spec.get("operators", []):
        if op.get("op") != "projection":
            continue
        for col in op.get("columns", []):
            if col.get("semantic") != "measure":
                continue
            agg = (col.get("aggregation") or "").upper()
            semantic_type = col.get("semanticType", "").lower()
            if agg == "SUM" and any(s in semantic_type for s in BALANCE_PRICE_SEMANTICS):
                issues.append({
                    "rule": "V-05",
                    "severity": "ERROR",
                    "message": f"Measure '{col.get('name')}' has balance/price semantic type but aggregation=SUM (non-additive)",
                    "field": f"operators[projection].columns[{col.get('name')}]",
                    "action": "Change to AVG or flag as LAST/NONE aggregation",
                })
    return issues


# ── V-06: Duplicate column names or reserved words (AUTO-FIX) ────────────────

def _v06_duplicate_reserved_column(spec: dict) -> list[ValidationIssue]:
    issues = []
    for op in spec.get("operators", []):
        if op.get("op") != "projection":
            continue
        seen_names: dict[str, int] = {}
        for col in op.get("columns", []):
            name = col.get("name", "")
            seen_names[name] = seen_names.get(name, 0) + 1
            if name.upper() in DS_RESERVED_WORDS:
                issues.append({
                    "rule": "V-06",
                    "severity": "WARNING",
                    "message": f"Column name '{name}' is a Datasphere reserved word",
                    "field": f"operators[projection].columns[{name}]",
                    "action": "auto_fix_suffix",
                })
        for name, count in seen_names.items():
            if count > 1:
                issues.append({
                    "rule": "V-06",
                    "severity": "WARNING",
                    "message": f"Duplicate output column name '{name}' appears {count} times",
                    "field": f"operators[projection].columns[{name}]",
                    "action": "auto_fix_suffix",
                })
    return issues


# ── V-07: Object ID already exists in imported catalog ────────────────────────

def _v07_object_id_exists(spec: dict, existing_object_ids: list[str]) -> list[ValidationIssue]:
    issues = []
    obj_id = spec.get("objectId", spec.get("object_id", ""))
    if obj_id in existing_object_ids:
        issues.append({
            "rule": "V-07",
            "severity": "WARNING",
            "message": f"Object ID '{obj_id}' already exists in imported catalog",
            "field": "objectId",
            "action": "offer_merge_rename",
        })
    return issues


# ── V-08: ViewSpec fails JSON Schema ─────────────────────────────────────────

VIEWSPEC_REQUIRED_FIELDS = {"objectId", "layer", "kind", "operators"}

def _v08_viewspec_schema(spec: dict) -> list[ValidationIssue]:
    issues = []
    missing = VIEWSPEC_REQUIRED_FIELDS - set(spec.keys())
    if missing:
        issues.append({
            "rule": "V-08",
            "severity": "BLOCKER",
            "message": f"ViewSpec missing required fields: {missing}",
            "field": "root",
        })
    layer = spec.get("layer", "")
    if layer not in ("L1", "L2", "L3", "L4"):
        issues.append({
            "rule": "V-08",
            "severity": "BLOCKER",
            "message": f"Invalid layer '{layer}'. Must be L1|L2|L3|L4",
            "field": "layer",
        })
    kind = spec.get("kind", "")
    valid_kinds = {"graphical_view", "sql_view", "business_entity", "analytic_model", "replication_config"}
    if kind not in valid_kinds:
        issues.append({
            "rule": "V-08",
            "severity": "BLOCKER",
            "message": f"Invalid kind '{kind}'. Must be one of {valid_kinds}",
            "field": "kind",
        })
    return issues


# ── V-09: Datasphere Filter Dialect ──────────────────────────────────────────

def _v09_datasphere_filter_dialect(spec: dict) -> list[ValidationIssue]:
    """Validate that all filter expressions adhere to Datasphere filter grammar."""
    from app.services.sql_generator import validate_filter_expression
    issues = []

    filters = spec.get("filters", [])
    for op in spec.get("operators", []):
        if op.get("op") == "filter" and op.get("expression"):
            filters.append(op["expression"])

    for expr in filters:
        if isinstance(expr, dict):
            expr = expr.get("expression", "")
        valid, err = validate_filter_expression(str(expr))
        if not valid:
            issues.append({
                "rule": "V-09",
                "severity": "WARNING",
                "message": f"Filter grammar warning: {err} in expression: '{expr}'",
                "field": "filter",
            })
    return issues


# ── V-10: Performance & Cartesian Product Checks ─────────────────────────────

def _v10_performance_checks(spec: dict, profiles: dict) -> list[ValidationIssue]:
    """Warn on potential performance bottlenecks (Cartesian joins, massive unpartitioned joins)."""
    issues = []
    for op in spec.get("operators", []):
        if op.get("op") == "join":
            conditions = op.get("conditions", [])
            if not conditions:
                issues.append({
                    "rule": "V-10",
                    "severity": "BLOCKER",
                    "message": f"Join between '{op.get('left')}' and '{op.get('right')}' has no join conditions (Cartesian product).",
                    "field": "join",
                })
    return issues


# ── Auto-fix V-06 ─────────────────────────────────────────────────────────────

def apply_auto_fixes(view_specs: list[dict]) -> list[dict]:
    """Apply auto-fix for V-06 (rename reserved/duplicate column names)."""
    fixed_specs = []
    for spec in view_specs:
        spec = copy.deepcopy(spec)
        for op in spec.get("operators", []):
            if op.get("op") != "projection":
                continue
            seen: dict[str, int] = {}
            for col in op.get("columns", []):
                name = col.get("name", "")
                upper = name.upper()
                if upper in DS_RESERVED_WORDS:
                    col["name"] = name + "_col"
                    name = col["name"]
                seen[name] = seen.get(name, 0) + 1
                if seen[name] > 1:
                    col["name"] = f"{name}_{seen[name]}"
        fixed_specs.append(spec)
    return fixed_specs

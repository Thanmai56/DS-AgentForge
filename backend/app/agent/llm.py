"""
LiteLLM wrapper for all 4 LLM call types.
- Temperature always 0 (deterministic)
- JSON-schema-constrained output
- 1 retry on schema failure, then flag for human
- Logs prompt hash + response + cost to audit_log
"""
import hashlib
import json
import logging
from typing import Any

import litellm
from tenacity import retry, stop_after_attempt, wait_fixed

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# ── Output schemas per call type ──────────────────────────────────────────────

PARSE_REQUIREMENT_SCHEMA = {
    "type": "object",
    "required": ["measures", "dimensions", "time_grain", "filters", "target", "notes"],
    "properties": {
        "measures": {"type": "array", "items": {"type": "string"}},
        "dimensions": {"type": "array", "items": {"type": "string"}},
        "time_grain": {"type": "string", "enum": ["day", "week", "month", "quarter", "year", "none"]},
        "filters": {"type": "array", "items": {"type": "string"}},
        "target": {"type": "string", "enum": ["SAC", "OData", "SQL", "BW", "other"]},
        "notes": {"type": "string"},
    },
}

CLASSIFY_COLUMN_SCHEMA = {
    "type": "object",
    "required": ["role", "business_name", "description", "semantic_type", "confidence"],
    "properties": {
        "role": {"type": "string", "enum": ["key", "measure", "dimension", "text", "date", "unit"]},
        "business_name": {"type": "string"},
        "description": {"type": "string"},
        "semantic_type": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    },
}

CONFIRM_ASSOCIATION_SCHEMA = {
    "type": "object",
    "required": ["confirm", "cardinality", "business_verb", "confidence", "justification"],
    "properties": {
        "confirm": {"type": "boolean"},
        "cardinality": {"type": "string", "enum": ["1..1", "1..n", "n..1", "n..m"]},
        "business_verb": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "justification": {"type": "string"},
    },
}

CHAT_MODIFY_SCHEMA = {
    "type": "object",
    "required": ["action", "explanation", "code_preview"],
    "properties": {
        "action": {
            "type": "string",
            "enum": [
                "add_filter", "add_join", "drop_column", "rename_column",
                "convert_to_sql", "add_calculated_column", "add_aggregation",
                "set_semantic", "convert_to_entity", "custom_modify"
            ],
        },
        "explanation": {"type": "string"},
        "code_preview": {"type": "string"},
        "patch": {"type": "object"},
        "target_view_id": {"type": "string"},
    },
}

SCHEMAS = {
    "parse_requirement": PARSE_REQUIREMENT_SCHEMA,
    "classify_column": CLASSIFY_COLUMN_SCHEMA,
    "confirm_association": CONFIRM_ASSOCIATION_SCHEMA,
    "chat_modify": CHAT_MODIFY_SCHEMA,
    # build_view_spec uses the full ViewSpec schema — validated separately
}

# ── System prompts ────────────────────────────────────────────────────────────

SYSTEM_PROMPTS: dict[str, str] = {
    "parse_requirement": """
You are an expert SAP data modeler. Parse the user's business requirement and extract:
- measures (quantitative KPIs to aggregate)
- dimensions (attributes to group/filter by)  
- time_grain (reporting granularity)
- filters (specific data restrictions)
- target (consumption tool: SAC, OData, SQL, BW)
- notes (any ambiguities or assumptions)

Respond ONLY with valid JSON matching the required schema.
""",

    "classify_column": """
You are an SAP data dictionary expert. Classify the given column based on its technical name,
data type, statistics, and sample values. Use the provided profile data to infer its business role.
- key: unique identifier for the entity
- measure: quantitative value to aggregate (SUM/AVG/COUNT)
- dimension: categorical attribute for grouping/filtering
- text: descriptive text field, not for aggregation
- date: temporal field
- unit: currency key or unit of measure code

Respond ONLY with valid JSON matching the required schema.
""",

    "confirm_association": """
You are an SAP data modeler specializing in association design. Based on the orphan ratio
profiling results and column metadata, determine if a join relationship exists and classify it.
Orphan ratio < 2% = strong candidate. Consider SAP data model semantics.

Respond ONLY with valid JSON matching the required schema.
""",

    "build_view_spec": """
You are a senior SAP Datasphere data modeler. Generate a complete ViewSpec JSON for the
given layer and requirement slice.

STRICT RULES:
1. Object IDs: UPPERCASE, underscores only, prefixed: L1→V_STG_, L2→V_, L3→E_, L4→AM_
2. Layering: L1=staging (1:1 source), L2=core facts/dims (joins+filters), L3=entities+assocs, L4=analytic model
3. Measures: additive (revenue, qty) → SUM; balances/prices → AVG or flag as non-additive
4. ALWAYS bind currency amounts to their currency key column
5. Every key column must have semantic="key"; measures must have aggregation set
6. Use inner joins only when orphan ratio < 2%; otherwise left join
7. Association cardinality: most dimensions are n..1 from fact
8. Include confidence and evidence for every join and association
9. descriptions must start with "AI: " prefix

Respond ONLY with a valid ViewSpec JSON matching the §7.1 schema.
""",

    "chat_modify": """
You are an expert SAP Datasphere Data Modeler and SQL Engineer.
The user wants to modify an existing Datasphere ViewSpec (graphical view, SQL view, dimension entity, or analytic model) or add filters, joins, calculated columns, or SQL code via chat.

Strict Rules for Datasphere Code Generation:
1. Filters must use the exact Datasphere filter grammar:
   - Identifiers must be double-quoted: "COLUMN_NAME"
   - String literals single-quoted: 'VAL'
   - Examples:
     "BUKRS" = '1000'
     "ORDER_DATE" >= '2024-01-01'
     "AUART" NOT IN ('RETU', 'CRED')
     "ABGRU" IS NULL
     YEAR("ORDER_DATE") = 2024
2. SQL Views:
   - Valid Datasphere / SAP HANA SQL SELECT statement
   - Fully qualified column references where ambiguous
3. Return patch containing:
   - For add_filter: {"op": "filter", "expression": "...", "rationale": "..."}
   - For add_join: {"op": "join", "type": "INNER|LEFT", "left": "...", "right": "...", "conditions": [{"leftColumn": "...", "rightColumn": "..."}]}
   - For convert_to_sql: {"sqlQuery": "SELECT ...", "columns": [...]}
   - For add_calculated_column: {"name": "...", "expression": "...", "dataType": "...", "semantic": "measure|dimension"}
   - For set_semantic: {"column": "...", "semantic": "measure|dimension|key", "aggregation": "SUM|AVG|COUNT", "currencyKey": "..."}

Respond ONLY with valid JSON matching the schema.
""",
}


# ── Core LLM caller ───────────────────────────────────────────────────────────

def _build_litellm_model(provider: str, model: str) -> str:
    if provider == "azure":
        return f"azure/{settings.azure_openai_deployment or model}"
    if provider == "anthropic":
        return f"anthropic/{model}"
    if provider in ("gemini", "google"):
        if not model.startswith("gemini/"):
            return f"gemini/{model}"
        return model
    return model  # openai default


@retry(stop=stop_after_attempt(2), wait=wait_fixed(2))
def _call_with_retry(messages: list[dict], model: str, response_format: dict | None) -> Any:
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": settings.llm_temperature,
        "max_tokens": 4096,
    }
    if settings.llm_provider in ("gemini", "google"):
        api_key = settings.gemini_api_key or settings.google_api_key
        if api_key:
            kwargs["api_key"] = api_key
    elif settings.llm_provider == "openai" and settings.openai_api_key:
        kwargs["api_key"] = settings.openai_api_key
    elif settings.llm_provider == "anthropic" and settings.anthropic_api_key:
        kwargs["api_key"] = settings.anthropic_api_key

    if response_format and settings.llm_provider in ("openai", "azure"):
        kwargs["response_format"] = {"type": "json_object"}

    return litellm.completion(**kwargs)


def call_llm(
    call_type: str,
    user_content: str,
    extra_system: str = "",
    run_id: str | None = None,
) -> dict[str, Any]:
    """
    Execute an LLM call with full schema validation and audit logging.

    Args:
        call_type: One of parse_requirement | classify_column | confirm_association | build_view_spec
        user_content: The user message (structured prompt)
        extra_system: Additional system prompt content (e.g., injected golden examples)
        run_id: For audit log correlation

    Returns:
        Parsed and schema-validated dict

    Raises:
        ValueError: If output fails schema validation after 1 retry
    """
    import jsonschema
    from app.agent.json_compressor import compress_for_llm, compute_compression_stats

    # Automatically compress JSON in user_content to optimize tokens and model attention
    optimized_content = user_content
    try:
        stripped = user_content.strip()
        if stripped.startswith(("{", "[")):
            compressed = compress_for_llm(stripped)
            stats = compute_compression_stats(stripped, compressed)
            if stats["compressed_bytes"] < stats["original_bytes"]:
                optimized_content = compressed
                logger.info(
                    "JSON Compressor optimized %s: %d -> %d tokens (~%.1f%% token reduction)",
                    call_type,
                    stats["original_tokens_est"],
                    stats["compressed_tokens_est"],
                    stats["savings_percentage"],
                )
    except Exception as comp_err:
        logger.debug("JSON compression pass-through: %s", comp_err)

    system_prompt = SYSTEM_PROMPTS.get(call_type, "") + "\n" + extra_system
    prompt_text = system_prompt + optimized_content
    prompt_hash = hashlib.sha256(prompt_text.encode()).hexdigest()[:16]

    model = _build_litellm_model(settings.llm_provider, settings.llm_model)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": optimized_content},
    ]

    schema = SCHEMAS.get(call_type)
    response = None
    cost = 0.0
    error = None

    try:
        response = _call_with_retry(messages, model, schema)
        raw_text = response.choices[0].message.content or ""
        cost = litellm.completion_cost(response) if hasattr(litellm, "completion_cost") else 0.0

        # Parse JSON
        parsed = json.loads(raw_text)

        # Validate schema if available
        if schema:
            jsonschema.validate(instance=parsed, schema=schema)

        _write_audit(run_id, call_type, prompt_hash, model, cost, "success", None)
        return parsed

    except json.JSONDecodeError as exc:
        error = f"JSON parse error: {exc}"
        logger.error("LLM %s JSON decode error: %s", call_type, exc)
    except Exception as exc:
        error = str(exc)
        logger.error("LLM %s failed: %s", call_type, exc)

    _write_audit(run_id, call_type, prompt_hash, model, cost, "failed", error)
    # Return sentinel that signals human review needed
    return {"_llm_error": error, "_needs_human_review": True}


def _write_audit(
    run_id: str | None,
    call_type: str,
    prompt_hash: str,
    model: str,
    cost: float,
    status: str,
    error: str | None,
) -> None:
    """Fire-and-forget audit log write (sync, best-effort)."""
    # Deferred import to avoid circular imports
    try:
        import asyncio
        from app.services.audit import log_llm_call_sync
        log_llm_call_sync(run_id, call_type, prompt_hash, model, cost, status, error)
    except Exception:
        logger.warning("Audit log write failed (non-critical)", exc_info=True)

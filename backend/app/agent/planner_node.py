"""
Planner Node.

Orchestrates the LLM planning cycle:
1. Builds user message: REQUIREMENT / SOURCE METADATA / DATA PROFILE / SAMPLE ROWS
2. Calls the LLM with planner_system.md
3. Validates output with Pydantic (Plan model)
4. Validates output with deterministic Plan Checker (tables/columns exist, step inputs exist, no cycles, join keys exist)
5. Automatically retries on invalid output, feeding specific validation errors back to the LLM
6. Returns validated Plan.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any, Optional
import logging

from app.agent.plan_models import Plan
from app.agent.cds_extractor import ExtractedMetadata
from app.agent.profiler import DataProfile
from app.agent.plan_checker import check_plan, PlanCheckResult
from app.agent.llm_provider import LLMProvider, get_llm_provider

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_PATH = Path(__file__).parent / "prompts" / "planner_system.md"


class PlannerError(Exception):
    """Raised when plan generation fails validation after retries."""
    pass


def load_planner_system_prompt() -> str:
    """Loads the planner system prompt markdown file."""
    if not SYSTEM_PROMPT_PATH.exists():
        raise FileNotFoundError(f"Planner system prompt not found at {SYSTEM_PROMPT_PATH}")
    return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8").strip()


from datetime import datetime, timezone
from app.agent.inspection import InspectionTrace, LLMAttemptLog, StageLLMInspection


def build_planner_user_message(
    requirement: str,
    metadata: ExtractedMetadata,
    profile: Optional[DataProfile] = None,
    sample_data_text: Optional[str] = None,
) -> str:
    """
    Constructs the exact user message expected by planner_system.md:
    REQUIREMENT / SOURCE METADATA / SAMPLE DATA
    """
    sample_content = sample_data_text
    if not sample_content:
        if profile and hasattr(profile, "sample_rows_text"):
            sample_content = profile.sample_rows_text()
        else:
            sample_content = "No sample data provided. Planning based on metadata alone."

    sections = [
        "REQUIREMENT:",
        requirement.strip(),
        "",
        "SOURCE METADATA:",
        metadata.to_compact_text(),
    ]

    # Optional DATA PROFILE section if profiling data is supplied
    if profile:
        prof_text = profile.to_text()
        if prof_text and "No sample rows" not in prof_text:
            sections.extend(["", "DATA PROFILE:", prof_text])

    sections.extend([
        "",
        "SAMPLE DATA:",
        sample_content.strip(),
    ])
    return "\n".join(sections).strip()


def generate_plan(
    requirement: str,
    metadata: ExtractedMetadata,
    profile: Optional[DataProfile] = None,
    sample_data_text: Optional[str] = None,
    provider: LLMProvider | None = None,
    max_retries: int = 3,
    inspection_trace: Optional[InspectionTrace] = None,
) -> Plan:
    """
    Generates and validates a modeling plan.
    Retries automatically on invalid JSON, Pydantic failure, or PlanChecker errors.
    Records full inspection trace across attempts.
    """
    llm = provider or get_llm_provider()
    system_prompt = load_planner_system_prompt()
    user_prompt = build_planner_user_message(
        requirement=requirement,
        metadata=metadata,
        profile=profile,
        sample_data_text=sample_data_text,
    )

    if inspection_trace:
        provider_name = getattr(llm, "provider_name", type(llm).__name__)
        model_name = getattr(llm, "model", "default")
        inspection_trace.stage_llm = StageLLMInspection(
            provider=provider_name,
            model=model_name,
            system_prompt=system_prompt,
            total_attempts=0,
            attempts=[],
            final_status="pending",
        )

    current_prompt = user_prompt
    last_errors: list[str] = []

    for attempt in range(1, max_retries + 1):
        logger.info("Planner attempt %d/%d", attempt, max_retries)
        if inspection_trace:
            inspection_trace.stage_llm.total_attempts = attempt

        raw_response = llm.generate(system_prompt=system_prompt, user_prompt=current_prompt)

        attempt_log = LLMAttemptLog(
            attempt_number=attempt,
            timestamp=datetime.now(timezone.utc).isoformat(),
            prompt_chars=len(current_prompt),
            user_prompt_sent=current_prompt,
            raw_response=raw_response,
        )

        # 1. Extract JSON from response (handling potential markdown fences)
        cleaned_json_str = _extract_json_string(raw_response)
        if not cleaned_json_str:
            last_errors = [f"Output did not contain valid JSON: {raw_response[:200]}"]
            attempt_log.json_parse_status = "error"
            attempt_log.errors = list(last_errors)
            if inspection_trace:
                inspection_trace.stage_llm.attempts.append(attempt_log)
            current_prompt = _build_retry_prompt(user_prompt, last_errors)
            continue

        # 2. Parse JSON
        try:
            plan_dict = _normalize_operation_aliases(_parse_planner_json(cleaned_json_str))
        except json.JSONDecodeError as exc:
            context_start = max(0, exc.pos - 80)
            context_end = min(len(cleaned_json_str), exc.pos + 80)
            context = cleaned_json_str[context_start:context_end].replace("\n", "\\n")
            last_errors = [
                f"JSON syntax error: {exc.msg} at line {exc.lineno}, "
                f"column {exc.colno} near '{context}'"
            ]
            attempt_log.json_parse_status = "error"
            attempt_log.errors = list(last_errors)
            if inspection_trace:
                inspection_trace.stage_llm.attempts.append(attempt_log)
            current_prompt = _build_retry_prompt(user_prompt, last_errors)
            continue

        # 3. Pydantic validation
        try:
            plan = Plan.model_validate(plan_dict)
        except Exception as exc:
            last_errors = [f"Schema validation error: {str(exc)}"]
            attempt_log.pydantic_status = "error"
            attempt_log.errors = list(last_errors)
            if inspection_trace:
                inspection_trace.stage_llm.attempts.append(attempt_log)
            current_prompt = _build_retry_prompt(user_prompt, last_errors)
            continue

        # 4. Deterministic Plan Checker validation
        check_result: PlanCheckResult = check_plan(plan, metadata)
        if not check_result.is_valid:
            last_errors = check_result.errors
            logger.warning("Plan checker failed with %d errors: %s", len(last_errors), last_errors)
            attempt_log.plan_checker_status = "error"
            attempt_log.errors = list(last_errors)
            if inspection_trace:
                inspection_trace.stage_llm.attempts.append(attempt_log)
            current_prompt = _build_retry_prompt(user_prompt, last_errors)
            continue

        # Success!
        logger.info("Plan generated successfully on attempt %d with %d nodes", attempt, len(plan.nodes))
        if inspection_trace:
            inspection_trace.stage_llm.attempts.append(attempt_log)
            inspection_trace.stage_llm.final_status = "success"
            inspection_trace.final_plan_node_count = len(plan.nodes)
        return plan

    if inspection_trace:
        inspection_trace.stage_llm.final_status = "failed"
        inspection_trace.stage_llm.final_error = "; ".join(last_errors)

    raise PlannerError(
        f"Failed to generate a valid plan after {max_retries} attempts. Last errors: {'; '.join(last_errors)}"
    )


def _normalize_operation_aliases(plan_data: Any) -> Any:
    """Map common Datasphere operator labels to the planner's canonical operations."""
    if not isinstance(plan_data, dict):
        return plan_data

    nodes = plan_data.get("nodes")
    if not isinstance(nodes, list):
        return plan_data

    operation_aliases = {
        "relational_dataset": "projection",
        "relational dataset": "projection",
        "aggregation": "measure",
    }

    wrapper_id_aliases = {
        node.get("id"): re.sub(
            r"^L1_(.+)_Wrapper$",
            r"WRAP_\1",
            node.get("id"),
            flags=re.IGNORECASE,
        )
        for node in nodes
        if isinstance(node, dict)
        and isinstance(node.get("id"), str)
        and re.match(r"^L1_(.+)_Wrapper$", node["id"], flags=re.IGNORECASE)
    }

    def rewrite_wrapper_reference(value: Any) -> Any:
        if isinstance(value, str):
            rewritten = wrapper_id_aliases.get(value, value)
            for old_id, new_id in wrapper_id_aliases.items():
                rewritten = re.sub(
                    rf"(?<![A-Za-z0-9_]){re.escape(old_id)}(?=\.)",
                    new_id,
                    rewritten,
                )
            return rewritten
        if isinstance(value, list):
            return [rewrite_wrapper_reference(item) for item in value]
        if isinstance(value, dict):
            return {key: rewrite_wrapper_reference(item) for key, item in value.items()}
        return value

    if wrapper_id_aliases:
        for node in nodes:
            if isinstance(node, dict):
                rewritten = rewrite_wrapper_reference(node)
                node.clear()
                node.update(rewritten)

    def _format_value(value: Any) -> str:
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        if isinstance(value, str):
            escaped = value.replace("'", "''")
            return f"'{escaped}'"
        return str(value)

    def _rule_strings(value: Any) -> list[str]:
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            result: list[str] = []
            for item in value:
                result.extend(_rule_strings(item))
            return result
        if isinstance(value, dict):
            field = value.get("field") or value.get("column") or value.get("left")
            operator = value.get("op") or value.get("operator")
            if field and operator and "value" in value:
                return [f'"{field}" {operator} {_format_value(value["value"])}']
            expression = value.get("expression") or value.get("sql")
            if isinstance(expression, str):
                return [expression]
        return []

    for node in nodes:
        if not isinstance(node, dict):
            continue
        operation = node.get("operation")
        if isinstance(operation, str):
            canonical = operation.strip().lower()
            node["operation"] = operation_aliases.get(canonical, canonical)
        details = node.setdefault("details", {})
        if not isinstance(details, dict):
            details = {}
            node["details"] = details

        for target, aliases in {
            "conditions": ("conditions", "filters", "where"),
            "formulas": ("formulas", "calculations"),
        }.items():
            values = _rule_strings(details.get(target, []))
            for alias in aliases:
                for container in (node, details):
                    values.extend(_rule_strings(container.get(alias)))
            normalized_values = [
                value.strip()
                for value in values
                if value.strip()
            ]
            details[target] = list(dict.fromkeys(normalized_values))
            if target == "conditions":
                details["filters"] = list(details[target])

        if isinstance(node.get("condition"), str) and node["condition"].strip():
            details["condition"] = node["condition"].strip()
            details["conditions"] = list(dict.fromkeys([
                *details.get("conditions", []), details["condition"]
            ]))
        if isinstance(node.get("formula"), str) and node["formula"].strip():
            details["formula"] = node["formula"].strip()
            details["formulas"] = list(dict.fromkeys([
                *details.get("formulas", []), details["formula"]
            ]))
    return plan_data


def _extract_json_string(text: str) -> str:
    """Extracts JSON substring, stripping markdown code fences if present."""
    text = text.strip()

    # If wrapped in markdown ```json ... ```
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()

    # If already raw JSON object
    if text.startswith("{") and text.endswith("}"):
        return text

    # Attempt to locate first { and last }
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        return text[first_brace : last_brace + 1].strip()

    return text


def _parse_planner_json(text: str) -> Any:
    """Parse planner JSON, tolerating only harmless trailing commas."""
    try:
        return json.loads(text)
    except json.JSONDecodeError as original_error:
        repaired = _remove_json_trailing_commas(text)
        if repaired == text:
            raise
        try:
            return json.loads(repaired)
        except json.JSONDecodeError:
            raise original_error


def _remove_json_trailing_commas(text: str) -> str:
    """Remove commas immediately before } or ], without touching JSON strings."""
    output: list[str] = []
    in_string = False
    escaped = False
    index = 0

    while index < len(text):
        char = text[index]
        if in_string:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue

        if char == '"':
            in_string = True
            output.append(char)
            index += 1
            continue

        if char == ",":
            next_index = index + 1
            while next_index < len(text) and text[next_index].isspace():
                next_index += 1
            if next_index < len(text) and text[next_index] in "}]":
                index += 1
                continue

        output.append(char)
        index += 1

    return "".join(output)


def _build_retry_prompt(original_prompt: str, errors: list[str]) -> str:
    """Builds the retry feedback prompt showing what went wrong."""
    error_list = "\n".join(f"- {err}" for err in errors)
    return (
        f"{original_prompt}\n\n"
        f"CRITICAL: Your previous output failed validation with the following error(s):\n"
        f"{error_list}\n\n"
        f"Please correct these errors. Make sure you use ONLY tables and columns from SOURCE METADATA, "
        f"ensure each join key uses the exact technical column available on its respective input "
        f"(use metadata labels to identify equivalent columns), eliminate any dependency cycles. "
        f"Return ONLY machine-parseable JSON: escape double quotes inside formula strings, "
        f"prefer bare technical column names in formulas, use single quotes for SQL string "
        f"literals, and do not emit trailing commas."
    )

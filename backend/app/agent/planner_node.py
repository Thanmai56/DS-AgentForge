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
from typing import Any
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
            plan_dict = json.loads(cleaned_json_str)
        except json.JSONDecodeError as exc:
            last_errors = [f"JSON syntax error: {exc.msg} at line {exc.lineno}"]
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


def _extract_json_string(text: str) -> str:
    """Extracts JSON substring, stripping markdown code fences if present."""
    text = text.strip()

    # If wrapped in markdown ```json ... ```
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
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


def _build_retry_prompt(original_prompt: str, errors: list[str]) -> str:
    """Builds the retry feedback prompt showing what went wrong."""
    error_list = "\n".join(f"- {err}" for err in errors)
    return (
        f"{original_prompt}\n\n"
        f"CRITICAL: Your previous output failed validation with the following error(s):\n"
        f"{error_list}\n\n"
        f"Please correct these errors. Make sure you use ONLY tables and columns from SOURCE METADATA, "
        f"ensure all join keys exist, eliminate any dependency cycles, and return ONLY valid JSON."
    )

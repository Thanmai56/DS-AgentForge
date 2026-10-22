"""
Unit tests for Step 3: Planner Node (LLM provider interface, prompt assembler, validation & retry loop).
Tests:
- Prompt assembler: REQUIREMENT / SOURCE METADATA / DATA PROFILE / SAMPLE ROWS
- Successful plan generation with FakeLLMProvider (no internet, no database)
- Auto-retry on invalid JSON / syntax error
- Auto-retry on deterministic PlanChecker error (e.g. hallucinated column)
- Exception raising when max retries are exhausted
"""
import copy
import json
from pathlib import Path
import pytest

from app.agent.cds_extractor import parse_csn_metadata
from app.agent.profiler import profile_data
from app.agent.llm_provider import FakeLLMProvider, DEFAULT_FIXTURE_PLAN
from app.agent.planner_node import (
    build_planner_user_message,
    generate_plan,
    load_planner_system_prompt,
    PlannerError,
)

FIXTURE_PATH = Path(__file__).parent.parent.parent / "fixtures" / "reference" / "F_PO_PROCESSING_TIME_APT (1).json"


@pytest.fixture
def sample_metadata_and_profile():
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        csn = json.load(f)
    meta = parse_csn_metadata(csn)
    profile = profile_data(meta, tables_data=None)
    return meta, profile


def test_build_planner_user_message(sample_metadata_and_profile):
    """Verify prompt builder contains all 4 required sections."""
    meta, profile = sample_metadata_and_profile
    requirement = "Compute Purchase Order Average Processing Time (APT) grouped by supplier."

    message = build_planner_user_message(requirement, meta, profile)

    assert "REQUIREMENT:" in message
    assert requirement in message
    assert "SOURCE METADATA:" in message
    assert "[TABLE] ZIPOHDRAPT" in message
    assert "[VIEW] V_PO_FINAL_DELIVERY_APT" in message
    assert "DATA PROFILE:" in message
    assert "SAMPLE DATA:" in message


def test_load_planner_system_prompt():
    """Verify that planner_system.md loads properly."""
    prompt = load_planner_system_prompt()
    assert "SAP Datasphere modeling architect" in prompt
    assert "Allowed operations:" in prompt
    assert '"calculated_fields":[{"name":"","formula":"","label":"","data_type":""}]' in prompt
    assert "Do not collapse multiple requested formulas" in prompt
    assert "Output ONLY valid JSON in this format:" in prompt


def test_generate_plan_success(sample_metadata_and_profile):
    """Verify FakeLLMProvider generates a valid plan on attempt 1."""
    meta, profile = sample_metadata_and_profile
    fake_llm = FakeLLMProvider()

    plan = generate_plan(
        requirement="Compute PO Average Processing Time",
        metadata=meta,
        profile=profile,
        provider=fake_llm,
        max_retries=3,
    )

    assert plan is not None
    assert len(plan.nodes) == 3
    assert plan.nodes[0].id == "V_PO_FINAL_DELIVERY_APT"
    assert plan.nodes[0].is_existing is True
    fact = next(node for node in plan.nodes if node.id == "F_PO_PROCESSING_TIME_APT")
    assert [field.name for field in fact.calculated_fields] == [
        "Processing_Days",
        "Total_Delivered_Order",
    ]
    assert all(field.name in fact.columns for field in fact.calculated_fields)
    assert plan.measures[0].name == "Total_Delivered_Order"
    assert len(fake_llm.call_history) == 1


def test_planner_checker_retains_all_named_calculated_columns(sample_metadata_and_profile):
    meta, profile = sample_metadata_and_profile
    fake_llm = FakeLLMProvider()

    plan = generate_plan(
        requirement="Compute processing days and delivered order count in the fact.",
        metadata=meta,
        profile=profile,
        provider=fake_llm,
    )

    fact = next(node for node in plan.nodes if node.id == "F_PO_PROCESSING_TIME_APT")
    assert [(field.name, field.formula) for field in fact.calculated_fields] == [
        ("Processing_Days", "DAYS_BETWEEN(TO_DATE(CREATIONDATE), TO_DATE(FINAL_DELIVERY_DATE)) + 1"),
        ("Total_Delivered_Order", "1"),
    ]
    assert {"Processing_Days", "Total_Delivered_Order"}.issubset(set(fact.columns))


def test_generate_plan_retry_on_invalid_json(sample_metadata_and_profile):
    """Verify planner node retries when LLM returns invalid JSON syntax."""
    meta, profile = sample_metadata_and_profile

    # 1st attempt: broken JSON, 2nd attempt: valid JSON
    broken_response = "I am an AI and here is the plan: { broken json..."
    valid_response = json.dumps(DEFAULT_FIXTURE_PLAN)

    fake_llm = FakeLLMProvider(responses=[broken_response, valid_response])

    plan = generate_plan(
        requirement="Compute PO Average Processing Time",
        metadata=meta,
        profile=profile,
        provider=fake_llm,
        max_retries=3,
    )

    assert plan is not None
    assert len(fake_llm.call_history) == 2
    # Verify retry prompt included error feedback
    assert "CRITICAL: Your previous output failed validation" in fake_llm.call_history[1]["user"]


def test_generate_plan_retry_on_hallucinated_column(sample_metadata_and_profile):
    """Verify planner node retries when PlanChecker catches a hallucinated column."""
    meta, profile = sample_metadata_and_profile

    # Create a plan with a hallucinated column
    bad_plan = copy.deepcopy(DEFAULT_FIXTURE_PLAN)
    bad_plan["nodes"][0]["columns"].append("NON_EXISTENT_GHOST_COLUMN")

    good_plan = json.dumps(DEFAULT_FIXTURE_PLAN)

    fake_llm = FakeLLMProvider(responses=[json.dumps(bad_plan), good_plan])

    plan = generate_plan(
        requirement="Compute PO Average Processing Time",
        metadata=meta,
        profile=profile,
        provider=fake_llm,
        max_retries=3,
    )

    assert plan is not None
    assert len(fake_llm.call_history) == 2
    # Second call prompt must cite the hallucinated column error
    assert "NON_EXISTENT_GHOST_COLUMN" in fake_llm.call_history[1]["user"]


def test_generate_plan_exhausts_retries_raises_error(sample_metadata_and_profile):
    """Verify PlannerError is raised after max_retries attempts fail."""
    meta, profile = sample_metadata_and_profile

    bad_plan = copy.deepcopy(DEFAULT_FIXTURE_PLAN)
    bad_plan["nodes"][0]["inputs"] = ["COMPLETELY_FAKE_TABLE"]

    fake_llm = FakeLLMProvider(
        responses=[
            json.dumps(bad_plan),
            json.dumps(bad_plan),
            json.dumps(bad_plan),
        ]
    )

    with pytest.raises(PlannerError) as exc_info:
        generate_plan(
            requirement="Compute PO Average Processing Time",
            metadata=meta,
            profile=profile,
            provider=fake_llm,
            max_retries=3,
        )

    assert "Failed to generate a valid plan after 3 attempts" in str(exc_info.value)
    assert "COMPLETELY_FAKE_TABLE" in str(exc_info.value)
    assert len(fake_llm.call_history) == 3

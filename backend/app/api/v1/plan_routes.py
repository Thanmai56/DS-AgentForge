"""
REST API Endpoints for Modeling Plan Generation and Revision.

Database-free, in-memory endpoints:
- POST /api/plan: Generate a new modeling plan from requirement + CSN/JSON metadata
- POST /api/plan/revise: Revise an existing plan via targeted instruction or direct step edit
- GET /api/plan/{id}: Retrieve a stored plan session
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from typing import Any, Optional, Union
import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, ConfigDict

from app.agent.plan_models import Plan, PlanNode
from app.agent.cds_extractor import parse_csn_metadata, ExtractedMetadata
from app.agent.profiler import profile_data, DataProfile
from app.agent.plan_checker import check_plan
from app.agent.planner_node import generate_plan, load_planner_system_prompt, PlannerError
from app.agent.llm_provider import get_llm_provider, LLMProvider
from app.agent.sample_mapper import parse_and_map_sample_data, SampleMappingResult
from app.agent.inspection import (
    InspectionTrace,
    record_metadata_stage,
    record_compaction_stage,
    record_sample_mapping_stage,
    save_inspection_trace,
    get_inspection_trace,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["plan"])

# In-memory storage for database-free operation
PLAN_SESSIONS: dict[str, dict[str, Any]] = {}


# ── Request / Response Models ────────────────────────────────────────────────

class GeneratePlanRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    requirement: str = Field(..., description="Natural language KPI modeling requirement")
    metadata: Any = Field(..., description="Raw CSN JSON object, list of tables, or metadata dictionary")
    mock_data: Optional[dict[str, str]] = Field(
        default=None, description="Optional map of table_name -> CSV content"
    )
    sample_data: Optional[Union[str, dict[str, str]]] = Field(
        default=None, description="Optional pasted sample rows (CSV, TSV, pipe, or map of table_name -> sample rows)"
    )
    row_limit: Optional[int] = Field(
        default=5, description="Maximum sample rows to retain per table in LLM prompt"
    )
    filename: Optional[str] = Field(
        default="uploaded_metadata.json", description="Source filename for inspection trace"
    )


class GeneratePlanResponse(BaseModel):
    plan_id: str
    request_id: str
    plan: Plan
    metadata_summary: str
    profile_summary: str
    sample_data_summary: str = ""
    warnings: list[str] = Field(default_factory=list)
    created_at: str


class RevisePlanRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    plan_id: str = Field(..., description="ID of the plan session to revise")
    instruction: Optional[str] = Field(
        default=None, description="Natural language revision prompt (e.g. 'Change join to LEFT join')"
    )
    edited_node: Optional[PlanNode] = Field(
        default=None, description="Direct visual edit of a specific node"
    )


class RevisePlanResponse(BaseModel):
    plan_id: str
    plan: Plan
    affected_nodes: list[str]
    updated_at: str


class GetPlanResponse(BaseModel):
    plan_id: str
    plan: Plan
    requirement: str
    metadata_summary: str
    profile_summary: str
    created_at: str
    updated_at: str


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post(
    "/plan",
    response_model=GeneratePlanResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate a new modeling plan",
)
def create_plan(req: GeneratePlanRequest) -> GeneratePlanResponse:
    """
    Parses uploaded CSN/JSON definitions, maps pasted sample rows, calls the LLM,
    validates the output, records an end-to-end inspection trace, and returns a verified plan.
    """
    if not req.requirement.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Requirement text cannot be empty.",
        )

    request_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    filename = req.filename or "uploaded_metadata.json"

    # 1. Parse metadata (CSN definitions or generic table list)
    metadata: ExtractedMetadata = parse_csn_metadata(req.metadata, filename=filename)
    if not metadata.objects:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid tables or CDS views found in uploaded metadata.",
        )

    # 2. Stage 1 & 2 Inspection: Metadata and Compaction
    stage_meta = record_metadata_stage(metadata, filename=filename)
    stage_compaction = record_compaction_stage(metadata)

    # 3. Stage 3: Parse and map pasted sample rows
    sample_result: SampleMappingResult = parse_and_map_sample_data(
        raw_sample_text=req.sample_data,
        metadata=metadata,
        row_limit=req.row_limit or 5,
    )
    stage_sample = record_sample_mapping_stage(sample_result)

    # 4. Profile data (fallback or exact if mock_data / samples supplied)
    # If mock_data omitted but sample_data has rows, convert sample rows for profiler
    tables_data = dict(req.mock_data) if req.mock_data else {}
    if not tables_data and sample_result.has_samples:
        for t_name, m_tbl in sample_result.tables.items():
            if m_tbl.rows:
                cols = list(m_tbl.rows[0].keys())
                csv_lines = [",".join(cols)]
                for r in m_tbl.rows:
                    csv_lines.append(",".join(str(r.get(c, "")) for c in cols))
                tables_data[t_name] = "\n".join(csv_lines)

    profile: DataProfile = profile_data(metadata=metadata, tables_data=tables_data)

    # Initialize inspection trace
    trace = InspectionTrace(
        request_id=request_id,
        timestamp=now_iso,
        requirement=req.requirement,
        stage_metadata=stage_meta,
        stage_compaction=stage_compaction,
        stage_sample_mapping=stage_sample,
    )

    # 5. Generate plan via planner node with auto-retries and trace recording
    try:
        plan: Plan = generate_plan(
            requirement=req.requirement,
            metadata=metadata,
            profile=profile,
            sample_data_text=sample_result.to_compact_text(),
            max_retries=3,
            inspection_trace=trace,
        )
    except PlannerError as exc:
        trace.stage_llm.final_status = "failed"
        save_inspection_trace(trace)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Plan generation failed validation: {str(exc)}",
        )
    except Exception as exc:
        logger.exception("Unexpected error during plan generation: %s", exc)
        trace.stage_llm.final_status = "error"
        save_inspection_trace(trace)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal planner error: {str(exc)}",
        )

    # 6. Store in-memory session & save inspection trace
    plan_id = str(uuid.uuid4())
    trace.plan_id = plan_id
    save_inspection_trace(trace)

    PLAN_SESSIONS[plan_id] = {
        "plan_id": plan_id,
        "request_id": request_id,
        "plan": plan,
        "metadata": metadata,
        "profile": profile,
        "sample_result": sample_result,
        "requirement": req.requirement,
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    plan_check = check_plan(plan, metadata)
    all_warnings = (
        list(metadata.parsing_warnings)
        + list(sample_result.warnings)
        + plan_check.warnings
    )

    return GeneratePlanResponse(
        plan_id=plan_id,
        request_id=request_id,
        plan=plan,
        metadata_summary=metadata.to_compact_text(),
        profile_summary=profile.to_text(),
        sample_data_summary=sample_result.to_compact_text(),
        warnings=all_warnings,
        created_at=now_iso,
    )


@router.get(
    "/plan/{id}/inspect",
    summary="Inspect end-to-end pipeline trace from parser to LLM",
)
def inspect_plan(id: str, format: Optional[str] = "json"):
    """
    Returns the complete untruncated inspection trace for development.
    Accepts either plan_id or request_id.
    If query param ?format=text, returns untruncated plain-text format.
    """
    trace = get_inspection_trace(id)
    if not trace:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No inspection trace found for ID '{id}'.",
        )

    if format == "text":
        from fastapi.responses import PlainTextResponse
        return PlainTextResponse(trace.to_human_readable_summary())

    return trace.model_dump()


@router.post(
    "/plan/revise",
    response_model=RevisePlanResponse,
    summary="Revise an existing modeling plan",
)
def revise_plan(req: RevisePlanRequest) -> RevisePlanResponse:
    """
    Revises an existing plan.
    Supports either:
    1. Direct visual step edit (edited_node): updates only that step and dependent downstream nodes.
    2. Natural language instruction: instructs the LLM to update only affected steps.
    """
    session = PLAN_SESSIONS.get(req.plan_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plan session '{req.plan_id}' not found.",
        )

    current_plan: Plan = session["plan"]
    metadata: ExtractedMetadata = session["metadata"]
    affected_nodes: list[str] = []

    # Case A: User edited a specific step directly in UI
    if req.edited_node is not None:
        target_id = req.edited_node.id
        node_index = next((i for i, n in enumerate(current_plan.nodes) if n.id == target_id), None)
        if node_index is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Edited node '{target_id}' not found in existing plan.",
            )

        # Replace node
        updated_nodes = list(current_plan.nodes)
        updated_nodes[node_index] = req.edited_node

        # Compute all downstream dependent nodes
        dependents = _find_downstream_dependents(updated_nodes, target_id)
        affected_nodes = [target_id] + list(dependents)

        revised_plan = current_plan.model_copy(update={"nodes": updated_nodes})

        # Deterministic check on revised plan
        check_result = check_plan(revised_plan, metadata)
        if not check_result.is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Edited plan failed validation: {'; '.join(check_result.errors)}",
            )

    # Case B: User provided an instruction to revise
    elif req.instruction and req.instruction.strip():
        revised_plan, affected_nodes = _revise_via_llm(
            current_plan=current_plan,
            instruction=req.instruction,
            metadata=metadata,
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must provide either 'instruction' or 'edited_node'.",
        )

    # Update session
    now_iso = datetime.now(timezone.utc).isoformat()
    session["plan"] = revised_plan
    session["updated_at"] = now_iso

    return RevisePlanResponse(
        plan_id=req.plan_id,
        plan=revised_plan,
        affected_nodes=affected_nodes,
        updated_at=now_iso,
    )


@router.get(
    "/plan/{plan_id}",
    response_model=GetPlanResponse,
    summary="Retrieve an existing plan session",
)
def get_plan(plan_id: str) -> GetPlanResponse:
    """Retrieves an existing plan by ID."""
    session = PLAN_SESSIONS.get(plan_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plan '{plan_id}' not found.",
        )

    return GetPlanResponse(
        plan_id=plan_id,
        plan=session["plan"],
        requirement=session["requirement"],
        metadata_summary=session["metadata"].to_compact_text(),
        profile_summary=session["profile"].to_text(),
        created_at=session["created_at"],
        updated_at=session["updated_at"],
    )


# ── Helpers for Plan Revision ────────────────────────────────────────────────

def _find_downstream_dependents(nodes: list[PlanNode], root_id: str) -> set[str]:
    """Finds all downstream nodes that transitively depend on root_id."""
    dependents: set[str] = set()
    queue = [root_id]

    while queue:
        curr = queue.pop(0)
        for node in nodes:
            if curr in node.inputs and node.id not in dependents:
                dependents.add(node.id)
                queue.append(node.id)

    return dependents


def _revise_via_llm(
    current_plan: Plan,
    instruction: str,
    metadata: ExtractedMetadata,
    provider: Optional[LLMProvider] = None,
) -> tuple[Plan, list[str]]:
    """Calls LLM with targeted revision prompt and checks only affected nodes change."""
    llm = provider or get_llm_provider()
    system_prompt = load_planner_system_prompt()

    revision_prompt = f"""
EXISTING MODELING PLAN:
{current_plan.model_dump_json(indent=2)}

SOURCE METADATA:
{metadata.to_compact_text()}

USER REVISION INSTRUCTION:
{instruction.strip()}

TASK:
Modify ONLY the affected node(s) and any downstream dependent nodes to satisfy the instruction.
Keep all unaffected nodes and definitions unchanged.
Ensure all referenced tables, columns, and join keys exist in SOURCE METADATA.
Return ONLY valid JSON matching the Plan format.
"""

    raw_response = llm.generate(system_prompt=system_prompt, user_prompt=revision_prompt)
    from app.agent.planner_node import _extract_json_string

    cleaned = _extract_json_string(raw_response)
    try:
        data = json.loads(cleaned)
        revised_plan = Plan.model_validate(data)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"LLM revision output was invalid: {str(exc)}",
        )

    # Validate with deterministic checker
    check_result = check_plan(revised_plan, metadata)
    if not check_result.is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Revised plan failed validation: {'; '.join(check_result.errors)}",
        )

    # Compare existing nodes with revised nodes to detect affected IDs
    orig_map = {n.id: n.model_dump() for n in current_plan.nodes}
    rev_map = {n.id: n.model_dump() for n in revised_plan.nodes}

    affected = []
    for r_id, r_dump in rev_map.items():
        if r_id not in orig_map or orig_map[r_id] != r_dump:
            affected.append(r_id)

    return revised_plan, affected

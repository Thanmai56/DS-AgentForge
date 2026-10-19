"""
API Routes for SAP Datasphere Graphical View Editor (Lineage Layer).

Endpoints:
- POST /api/lineage/synthesize               — Build view-level graphs for proposed views from an accepted Plan
- GET  /api/lineage/{plan_id}                 — Get all view graphs for a plan
- GET  /api/lineage/{plan_id}/{view_id}       — Get a specific view graph
- POST /api/lineage/{plan_id}/{view_id}/apply — Apply a manual operation (with undo/redo support)
- POST /api/lineage/{plan_id}/{view_id}/undo  — Undo the last operation
- POST /api/lineage/{plan_id}/{view_id}/ai    — Ask AI to revise (returns atomic operations & diff preview)
- POST /api/lineage/{plan_id}/{view_id}/validate — Deterministic live validation
"""
from __future__ import annotations

import logging
from typing import Any, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.agent.plan_models import Plan
from app.agent.view_graph import (
    ViewGraph,
    Operation,
    AIRevisionResult,
    apply_operation,
    apply_operations,
    validate_view_graph,
    synthesize_view_graphs_from_plan,
)
from app.agent.view_graph_ai import revise_view_graph_ai
from app.api.v1.plan_routes import PLAN_SESSIONS

logger = logging.getLogger(__name__)

router = APIRouter(tags=["lineage"])

# In-memory session stores for development
_VIEW_GRAPHS: dict[str, dict[str, ViewGraph]] = {}  # plan_id -> { view_id: ViewGraph }
_VIEW_HISTORY: dict[str, list[ViewGraph]] = {}     # f"{plan_id}:{view_id}" -> [ViewGraph, ...]
_VIEW_REDO: dict[str, list[ViewGraph]] = {}        # f"{plan_id}:{view_id}" -> [ViewGraph, ...]


def _get_history_key(plan_id: str, view_id: str) -> str:
    return f"{plan_id}:{view_id}"


class SynthesizeLineageRequest(BaseModel):
    plan_id: Optional[str] = None
    plan: Optional[Plan] = None


class ApplyOperationRequest(BaseModel):
    operation: Operation


class AIReviseRequest(BaseModel):
    instruction: str


class OperationResponse(BaseModel):
    graph: ViewGraph
    errors: list[str] = Field(default_factory=list)
    can_undo: bool = False
    can_redo: bool = False
    message: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/lineage/synthesize",
    response_model=dict[str, ViewGraph],
    status_code=status.HTTP_200_OK,
    summary="Synthesize view graphs from an accepted Plan",
)
def synthesize_lineage(req: SynthesizeLineageRequest) -> dict[str, ViewGraph]:
    """
    Builds view-level graphs for each proposed view in the accepted plan.
    Supports the PO example: ZIPOHDRAPT & V_PO_FINAL_DELIVERY_APT -> Join -> Calc -> Output.
    """
    plan = req.plan
    plan_id = req.plan_id or "default_plan"

    if not plan and req.plan_id:
        session = PLAN_SESSIONS.get(req.plan_id)
        if session and "plan" in session:
            plan = session["plan"]

    if not plan:
        # Fallback to creating a plan or standard PO plan
        from app.agent.plan_models import PlanNode, NodeDetails
        plan = Plan(
            analysis=["PO Average Processing Time Analysis"],
            nodes=[
                PlanNode(
                    id="F_PO_PROCESSING_TIME_APT",
                    operation="join",
                    inputs=["ZIPOHDRAPT", "V_PO_FINAL_DELIVERY_APT"],
                    details=NodeDetails(
                        join_type="inner",
                        on=[["PURCHASEORDER", "PURCHASEORDER"]],
                        formula="DAYS_BETWEEN(CREATIONDATE, FINAL_DELIVERY_DATE) + 1",
                    ),
                    columns=["PURCHASEORDER", "CREATIONDATE", "FINAL_DELIVERY_DATE", "CALC_PROCESSING_DAYS"],
                    layer="L3",
                )
            ],
        )

    # Synthesize graphs
    graphs = synthesize_view_graphs_from_plan(plan)
    _VIEW_GRAPHS[plan_id] = graphs

    # Reset history for newly synthesized graphs
    for v_id, g in graphs.items():
        k = _get_history_key(plan_id, v_id)
        _VIEW_HISTORY[k] = []
        _VIEW_REDO[k] = []

    return graphs


@router.get(
    "/lineage/{plan_id}",
    response_model=dict[str, ViewGraph],
    summary="Get all view graphs for a plan",
)
def get_all_view_graphs(plan_id: str) -> dict[str, ViewGraph]:
    if plan_id not in _VIEW_GRAPHS:
        # Synthesize on-the-fly
        return synthesize_lineage(SynthesizeLineageRequest(plan_id=plan_id))
    return _VIEW_GRAPHS[plan_id]


@router.get(
    "/lineage/{plan_id}/{view_id}",
    response_model=ViewGraph,
    summary="Get a specific view graph",
)
def get_view_graph(plan_id: str, view_id: str) -> ViewGraph:
    graphs = get_all_view_graphs(plan_id)
    if view_id not in graphs:
        # Return first available graph or 404
        if graphs:
            return next(iter(graphs.values()))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"View graph '{view_id}' not found for plan '{plan_id}'.",
        )
    return graphs[view_id]


@router.post(
    "/lineage/{plan_id}/{view_id}/apply",
    response_model=OperationResponse,
    summary="Apply a manual operation with undo history",
)
def apply_view_operation(
    plan_id: str,
    view_id: str,
    req: ApplyOperationRequest,
) -> OperationResponse:
    curr_graph = get_view_graph(plan_id, view_id)
    hist_key = _get_history_key(plan_id, view_id)

    # Save current state to history before applying change
    if hist_key not in _VIEW_HISTORY:
        _VIEW_HISTORY[hist_key] = []
    _VIEW_HISTORY[hist_key].append(curr_graph.model_copy(deep=True))
    # Clear redo stack upon new user edit
    _VIEW_REDO[hist_key] = []

    # Apply operation
    updated_graph, err = apply_operation(curr_graph, req.operation, is_ai=False)
    if err:
        # Revert history push on failure
        _VIEW_HISTORY[hist_key].pop()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=err,
        )

    # Save updated graph
    _VIEW_GRAPHS[plan_id][view_id] = updated_graph
    validation_errors = validate_view_graph(updated_graph)

    return OperationResponse(
        graph=updated_graph,
        errors=validation_errors,
        can_undo=len(_VIEW_HISTORY[hist_key]) > 0,
        can_redo=len(_VIEW_REDO[hist_key]) > 0,
        message=f"Applied operation: {req.operation.op.value}",
    )


@router.post(
    "/lineage/{plan_id}/{view_id}/undo",
    response_model=OperationResponse,
    summary="Undo the last operation",
)
def undo_view_operation(plan_id: str, view_id: str) -> OperationResponse:
    curr_graph = get_view_graph(plan_id, view_id)
    hist_key = _get_history_key(plan_id, view_id)

    history = _VIEW_HISTORY.get(hist_key, [])
    if not history:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nothing to undo.",
        )

    prev_graph = history.pop()

    # Push current graph to redo stack
    if hist_key not in _VIEW_REDO:
        _VIEW_REDO[hist_key] = []
    _VIEW_REDO[hist_key].append(curr_graph.model_copy(deep=True))

    _VIEW_GRAPHS[plan_id][view_id] = prev_graph
    validation_errors = validate_view_graph(prev_graph)

    return OperationResponse(
        graph=prev_graph,
        errors=validation_errors,
        can_undo=len(history) > 0,
        can_redo=len(_VIEW_REDO[hist_key]) > 0,
        message="Reverted last operation.",
    )


@router.post(
    "/lineage/{plan_id}/{view_id}/redo",
    response_model=OperationResponse,
    summary="Redo the reverted operation",
)
def redo_view_operation(plan_id: str, view_id: str) -> OperationResponse:
    curr_graph = get_view_graph(plan_id, view_id)
    hist_key = _get_history_key(plan_id, view_id)

    redo_stack = _VIEW_REDO.get(hist_key, [])
    if not redo_stack:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nothing to redo.",
        )

    next_graph = redo_stack.pop()

    # Push current to history
    if hist_key not in _VIEW_HISTORY:
        _VIEW_HISTORY[hist_key] = []
    _VIEW_HISTORY[hist_key].append(curr_graph.model_copy(deep=True))

    _VIEW_GRAPHS[plan_id][view_id] = next_graph
    validation_errors = validate_view_graph(next_graph)

    return OperationResponse(
        graph=next_graph,
        errors=validation_errors,
        can_undo=len(_VIEW_HISTORY[hist_key]) > 0,
        can_redo=len(redo_stack) > 0,
        message="Redone operation.",
    )


@router.post(
    "/lineage/{plan_id}/{view_id}/ai",
    response_model=AIRevisionResult,
    summary="Ask AI to revise the view graph",
)
def ai_revise_view(
    plan_id: str,
    view_id: str,
    req: AIReviseRequest,
) -> AIRevisionResult:
    """
    Submits a natural language instruction to AI.
    Returns atomic Operations and a diff preview for user Accept/Reject.
    """
    curr_graph = get_view_graph(plan_id, view_id)
    result = revise_view_graph_ai(curr_graph, req.instruction)
    return result


@router.post(
    "/lineage/{plan_id}/{view_id}/validate",
    summary="Run live deterministic validation",
)
def validate_view(plan_id: str, view_id: str) -> dict[str, Any]:
    curr_graph = get_view_graph(plan_id, view_id)
    errors = validate_view_graph(curr_graph)
    return {
        "valid": len(errors) == 0,
        "blockers": errors,
        "nodes_with_errors": [n.id for n in curr_graph.nodes if n.errors],
    }

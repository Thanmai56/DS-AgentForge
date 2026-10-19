"""
LangGraph State Machine for DS ModelForge Agent Orchestration (§10).

States:
INTAKE → PARSE_REQUIREMENT → SELECT_SOURCES ──(human confirm)──►
PROFILE → DETECT_ASSOCIATIONS → PLAN_VIEW_CHAIN ──(human confirm plan)──►
BUILD_VIEWS → VALIDATE → RENDER_ARTIFACTS ──(human approve)──► EXPORT
     ▲ │
     └──── EDIT_LOOP (canvas edits) ◄─────┘

Human-approval states are LangGraph interrupts.
Every state writes run status to DB; frontend polls via WebSocket.
"""
from typing import TypedDict, Annotated, Any
import operator


class ParsedRequirement(TypedDict):
    measures: list[str]
    dimensions: list[str]
    time_grain: str
    filters: list[str]
    target: str
    notes: str


class AssociationCandidate(TypedDict):
    table_a: str
    col_a: str
    table_b: str
    col_b: str
    orphan_ratio: float
    total: int
    orphans: int
    confirmed: bool | None
    cardinality: str | None
    business_verb: str | None
    confidence: float | None


class ViewChainPlan(TypedDict):
    layers: dict[str, list[str]]  # L1: [...], L2: [...], L3: [...], L4: [...]
    rationale: str
    dag: list[dict]   # list of {from, to} edges


class RunState(TypedDict):
    """Full LangGraph state for a modelling run."""
    # Identity
    run_id: str
    connection_id: str | None
    user_id: str

    # Input
    requirement_text: str
    user_metadata: dict | list | str | None

    # Agent progress
    current_state: str
    error: str | None

    # Parsed
    parsed_requirement: ParsedRequirement | None

    # Source selection
    candidate_tables: list[str]           # selected by user
    candidate_table_metas: list[dict]     # column metadata
    source_match_reasons: list[dict]      # why each table was selected

    # Profiling
    profiles: dict[str, dict]            # table_name → profile dict

    # Associations
    association_candidates: list[AssociationCandidate]
    confirmed_associations: list[AssociationCandidate]

    # View chain plan
    view_chain_plan: ViewChainPlan | None

    # View specs (SSOT in DB; IDs here)
    view_spec_ids: list[str]
    view_specs: list[dict]               # ViewSpec JSON objects

    # Validation
    validation_report: dict | None
    has_blockers: bool

    # Artifacts
    artifact_ids: list[str]

    # Human gates
    source_selection_approved: bool
    plan_approved: bool
    artifacts_approved: bool

    # Golden examples (injected into build_view_spec prompt)
    golden_examples: list[dict]

    # Feedback / edits (EDIT_LOOP)
    pending_edits: list[dict]
    messages: Annotated[list[str], operator.add]  # accumulated messages for debugging

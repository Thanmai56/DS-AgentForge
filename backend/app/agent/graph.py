"""
LangGraph state machine graph definition.
Wires all nodes + 3 human-interrupt gates + EDIT_LOOP.
"""
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from app.agent.states import RunState
from app.agent.nodes import (
    intake_node,
    parse_requirement_node,
    select_sources_node,
    profile_node,
    detect_associations_node,
    plan_view_chain_node,
    build_views_node,
    validate_node,
    render_artifacts_node,
    export_node,
)


def should_continue_after_validate(state: RunState) -> str:
    """Route after validation: if blockers exist, stay for human fix; else render."""
    if state.get("has_blockers"):
        return "VALIDATE_FAILED"
    return "render_artifacts"


def route_after_build(state: RunState) -> str:
    """Check for build errors."""
    if state.get("error"):
        return END
    return "validate"


def build_graph() -> StateGraph:
    """
    Construct the LangGraph state machine.

    Human interrupt gates at:
    - AWAITING_SOURCE_CONFIRM (after select_sources_node)
    - AWAITING_PLAN_CONFIRM (after plan_view_chain_node)
    - AWAITING_APPROVAL (after render_artifacts_node)

    EDIT_LOOP: canvas edits re-enter at validate → render_artifacts.
    """
    graph = StateGraph(RunState)

    # Add all nodes
    graph.add_node("intake", intake_node)
    graph.add_node("parse_requirement", parse_requirement_node)
    graph.add_node("select_sources", select_sources_node)
    graph.add_node("profile", profile_node)
    graph.add_node("detect_associations", detect_associations_node)
    graph.add_node("plan_view_chain", plan_view_chain_node)
    graph.add_node("build_views", build_views_node)
    graph.add_node("validate", validate_node)
    graph.add_node("render_artifacts", render_artifacts_node)
    graph.add_node("export", export_node)

    # Set entry
    graph.set_entry_point("intake")

    # Linear flow
    graph.add_edge("intake", "parse_requirement")
    graph.add_edge("parse_requirement", "select_sources")

    # INTERRUPT GATE 1: source selection (human must approve)
    graph.add_edge("select_sources", "profile")  # resumes after interrupt

    graph.add_edge("profile", "detect_associations")
    graph.add_edge("detect_associations", "plan_view_chain")

    # INTERRUPT GATE 2: plan approval
    graph.add_edge("plan_view_chain", "build_views")  # resumes after interrupt

    graph.add_conditional_edges("build_views", route_after_build, {
        "validate": "validate",
        END: END,
    })

    graph.add_conditional_edges("validate", should_continue_after_validate, {
        "render_artifacts": "render_artifacts",
        "VALIDATE_FAILED": END,  # human edits re-enter at validate
    })

    # INTERRUPT GATE 3: artifact approval
    graph.add_edge("render_artifacts", "export")  # resumes after interrupt

    graph.add_edge("export", END)

    return graph


# ── Interrupt configuration (LangGraph >= 0.1.x) ─────────────────────────────

INTERRUPT_BEFORE = [
    "profile",         # Gate 1: user confirms source tables
    "build_views",     # Gate 2: user approves plan
    "export",          # Gate 3: user approves artifacts
]


def create_compiled_graph():
    """Create the compiled graph with memory checkpointer and interrupt gates."""
    graph = build_graph()
    checkpointer = MemorySaver()
    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=INTERRUPT_BEFORE,
    )


def create_agent_graph():
    """Backward-compatible factory expected by the test suite and app callers."""
    return create_compiled_graph()


# Singleton compiled graph
_compiled_graph = None


def get_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = create_compiled_graph()
    return _compiled_graph

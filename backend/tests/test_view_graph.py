"""
Acceptance Tests for ViewGraph & Datasphere Graphical View Editor.

Covers all 5 acceptance criteria from the specification:
1. PO Example: ZIPOHDRAPT & V_PO_FINAL_DELIVERY_APT -> Inner Join -> CALC_PROCESSING_DAYS -> Output F_PO_PROCESSING_TIME_APT, laid out left to right.
2. Manual: change join type to LEFT in properties panel; node label changes to 'Left Join'; undo reverts it.
3. AI: 'change the join to left outer'; preview shows single changed join_type; Accept applies it.
4. AI: join on a column that does not exist; rejected with a clear reason.
5. AI restriction: cannot modify or delete SOURCE nodes.
6. API routes integration: synthesize, apply, undo, ai endpoints.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.agent.plan_models import Plan, PlanNode, NodeDetails
from app.agent.view_graph import (
    ViewGraph,
    ViewGraphNode,
    NodeType,
    Operation,
    OperationType,
    apply_operation,
    apply_operations,
    validate_view_graph,
    synthesize_view_graphs_from_plan,
)
from app.agent.view_graph_ai import revise_view_graph_ai

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_env(monkeypatch):
    """Ensure tests run completely offline and isolated."""
    monkeypatch.setenv("LLM_PROVIDER", "fake")


@pytest.fixture
def sample_po_plan() -> Plan:
    """Standard PO Average Processing Time plan."""
    return Plan(
        analysis=["PO Processing Efficiency Analysis"],
        nodes=[
            PlanNode(
                id="ZIPOHDRAPT",
                operation="source",
                columns=["PURCHASEORDER", "CREATIONDATE", "COMPANYCODE", "PURCHASINGGROUP", "SUPPLIER"],
                is_existing=True,
                layer="L0",
            ),
            PlanNode(
                id="V_PO_FINAL_DELIVERY_APT",
                operation="projection",
                inputs=["ZIPOHISTEXT"],
                columns=["PURCHASEORDER", "FINAL_DELIVERY_DATE", "DELIVERYDATE"],
                is_existing=True,
                layer="L2",
            ),
            PlanNode(
                id="F_PO_PROCESSING_TIME_APT",
                operation="join",
                inputs=["ZIPOHDRAPT", "V_PO_FINAL_DELIVERY_APT"],
                columns=[
                    "PURCHASEORDER",
                    "CREATIONDATE",
                    "FINAL_DELIVERY_DATE",
                    "Processing_Days",
                    "Total_Delivered_Order",
                ],
                calculated_fields=[
                    {
                        "name": "Processing_Days",
                        "formula": "DAYS_BETWEEN(CREATIONDATE, FINAL_DELIVERY_DATE) + 1",
                        "data_type": "cds.Integer",
                    },
                    {
                        "name": "Total_Delivered_Order",
                        "formula": "1",
                        "data_type": "cds.Integer",
                    },
                ],
                details=NodeDetails(
                    join_type="inner",
                    on=[["PURCHASEORDER", "PURCHASEORDER"]],
                    formula="DAYS_BETWEEN(CREATIONDATE, FINAL_DELIVERY_DATE) + 1",
                ),
                is_existing=False,
                layer="L3",
            ),
        ],
    )


# ── Criterion 1: PO Example Left-to-Right Flow ──────────────────────────────

def test_po_example_left_to_right_flow(sample_po_plan: Plan):
    """
    Clicking Accept on PO example builds:
    ZIPOHDRAPT & V_PO_FINAL_DELIVERY_APT -> Inner Join (PURCHASEORDER = PURCHASEORDER)
    -> One calculation operator per fact formula -> Output F_PO_PROCESSING_TIME_APT.
    """
    graphs = synthesize_view_graphs_from_plan(sample_po_plan)
    assert "F_PO_PROCESSING_TIME_APT" in graphs
    graph = graphs["F_PO_PROCESSING_TIME_APT"]

    # Verify nodes present
    node_names = [n.name for n in graph.nodes]
    node_types = {n.id: n.node_type for n in graph.nodes}

    # Sources on left
    assert "ZIPOHDRAPT" in node_names
    assert "V_PO_FINAL_DELIVERY_APT" in node_names
    src_nodes = [n for n in graph.nodes if n.node_type == NodeType.SOURCE]
    assert len(src_nodes) == 2

    # Join in middle
    join_nodes = [n for n in graph.nodes if n.node_type == NodeType.JOIN]
    assert len(join_nodes) == 1
    join_node = join_nodes[0]
    assert join_node.details.join_type == "inner"
    assert join_node.name == "Inner Join"
    assert join_node.details.key_pairs == [["PURCHASEORDER", "PURCHASEORDER"]]

    # Calculation operator
    calc_nodes = [n for n in graph.nodes if n.node_type == NodeType.CALCULATION]
    assert {node.name for node in calc_nodes} == {"Processing_Days", "Total_Delivered_Order"}

    # Output node on right
    output_nodes = [n for n in graph.nodes if n.node_type == NodeType.OUTPUT]
    assert len(output_nodes) == 1
    assert output_nodes[0].name == "F_PO_PROCESSING_TIME_APT"

    # Verify Left-to-Right flow (x-coordinates strictly increasing)
    src_x = max(n.position["x"] for n in src_nodes)
    join_x = join_node.position["x"]
    calc_x = calc_nodes[0].position["x"]
    out_x = output_nodes[0].position["x"]

    assert src_x < join_x < calc_x < out_x, f"Expected LR layout: {src_x} < {join_x} < {calc_x} < {out_x}"

    # Verify edge connectivity
    edge_pairs = {(e.source, e.target) for e in graph.edges}
    for src in src_nodes:
        assert (src.id, join_node.id) in edge_pairs
    assert (join_node.id, calc_nodes[0].id) in edge_pairs
    assert (calc_nodes[-1].id, output_nodes[0].id) in edge_pairs

    # Verify no validation blockers
    errors = validate_view_graph(graph)
    assert errors == []


# ── Criterion 2: Manual Edit & Undo ─────────────────────────────────────────

def test_manual_edit_join_and_undo(sample_po_plan: Plan):
    """
    Manual: change join type to LEFT in properties panel;
    node label changes to 'Left Join'; undo reverts it.
    """
    graphs = synthesize_view_graphs_from_plan(sample_po_plan)
    graph = graphs["F_PO_PROCESSING_TIME_APT"]
    join_node = [n for n in graph.nodes if n.node_type == NodeType.JOIN][0]

    assert join_node.details.join_type == "inner"
    assert join_node.name == "Inner Join"

    # Apply manual edit: set join to left
    op = Operation(
        op=OperationType.SET_JOIN,
        node_id=join_node.id,
        payload={"join_type": "left"},
    )
    updated_graph, err = apply_operation(graph, op, is_ai=False)
    assert err is None
    assert updated_graph.version == graph.version + 1

    updated_join = updated_graph.get_node(join_node.id)
    assert updated_join is not None
    assert updated_join.details.join_type == "left"
    assert updated_join.name == "Left Join"

    # Revert via undo operation
    undo_op = Operation(
        op=OperationType.SET_JOIN,
        node_id=join_node.id,
        payload={"join_type": "inner"},
    )
    reverted_graph, err = apply_operation(updated_graph, undo_op, is_ai=False)
    assert err is None
    reverted_join = reverted_graph.get_node(join_node.id)
    assert reverted_join is not None
    assert reverted_join.details.join_type == "inner"
    assert reverted_join.name == "Inner Join"


# ── Criterion 3: AI Edit with Diff Preview ──────────────────────────────────

def test_ai_edit_change_join_to_left_outer(sample_po_plan: Plan):
    """
    AI: type 'change the join to left outer';
    preview shows single changed join_type; Accept applies it.
    """
    graphs = synthesize_view_graphs_from_plan(sample_po_plan)
    graph = graphs["F_PO_PROCESSING_TIME_APT"]
    join_node = [n for n in graph.nodes if n.node_type == NodeType.JOIN][0]

    result = revise_view_graph_ai(graph, "change the join to left outer")
    assert result.valid is True
    assert len(result.operations) == 1
    assert result.operations[0].op == OperationType.SET_JOIN
    assert result.operations[0].payload.get("join_type") == "left"

    # Diff preview identifies the modified node
    assert join_node.id in result.diff["modified_nodes"]
    assert result.diff["added_nodes"] == []
    assert result.diff["removed_nodes"] == []

    # Preview graph reflects the change
    assert result.preview_graph is not None
    prev_join = result.preview_graph.get_node(join_node.id)
    assert prev_join is not None
    assert prev_join.details.join_type == "left"
    assert prev_join.name == "Left Join"

    # Simulating 'Accept': apply operations to the graph
    accepted_graph, rejected = apply_operations(graph, result.operations, is_ai=True)
    assert rejected == []
    accepted_join = accepted_graph.get_node(join_node.id)
    assert accepted_join is not None
    assert accepted_join.details.join_type == "left"


# ── Criterion 4: AI Rejects Non-Existent Column ─────────────────────────────

def test_ai_rejects_non_existent_join_column(sample_po_plan: Plan):
    """
    AI: ask it to join on a column that does not exist;
    rejected with a clear reason.
    """
    graphs = synthesize_view_graphs_from_plan(sample_po_plan)
    graph = graphs["F_PO_PROCESSING_TIME_APT"]
    join_node = [n for n in graph.nodes if n.node_type == NodeType.JOIN][0]

    result = revise_view_graph_ai(graph, "join on NON_EXISTENT_COLUMN_XYZ")
    assert result.valid is False
    assert len(result.rejected_operations) > 0

    rejection_reason = result.rejected_operations[0]["reason"]
    assert "NON_EXISTENT_COLUMN_XYZ" in rejection_reason
    assert "does not exist in upstream sources" in rejection_reason


# ── Criterion 5: AI Restriction on SOURCE Nodes ─────────────────────────────

def test_ai_may_not_modify_source_nodes(sample_po_plan: Plan):
    """AI is strictly forbidden from removing or modifying SOURCE nodes."""
    graphs = synthesize_view_graphs_from_plan(sample_po_plan)
    graph = graphs["F_PO_PROCESSING_TIME_APT"]
    src_node = [n for n in graph.nodes if n.node_type == NodeType.SOURCE][0]

    # Attempt to remove source node as AI
    remove_op = Operation(
        op=OperationType.REMOVE_NODE,
        node_id=src_node.id,
    )
    _, err = apply_operation(graph, remove_op, is_ai=True)
    assert err is not None
    assert "AI is not permitted to modify or delete SOURCE node" in err


# ── Criterion 6: Live Graph Validation Rules ────────────────────────────────

def test_live_validation_cycle_and_dangling(sample_po_plan: Plan):
    """Live validation detects cycles and dangling nodes."""
    graphs = synthesize_view_graphs_from_plan(sample_po_plan)
    graph = graphs["F_PO_PROCESSING_TIME_APT"]

    # 1. Add dangling operator node
    dangling_op = Operation(
        op=OperationType.ADD_NODE,
        node_id="dangling_calc",
        payload={
            "node_type": "CALCULATION",
            "name": "Dangling",
            "details": {"calculation_name": "Dangling", "expression": "1 + 1"},
        },
    )
    g_dangling, _ = apply_operation(graph, dangling_op, is_ai=False)
    errs = validate_view_graph(g_dangling)
    assert any("has no incoming input connections" in e for e in errs)

    # 2. Introduce cycle: Output -> Join
    join_id = [n for n in graph.nodes if n.node_type == NodeType.JOIN][0].id
    out_id = [n for n in graph.nodes if n.node_type == NodeType.OUTPUT][0].id
    cycle_op = Operation(
        op=OperationType.ADD_EDGE,
        payload={"source": out_id, "target": join_id},
    )
    g_cycle, _ = apply_operation(graph, cycle_op, is_ai=False)
    cycle_errs = validate_view_graph(g_cycle)
    assert any("Cycle detected in graph topology" in e for e in cycle_errs)


# ── Criterion 7: API Endpoint Integration ───────────────────────────────────

def test_lineage_api_flow(sample_po_plan: Plan):
    """Full HTTP test through /api/lineage endpoints."""
    # 1. Synthesize
    res = client.post("/api/lineage/synthesize", json={"plan_id": "test_plan_po", "plan": sample_po_plan.model_dump()})
    assert res.status_code == 200
    data = res.json()
    assert "F_PO_PROCESSING_TIME_APT" in data

    # 2. Get specific view graph
    res2 = client.get("/api/lineage/test_plan_po/F_PO_PROCESSING_TIME_APT")
    assert res2.status_code == 200
    vg = res2.json()
    assert vg["view_id"] == "F_PO_PROCESSING_TIME_APT"
    join_node_id = [n["id"] for n in vg["nodes"] if n["node_type"] == "JOIN"][0]

    # 3. Apply manual operation: change join to LEFT
    res3 = client.post(
        "/api/lineage/test_plan_po/F_PO_PROCESSING_TIME_APT/apply",
        json={
            "operation": {
                "op": "set_join",
                "node_id": join_node_id,
                "payload": {"join_type": "left"},
            }
        },
    )
    assert res3.status_code == 200
    op_data = res3.json()
    assert op_data["can_undo"] is True
    assert op_data["graph"]["nodes"][2]["details"]["join_type"] == "left"

    # 4. Undo operation
    res4 = client.post("/api/lineage/test_plan_po/F_PO_PROCESSING_TIME_APT/undo")
    assert res4.status_code == 200
    undo_data = res4.json()
    assert undo_data["graph"]["nodes"][2]["details"]["join_type"] == "inner"

    # 5. AI Revise via API
    res5 = client.post(
        "/api/lineage/test_plan_po/F_PO_PROCESSING_TIME_APT/ai",
        json={"instruction": "change the join to left outer"},
    )
    assert res5.status_code == 200
    ai_data = res5.json()
    assert ai_data["valid"] is True
    assert join_node_id in ai_data["diff"]["modified_nodes"]

    # 6. AI Revise rejected column via API
    res6 = client.post(
        "/api/lineage/test_plan_po/F_PO_PROCESSING_TIME_APT/ai",
        json={"instruction": "join on GHOST_COLUMN"},
    )
    assert res6.status_code == 200
    ai_invalid = res6.json()
    assert ai_invalid["valid"] is False
    assert len(ai_invalid["rejected_operations"]) > 0

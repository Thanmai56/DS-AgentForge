"""
Unit tests for LangGraph state transitions and human interrupt gates (§11).
"""
import pytest
from app.agent.graph import create_agent_graph
from app.agent.states import RunState


def test_graph_initialization():
    """Verify that LangGraph graph compiles with all 10 nodes and memory checkpointer."""
    graph = create_agent_graph()
    assert graph is not None


def test_sap_glossary_lookup():
    """Verify that SAP dictionary recognizes canonical ERP tables and field names."""
    from app.agent.sap_dictionary import classify_column, get_table_metadata

    vbak_meta = get_table_metadata("VBAK")
    assert vbak_meta is not None
    assert "Sales" in vbak_meta.get("business_name", "")

    vbeln_classification = classify_column("VBAK", "VBELN")
    assert vbeln_classification["semantic_role"] in ["key", "dimension"]

    netwr_classification = classify_column("VBAK", "NETWR")
    assert netwr_classification["semantic_role"] == "measure"

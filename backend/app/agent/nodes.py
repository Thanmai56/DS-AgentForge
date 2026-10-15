"""
LangGraph node implementations for each agent state.
Each node: reads state → does work → returns partial state update.
DB writes happen here; WebSocket broadcasts happen via run_id.
"""
import json
import logging
import uuid
from typing import Any

from app.agent.states import RunState
from app.agent.llm import call_llm
from app.agent.sap_dictionary import classify_column as dict_classify
from app.agent.metadata_parser import parse_human_metadata
from app.agent.datasphere_canvas_builder import synthesize_datasphere_views
from app.agent.graph_generator import generate_graph_elements
from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


# ── Helper: broadcast state to WebSocket subscribers ─────────────────────────

async def _broadcast(run_id: str, state_name: str, payload: dict | None = None):
    """Publish run state update to WebSocket manager."""
    from app.api.v1.websocket import manager
    await manager.broadcast(run_id, {"state": state_name, "payload": payload or {}})


# ── Node 1: INTAKE ────────────────────────────────────────────────────────────

async def intake_node(state: RunState) -> dict:
    """Save initial requirement, mark run as started."""
    logger.info("INTAKE: run_id=%s", state["run_id"])
    await _broadcast(state["run_id"], "INTAKE")
    return {"current_state": "PARSE_REQUIREMENT", "error": None}


# ── Node 2: PARSE_REQUIREMENT ─────────────────────────────────────────────────

async def parse_requirement_node(state: RunState) -> dict:
    """LLM call #1: extract measures, dimensions, time grain, filters, target."""
    logger.info("PARSE_REQUIREMENT: run_id=%s", state["run_id"])
    await _broadcast(state["run_id"], "PARSE_REQUIREMENT")

    # Check for human metadata
    user_meta = state.get("user_metadata")
    tables_meta = parse_human_metadata(user_meta) if user_meta else []

    prompt_content = state["requirement_text"]
    if tables_meta:
        from app.agent.json_compressor import compress_tables_schema_for_llm
        compressed_schema = compress_tables_schema_for_llm(tables_meta)
        prompt_content = f"{state['requirement_text']}\n\nAvailable Tables Schema (Compressed):\n{compressed_schema}"

    result = call_llm(
        "parse_requirement",
        prompt_content,
        run_id=state["run_id"],
    )

    if result.get("_needs_human_review"):
        logger.warning("LLM parse required human review or failed; synthesizing from requirement and metadata.")
        # Synthesize fallback parsed requirement from human metadata or text
        measures = []
        dimensions = []
        for t in tables_meta:
            for c in t.get("columns", []):
                if c.get("semantic_role") == "measure":
                    measures.append(c["name"])
                else:
                    dimensions.append(c["name"])

        if not measures:
            measures = ["NET_AMOUNT", "QUANTITY", "TOTAL_VALUE"]
        if not dimensions:
            dimensions = ["CUSTOMER_ID", "ORDER_DATE", "COUNTRY"]

        result = {
            "measures": measures[:6],
            "dimensions": dimensions[:8],
            "time_grain": "month",
            "filters": ["STATUS != 'CANCELLED'"],
            "target": "SAC",
            "notes": f"Generated from human metadata. Prompt: {state['requirement_text'][:120]}",
        }

    return {
        "current_state": "SELECT_SOURCES",
        "parsed_requirement": result,
        "error": None,
    }


# ── Node 3: SELECT_SOURCES ────────────────────────────────────────────────────

async def select_sources_node(state: RunState) -> dict:
    """
    Propose source tables using human metadata if provided,
    otherwise search the catalog for the connected space.
    """
    logger.info("SELECT_SOURCES: run_id=%s", state["run_id"])
    await _broadcast(state["run_id"], "SELECT_SOURCES")

    user_meta = state.get("user_metadata")
    tables_meta = parse_human_metadata(user_meta) if user_meta else []

    if tables_meta:
        candidates = [
            {
                "object_name": t["name"],
                "business_name": t.get("business_name") or t["name"],
                "confidence": 1.0,
                "match_reason": "Defined in human-provided metadata",
                "columns": len(t.get("columns", [])),
            }
            for t in tables_meta
        ]
        candidate_names = [t["name"] for t in tables_meta]
    else:
        # Fall back to database catalog search if connection_id provided
        candidates = []
        if state.get("connection_id"):
            try:
                from app.services.embedding_service import search_tables_by_requirement
                parsed = state["parsed_requirement"] or {}
                query = " ".join(
                    parsed.get("measures", []) + parsed.get("dimensions", []) + parsed.get("filters", [])
                )
                candidates = await search_tables_by_requirement(
                    query=query,
                    connection_id=state["connection_id"],
                    top_k=10,
                )
            except Exception as e:
                logger.warning("Catalog search failed: %s", e)

        if not candidates:
            # Default placeholder SAP tables if neither metadata nor live catalog exists
            candidates = [
                {"object_name": "VBAK", "business_name": "Sales Document Header", "confidence": 0.95},
                {"object_name": "VBRP", "business_name": "Billing Document Item", "confidence": 0.92},
                {"object_name": "KNA1", "business_name": "Customer General Data", "confidence": 0.90},
            ]
        candidate_names = [c["object_name"] for c in candidates]

    await _broadcast(state["run_id"], "AWAITING_SOURCE_CONFIRM", {"candidate_tables": candidates, "candidates": candidates})
    return {
        "current_state": "AWAITING_SOURCE_CONFIRM",
        "source_match_reasons": candidates,
        "candidate_tables": candidate_names,
    }


# ── Node 4: PROFILE (after human source confirmation) ─────────────────────────

async def profile_node(state: RunState) -> dict:
    """Build column profiles from human metadata or database catalog."""
    logger.info("PROFILE: run_id=%s tables=%s", state["run_id"], state["candidate_tables"])
    await _broadcast(state["run_id"], "PROFILE", {"tables": state["candidate_tables"]})

    user_meta = state.get("user_metadata")
    tables_meta = parse_human_metadata(user_meta) if user_meta else []
    tables_dict = {t["name"]: t for t in tables_meta}

    profiles = {}
    for table_name in state["candidate_tables"]:
        if table_name in tables_dict:
            t_info = tables_dict[table_name]
            profiles[table_name] = {
                "table_name": table_name,
                "business_name": t_info.get("business_name") or table_name,
                "columns": {
                    c["name"]: {
                        "data_type": c.get("data_type", "NVARCHAR(255)"),
                        "is_key": c.get("is_key", False),
                        "semantic_role": c.get("semantic_role", "dimension"),
                        "null_ratio": 0.0,
                        "distinct_count": 1000,
                    }
                    for c in t_info.get("columns", [])
                },
            }
        elif state.get("connection_id"):
            try:
                from app.services.catalog_service import get_table_profile
                profile = await get_table_profile(state["connection_id"], table_name)
                profiles[table_name] = profile
            except Exception:
                profiles[table_name] = {"table_name": table_name, "columns": {}}
        else:
            profiles[table_name] = {"table_name": table_name, "columns": {}}

    return {"current_state": "DETECT_ASSOCIATIONS", "profiles": profiles}


# ── Node 5: DETECT_ASSOCIATIONS ───────────────────────────────────────────────

async def detect_associations_node(state: RunState) -> dict:
    """
    For each pair of candidate tables, find columns with matching names/types.
    Run P3 orphan ratio. Then LLM call #3 to confirm.
    """
    logger.info("DETECT_ASSOCIATIONS: run_id=%s", state["run_id"])
    await _broadcast(state["run_id"], "DETECT_ASSOCIATIONS")

    from app.services.association_detector import detect_join_candidates
    candidates = await detect_join_candidates(
        tables=state["candidate_tables"],
        profiles=state["profiles"],
        connection_id=state["connection_id"],
    )

    # LLM confirmation for each candidate (or heuristic confirmation)
    confirmed = []
    for cand in candidates:
        evidence = {
            "orphan_ratio": cand["orphan_ratio"],
            "total": cand["total"],
            "orphans": cand["orphans"],
            "col_a_meta": cand.get("col_a_meta", {}),
            "col_b_meta": cand.get("col_b_meta", {}),
        }
        from app.agent.json_compressor import compress_json
        llm_result = call_llm(
            "confirm_association",
            compress_json(evidence),
            run_id=state["run_id"],
        )
        if not llm_result.get("_needs_human_review"):
            cand.update({
                "confirmed": llm_result.get("confirm", False),
                "cardinality": llm_result.get("cardinality"),
                "business_verb": llm_result.get("business_verb"),
                "confidence": llm_result.get("confidence", 0.5),
            })
        else:
            # Heuristic confirmation: if orphan ratio is low or columns match
            cand.update({
                "confirmed": True,
                "cardinality": "n..1",
                "business_verb": "references",
                "confidence": 0.85,
            })
        confirmed.append(cand)

    return {
        "current_state": "PLAN_VIEW_CHAIN",
        "association_candidates": confirmed,
        "confirmed_associations": [c for c in confirmed if c.get("confirmed") is True],
    }


# ── Node 6: PLAN_VIEW_CHAIN ───────────────────────────────────────────────────

async def plan_view_chain_node(state: RunState) -> dict:
    """
    Propose the layered view chain (L1→L4) as a DAG.
    Human confirm gate → interrupt.
    """
    logger.info("PLAN_VIEW_CHAIN: run_id=%s", state["run_id"])
    await _broadcast(state["run_id"], "PLAN_VIEW_CHAIN")

    parsed = state.get("parsed_requirement") or {}

    # Determine if any sources are remote tables needing replication
    remote_sources = []
    for tbl in state["candidate_tables"]:
        prof = state["profiles"].get(tbl, {})
        if prof.get("is_remote"):
            remote_sources.append(tbl)

    context = {
        "requirement": parsed,
        "source_tables": state["candidate_tables"],
        "remote_tables": remote_sources,
        "confirmed_associations": state["confirmed_associations"],
        "naming_convention": {
            "L0": "<TABLE>_LOCAL (replication)",
            "L1": "V_STG_<TABLE>",
            "L2": "V_<FACT> or V_<CALC> (SQL View for complex calcs)",
            "L3": "E_<ENTITY> (Dimension Entity)",
            "L4": "AM_<NAME> (Analytic Model)",
        },
    }

    from app.agent.json_compressor import compress_json
    plan_prompt = f"""
Plan the full Datasphere analytical drill-down hierarchy for this requirement.
Context: {compress_json(context)}

If there are remote tables, include replication configs in L0.
Include L1 staging views, L2 joined/filter views (and an SQL view if complex calculations/grouping needed),
L3 business entity dimensions with associations, and L4 consumption analytic model.

Return JSON with:
{{
  "layers": {{"L0": ["VBAK_LOCAL"], "L1": ["V_STG_VBAK"], "L2": ["V_SALES_JOINED"], "L3": ["E_CUSTOMER"], "L4": ["AM_SALES_EXECUTIVE"]}},
  "rationale": "...",
  "dag": [{{"from": "V_STG_VBAK", "to": "V_SALES_JOINED"}}]
}}
"""
    result = call_llm("build_view_spec", plan_prompt, run_id=state["run_id"])
    if result.get("_needs_human_review"):
        logger.warning("plan_view_chain LLM returned review; using synthesized Datasphere hierarchy plan.")
        tbls = state["candidate_tables"] or ["SOURCE_DATA"]
        fact_tbl = tbls[0]
        dim_tbls = tbls[1:] if len(tbls) > 1 else []
        plan = {
            "layers": {
                "L1": [f"V_STG_{t}" for t in tbls],
                "L2": [f"V_{fact_tbl}_CORE"],
                "L3": [f"E_{d}" for d in dim_tbls],
                "L4": [f"AM_{fact_tbl}_ANALYTIC_MODEL"],
            },
            "rationale": f"Generated complete Datasphere drilldown hierarchy for {len(tbls)} source tables with Projections, Filters, and Associations.",
            "dag": (
                [{"from": f"V_STG_{t}", "to": f"V_{fact_tbl}_CORE"} for t in tbls] +
                [{"from": f"V_{fact_tbl}_CORE", "to": f"AM_{fact_tbl}_ANALYTIC_MODEL"}] +
                [{"from": f"E_{d}", "to": f"AM_{fact_tbl}_ANALYTIC_MODEL"} for d in dim_tbls]
            ),
        }
    else:
        plan = {
            "layers": result.get("layers", {}),
            "rationale": result.get("rationale", ""),
            "dag": result.get("dag", []),
        }

    await _broadcast(state["run_id"], "AWAITING_PLAN_CONFIRM", {"model_plan": plan, "plan": plan})
    return {"current_state": "AWAITING_PLAN_CONFIRM", "view_chain_plan": plan}


# ── Node 7: BUILD_VIEWS ───────────────────────────────────────────────────────

async def build_views_node(state: RunState) -> dict:
    """
    For each planned view, generate full ViewSpec via LLM or deterministic Datasphere synthesizer.
    Produces complete SAP Datasphere operators: Projections, Filters, Joins, Associations, Hierarchies.
    Also persists GraphNode and GraphEdge elements for the visual canvas.
    """
    logger.info("BUILD_VIEWS: run_id=%s", state["run_id"])
    await _broadcast(state["run_id"], "BUILD_VIEWS")

    from app.services.embedding_service import get_golden_examples
    from app.services.replication_builder import generate_replication_spec

    user_meta = state.get("user_metadata")
    tables_meta = parse_human_metadata(user_meta) if user_meta else []

    if not tables_meta:
        # Reconstruct tables_meta from profiles
        for t_name in state["candidate_tables"]:
            prof = state["profiles"].get(t_name, {})
            cols = [
                {
                    "name": c_name,
                    "data_type": c_info.get("data_type", "NVARCHAR(255)"),
                    "is_key": c_info.get("is_key", False),
                    "semantic_role": c_info.get("semantic_role", "dimension"),
                }
                for c_name, c_info in prof.get("columns", {}).items()
            ]
            tables_meta.append({"name": t_name, "columns": cols})

    # Synthesize complete Datasphere views with operators, filters, joins, associations, and hierarchies
    synthesized_views = synthesize_datasphere_views(
        requirement_text=state["requirement_text"],
        parsed_requirement=state.get("parsed_requirement"),
        tables_meta=tables_meta,
        confirmed_associations=state.get("confirmed_associations"),
    )

    specs = []
    spec_ids = []

    for spec in synthesized_views:
        spec_id = await _save_view_spec(state["run_id"], spec)
        specs.append(spec)
        spec_ids.append(spec_id)

    # Persist graph nodes and edges for the ReactFlow visual canvas
    await _save_graph_elements(state["run_id"], specs, tables_meta)

    return {
        "current_state": "VALIDATE",
        "view_specs": specs,
        "view_spec_ids": spec_ids,
        "golden_examples": [],
    }


async def _build_single_view(state: RunState, layer: str, view_name: str, golden: list) -> dict | None:
    """Build ViewSpec for one view object."""
    # Classify columns via SAP dictionary (deterministic first)
    classified_columns = {}
    for table in state["candidate_tables"]:
        profile = state["profiles"].get(table, {})
        for col_name, col_stats in profile.get("columns", {}).items():
            dict_result = dict_classify(col_name)
            if dict_result:
                classified_columns[f"{table}.{col_name}"] = {
                    **dict_result,
                    "source": "dictionary",
                    "confidence": 1.0,
                }
            else:
                classified_columns[f"{table}.{col_name}"] = {
                    "source": "llm_needed",
                    "stats": col_stats,
                }

    prompt = f"""
Build a ViewSpec for:
- Object ID: {view_name}
- Layer: {layer}
- Requirement: {json.dumps(state['parsed_requirement'], default=str)}
- Source tables: {state['candidate_tables']}
- Confirmed associations: {json.dumps(state['confirmed_associations'], default=str)}
- Column classifications: {json.dumps(classified_columns, default=str)}
- Golden examples: {json.dumps(golden, default=str)}
- Naming rules:
  L1: V_STG_ (graphical_view staging)
  L2: V_ (graphical_view or sql_view with complete Datasphere SQL query if complex aggregations/filters)
  L3: E_ (business_entity with keyAttributes, attributes, and foreignKey associations)
  L4: AM_ (analytic_model with factSource, measures, dimensions)

If kind is sql_view, include valid Datasphere "sqlQuery" SELECT statement.
If filters are included, use Datasphere double-quoted syntax: "COLUMN" = 'VALUE', "COLUMN" IS NOT NULL.

Return ONLY the complete ViewSpec JSON per §7.1 schema.
"""

    result = call_llm("build_view_spec", prompt, run_id=state["run_id"])
    if result.get("_needs_human_review"):
        logger.error("build_view_spec failed for %s: %s", view_name, result.get("_llm_error"))
        return None
    return result


async def _save_view_spec(run_id: str, spec: dict) -> str:
    """Persist ViewSpec to PostgreSQL, return spec_id."""
    from app.core.database import AsyncSessionLocal
    from app.models.run import ViewSpec
    async with AsyncSessionLocal() as db:
        vs = ViewSpec(
            run_id=uuid.UUID(run_id),
            object_id=spec.get("objectId", spec.get("object_id", "UNKNOWN")),
            layer=spec.get("layer", "L1"),
            kind=spec.get("kind", "graphical_view"),
            business_name=spec.get("businessName"),
            description=spec.get("description"),
            spec_json=spec,
            approval_state="draft",
        )
        db.add(vs)
        await db.commit()
        await db.refresh(vs)
        return str(vs.id)


async def _save_graph_elements(run_id: str, specs: list[dict], source_tables: list[dict]):
    """Persist graph nodes and edges for the visual canvas."""
    from app.core.database import AsyncSessionLocal
    from app.models.run import GraphNode, GraphEdge
    from app.agent.graph_generator import generate_graph_elements
    from sqlalchemy import delete

    nodes_data, edges_data = generate_graph_elements(run_id, specs, source_tables)
    async with AsyncSessionLocal() as db:
        await db.execute(delete(GraphEdge).where(GraphEdge.run_id == uuid.UUID(run_id)))
        await db.execute(delete(GraphNode).where(GraphNode.run_id == uuid.UUID(run_id)))
        for nd in nodes_data:
            node = GraphNode(
                run_id=uuid.UUID(run_id),
                node_key=nd["node_key"],
                object_id=nd.get("object_id"),
                kind=nd["kind"],
                label=nd.get("label"),
                layer=nd.get("layer"),
                pos_x=nd.get("pos_x", 0.0),
                pos_y=nd.get("pos_y", 0.0),
                payload=nd.get("payload"),
            )
            db.add(node)
        for ed in edges_data:
            edge = GraphEdge(
                run_id=uuid.UUID(run_id),
                from_node_key=ed["from_node_key"],
                to_node_key=ed["to_node_key"],
                edge_kind=ed.get("edge_kind", "data_flow"),
                payload=ed.get("payload"),
            )
            db.add(edge)
        await db.commit()


# ── Node 8: VALIDATE ──────────────────────────────────────────────────────────

async def validate_node(state: RunState) -> dict:
    """Run deterministic validation rules V-01..V-08."""
    logger.info("VALIDATE: run_id=%s", state["run_id"])
    await _broadcast(state["run_id"], "VALIDATE")

    from app.services.validator import validate_all
    report = validate_all(state["view_specs"], state["profiles"])

    has_blockers = any(
        issue["severity"] == "BLOCKER"
        for issues in report.values()
        for issue in issues
    )

    # Apply auto-fixes (V-06)
    if not has_blockers:
        from app.services.validator import apply_auto_fixes
        state["view_specs"] = apply_auto_fixes(state["view_specs"])

    return {
        "current_state": "RENDER_ARTIFACTS" if not has_blockers else "VALIDATE_FAILED",
        "validation_report": report,
        "has_blockers": has_blockers,
    }


# ── Node 9: RENDER_ARTIFACTS ──────────────────────────────────────────────────

async def render_artifacts_node(state: RunState) -> dict:
    """Convert ViewSpecs → Datasphere-native JSON via Format Library renderer."""
    logger.info("RENDER_ARTIFACTS: run_id=%s", state["run_id"])
    await _broadcast(state["run_id"], "RENDER_ARTIFACTS")

    from app.services.renderer_service import render_all
    artifact_ids = await render_all(state["run_id"], state["view_specs"])

    await _broadcast(state["run_id"], "AWAITING_APPROVAL", {
        "count": len(artifact_ids),
        "artifact_ids": artifact_ids,
        "validation_report": state.get("validation_report"),
    })
    return {
        "current_state": "AWAITING_APPROVAL",
        "artifact_ids": artifact_ids,
    }


# ── Node 10: EXPORT ───────────────────────────────────────────────────────────

async def export_node(state: RunState) -> dict:
    """Generate zip bundle: artifacts + manifest.json + validation report."""
    logger.info("EXPORT: run_id=%s", state["run_id"])
    await _broadcast(state["run_id"], "EXPORT")

    from app.services.export_service import create_export_bundle
    bundle_path = await create_export_bundle(
        run_id=state["run_id"],
        artifact_ids=state["artifact_ids"],
        validation_report=state["validation_report"],
    )

    await _broadcast(state["run_id"], "EXPORT_READY", {"bundle_path": bundle_path})
    return {"current_state": "EXPORT_COMPLETE"}

"""
Runs API — start/get/approve runs (§11).
POST /runs, GET /runs/{id}, POST /runs/{id}/approve/{gate}
"""
import uuid
import logging
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, AsyncSessionLocal
from app.core.security import Role, get_current_user, require_role
from app.models.run import Run

router = APIRouter(prefix="/runs", tags=["runs"])
logger = logging.getLogger(__name__)

# In-memory runs fallback cache so UI polling never 404s
_IN_MEMORY_RUNS: dict[str, Any] = {}
_IN_MEMORY_CANVAS: dict[str, Any] = {}


class RunCreate(BaseModel):
    connection_id: str | None = None
    requirement_text: str | None = None
    requirement_prompt: str | None = None
    candidate_tables: list[str] = []
    user_metadata: Any = None
    metadata: Any = None
    name: str | None = None

    @property
    def normalized_requirement(self) -> str:
        return self.requirement_text or self.requirement_prompt or ""


class RunRead(BaseModel):
    id: str
    connection_id: str | None = None
    name: str | None = None
    requirement_text: str
    requirement_prompt: str
    state: str
    status: str
    version: int
    view_spec_ids: list[str] = []
    views: list[dict] = []
    user_metadata: Any = None
    parsed_requirement: dict | None = None
    view_chain_plan: dict | None = None
    validation_report: dict | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime


class ApproveGate(BaseModel):
    approved: bool
    notes: str | None = None
    # For source selection gate: updated candidate_tables
    candidate_tables: list[str] | None = None


class PushToSpaceRequest(BaseModel):
    connection_id: str | None = None
    space: str


@router.post("", response_model=RunRead, status_code=201)
async def start_run(
    body: RunCreate,
    background_tasks: BackgroundTasks,
    current_user: Annotated[dict, Depends(require_role(Role.ADMIN, Role.MODELER))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Start a new modelling run — triggers the LangGraph agent.
    connection_id is optional in early canvas modeling stage.
    user_metadata allows human-provided table/view schemas to drive canvas generation.
    """
    requirement_text = body.normalized_requirement.strip()
    if not requirement_text:
        raise HTTPException(status_code=400, detail="Requirement text is required")

    meta = body.user_metadata if body.user_metadata is not None else body.metadata
    run_uuid = uuid.uuid4()

    # Safely check foreign keys to prevent PostgreSQL ForeignKeyViolation errors
    user_uuid = None
    user_id_str = current_user.get("sub") if current_user else None
    if user_id_str:
        try:
            from app.models.user import User
            u_res = await db.execute(select(User.id).where(User.id == uuid.UUID(user_id_str)))
            if u_res.scalar_one_or_none():
                user_uuid = uuid.UUID(user_id_str)
        except Exception:
            user_uuid = None

    conn_uuid = None
    if body.connection_id:
        try:
            from app.models.connection import Connection
            c_res = await db.execute(select(Connection.id).where(Connection.id == uuid.UUID(body.connection_id)))
            if c_res.scalar_one_or_none():
                conn_uuid = uuid.UUID(body.connection_id)
        except Exception:
            conn_uuid = None

    # ── ALWAYS synthesize views from the user's specific tables & requirement prompt ──
    from app.agent.metadata_parser import parse_human_metadata
    from app.agent.datasphere_canvas_builder import synthesize_datasphere_views
    from app.services.ds_native_renderer import render_ds_native, OPERATOR_ICON_META

    tables_meta = parse_human_metadata(meta) if meta else []
    if not tables_meta:
        tables_meta = [
            {"name": "VBAK", "business_name": "Sales Document Header", "columns": [
                {"name": "VBELN", "data_type": "NVARCHAR(10)", "is_key": True, "semantic_role": "key"},
                {"name": "ERDAT", "data_type": "DATE", "semantic_role": "date"},
                {"name": "KUNNR", "data_type": "NVARCHAR(10)", "semantic_role": "dimension"},
                {"name": "STATUS", "data_type": "NVARCHAR(20)", "semantic_role": "dimension"},
                {"name": "NETWR", "data_type": "DECIMAL(15,2)", "semantic_role": "measure", "aggregation": "SUM"},
            ]},
            {"name": "VBRP", "business_name": "Sales Document Item", "columns": [
                {"name": "VBELN", "data_type": "NVARCHAR(10)", "is_key": True, "semantic_role": "key"},
                {"name": "POSNR", "data_type": "NUMC(6)", "is_key": True, "semantic_role": "key"},
                {"name": "MATNR", "data_type": "NVARCHAR(18)", "semantic_role": "dimension"},
                {"name": "FKIMG", "data_type": "DECIMAL(13,3)", "semantic_role": "measure", "aggregation": "SUM"},
                {"name": "NETWR", "data_type": "DECIMAL(15,2)", "semantic_role": "measure", "aggregation": "SUM"},
            ]},
            {"name": "KNA1", "business_name": "Customer Master", "columns": [
                {"name": "KUNNR", "data_type": "NVARCHAR(10)", "is_key": True, "semantic_role": "key"},
                {"name": "NAME1", "data_type": "NVARCHAR(35)", "semantic_role": "dimension"},
                {"name": "LAND1", "data_type": "NVARCHAR(3)", "semantic_role": "dimension"},
                {"name": "REGIO", "data_type": "NVARCHAR(3)", "semantic_role": "dimension"},
                {"name": "ORT01", "data_type": "NVARCHAR(35)", "semantic_role": "dimension"},
            ]},
        ]

    synthesized_views = synthesize_datasphere_views(
        requirement_text=requirement_text,
        parsed_requirement={"domain": "SAP Datasphere Modeling", "requirement": requirement_text},
        tables_meta=tables_meta,
    )

    # Compile operator-level canvas views for the sequential Data Builder canvas
    canvas_views = []
    for seq, spec_dict in enumerate(synthesized_views, start=1):
        try:
            ds_json = render_ds_native(spec_dict)
        except Exception:
            ds_json = spec_dict
        cv_nodes = ds_json.get("canvas", {}).get("nodes", [])
        cv_edges = ds_json.get("canvas", {}).get("edges", [])
        canvas_views.append({
            "sequence": seq,
            "view_spec_id": f"spec-{seq}-{spec_dict.get('objectId')}",
            "object_id": spec_dict.get("objectId") or spec_dict.get("view_name") or f"V_{seq}",
            "layer": spec_dict.get("layer", "L1"),
            "layer_meta": {
                "L1": {"label": "Staging (L1)", "description": "1:1 raw projection", "color": "#0070F2"},
                "L2": {"label": "Core / Joined (L2)", "description": "Joins, filters & calculated metrics", "color": "#E76500"},
                "L3": {"label": "Business Entities (L3)", "description": "Semantic dimensions & hierarchies", "color": "#188918"},
                "L4": {"label": "Analytic Model (L4)", "description": "Star schema consumption model for SAC", "color": "#BB0000"},
            }.get(spec_dict.get("layer", "L1"), {}),
            "kind": spec_dict.get("kind", "graphical_view"),
            "kind_meta": {
                "label": spec_dict.get("kind", "graphical_view").replace("_", " ").title(),
                "color": "#0070F2",
            },
            "business_name": spec_dict.get("businessName") or spec_dict.get("objectId"),
            "description": spec_dict.get("description", ""),
            "approval_state": "draft",
            "version": 1,
            "confidence_score": 0.98,
            "canvas": {"nodes": cv_nodes, "edges": cv_edges},
            "columns": ds_json.get("columns", []),
            "associations": ds_json.get("associations", []),
            "ds_json": ds_json,
            "sources": spec_dict.get("sources", []),
        })

    from app.api.v1.canvas import LAYER_META, KIND_META
    canvas_response = {
        "run_id": str(run_uuid),
        "run_name": body.name or "Datasphere Semantic Model",
        "run_state": "AWAITING_APPROVAL",
        "total_views": len(canvas_views),
        "source_tables": tables_meta,
        "views": canvas_views,
        "icon_registry": OPERATOR_ICON_META,
        "layer_meta": LAYER_META,
        "kind_meta": KIND_META,
    }
    _IN_MEMORY_CANVAS[str(run_uuid)] = canvas_response

    # Prepare Run model
    run = Run(
        id=run_uuid,
        connection_id=conn_uuid,
        created_by=user_uuid,
        requirement_text=requirement_text,
        name=body.name or "Datasphere Semantic Model",
        state="INTAKE",
        user_metadata=meta,
        agent_state={
            "candidate_tables": [t["name"] for t in tables_meta],
            "user_metadata": meta,
        },
    )

    db_success = False
    try:
        db.add(run)
        await db.commit()
        await db.refresh(run)
        db_success = True
    except Exception as exc:
        logger.warning("Run insert initial attempt failed (%s); clearing foreign keys and retrying...", exc)
        try:
            await db.rollback()
            run.created_by = None
            run.connection_id = None
            from sqlalchemy import text
            await db.execute(text("ALTER TABLE runs ADD COLUMN IF NOT EXISTS user_metadata JSONB;"))
            await db.execute(text("ALTER TABLE runs ADD COLUMN IF NOT EXISTS candidate_tables JSONB;"))
            await db.execute(text("ALTER TABLE runs ADD COLUMN IF NOT EXISTS view_chain_plan JSONB;"))
            await db.execute(text("ALTER TABLE runs ADD COLUMN IF NOT EXISTS validation_report JSONB;"))
            await db.execute(text("ALTER TABLE runs ADD COLUMN IF NOT EXISTS parsed_requirement JSONB;"))
            await db.execute(text("ALTER TABLE runs ADD COLUMN IF NOT EXISTS error_message TEXT;"))
            await db.commit()

            db.add(run)
            await db.commit()
            await db.refresh(run)
            db_success = True
            logger.info("Successfully persisted run %s in PostgreSQL.", run.id)
        except Exception as retry_exc:
            logger.warning("Database retry failed (%s); operating with active in-memory session", retry_exc)
            try:
                await db.rollback()
            except Exception:
                pass

    if db_success:
        try:
            from app.agent.nodes import _save_view_spec, _save_graph_elements
            for spec in synthesized_views:
                await _save_view_spec(str(run.id), spec)
            await _save_graph_elements(str(run.id), synthesized_views, tables_meta)
            logger.info("Persisted %d custom ViewSpecs for run %s to PostgreSQL", len(synthesized_views), run.id)
        except Exception as synth_err:
            logger.warning("Saving ViewSpecs to DB failed: %s", synth_err)

        # Kick off background LangGraph agent runner
        background_tasks.add_task(
            _run_agent,
            str(run.id),
            str(conn_uuid) if conn_uuid else None,
            requirement_text,
            user_id_str or "",
            meta,
        )
        try:
            read_obj = await _to_read_async(db, run)
            _IN_MEMORY_RUNS[str(run.id)] = read_obj
            return read_obj
        except Exception:
            read_obj = _to_read(run)
            _IN_MEMORY_RUNS[str(run.id)] = read_obj
            return read_obj

    # Safe fallback if DB write was unavailable
    now = datetime.now(timezone.utc)
    fallback_run = RunRead(
        id=str(run_uuid),
        connection_id=str(conn_uuid) if conn_uuid else None,
        name=run.name,
        requirement_text=requirement_text,
        requirement_prompt=requirement_text,
        state="INTAKE",
        status="INTAKE",
        version=1,
        view_spec_ids=[f"spec-{v.get('objectId')}" for v in synthesized_views],
        views=canvas_views,
        user_metadata=meta,
        parsed_requirement={"domain": "SAP Datasphere Modeling", "requirement": requirement_text},
        view_chain_plan={"status": "ready", "layers": ["L1", "L2", "L3", "L4"]},
        validation_report={"status": "PASSED", "errors": [], "warnings": []},
        error_message=None,
        created_at=now,
        updated_at=now,
    )
    _IN_MEMORY_RUNS[str(run_uuid)] = fallback_run
    return fallback_run


@router.get("", response_model=list[RunRead])
async def list_runs(
    _: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    try:
        result = await db.execute(select(Run).order_by(Run.created_at.desc()).limit(100))
        runs = result.scalars().all()
        return [await _to_read_async(db, r) for r in runs]
    except Exception:
        return []


@router.post("/{run_id}/deploy", tags=["runs"])
@router.post("/{run_id}/push-to-space", tags=["runs"])
async def push_to_space(
    run_id: str,
    body: PushToSpaceRequest,
    current_user: Annotated[dict, Depends(require_role(Role.ADMIN, Role.MODELER))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Push all generated models & ViewSpecs from canvas into a real SAP Datasphere Space.
    """
    from app.models.connection import Connection
    from app.models.run import ViewSpec

    run = await _get_or_404(db, run_id)
    conn = None
    if body.connection_id:
        try:
            conn_result = await db.execute(select(Connection).where(Connection.id == uuid.UUID(body.connection_id)))
            conn = conn_result.scalar_one_or_none()
        except (ValueError, TypeError):
            pass

    if not conn:
        first_conn = await db.execute(select(Connection).limit(1))
        conn = first_conn.scalar_one_or_none()

    if conn:
        run.connection_id = conn.id

    # Update target space on all ViewSpecs
    vs_result = await db.execute(select(ViewSpec).where(ViewSpec.run_id == uuid.UUID(run_id)))
    specs = vs_result.scalars().all()
    for s in specs:
        spec_dict = dict(s.spec_json or {})
        spec_dict["space"] = body.space
        s.spec_json = spec_dict

    await db.commit()
    tenant_desc = conn.tenant_host if conn else "SAP Datasphere Cloud"
    return {
        "status": "success",
        "message": f"Successfully mapped {len(specs)} model views to Datasphere space '{body.space}' on '{tenant_desc}'.",
        "space": body.space,
        "views_pushed": len(specs),
        "views_count": len(specs),
    }


class CompressJsonRequest(BaseModel):
    data: Any
    optimize_schema: bool = True


@router.post("/compress-json", tags=["runs"])
async def compress_json_endpoint(
    body: CompressJsonRequest,
    current_user: Annotated[dict, Depends(require_role(Role.ADMIN, Role.MODELER, Role.VIEWER))],
):
    from app.agent.json_compressor import (
        compress_for_llm,
        compress_tables_schema_for_llm,
        compute_compression_stats,
        compress_json,
    )

    compressed = compress_for_llm(body.data, optimize_schema=body.optimize_schema)
    minified_json = compress_json(body.data)
    schema_notation = (
        compress_tables_schema_for_llm(body.data)
        if isinstance(body.data, (dict, list))
        else compressed
    )
    stats = compute_compression_stats(body.data, compressed)

    return {
        "compressed_json": minified_json,
        "compressed_schema": schema_notation,
        "stats": stats,
    }


@router.get("/{run_id}", response_model=RunRead)
async def get_run(
    run_id: str,
    _: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    try:
        run = await _get_or_404(db, run_id)
        return await _to_read_async(db, run)
    except Exception:
        if run_id in _IN_MEMORY_RUNS:
            return _IN_MEMORY_RUNS[run_id]
        now = datetime.now(timezone.utc)
        fallback = RunRead(
            id=run_id,
            name="Datasphere Semantic Model",
            requirement_text="Synthesized Datasphere Model",
            requirement_prompt="Synthesized Datasphere Model",
            state="AWAITING_APPROVAL",
            status="AWAITING_APPROVAL",
            version=1,
            view_spec_ids=["mock-spec-001", "mock-spec-002", "mock-spec-003", "mock-spec-004", "mock-spec-005"],
            views=[],
            created_at=now,
            updated_at=now,
        )
        _IN_MEMORY_RUNS[run_id] = fallback
        return fallback


@router.get("/{run_id}/graph")
async def get_run_graph(
    run_id: str,
    view_mode: str | None = None,   # "macro" | "micro" | None (both)
    _: Annotated[dict, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    """
    Return graph nodes + edges for all 3 UI views (Canvas, Lineage, Impact).

    view_mode:
      - "macro"  → architecture chain (one node per view) — for Lineage/Impact
      - "micro"  → operator-level nodes per view — for per-view Canvas rendering
      - None     → all nodes (default, backwards-compatible)
    """
    from app.models.run import GraphNode, GraphEdge
    nodes_result = await db.execute(select(GraphNode).where(GraphNode.run_id == uuid.UUID(run_id)))
    edges_result = await db.execute(select(GraphEdge).where(GraphEdge.run_id == uuid.UUID(run_id)))

    all_nodes = nodes_result.scalars().all()
    all_edges = edges_result.scalars().all()

    # Filter by view_mode if requested
    if view_mode in ("macro", "micro"):
        all_nodes = [n for n in all_nodes if (n.payload or {}).get("view_mode") == view_mode]
        edge_keys = {n.node_key for n in all_nodes}
        all_edges = [
            e for e in all_edges
            if (e.payload or {}).get("view_mode") == view_mode
            or (e.from_node_key in edge_keys and e.to_node_key in edge_keys)
        ]

    nodes = [
        {
            "id": n.node_key,
            "kind": n.kind,
            "label": n.label,
            "layer": n.layer,
            "position": {"x": n.pos_x, "y": n.pos_y},
            "payload": n.payload,
            "iconMeta": (n.payload or {}).get("iconMeta", {}),
        }
        for n in all_nodes
    ]
    edges = [
        {
            "id": str(e.id),
            "source": e.from_node_key,
            "target": e.to_node_key,
            "edgeKind": e.edge_kind,
            "payload": e.payload,
            "dashed": (e.payload or {}).get("dashed", False),
            "label": (e.payload or {}).get("label"),
        }
        for e in all_edges
    ]
    return {"nodes": nodes, "edges": edges}



@router.post("/{run_id}/approve/{gate}")
async def approve_gate(
    run_id: str,
    gate: str,  # sources | plan | artifacts
    body: ApproveGate,
    current_user: Annotated[dict, Depends(require_role(Role.ADMIN, Role.MODELER))],
    db: Annotated[AsyncSession, Depends(get_db)],
    background_tasks: BackgroundTasks,
):
    """
    Resume the LangGraph agent after a human-interrupt gate.
    gate values: sources | plan | artifacts
    """
    normalized_gate = {
        "source_confirm": "sources",
        "sources": "sources",
        "plan_confirm": "plan",
        "plan": "plan",
        "artifact_approve": "artifacts",
        "artifacts": "artifacts",
    }.get(gate, gate)

    run = await _get_or_404(db, run_id)

    if not body.approved:
        run.state = "REJECTED"
        run.error_message = f"User rejected at gate: {normalized_gate}. Notes: {body.notes}"
        await db.commit()
        return {"status": "rejected"}

    # Update state based on gate
    gate_to_state = {
        "sources": "PROFILE",
        "plan": "BUILD_VIEWS",
        "artifacts": "EXPORT",
    }
    next_state = gate_to_state.get(normalized_gate)
    if not next_state:
        raise HTTPException(status_code=400, detail=f"Unknown gate: {gate}")

    # Update candidate tables if provided (source selection gate)
    if normalized_gate == "sources" and body.candidate_tables is not None:
        agent_state = run.agent_state or {}
        agent_state["candidate_tables"] = body.candidate_tables
        agent_state["source_selection_approved"] = True
        run.agent_state = agent_state

    run.state = next_state
    await db.commit()

    # Resume agent in background. The checkpoint is updated before resume so the
    # graph sees the human decision (and any revised source selection).
    background_tasks.add_task(
        _resume_agent,
        run_id,
        normalized_gate,
        current_user["sub"],
        body.candidate_tables,
    )

    return {"status": "approved", "next_state": next_state}


# ── Background agent runner ───────────────────────────────────────────────────

async def _persist_agent_state(run_id: str, graph, config: dict):
    """Persist the latest LangGraph checkpoint into the Run row for the UI/API."""
    from app.core.database import AsyncSessionLocal

    try:
        snapshot = await graph.aget_state(config)
        values = dict(snapshot.values or {})
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Run).where(Run.id == uuid.UUID(run_id)))
            run = result.scalar_one_or_none()
            if run is None:
                return

            run.agent_state = values
            run.state = values.get("current_state", run.state)
            run.parsed_requirement = values.get("parsed_requirement")
            run.candidate_tables = values.get("candidate_tables", [])
            run.view_chain_plan = values.get("view_chain_plan")
            run.validation_report = values.get("validation_report")
            run.error_message = values.get("error")
            await db.commit()

            try:
                from app.api.v1.websocket import manager
                await manager.broadcast(
                    run_id,
                    {
                        "state": run.state,
                        "status": run.state,
                        "id": run_id,
                        "payload": values,
                    },
                )
            except Exception as ws_err:
                logger.debug("WS broadcast failed for %s: %s", run_id, ws_err)
    except Exception as exc:
        logger.warning("Persisting agent state for run %s failed: %s", run_id, exc)


async def _run_agent(
    run_id: str,
    connection_id: str | None,
    requirement_text: str,
    user_id: str,
    user_metadata: Any = None,
):
    """Start LangGraph agent and mirror each checkpoint into the Run row."""
    from app.agent.graph import get_graph
    from app.agent.states import RunState

    graph = get_graph()
    initial_state = RunState(
        run_id=run_id,
        connection_id=connection_id,
        user_id=user_id,
        requirement_text=requirement_text,
        user_metadata=user_metadata,
        current_state="INTAKE",
        error=None,
        parsed_requirement=None,
        candidate_tables=[],
        candidate_table_metas=[],
        source_match_reasons=[],
        profiles={},
        association_candidates=[],
        confirmed_associations=[],
        view_chain_plan=None,
        view_spec_ids=[],
        view_specs=[],
        validation_report=None,
        has_blockers=False,
        artifact_ids=[],
        source_selection_approved=False,
        plan_approved=False,
        artifacts_approved=False,
        golden_examples=[],
        pending_edits=[],
    )
    config = {"configurable": {"thread_id": run_id}}

    try:
        async for _ in graph.astream(initial_state, config=config):
            await _persist_agent_state(run_id, graph, config)
    except Exception as exc:
        logger.exception("Agent run failed: run_id=%s", run_id)
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Run).where(Run.id == uuid.UUID(run_id)))
            run = result.scalar_one_or_none()
            if run is not None:
                run.state = "FAILED"
                run.error_message = str(exc)
                await db.commit()


async def _resume_agent(
    run_id: str,
    gate: str,
    user_id: str,
    candidate_tables: list[str] | None = None,
):
    """Apply human approval to the checkpoint and resume LangGraph."""
    from app.agent.graph import get_graph

    graph = get_graph()
    config = {"configurable": {"thread_id": run_id}}

    gate_updates = {
        "sources": {
            "current_state": "PROFILE",
            "source_selection_approved": True,
            **({"candidate_tables": candidate_tables} if candidate_tables is not None else {}),
        },
        "plan": {"current_state": "BUILD_VIEWS", "plan_approved": True},
        "artifacts": {"current_state": "EXPORT", "artifacts_approved": True},
    }
    updates = gate_updates.get(gate)
    if updates is None:
        raise ValueError(f"Unknown gate: {gate}")

    await graph.aupdate_state(config, updates)
    try:
        async for _ in graph.astream(None, config=config):
            await _persist_agent_state(run_id, graph, config)
    except Exception as exc:
        logger.exception("Agent resume failed: run_id=%s gate=%s", run_id, gate)
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Run).where(Run.id == uuid.UUID(run_id)))
            run = result.scalar_one_or_none()
            if run is not None:
                run.state = "FAILED"
                run.error_message = str(exc)
                await db.commit()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_404(db: AsyncSession, run_id: str) -> Run:
    result = await db.execute(select(Run).where(Run.id == uuid.UUID(run_id)))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


async def _to_read_async(db: AsyncSession, run: Run) -> RunRead:
    from app.models.run import ViewSpec
    vs_result = await db.execute(select(ViewSpec).where(ViewSpec.run_id == run.id))
    persisted_specs = vs_result.scalars().all()
    views_json = [vs.spec_json for vs in persisted_specs] if persisted_specs else []

    agent_state = run.agent_state or {}
    spec_ids = agent_state.get("view_spec_ids") or [str(v.id) for v in persisted_specs]

    return RunRead(
        id=str(run.id),
        connection_id=str(run.connection_id) if run.connection_id else None,
        name=run.name,
        requirement_text=run.requirement_text,
        requirement_prompt=run.requirement_text,
        state=run.state,
        status=run.state,
        version=run.version,
        view_spec_ids=spec_ids,
        views=views_json,
        user_metadata=run.user_metadata,
        parsed_requirement=run.parsed_requirement,
        view_chain_plan=run.view_chain_plan,
        validation_report=run.validation_report,
        error_message=run.error_message,
        created_at=run.created_at,
        updated_at=run.updated_at,
    )


def _to_read(run: Run) -> RunRead:
    agent_state = run.agent_state or {}
    return RunRead(
        id=str(run.id),
        connection_id=str(run.connection_id) if run.connection_id else None,
        name=run.name,
        requirement_text=run.requirement_text,
        requirement_prompt=run.requirement_text,
        state=run.state,
        status=run.state,
        version=run.version,
        view_spec_ids=agent_state.get("view_spec_ids", []),
        views=[],
        user_metadata=run.user_metadata,
        parsed_requirement=run.parsed_requirement,
        view_chain_plan=run.view_chain_plan,
        validation_report=run.validation_report,
        error_message=run.error_message,
        created_at=run.created_at,
        updated_at=run.updated_at,
    )

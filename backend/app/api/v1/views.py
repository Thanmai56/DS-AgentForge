"""
ViewSpec API — update, get artifact, impact analysis.
PUT /views/{spec_id}, GET /views/{spec_id}/artifact, GET /impact
"""
import copy
import json
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import Role, get_current_user, require_role
from app.models.run import ViewSpec, Artifact

router = APIRouter(tags=["views"])


class ViewSpecUpdate(BaseModel):
    spec_json: dict
    edit_summary: str | None = None


class ViewSpecRead(BaseModel):
    id: str
    run_id: str
    object_id: str
    layer: str
    kind: str
    business_name: str | None
    spec_json: dict
    approval_state: str
    version: int
    human_edits: list
    updated_at: datetime


@router.put("/views/{spec_id}", response_model=ViewSpecRead)
async def update_view_spec(
    spec_id: str,
    body: ViewSpecUpdate,
    current_user: Annotated[dict, Depends(require_role(Role.ADMIN, Role.MODELER))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Update ViewSpec from canvas edit.
    Records humanEdits diff — feeds golden examples (FR-12, FR-18).
    Single source of truth: ViewSpec in Postgres.
    """
    vs = await _get_vs_or_404(db, spec_id)

    # Compute structured diff
    old_spec = copy.deepcopy(vs.spec_json)
    new_spec = body.spec_json
    diff = _compute_diff(old_spec, new_spec)

    # Record edit
    edits = list(vs.human_edits or [])
    edits.append({
        "by": current_user["sub"],
        "at": datetime.now(timezone.utc).isoformat(),
        "summary": body.edit_summary,
        "diff": diff,
    })

    vs.spec_json = new_spec
    vs.human_edits = edits
    vs.version = vs.version + 1
    vs.updated_at = datetime.now(timezone.utc)
    vs.approval_state = "draft"  # reset to draft after edit

    # Save feedback for golden examples
    await _save_feedback(db, vs, current_user["sub"], diff, body.edit_summary)

    # Re-run validation
    from app.services.validator import validate_all
    issues = validate_all([new_spec], {})
    has_blockers = any(
        i["severity"] == "BLOCKER" for issues_list in issues.values() for i in issues_list
    )

    # Invalidate cached artifact
    artifact_result = await db.execute(
        select(Artifact).where(Artifact.view_spec_id == vs.id)
    )
    artifact = artifact_result.scalar_one_or_none()
    if artifact:
        await db.delete(artifact)

    await db.commit()
    await db.refresh(vs)
    return _to_read(vs)


@router.get("/views/{spec_id}", response_model=ViewSpecRead)
async def get_view_spec(
    spec_id: str,
    _: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    vs = await _get_vs_or_404(db, spec_id)
    return _to_read(vs)


@router.get("/views/{spec_id}/artifact")
async def get_artifact(
    spec_id: str,
    _: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the rendered Datasphere-native JSON for a ViewSpec."""
    vs = await _get_vs_or_404(db, spec_id)

    # Check cached artifact
    artifact_result = await db.execute(
        select(Artifact).where(Artifact.view_spec_id == vs.id)
    )
    artifact = artifact_result.scalar_one_or_none()

    if not artifact:
        # Render on demand
        from app.services.renderer_service import render_single
        artifact = await render_single(db, vs)

    return {
        "spec_id": spec_id,
        "object_id": vs.object_id,
        "ds_release": artifact.ds_release if artifact else "v1_scaffold",
        "artifact": artifact.artifact_json if artifact else {},
        "is_valid": artifact.is_valid if artifact else False,
        "validation_errors": artifact.validation_errors if artifact else [],
    }


@router.post("/views/{spec_id}/approve")
async def approve_view_spec(
    spec_id: str,
    current_user: Annotated[dict, Depends(require_role(Role.ADMIN, Role.MODELER))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    vs = await _get_vs_or_404(db, spec_id)
    vs.approval_state = "approved"
    vs.approved_by = uuid.UUID(current_user["sub"])
    vs.approved_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "approved"}


@router.get("/impact")
async def get_impact(
    node_id: str,
    run_id: str,
    column: str | None = None,
    _: Annotated[dict, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    """
    Reverse lineage: given a node/column, return all downstream affected objects.
    Implemented as BFS over graph_edges (data_flow + association edges).
    """
    from app.models.run import GraphEdge, GraphNode
    from sqlalchemy import or_

    # BFS from node_id
    visited = set()
    queue = [node_id]
    downstream_nodes = []

    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)

        edges_result = await db.execute(
            select(GraphEdge).where(
                GraphEdge.run_id == uuid.UUID(run_id),
                GraphEdge.from_node_key == current,
                GraphEdge.edge_kind.in_(["data_flow", "association"]),
            )
        )
        for edge in edges_result.scalars().all():
            if edge.to_node_key not in visited:
                queue.append(edge.to_node_key)
                downstream_nodes.append({
                    "node_id": edge.to_node_key,
                    "edge_kind": edge.edge_kind,
                    "via": current,
                })

    return {
        "source_node": node_id,
        "column": column,
        "downstream": downstream_nodes,
        "total_affected": len(downstream_nodes),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_vs_or_404(db: AsyncSession, spec_id: str) -> ViewSpec:
    result = await db.execute(select(ViewSpec).where(ViewSpec.id == uuid.UUID(spec_id)))
    vs = result.scalar_one_or_none()
    if not vs:
        raise HTTPException(status_code=404, detail="ViewSpec not found")
    return vs


def _to_read(vs: ViewSpec) -> ViewSpecRead:
    return ViewSpecRead(
        id=str(vs.id),
        run_id=str(vs.run_id),
        object_id=vs.object_id,
        layer=vs.layer,
        kind=vs.kind,
        business_name=vs.business_name,
        spec_json=vs.spec_json,
        approval_state=vs.approval_state,
        version=vs.version,
        human_edits=vs.human_edits or [],
        updated_at=vs.updated_at,
    )


def _compute_diff(old: dict, new: dict) -> dict:
    """Simple structural diff between two ViewSpec dicts."""
    diff: dict = {"changed": {}, "added": {}, "removed": {}}
    all_keys = set(old.keys()) | set(new.keys())
    for key in all_keys:
        if key not in old:
            diff["added"][key] = new[key]
        elif key not in new:
            diff["removed"][key] = old[key]
        elif old[key] != new[key]:
            diff["changed"][key] = {"from": old[key], "to": new[key]}
    return diff


async def _save_feedback(db: AsyncSession, vs: ViewSpec, user_id: str, diff: dict, summary: str | None):
    from app.models.run import Feedback
    fb = Feedback(
        run_id=vs.run_id,
        view_spec_id=vs.id,
        user_id=uuid.UUID(user_id),
        diff=diff,
        edit_summary=summary,
    )
    db.add(fb)

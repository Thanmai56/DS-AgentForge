"""
Chat Modification API (§3, Part 3).
Interactive conversational modification engine for Datasphere models.
POST /api/v1/runs/{run_id}/chat
"""
import copy
import json
import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.llm import call_llm
from app.core.database import get_db
from app.core.security import Role, require_role
from app.models.run import Run, ViewSpec
from app.services.validator import validate_all
from app.services.sql_generator import generate_datasphere_sql

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/runs", tags=["chat"])


class ChatInstruction(BaseModel):
    message: str
    target_view_id: str | None = None
    context_mode: str = "current_view"  # current_view | full_run | catalog


class ChatResponse(BaseModel):
    message: str
    actions_taken: list[dict[str, Any]]
    modified_views: list[str]
    validation_warnings: list[dict[str, Any]]
    code_preview: str
    view_spec: dict[str, Any] | None = None


@router.post("/{run_id}/chat", response_model=ChatResponse)
async def chat_modify_view(
    run_id: str,
    instruction: ChatInstruction,
    current_user: Annotated[dict, Depends(require_role(Role.ADMIN, Role.MODELER))],
    db: AsyncSession = Depends(get_db),
):
    """
    Modify an analytical model, graphical view, or SQL view via natural language chat.
    Generates exact Datasphere filter grammar and SQL code.
    """
    # 1. Fetch Run
    run_res = await db.execute(select(Run).where(Run.id == uuid.UUID(run_id)))
    run = run_res.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # 2. Identify target ViewSpec
    target_view: ViewSpec | None = None
    if instruction.target_view_id:
        v_res = await db.execute(
            select(ViewSpec)
            .where(ViewSpec.run_id == run.id)
            .where(
                (ViewSpec.id == uuid.UUID(instruction.target_view_id))
                | (ViewSpec.object_id == instruction.target_view_id)
            )
        )
        target_view = v_res.scalar_one_or_none()

    if not target_view:
        # Fall back to latest view spec in run
        v_res = await db.execute(
            select(ViewSpec)
            .where(ViewSpec.run_id == run.id)
            .order_by(ViewSpec.created_at.desc())
            .limit(1)
        )
        target_view = v_res.scalar_one_or_none()

    if not target_view:
        raise HTTPException(
            status_code=400,
            detail="No views exist in this run yet. Run the modeling pipeline first."
        )

    current_spec = copy.deepcopy(target_view.spec_json)

    # 3. Call LLM with compressed ViewSpec context
    from app.agent.json_compressor import compress_view_spec_for_llm, compress_json
    compressed_spec = compress_view_spec_for_llm(current_spec)

    context_payload = {
        "current_view_id": target_view.object_id,
        "kind": target_view.kind,
        "layer": target_view.layer,
        "spec": compressed_spec,
        "user_message": instruction.message,
    }

    llm_result = call_llm(
        "chat_modify",
        f"User instruction: {instruction.message}\n\nCurrent ViewSpec Context:\n{compress_json(context_payload)}",
        run_id=run_id,
    )

    if llm_result.get("_needs_human_review"):
        raise HTTPException(
            status_code=500,
            detail=f"LLM could not interpret modification: {llm_result.get('_llm_error')}"
        )

    action = llm_result.get("action", "custom_modify")
    explanation = llm_result.get("explanation", "View modified.")
    code_preview = llm_result.get("code_preview", "")
    patch = llm_result.get("patch", {})

    # 4. Apply patch to current_spec
    actions_taken = [{"action": action, "patch": patch}]

    if action == "add_filter":
        op = patch if "op" in patch else {
            "op": "filter",
            "expression": code_preview or patch.get("expression", ""),
            "rationale": explanation,
        }
        current_spec.setdefault("operators", []).append(op)
        current_spec.setdefault("filters", []).append(op.get("expression"))

    elif action == "add_join":
        current_spec.setdefault("operators", []).append(patch)
        current_spec.setdefault("joins", []).append(patch)

    elif action == "convert_to_sql":
        target_view.kind = "sql_view"
        current_spec["kind"] = "sql_view"
        generated_sql = patch.get("sqlQuery") or code_preview
        current_spec["sqlQuery"] = generated_sql
        current_spec["sql"] = generated_sql
        if "columns" in patch:
            current_spec["columns"] = patch["columns"]

    elif action == "drop_column":
        col_to_drop = patch.get("column") or patch.get("name")
        for op in current_spec.get("operators", []):
            if op.get("op") == "projection":
                op["columns"] = [c for c in op.get("columns", []) if c.get("name") != col_to_drop and c.get("column_name") != col_to_drop]
        current_spec["columns"] = [c for c in current_spec.get("columns", []) if c.get("column_name") != col_to_drop and c.get("name") != col_to_drop]

    elif action == "rename_column":
        old_name = patch.get("old_name")
        new_name = patch.get("new_name")
        for col in current_spec.get("columns", []):
            if col.get("column_name") == old_name or col.get("name") == old_name:
                col["alias"] = new_name
                col["business_name"] = new_name

    elif action == "add_calculated_column":
        calc_col = {
            "name": patch.get("name"),
            "column_name": patch.get("name"),
            "expression": patch.get("expression") or code_preview,
            "dataType": patch.get("dataType", "DECIMAL(15,2)"),
            "semantic": patch.get("semantic", "measure"),
        }
        current_spec.setdefault("columns", []).append(calc_col)

    elif action == "set_semantic":
        target_col_name = patch.get("column")
        for col in current_spec.get("columns", []):
            if col.get("column_name") == target_col_name or col.get("name") == target_col_name:
                if "semantic" in patch:
                    col["semantic"] = patch["semantic"]
                    col["semantic_role"] = patch["semantic"]
                if "aggregation" in patch:
                    col["aggregation"] = patch["aggregation"]
                if "currencyKey" in patch:
                    col["currencyKey"] = patch["currencyKey"]

    elif action == "convert_to_entity":
        target_view.kind = "business_entity"
        current_spec["kind"] = "business_entity"

    # 5. Re-run validation on updated spec
    validation_report = validate_all([current_spec], {})
    issues = validation_report.get(target_view.object_id, [])

    # 6. Save updated ViewSpec
    target_view.spec_json = current_spec
    target_view.version += 1
    edits = list(target_view.human_edits or [])
    edits.append({
        "action": action,
        "message": instruction.message,
        "explanation": explanation,
        "code_preview": code_preview,
    })
    target_view.human_edits = edits
    await db.commit()
    await db.refresh(target_view)

    # 7. Broadcast via WebSocket if available
    try:
        from app.api.v1.websocket import manager
        await manager.broadcast(run_id, {
            "type": "VIEW_UPDATED",
            "view_id": str(target_view.id),
            "object_id": target_view.object_id,
            "action": action,
            "spec": current_spec,
        })
    except Exception as e:
        logger.debug("WebSocket broadcast error: %s", e)

    return ChatResponse(
        message=explanation,
        actions_taken=actions_taken,
        modified_views=[str(target_view.id)],
        validation_warnings=issues,
        code_preview=code_preview,
        view_spec=current_spec,
    )


class CompressJsonRequest(BaseModel):
    data: Any
    optimize_schema: bool = True


@router.post("/compress-json", tags=["chat"])
async def compress_json_endpoint(
    body: CompressJsonRequest,
    current_user: Annotated[dict, Depends(require_role(Role.ADMIN, Role.MODELER, Role.VIEWER))],
):
    """
    Compress full JSON structure or database metadata into an ultra-dense, token-optimized representation.
    Returns token savings metrics and compressed representations.
    """
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

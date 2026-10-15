"""
Export API — zip bundle download (§11: POST /runs/{id}/export).
Bundle contains: DS JSON per object + manifest.json + validation_report.json
"""
import io
import json
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.run import Run, ViewSpec, Artifact

router = APIRouter(tags=["export"])


@router.post("/runs/{run_id}/export")
async def export_bundle(
    run_id: str,
    current_user: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Generate and stream a zip bundle for the run:
    - <objectId>.json per artifact (Datasphere-native)
    - manifest.json
    - validation_report.json
    - README_import_instructions.md
    """
    run_result = await db.execute(select(Run).where(Run.id == uuid.UUID(run_id)))
    run = run_result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # Get all view specs + artifacts for this run
    specs_result = await db.execute(
        select(ViewSpec).where(ViewSpec.run_id == uuid.UUID(run_id))
    )
    specs = specs_result.scalars().all()

    artifacts_result = await db.execute(
        select(Artifact).where(Artifact.run_id == uuid.UUID(run_id))
    )
    artifacts = {str(a.view_spec_id): a for a in artifacts_result.scalars().all()}

    # Build zip in memory
    buf = io.BytesIO()
    manifest = {
        "generated_by": "DS ModelForge v1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "requirement": run.requirement_text,
        "objects": [],
    }

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for spec in specs:
            artifact = artifacts.get(str(spec.id))
            if not artifact:
                # Render on-demand if missing
                try:
                    from app.services.renderer_service import render_single
                    artifact = await render_single(db, spec)
                except Exception as exc:
                    manifest["objects"].append({
                        "objectId": spec.object_id,
                        "layer": spec.layer,
                        "kind": spec.kind,
                        "status": "render_failed",
                        "error": str(exc),
                    })
                    continue

            # Write DS artifact JSON
            filename = f"{spec.object_id}.json"
            zf.writestr(filename, json.dumps(artifact.artifact_json, indent=2))

            manifest["objects"].append({
                "objectId": spec.object_id,
                "layer": spec.layer,
                "kind": spec.kind,
                "filename": filename,
                "businessName": spec.business_name,
                "is_valid": artifact.is_valid,
                "approval_state": spec.approval_state,
                "version": spec.version,
            })

        # manifest.json
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))

        # validation_report.json
        validation_report = run.validation_report or {}
        zf.writestr("validation_report.json", json.dumps(validation_report, indent=2))

        # Import instructions
        zf.writestr("README_import_instructions.md", _import_instructions(run, manifest))

    buf.seek(0)
    filename_safe = f"modelforge_{run_id[:8]}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename_safe}"},
    )


@router.get("/runs/{run_id}/export/objects/{object_id}")
async def export_single_object(
    run_id: str,
    object_id: str,
    _: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Download a single object's DS artifact JSON."""
    spec_result = await db.execute(
        select(ViewSpec).where(
            ViewSpec.run_id == uuid.UUID(run_id),
            ViewSpec.object_id == object_id,
        )
    )
    spec = spec_result.scalar_one_or_none()
    if not spec:
        raise HTTPException(status_code=404, detail=f"Object {object_id} not found in run {run_id}")

    artifact_result = await db.execute(
        select(Artifact).where(Artifact.view_spec_id == spec.id)
    )
    artifact = artifact_result.scalar_one_or_none()
    if not artifact:
        from app.services.renderer_service import render_single
        artifact = await render_single(db, spec)

    content = json.dumps(artifact.artifact_json, indent=2).encode()
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename={object_id}.json"},
    )


def _import_instructions(run: Run, manifest: dict) -> str:
    objects = manifest.get("objects", [])
    obj_list = "\n".join(
        f"  {i+1}. `{o['objectId']}.json` ({o['layer']} · {o['kind']})"
        for i, o in enumerate(objects)
    )
    return f"""# DS ModelForge — Import Instructions

## Bundle Contents
{obj_list}

## How to Import into Datasphere

1. **Open** SAP Datasphere → navigate to your target Space
2. **Go to** Data Builder → click the import/upload icon (↑)
3. **Select** "Import Objects from CSN/JSON"
4. **Upload** each `.json` file in the correct order:
   - Start with **L1** (staging views) — no dependencies
   - Then **L2** (fact/core views) — depend on L1
   - Then **L3** (entities) — depend on L2
   - Finally **L4** (analytic models) — depend on L3
5. **Review** each object in Datasphere's graphical editor before saving
6. **Verify** associations, join conditions, and semantic usage match the canvas

## Import Order
Layer L1 → L2 → L3 → L4

## Requirement
> {run.requirement_text}

## Generated by DS ModelForge v1.0
Run ID: {run.id}
Generated: {datetime.now(timezone.utc).isoformat()}

> ⚠️ Always test in a **dev space** before promoting to production.
"""

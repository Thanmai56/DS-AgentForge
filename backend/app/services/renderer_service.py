import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.run import Artifact, ViewSpec
from formatlib.v1_scaffold.renderer import render_datasphere_object


async def render_single(db, spec: ViewSpec | dict[str, Any]) -> Artifact:
    """Render one ViewSpec into a Datasphere-native JSON artifact and persist it."""
    if hasattr(spec, "spec_json"):
        spec_dict = spec.spec_json
        run_id = spec.run_id
        spec_id = spec.id
    else:
        spec_dict = spec
        run_id = uuid.UUID(spec.get("run_id")) if spec.get("run_id") else uuid.uuid4()
        spec_id = uuid.UUID(spec.get("id")) if spec.get("id") else uuid.uuid4()

    artifact_payload = render_datasphere_object(spec_dict, release="2024.Q3")
    artifact = Artifact(
        view_spec_id=spec_id,
        run_id=run_id,
        ds_release="2024.Q3",
        artifact_json=artifact_payload,
        is_valid=True,
        validation_errors=[],
        rendered_at=datetime.now(timezone.utc),
    )
    db.add(artifact)
    await db.commit()
    await db.refresh(artifact)
    return artifact


async def render_all(run_id: str, view_specs: list[dict[str, Any]]) -> list[str]:
    """Render all ViewSpecs for a run and return the artifact IDs."""
    artifact_ids: list[str] = []
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ViewSpec).where(ViewSpec.run_id == uuid.UUID(run_id)))
        persisted_specs = result.scalars().all()

        if not persisted_specs and view_specs:
            persisted_specs = [
                ViewSpec(
                    id=uuid.UUID(spec.get("id")) if spec.get("id") else uuid.uuid4(),
                    run_id=uuid.UUID(run_id),
                    object_id=spec.get("objectId") or spec.get("object_id") or spec.get("view_name") or "UNKNOWN",
                    layer=spec.get("layer") or "L1",
                    kind=spec.get("kind") or "graphical_view",
                    business_name=spec.get("businessName") or spec.get("business_name") or spec.get("view_name"),
                    spec_json=spec,
                    approval_state="draft",
                )
                for spec in view_specs
            ]

        for spec in persisted_specs:
            artifact = await render_single(db, spec)
            artifact_ids.append(str(artifact.id))

    return artifact_ids

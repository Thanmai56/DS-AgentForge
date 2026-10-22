"""
Format Library Renderer — M0.
ViewSpec → Datasphere-native JSON (deterministic, unit-tested).

M0 STUB: Renders against ViewSpec schema only until real Datasphere
export files are provided (per §17 instruction).

When real exports arrive:
1. Place them in formatlib/<ds_release>/examples/
2. Reverse-engineer JSON Schema into formatlib/<ds_release>/schemas/
3. Update _render_graphical_view(), _render_business_entity(), _render_analytic_model()
4. Run: pytest backend/tests/test_renderer.py
"""
import copy
import json
import logging
import os
from pathlib import Path
from typing import Any

import jsonschema

logger = logging.getLogger(__name__)

FORMATLIB_ROOT = Path(__file__).parent.parent.parent / "formatlib"


class RendererError(Exception):
    pass


class ViewSpecRenderer:
    """
    Renders ViewSpec JSON → Datasphere-native artifact JSON.
    Version-aware: loads the correct schema for the tenant's DS release.
    """

    def __init__(self, ds_release: str = "v1_scaffold"):
        self.ds_release = ds_release
        self.release_dir = FORMATLIB_ROOT / ds_release
        self._schemas: dict[str, dict] = {}
        self._load_schemas()

    def _load_schemas(self):
        schema_dir = self.release_dir / "schemas"
        if not schema_dir.exists():
            logger.warning("Schema dir not found: %s — using permissive validation", schema_dir)
            return
        for f in schema_dir.glob("*.json"):
            try:
                with open(f) as fp:
                    self._schemas[f.stem] = json.load(fp)
            except Exception as exc:
                logger.warning("Could not load schema %s: %s", f, exc)

    def render(self, viewspec: dict) -> dict:
        """
        Main entry point: ViewSpec → DS artifact JSON.
        Validates input ViewSpec, dispatches to kind-specific renderer,
        validates output against DS schema if available.
        """
        kind = viewspec.get("kind", "graphical_view")
        obj_id = viewspec.get("objectId", viewspec.get("object_id", "UNKNOWN"))
        logger.info("Rendering %s (kind=%s, release=%s)", obj_id, kind, self.ds_release)

        if kind == "graphical_view":
            artifact = self._render_graphical_view(viewspec)
        elif kind == "sql_view":
            artifact = self._render_sql_view(viewspec)
        elif kind == "business_entity":
            artifact = self._render_business_entity(viewspec)
        elif kind == "analytic_model":
            artifact = self._render_analytic_model(viewspec)
        elif kind == "replication_config":
            artifact = self._render_replication_config(viewspec)
        else:
            raise RendererError(f"Unknown kind: {kind}")

        # Validate against DS schema if available
        schema = self._schemas.get(kind)
        if schema:
            try:
                jsonschema.validate(instance=artifact, schema=schema)
            except jsonschema.ValidationError as exc:
                raise RendererError(f"Artifact failed DS schema validation: {exc.message}") from exc

        return artifact

    # ── Kind-specific renderers ────────────────────────────────────────────────
    #
    # NOTE (M0): These produce ViewSpec-shaped output until real DS exports
    # are provided. When you have exports, reverse-engineer the exact JSON
    # structure and update these methods. Run golden-file tests to verify.

    def _render_graphical_view(self, spec: dict) -> dict:
        """Render a graphical view (L1/L2 typically)."""
        projection_op = next(
            (op for op in spec.get("operators", []) if op.get("op") == "projection"), {}
        )
        columns = projection_op.get("columns", [])

        return {
            # ── M0 STUB ── replace with exact DS JSON structure from exports
            "$schema": "https://modelforge.ds/schemas/graphical_view/v1",
            "resourceType": "graphical_view",
            "version": "1",
            "content": {
                "objectId": spec.get("objectId", spec.get("object_id")),
                "businessName": spec.get("businessName", spec.get("business_name")),
                "description": spec.get("description", ""),
                "source": spec.get("source", {}),
                "layer": spec.get("layer"),
                "columns": [self._render_column(c) for c in columns],
                "joins": [self._render_join(op) for op in spec.get("operators", [])
                          if op.get("op") == "join"],
                "filters": [self._render_filter(op) for op in spec.get("operators", [])
                            if op.get("op") == "filter"],
                "associations": [self._render_association(a) for a in spec.get("associations", [])],
                "inputs": spec.get("inputs", []),
            },
            "_modelforgeVersion": spec.get("specVersion", "1.0"),
            "_generatedBy": "DS ModelForge v1.0",
        }

    def _render_sql_view(self, spec: dict) -> dict:
        return {
            "$schema": "https://modelforge.ds/schemas/sql_view/v1",
            "resourceType": "sql_view",
            "version": "1",
            "content": {
                "objectId": spec.get("objectId"),
                "businessName": spec.get("businessName"),
                "description": spec.get("description", ""),
                "sqlQuery": spec.get("sqlQuery", spec.get("sql", "-- Generated SQL placeholder")),
                "columns": [self._render_column(c) for c in spec.get("columns", [])],
            },
            "_generatedBy": "DS ModelForge v1.0",
        }

    def _render_replication_config(self, spec: dict) -> dict:
        return {
            "$schema": "https://modelforge.ds/schemas/replication_config/v1",
            "resourceType": "replication_config",
            "version": "1",
            "content": {
                "objectId": spec.get("objectId") or spec.get("view_name"),
                "remoteSource": spec.get("remote_source"),
                "remoteObject": spec.get("remote_object"),
                "targetLocalTable": spec.get("target_local_table") or f"{spec.get('remote_object')}_LOCAL",
                "replicationMode": spec.get("replication_mode", "SCHEDULED"),
                "fullLoadFirst": spec.get("full_load_first", True),
                "columns": spec.get("projected_columns", []),
            },
            "_generatedBy": "DS ModelForge v1.0",
        }

    def _render_business_entity(self, spec: dict) -> dict:
        projection_op = next(
            (op for op in spec.get("operators", []) if op.get("op") == "projection"), {}
        )
        return {
            "$schema": "https://modelforge.ds/schemas/business_entity/v1",
            "resourceType": "business_entity",
            "version": "1",
            "content": {
                "objectId": spec.get("objectId"),
                "businessName": spec.get("businessName"),
                "description": spec.get("description", ""),
                "columns": [self._render_column(c) for c in projection_op.get("columns", [])],
                "associations": [self._render_association(a) for a in spec.get("associations", [])],
            },
            "_generatedBy": "DS ModelForge v1.0",
        }

    def _render_analytic_model(self, spec: dict) -> dict:
        projection_op = next(
            (op for op in spec.get("operators", []) if op.get("op") == "projection"), {}
        )
        columns = projection_op.get("columns", [])
        measures = [c for c in columns if c.get("semantic") == "measure"]
        dimensions = [c for c in columns if c.get("semantic") in ("dimension", "key", "date")]

        return {
            "$schema": "https://modelforge.ds/schemas/analytic_model/v1",
            "resourceType": "analytic_model",
            "version": "1",
            "content": {
                "objectId": spec.get("objectId"),
                "businessName": spec.get("businessName"),
                "description": spec.get("description", ""),
                "factSource": spec.get("inputs", [{}])[0] if spec.get("inputs") else {},
                "measures": [self._render_measure(c) for c in measures],
                "dimensions": [self._render_dimension(c) for c in dimensions],
                "associations": [self._render_association(a) for a in spec.get("associations", [])],
            },
            "_generatedBy": "DS ModelForge v1.0",
        }

    # ── Field renderers ────────────────────────────────────────────────────────

    def _render_column(self, col: dict) -> dict:
        return {
            "name": col.get("name"),
            "businessName": col.get("businessName", col.get("name")),
            "dataType": col.get("dataType", col.get("data_type", "NVARCHAR(255)")),
            "semanticUsage": col.get("semantic", "dimension"),
            "aggregation": col.get("aggregation"),
            "currencyKey": col.get("currencyKey"),
            "unitKey": col.get("unitKey"),
            "isKey": col.get("semantic") == "key",
        }

    def _render_measure(self, col: dict) -> dict:
        return {
            "name": col.get("name"),
            "businessName": col.get("businessName", col.get("name")),
            "dataType": col.get("dataType", "DECIMAL(16,2)"),
            "aggregation": col.get("aggregation", "SUM"),
            "currencyKey": col.get("currencyKey"),
        }

    def _render_dimension(self, col: dict) -> dict:
        return {
            "name": col.get("name"),
            "businessName": col.get("businessName", col.get("name")),
            "dataType": col.get("dataType", "NVARCHAR(255)"),
            "semanticUsage": col.get("semantic", "dimension"),
        }

    def _render_join(self, op: dict) -> dict:
        return {
            "type": op.get("type", "inner"),
            "left": op.get("left"),
            "right": op.get("right"),
            "conditions": op.get("conditions", []),
        }

    def _render_filter(self, op: dict) -> dict:
        return {
            "expression": op.get("expression", ""),
            "rationale": op.get("rationale", ""),
        }

    def _render_association(self, assoc: dict) -> dict:
        return {
            "name": assoc.get("name"),
            "target": assoc.get("target"),
            "cardinality": assoc.get("cardinality", "n..1"),
            "conditions": assoc.get("conditions", []),
            "integrity": assoc.get("integrity", "notRequired"),
            "status": assoc.get("status", "draft"),
        }


# ── Module-level helper ────────────────────────────────────────────────────────

def render_viewspec(viewspec: dict, ds_release: str = "v1_scaffold") -> dict:
    """Convenience function: render a single ViewSpec to DS artifact JSON."""
    renderer = ViewSpecRenderer(ds_release=ds_release)
    return renderer.render(viewspec)


def render_datasphere_object(viewspec: dict, release: str = "v1_scaffold", **_: Any) -> dict:
    """Backward-compatible renderer entrypoint used by tests and export flow."""
    artifact = render_viewspec(viewspec, ds_release=release)
    artifact.setdefault("name", viewspec.get("view_name") or viewspec.get("objectId") or viewspec.get("object_id") or "UNKNOWN")
    artifact.setdefault("version", "1")
    artifact.setdefault("data", artifact.get("content", {}))
    return artifact

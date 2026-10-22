"""
Deterministic Plan Checker.

Enforces modeling integrity rules on the generated Plan:
1. Tables and existing views referenced in inputs exist in metadata.
2. Step inputs exist (produced by metadata or earlier nodes).
3. No cycles in the DAG (strict topological order).
4. Join keys exist on the left and right inputs.
5. No hallucinated columns (every column must trace back to metadata or a calculated column).
6. Plan measures and dimensions exist in the produced views.
"""
from __future__ import annotations

import re
from typing import Any
from pydantic import BaseModel, Field

from app.agent.plan_models import Plan, PlanNode, ALLOWED_OPERATIONS
from app.agent.cds_extractor import ExtractedMetadata


class PlanCheckResult(BaseModel):
    is_valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


def check_plan(plan: Plan, metadata: ExtractedMetadata) -> PlanCheckResult:
    """
    Validates a generated Plan against the extracted source metadata.
    Returns PlanCheckResult with is_valid=True if all checks pass.
    """
    errors: list[str] = []
    warnings: list[str] = []

    # Map of object/node name -> set of available column names
    available_objects: dict[str, set[str]] = {}
    for name, obj in metadata.objects.items():
        available_objects[name] = obj.column_names()

    # 1. Check for duplicate node IDs
    seen_node_ids: set[str] = set()
    for node in plan.nodes:
        if node.id in seen_node_ids:
            errors.append(f"Duplicate node ID '{node.id}' found in plan.")
        seen_node_ids.add(node.id)

    # 2. Check for cycles in step dependencies
    cycle = _detect_cycle(plan.nodes)
    if cycle:
        errors.append(f"Cycle detected in plan dependencies: {' -> '.join(cycle)}")

    # 3. Step-by-step validation
    for node in plan.nodes:
        # Check operation validity
        if node.operation not in ALLOWED_OPERATIONS:
            errors.append(
                f"Node '{node.id}' uses invalid operation '{node.operation}'. "
                f"Allowed operations are: {', '.join(sorted(ALLOWED_OPERATIONS))}"
            )

        # Check step inputs exist
        input_columns: set[str] = set()
        for inp in node.inputs:
            if inp not in available_objects:
                errors.append(
                    f"Node '{node.id}' references input '{inp}' which does not exist "
                    f"in metadata or preceding steps."
                )
            else:
                input_columns.update(available_objects[inp])

        # If operation is a join, validate join keys
        if node.operation == "join":
            _validate_join_node(node, available_objects, errors, warnings)

        # Calculate this node's output columns
        output_cols = _compute_node_columns(node, input_columns, metadata, errors)
        available_objects[node.id] = output_cols

    # 4. Validate Measures
    for m in plan.measures:
        # Check if the measure's column exists in at least one available view/model
        col_found = any(m.column in cols for cols in available_objects.values())
        if not col_found and m.column not in ("*", "1"):
            errors.append(f"Measure '{m.name}' references column '{m.column}' which does not exist in any view.")

    # 5. Validate Dimensions
    for dim in plan.dimensions:
        dim_found = any(dim in cols for cols in available_objects.values())
        if not dim_found:
            warnings.append(f"Dimension '{dim}' not found in any generated view columns.")

    # 6. Informational: Blockers
    if plan.blockers:
        warnings.append(f"Plan identified {len(plan.blockers)} blocker(s): {'; '.join(plan.blockers)}")

    return PlanCheckResult(
        is_valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )


def _validate_join_node(
    node: PlanNode,
    available_objects: dict[str, set[str]],
    errors: list[str],
    warnings: list[str],
) -> None:
    """Validates each join key against the input named by its qualifier."""
    if len(node.inputs) < 2:
        errors.append(f"Join node '{node.id}' must specify at least 2 inputs, got {len(node.inputs)}.")
        return

    join_on = node.details.on
    if not join_on:
        errors.append(f"Join node '{node.id}' missing join condition ('on' keys).")
        return

    for pair in join_on:
        if len(pair) != 2:
            errors.append(f"Join node '{node.id}' join condition must be [left_col, right_col] pair, got {pair}.")
            continue

        for side, reference, default_input in (
            ("left", pair[0], node.inputs[0]),
            ("right", pair[1], node.inputs[1]),
        ):
            source = _resolve_join_input(reference, node.inputs, default_input)
            if source is None:
                qualifier = reference.rsplit(".", 1)[0]
                errors.append(
                    f"Join node '{node.id}' {side} join key '{reference}' references input "
                    f"'{qualifier}', which is not one of the join inputs: {node.inputs}."
                )
                continue

            columns = available_objects.get(source)
            if columns is None:
                # check_plan already reports inputs missing from metadata or preceding steps.
                continue

            key = _strip_qualifier(reference)
            if key not in columns:
                errors.append(
                    f"Join node '{node.id}' {side} join key '{reference}' not found in input '{source}'. "
                    f"Available columns: {sorted(columns)}"
                )


def _resolve_join_input(reference: str, inputs: list[str], default_input: str) -> str | None:
    """Uses a key qualifier to select its input, preserving positional behavior for bare keys."""
    if "." not in reference:
        return default_input

    qualifier = reference.rsplit(".", 1)[0]
    return next((input_name for input_name in inputs if input_name == qualifier), None)


def _compute_node_columns(
    node: PlanNode,
    input_columns: set[str],
    metadata: ExtractedMetadata,
    errors: list[str],
) -> set[str]:
    """Computes output columns for a node and flags hallucinated columns."""
    output_cols: set[str] = set()

    if node.columns:
        for col in node.columns:
            output_cols.add(_strip_qualifier(col))
    for calculated_field in node.calculated_fields:
        if not calculated_field.name.strip() or not calculated_field.formula.strip():
            errors.append(
                f"Node '{node.id}' has a calculated field that requires both a name and formula."
            )
        else:
            output_cols.add(_strip_qualifier(calculated_field.name))

    # If node is an existing CDS view in metadata, its allowed columns come from its definition
    existing_obj = metadata.get_object(node.id) if node.is_existing else None
    existing_cols = existing_obj.column_names() if existing_obj else set()

    # If node introduces a calculated column, include it
    if node.operation == "calculated_column" or node.details.formula or node.calculated_fields:
        if not node.columns and node.id:
            output_cols.add(node.id)

    # If no explicit columns were given, inherit input columns
    if not output_cols and input_columns:
        output_cols = set(input_columns)

    # Check for hallucinated columns
    if node.operation in ("projection", "filter") and node.columns:
        allowed = input_columns.union(existing_cols)
        for col in node.columns:
            clean_col = _strip_qualifier(col)
            if clean_col not in allowed:
                errors.append(
                    f"Node '{node.id}' ({node.operation}) selects column '{col}' which does not exist "
                    f"in its input(s) or existing metadata. Available: {sorted(allowed)}"
                )

    return output_cols


def _strip_qualifier(col_ref: str) -> str:
    """Strips table alias qualifier: 'VBAK.VBELN' -> 'VBELN'."""
    return col_ref.split(".")[-1].strip()


def _detect_cycle(nodes: list[PlanNode]) -> list[str] | None:
    """Detects cycles in node dependencies using DFS."""
    adj: dict[str, list[str]] = {n.id: [] for n in nodes}
    for n in nodes:
        for inp in n.inputs:
            if inp in adj:
                adj[inp].append(n.id)

    visited: dict[str, int] = {n.id: 0 for n in nodes}  # 0=unvisited, 1=visiting, 2=visited
    cycle_path: list[str] = []

    def dfs(curr: str, path: list[str]) -> bool:
        visited[curr] = 1
        path.append(curr)

        for neighbor in adj.get(curr, []):
            if visited.get(neighbor) == 1:
                cycle_path.extend(path[path.index(neighbor):] + [neighbor])
                return True
            if visited.get(neighbor) == 0:
                if dfs(neighbor, path):
                    return True

        path.pop()
        visited[curr] = 2
        return False

    for n in nodes:
        if visited[n.id] == 0:
            if dfs(n.id, []):
                return cycle_path

    return None

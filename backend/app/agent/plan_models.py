"""
Pydantic Models for DS ModelForge Planning Layer.

Matches the plan format specified in planner_system.md:
{
  "analysis": [""],
  "nodes": [
    {
      "id": "",
      "operation": "",
      "inputs": [""],
      "columns": [""],
      "calculated_fields": [{"name": "", "formula": "", "label": "", "data_type": ""}],
      "details": {
        "join_type": "",
        "on": [["LEFT_COL", "RIGHT_COL"]],
        "condition": "",
        "formula": "",
        "aggregation": ""
      },
      "reason": ""
    }
  ],
  "measures": [{"name": "", "aggregation": "", "column": ""}],
  "dimensions": [""],
  "assumptions": [""],
  "blockers": [""]
}
"""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field, ConfigDict, model_validator


ALLOWED_OPERATIONS = {
    "source",
    "projection",
    "filter",
    "join",
    "association",
    "calculated_column",
    "measure",
    "analytic_model",
}

JoinType = Literal["inner", "left", "right", "full", ""]


class NodeDetails(BaseModel):
    """Execution parameters for an individual step/node."""
    model_config = ConfigDict(extra="allow")

    join_type: str = ""
    on: list[list[str]] = Field(default_factory=list)
    condition: str = ""
    conditions: list[str] = Field(default_factory=list)
    filters: list[str] = Field(default_factory=list)
    formula: str = ""
    formulas: list[str] = Field(default_factory=list)
    aggregation: str = ""
    group_by: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_rule_lists(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)

        def format_value(candidate: Any) -> str:
            if candidate is None:
                return "NULL"
            if isinstance(candidate, bool):
                return "TRUE" if candidate else "FALSE"
            if isinstance(candidate, str):
                escaped = candidate.replace("'", "''")
                return f"'{escaped}'"
            return str(candidate)

        def rule_strings(candidate: Any) -> list[str]:
            if isinstance(candidate, str):
                return [candidate]
            if isinstance(candidate, list):
                result: list[str] = []
                for item in candidate:
                    result.extend(rule_strings(item))
                return result
            if isinstance(candidate, dict):
                field = candidate.get("field") or candidate.get("column") or candidate.get("left")
                operator = candidate.get("op") or candidate.get("operator")
                if field and operator and "value" in candidate:
                    return [f'"{field}" {operator} {format_value(candidate["value"])}']
                expression = candidate.get("expression") or candidate.get("sql")
                if isinstance(expression, str):
                    return [expression]
            return []

        for target, aliases in {
            "conditions": ("conditions", "filters", "where"),
            "formulas": ("formulas", "calculations"),
        }.items():
            values: list[str] = []
            for alias in aliases:
                values.extend(rule_strings(normalized.get(alias)))
            singular = normalized.get("condition" if target == "conditions" else "formula")
            values.extend(rule_strings(singular))
            normalized_values = [
                item.strip()
                for item in values
                if item.strip()
            ]
            normalized[target] = list(dict.fromkeys(normalized_values))
            if target == "conditions":
                normalized["filters"] = list(normalized[target])
        return normalized


class CalculatedFieldSpec(BaseModel):
    """A named output column calculated from an expression."""
    model_config = ConfigDict(extra="allow")

    name: str
    formula: str
    label: str = ""
    data_type: str = ""


class PlanNode(BaseModel):
    """
    An ordered step or view in the modeling pipeline.
    Represents either an existing CDS view/table or a newly proposed step.
    """
    model_config = ConfigDict(extra="allow")

    id: str
    operation: str
    inputs: list[str] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    calculated_fields: list[CalculatedFieldSpec] = Field(default_factory=list)
    details: NodeDetails = Field(default_factory=NodeDetails)
    reason: str = ""
    is_existing: bool = False
    layer: str = ""  # L0, L1, L2, L3, L4


class PlanMeasure(BaseModel):
    """A business measure / KPI definition."""
    model_config = ConfigDict(extra="allow")

    name: str
    aggregation: str = "SUM"
    column: str


class Plan(BaseModel):
    """Top-level plan produced by the LLM and consumed by the UI."""
    model_config = ConfigDict(extra="allow")

    analysis: list[str] = Field(default_factory=list)
    nodes: list[PlanNode] = Field(default_factory=list)
    measures: list[PlanMeasure] = Field(default_factory=list)
    dimensions: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)

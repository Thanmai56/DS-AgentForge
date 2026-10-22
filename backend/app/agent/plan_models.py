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
from pydantic import BaseModel, Field, ConfigDict


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
    model_config = ConfigDict(extra="ignore")

    join_type: str = ""
    on: list[list[str]] = Field(default_factory=list)
    condition: str = ""
    formula: str = ""
    aggregation: str = ""


class CalculatedFieldSpec(BaseModel):
    """A named output column calculated from an expression."""
    model_config = ConfigDict(extra="ignore")

    name: str
    formula: str
    label: str = ""
    data_type: str = ""


class PlanNode(BaseModel):
    """
    An ordered step or view in the modeling pipeline.
    Represents either an existing CDS view/table or a newly proposed step.
    """
    model_config = ConfigDict(extra="ignore")

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
    model_config = ConfigDict(extra="ignore")

    name: str
    aggregation: str = "SUM"
    column: str


class Plan(BaseModel):
    """Top-level plan produced by the LLM and consumed by the UI."""
    model_config = ConfigDict(extra="ignore")

    analysis: list[str] = Field(default_factory=list)
    nodes: list[PlanNode] = Field(default_factory=list)
    measures: list[PlanMeasure] = Field(default_factory=list)
    dimensions: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)

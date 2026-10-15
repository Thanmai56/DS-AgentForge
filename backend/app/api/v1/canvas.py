"""
Sequential Model Canvas API.

Returns views ordered L0 → L1 → L2 → L3 → L4, each with:
  - Its own operator-level canvas (Source → Projection → Join → Filter → Output)
  - Exact SAP Datasphere-native JSON (ready to push)
  - Icon metadata for every operator node (type, label, tooltip, color, shape)
  - Layer badge and sequence number

Endpoints:
  GET  /runs/{run_id}/canvas              — full sequential list of all views
  GET  /runs/{run_id}/canvas/{view_id}    — single view operator canvas
  GET  /runs/{run_id}/canvas/summary      — lightweight list (no canvas nodes)
  GET  /views/{spec_id}/ds-json           — raw push-ready Datasphere JSON
  POST /runs/{run_id}/canvas/reorder      — update display sequence numbers
"""
import uuid
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user, require_role, Role
from app.models.run import ViewSpec, Run
from app.services.ds_native_renderer import render_ds_native, OPERATOR_ICON_META

router = APIRouter(tags=["canvas"])
logger = logging.getLogger(__name__)


# ── Layer ordering ─────────────────────────────────────────────────────────────

LAYER_ORDER = {"L0": 0, "L1": 1, "L2": 2, "L3": 3, "L4": 4}

LAYER_META = {
    "L0": {
        "label": "Replication (L0)",
        "description": "Remote source replication flows — copy external data into Datasphere local tables.",
        "color": "#6E6E6E",
        "icon": "ReplicationIcon",
    },
    "L1": {
        "label": "Staging (L1)",
        "description": "Raw 1-to-1 projections from source tables. "
                       "Data type normalization and column aliasing only — no business logic.",
        "color": "#0070F2",
        "icon": "StagingIcon",
    },
    "L2": {
        "label": "Core / Joined (L2)",
        "description": "Graphical or SQL views that join staging views, apply filters, "
                       "add calculated columns, and aggregate measures.",
        "color": "#E76500",
        "icon": "CoreViewIcon",
    },
    "L3": {
        "label": "Business Entities (L3)",
        "description": "Semantic dimension entities with key attributes, text attributes, "
                       "and hierarchies. Used by the Analytic Model via associations.",
        "color": "#188918",
        "icon": "EntityIcon",
    },
    "L4": {
        "label": "Analytic Model (L4)",
        "description": "Multidimensional consumption model exposing measures and dimensions "
                       "to SAP Analytics Cloud (SAC) and other BI tools.",
        "color": "#BB0000",
        "icon": "AnalyticModelIcon",
    },
}

KIND_META = {
    "graphical_view": {
        "label": "Graphical View",
        "icon": "GraphicalViewIcon",
        "tooltip": "Built visually in the Data Builder canvas using operator nodes "
                   "(Source, Projection, Join, Filter, Aggregation).",
        "color": "#0070F2",
    },
    "sql_view": {
        "label": "SQL View",
        "icon": "SqlViewIcon",
        "tooltip": "Defined using a SQL SELECT statement. Supports complex expressions "
                   "not achievable graphically.",
        "color": "#1B6FA8",
    },
    "business_entity": {
        "label": "Business Entity (Dimension)",
        "icon": "EntityIcon",
        "tooltip": "Semantic dimension object with key attributes, hierarchies, and "
                   "navigational associations. Referenced by Analytic Models.",
        "color": "#188918",
    },
    "analytic_model": {
        "label": "Analytic Model",
        "icon": "AnalyticModelIcon",
        "tooltip": "Multi-dimensional star schema model for BI consumption. "
                   "Exposes measures, dimensions, and drill paths to SAC.",
        "color": "#BB0000",
    },
    "replication_config": {
        "label": "Replication Flow",
        "icon": "ReplicationIcon",
        "tooltip": "Copies remote source data into a Datasphere local table. "
                   "Supports full load and delta modes.",
        "color": "#6E6E6E",
    },
}


# ── GET /runs/mock/canvas — fully mocked example (no DB / auth needed) ────────

@router.get("/runs/mock/canvas", tags=["canvas", "demo"])
async def get_mock_canvas():
    """
    Returns a complete mocked sequential canvas for a Sales Analytics Model.
    Source tables: VBAK (Sales Document Header) + KNA1 (Customer Master).

    Identical response shape to GET /runs/{run_id}/canvas.
    Use for frontend development and testing without a real run.
    """
    ICONS = OPERATOR_ICON_META

    def src_node(node_id, label, obj_name, x, y, obj_type="table"):
        t = "viewSource" if obj_type == "view" else "tableSource"
        return {"id": node_id, "type": t, "label": label,
                "position": {"x": x, "y": y}, "iconMeta": ICONS[t],
                "data": {"objectName": obj_name, "alias": label, "objectType": obj_type}}

    def proj_node(node_id, label, columns, calc_cols, x, y):
        calc_names = [c["name"] for c in calc_cols]
        tip = (f"{len(columns)} columns selected"
               + (f", incl. calculated: {', '.join(calc_names)}" if calc_names else "")
               + f"\n\n{ICONS['projection']['tooltip']}")
        return {"id": node_id, "type": "projection", "label": label,
                "position": {"x": x, "y": y},
                "iconMeta": {**ICONS["projection"], "tooltip": tip},
                "data": {"columns": columns}}

    def join_node(node_id, label, join_type, left, right, conditions, x, y):
        cond_str = "; ".join(f"{c['left']} = {c['right']}" for c in conditions)
        return {"id": node_id, "type": "join", "label": label,
                "position": {"x": x, "y": y},
                "iconMeta": {**ICONS["join"],
                             "tooltip": f"{join_type} JOIN\nOn: {cond_str}\n\n{ICONS['join']['tooltip']}"},
                "data": {"joinType": join_type, "leftSource": left,
                         "rightSource": right, "conditions": conditions}}

    def filter_node(node_id, label, expression, rationale, x, y):
        return {"id": node_id, "type": "filter", "label": label,
                "position": {"x": x, "y": y},
                "iconMeta": {**ICONS["filter"],
                             "tooltip": f"Expression: {expression}\nRationale: {rationale}\n\n{ICONS['filter']['tooltip']}"},
                "data": {"expression": expression, "rationale": rationale}}

    def output_node(node_id, label, x, y):
        return {"id": node_id, "type": "output", "label": label,
                "position": {"x": x, "y": y}, "iconMeta": ICONS["output"],
                "data": {"objectId": label}}

    def hierarchy_node(node_id, label, h_type, details, x, y):
        if h_type == "parent_child":
            tip = (f"Parent-Child Hierarchy '{label}': "
                   f"parent='{details.get('parentAttribute')}' → child='{details.get('childAttribute')}'. "
                   "Unlimited depth rollup supported.")
        else:
            tip = f"Level Hierarchy '{label}': {' → '.join(details.get('levels', []))}"
        return {"id": node_id, "type": "hierarchy", "label": label,
                "position": {"x": x, "y": y},
                "iconMeta": {**ICONS["hierarchy"], "tooltip": tip},
                "data": {**details, "hierarchyType": h_type}}

    def edge(from_id, to_id, label=None, dashed=False, edge_type="data_flow"):
        e = {"from": from_id, "to": to_id, "edgeType": edge_type, "dashed": dashed}
        if label:
            e["label"] = label
        return e

    # ── Column definitions ─────────────────────────────────────────────────────
    vbak_cols = [
        {"name": "VBELN", "businessName": "Sales Order Number",   "dataType": "NVARCHAR(10)",  "semantic": "key",       "isKey": True,  "aggregation": None},
        {"name": "KUNNR", "businessName": "Customer Number",      "dataType": "NVARCHAR(10)",  "semantic": "dimension", "isKey": False, "aggregation": None},
        {"name": "VKORG", "businessName": "Sales Organization",   "dataType": "NVARCHAR(4)",   "semantic": "dimension", "isKey": False, "aggregation": None},
        {"name": "VTWEG", "businessName": "Distribution Channel", "dataType": "NVARCHAR(2)",   "semantic": "dimension", "isKey": False, "aggregation": None},
        {"name": "ERDAT", "businessName": "Creation Date",        "dataType": "DATE",          "semantic": "date",      "isKey": False, "aggregation": None},
        {"name": "NETWR", "businessName": "Net Order Value",      "dataType": "DECIMAL(15,2)", "semantic": "measure",   "isKey": False, "aggregation": "SUM"},
        {"name": "WAERK", "businessName": "Currency Key",         "dataType": "NVARCHAR(5)",   "semantic": "dimension", "isKey": False, "aggregation": None},
        {"name": "AUART", "businessName": "Order Type",           "dataType": "NVARCHAR(4)",   "semantic": "dimension", "isKey": False, "aggregation": None},
    ]
    kna1_cols = [
        {"name": "KUNNR", "businessName": "Customer Number", "dataType": "NVARCHAR(10)", "semantic": "key",       "isKey": True,  "aggregation": None},
        {"name": "NAME1", "businessName": "Customer Name",   "dataType": "NVARCHAR(35)", "semantic": "dimension", "isKey": False, "aggregation": None},
        {"name": "LAND1", "businessName": "Country",         "dataType": "NVARCHAR(3)",  "semantic": "dimension", "isKey": False, "aggregation": None},
        {"name": "ORT01", "businessName": "City",            "dataType": "NVARCHAR(35)", "semantic": "dimension", "isKey": False, "aggregation": None},
        {"name": "REGIO", "businessName": "Region",          "dataType": "NVARCHAR(3)",  "semantic": "dimension", "isKey": False, "aggregation": None},
        {"name": "KTOKD", "businessName": "Account Group",   "dataType": "NVARCHAR(4)",  "semantic": "dimension", "isKey": False, "aggregation": None},
    ]
    l2_cols = [
        *vbak_cols,
        {"name": "NAME1", "businessName": "Customer Name",        "dataType": "NVARCHAR(35)", "semantic": "dimension", "isKey": False, "aggregation": None},
        {"name": "LAND1", "businessName": "Country",              "dataType": "NVARCHAR(3)",  "semantic": "dimension", "isKey": False, "aggregation": None},
        {"name": "ORT01", "businessName": "City",                 "dataType": "NVARCHAR(35)", "semantic": "dimension", "isKey": False, "aggregation": None},
        {"name": "REGIO", "businessName": "Region",               "dataType": "NVARCHAR(3)",  "semantic": "dimension", "isKey": False, "aggregation": None},
        {"name": "NETWR_NET", "businessName": "Net Revenue (Calc)", "dataType": "DECIMAL(15,2)",
         "semantic": "measure", "isKey": False, "aggregation": "SUM",
         "isCalculated": True, "expression": '"NETWR" * 1.0'},
    ]
    calc_cols = [c for c in l2_cols if c.get("isCalculated")]

    def col_to_ds(c):
        return {"name": c["name"], "businessName": c["businessName"],
                "dataType": c["dataType"], "semanticUsage": c["semantic"],
                "aggregation": c.get("aggregation"), "isKey": c.get("isKey", False),
                "isCalculated": c.get("isCalculated", False), "expression": c.get("expression")}

    # ── VIEW 1 — L1 Staging V_STG_VBAK ────────────────────────────────────────
    view1 = {
        "sequence": 1, "view_spec_id": "mock-spec-001",
        "object_id": "V_STG_VBAK", "layer": "L1", "layer_meta": LAYER_META["L1"],
        "kind": "graphical_view", "kind_meta": KIND_META["graphical_view"],
        "business_name": "Staging: Sales Document Header (VBAK)",
        "description": "L1 Staging View — 1:1 raw projection of VBAK. Data type normalisation and column aliasing only. No business logic.",
        "approval_state": "draft", "version": 1, "confidence_score": 0.98,
        "sources": [{"alias": "VBAK", "object_name": "VBAK", "object_type": "table"}],
        "canvas": {
            "nodes": [
                src_node("src_VBAK",  "VBAK",        "VBAK",       40,  120),
                proj_node("proj_VBAK","Projection_VBAK", vbak_cols, [], 320, 120),
                output_node("output", "V_STG_VBAK",                600, 120),
            ],
            "edges": [edge("src_VBAK", "proj_VBAK"), edge("proj_VBAK", "output")],
        },
        "columns": [col_to_ds(c) for c in vbak_cols],
        "associations": [],
        "ds_json": {
            "kind": "DataBuilder.View", "version": "1.0.0",
            "objectId": "V_STG_VBAK", "dbObject": "V_STG_VBAK",
            "businessName": "Staging: Sales Document Header (VBAK)",
            "definitionType": "GRAPHICAL", "space": "SALES_SPACE", "layer": "L1",
            "columns": [col_to_ds(c) for c in vbak_cols], "associations": [],
        },
    }

    # ── VIEW 2 — L1 Staging V_STG_KNA1 ────────────────────────────────────────
    view2 = {
        "sequence": 2, "view_spec_id": "mock-spec-002",
        "object_id": "V_STG_KNA1", "layer": "L1", "layer_meta": LAYER_META["L1"],
        "kind": "graphical_view", "kind_meta": KIND_META["graphical_view"],
        "business_name": "Staging: Customer Master (KNA1)",
        "description": "L1 Staging View — 1:1 raw projection of KNA1. Data type normalisation and column aliasing only. No business logic.",
        "approval_state": "draft", "version": 1, "confidence_score": 0.98,
        "sources": [{"alias": "KNA1", "object_name": "KNA1", "object_type": "table"}],
        "canvas": {
            "nodes": [
                src_node("src_KNA1",  "KNA1",         "KNA1",       40,  120),
                proj_node("proj_KNA1","Projection_KNA1", kna1_cols, [], 320, 120),
                output_node("output", "V_STG_KNA1",                 600, 120),
            ],
            "edges": [edge("src_KNA1", "proj_KNA1"), edge("proj_KNA1", "output")],
        },
        "columns": [col_to_ds(c) for c in kna1_cols],
        "associations": [],
        "ds_json": {
            "kind": "DataBuilder.View", "version": "1.0.0",
            "objectId": "V_STG_KNA1", "dbObject": "V_STG_KNA1",
            "businessName": "Staging: Customer Master (KNA1)",
            "definitionType": "GRAPHICAL", "space": "SALES_SPACE", "layer": "L1",
            "columns": [col_to_ds(c) for c in kna1_cols], "associations": [],
        },
    }

    # ── VIEW 3 — L2 Core Joined V_VBAK_CORE ───────────────────────────────────
    join_cond = [{"left": "V_STG_VBAK.KUNNR", "right": "V_STG_KNA1.KUNNR", "operator": "="}]
    view3 = {
        "sequence": 3, "view_spec_id": "mock-spec-003",
        "object_id": "V_VBAK_CORE", "layer": "L2", "layer_meta": LAYER_META["L2"],
        "kind": "graphical_view", "kind_meta": KIND_META["graphical_view"],
        "business_name": "Core: Sales Orders with Customer Info",
        "description": "L2 Core View — LEFT joins V_STG_VBAK and V_STG_KNA1 on KUNNR, excludes return orders and zero-value orders, adds calculated net revenue column.",
        "approval_state": "draft", "version": 1, "confidence_score": 0.95,
        "sources": [
            {"alias": "V_STG_VBAK", "object_name": "V_STG_VBAK", "object_type": "view"},
            {"alias": "V_STG_KNA1", "object_name": "V_STG_KNA1", "object_type": "view"},
        ],
        "canvas": {
            "nodes": [
                src_node("src_stg_vbak", "V_STG_VBAK", "V_STG_VBAK", 40,  60,  "view"),
                src_node("src_stg_kna1", "V_STG_KNA1", "V_STG_KNA1", 40,  280, "view"),
                join_node("join_kna1", "Join_VBAK_KNA1", "LEFT",
                          "V_STG_VBAK", "V_STG_KNA1", join_cond, 320, 160),
                filter_node("filter_active", "Filter_Active_Orders",
                            '"AUART" != \'RET\' AND "NETWR" > 0',
                            "Exclude return orders and zero-value orders", 600, 160),
                proj_node("proj_core", "Projection_Core_Output",
                          l2_cols, calc_cols, 880, 160),
                output_node("output", "V_VBAK_CORE", 1160, 160),
            ],
            "edges": [
                edge("src_stg_vbak", "join_kna1",    "Left"),
                edge("src_stg_kna1", "join_kna1",    "Right"),
                edge("join_kna1",    "filter_active"),
                edge("filter_active","proj_core"),
                edge("proj_core",    "output"),
            ],
        },
        "columns": [col_to_ds(c) for c in l2_cols],
        "associations": [],
        "ds_json": {
            "kind": "DataBuilder.View", "version": "1.0.0",
            "objectId": "V_VBAK_CORE", "dbObject": "V_VBAK_CORE",
            "businessName": "Core: Sales Orders with Customer Info",
            "definitionType": "GRAPHICAL", "space": "SALES_SPACE", "layer": "L2",
            "columns": [col_to_ds(c) for c in l2_cols], "associations": [],
        },
    }

    # ── VIEW 4 — L3 Business Entity E_CUSTOMER ────────────────────────────────
    dim_cols = [
        {"name": "KUNNR", "businessName": "Customer Number", "dataType": "NVARCHAR(10)", "semantic": "key",       "isKey": True},
        {"name": "NAME1", "businessName": "Customer Name",   "dataType": "NVARCHAR(35)", "semantic": "dimension", "isKey": False},
        {"name": "LAND1", "businessName": "Country",         "dataType": "NVARCHAR(3)",  "semantic": "dimension", "isKey": False},
        {"name": "REGIO", "businessName": "Region",          "dataType": "NVARCHAR(3)",  "semantic": "dimension", "isKey": False},
        {"name": "ORT01", "businessName": "City",            "dataType": "NVARCHAR(35)", "semantic": "dimension", "isKey": False},
        {"name": "KTOKD", "businessName": "Account Group",   "dataType": "NVARCHAR(4)",  "semantic": "dimension", "isKey": False},
    ]
    view4 = {
        "sequence": 4, "view_spec_id": "mock-spec-004",
        "object_id": "E_CUSTOMER", "layer": "L3", "layer_meta": LAYER_META["L3"],
        "kind": "business_entity", "kind_meta": KIND_META["business_entity"],
        "business_name": "Dimension: Customer",
        "description": "L3 Business Entity — semantic dimension for KNA1 with key attributes, geographic attributes, and a Region→Country→City level hierarchy.",
        "approval_state": "draft", "version": 1, "confidence_score": 0.94,
        "sources": [{"alias": "V_STG_KNA1", "object_name": "V_STG_KNA1", "object_type": "view"}],
        "canvas": {
            "nodes": [
                src_node("src_stg_kna1", "V_STG_KNA1", "V_STG_KNA1", 40,  120, "view"),
                proj_node("proj_entity", "Keys & Attributes", dim_cols, [], 320, 120),
                hierarchy_node("hier_geo", "H_CUSTOMER_GEO_LEVELS", "level",
                               {"levels": ["LAND1", "REGIO", "ORT01"]}, 600, 120),
                output_node("output", "E_CUSTOMER", 880, 120),
            ],
            "edges": [
                edge("src_stg_kna1", "proj_entity"),
                edge("proj_entity",  "hier_geo"),
                edge("hier_geo",     "output"),
            ],
        },
        "columns": [col_to_ds(c) for c in dim_cols],
        "associations": [],
        "ds_json": {
            "kind": "DataBuilder.BusinessEntity", "version": "1.0.0",
            "objectId": "E_CUSTOMER", "businessName": "Dimension: Customer",
            "space": "SALES_SPACE", "layer": "L3",
            "keyAttributes": [col_to_ds(dim_cols[0])],
            "attributes": [col_to_ds(c) for c in dim_cols[1:]],
            "hierarchies": [{"name": "H_CUSTOMER_GEO_LEVELS", "type": "Level",
                             "levels": [{"name": "LAND1", "ordinal": 1},
                                        {"name": "REGIO", "ordinal": 2},
                                        {"name": "ORT01", "ordinal": 3}]}],
            "associations": [],
        },
    }

    # ── VIEW 5 — L4 Analytic Model AM_VBAK_ANALYTIC_MODEL ─────────────────────
    am_measures = [c for c in l2_cols if c["semantic"] == "measure"]
    am_dims     = [c for c in l2_cols if c["semantic"] in ("dimension", "key", "date")]
    view5 = {
        "sequence": 5, "view_spec_id": "mock-spec-005",
        "object_id": "AM_VBAK_ANALYTIC_MODEL", "layer": "L4", "layer_meta": LAYER_META["L4"],
        "kind": "analytic_model", "kind_meta": KIND_META["analytic_model"],
        "business_name": "Analytic Model: Sales Order Performance",
        "description": "L4 Analytic Model — multi-dimensional star schema exposing sales KPIs and dimensions to SAP Analytics Cloud (SAC).",
        "approval_state": "draft", "version": 1, "confidence_score": 0.96,
        "sources": [{"alias": "V_VBAK_CORE", "object_name": "V_VBAK_CORE", "object_type": "view"}],
        "canvas": {
            "nodes": [
                {
                    "id": "fact_source", "type": "measureSource", "label": "V_VBAK_CORE",
                    "position": {"x": 40, "y": 80},
                    "iconMeta": {**ICONS["measureSource"],
                                 "tooltip": (f"Fact view — {len(am_measures)} measures: "
                                             + ", ".join(c["name"] for c in am_measures))},
                    "data": {"objectName": "V_VBAK_CORE", "measures": [c["name"] for c in am_measures]},
                },
                {
                    "id": "dim_customer", "type": "dimensionSource", "label": "E_CUSTOMER",
                    "position": {"x": 40, "y": 300},
                    "iconMeta": {**ICONS["dimensionSource"],
                                 "tooltip": ("Dimension 'E_CUSTOMER' — Cardinality n..1. "
                                             "Provides customer name, country, region, city.")},
                    "data": {"objectName": "E_CUSTOMER", "cardinality": "n..1",
                             "foreignKeyMappings": [{"local_column": "KUNNR", "foreign_column": "KUNNR"}]},
                },
                {
                    "id": "am_node", "type": "analyticModel", "label": "AM_VBAK_ANALYTIC_MODEL",
                    "position": {"x": 400, "y": 180},
                    "iconMeta": {"icon": "AnalyticModelIcon", "label": "Analytic Model",
                                 "tooltip": (f"{len(am_measures)} measures, {len(am_dims)} dimensions. "
                                             "Ready for SAP Analytics Cloud."),
                                 "color": "#188918", "shape": "rect"},
                    "data": {"objectId": "AM_VBAK_ANALYTIC_MODEL",
                             "measureCount": len(am_measures), "dimensionCount": len(am_dims)},
                },
            ],
            "edges": [
                edge("fact_source",  "am_node"),
                edge("dim_customer", "am_node", label="n..1", dashed=True, edge_type="association"),
            ],
        },
        "columns": [col_to_ds(c) for c in l2_cols],
        "associations": [
            {"name": "Assoc_CUSTOMER", "target": "E_CUSTOMER", "cardinality": "n..1",
             "joinConditions": [{"left": "AM_VBAK_ANALYTIC_MODEL.KUNNR", "right": "E_CUSTOMER.KUNNR"}],
             "foreignKeyMappings": [{"local_column": "KUNNR", "foreign_column": "KUNNR"}],
             "integrity": "notRequired"},
        ],
        "ds_json": {
            "kind": "DataBuilder.AnalyticModel", "version": "1.0.0",
            "objectId": "AM_VBAK_ANALYTIC_MODEL",
            "businessName": "Analytic Model: Sales Order Performance",
            "space": "SALES_SPACE", "layer": "L4",
            "factSource": {"objectName": "V_VBAK_CORE", "alias": "V_VBAK_CORE"},
            "measures": [
                {"name": "NETWR",     "businessName": "Net Order Value",     "dataType": "DECIMAL(15,2)", "aggregation": "SUM", "currencyKey": "WAERK"},
                {"name": "NETWR_NET", "businessName": "Net Revenue (Calc)",  "dataType": "DECIMAL(15,2)", "aggregation": "SUM", "currencyKey": "WAERK"},
            ],
            "dimensions": [
                {"name": "VBELN", "businessName": "Sales Order Number",   "dataType": "NVARCHAR(10)", "semanticUsage": "key"},
                {"name": "KUNNR", "businessName": "Customer Number",      "dataType": "NVARCHAR(10)", "semanticUsage": "dimension"},
                {"name": "VKORG", "businessName": "Sales Organization",   "dataType": "NVARCHAR(4)",  "semanticUsage": "dimension"},
                {"name": "VTWEG", "businessName": "Distribution Channel", "dataType": "NVARCHAR(2)",  "semanticUsage": "dimension"},
                {"name": "ERDAT", "businessName": "Creation Date",        "dataType": "DATE",         "semanticUsage": "date"},
                {"name": "AUART", "businessName": "Order Type",           "dataType": "NVARCHAR(4)",  "semanticUsage": "dimension"},
                {"name": "LAND1", "businessName": "Country",              "dataType": "NVARCHAR(3)",  "semanticUsage": "dimension"},
                {"name": "REGIO", "businessName": "Region",               "dataType": "NVARCHAR(3)",  "semanticUsage": "dimension"},
                {"name": "ORT01", "businessName": "City",                 "dataType": "NVARCHAR(35)", "semanticUsage": "dimension"},
            ],
            "associatedDimensions": [
                {"dimensionObject": "E_CUSTOMER", "associationName": "Assoc_CUSTOMER", "cardinality": "n..1"}
            ],
        },
    }

    return {
        "run_id": "mock-run-sales-analytics",
        "run_name": "Sales Analytics Model (Mock)",
        "run_state": "AWAITING_APPROVAL",
        "total_views": 5,
        "layer_summary": {"L1": 2, "L2": 1, "L3": 1, "L4": 1},
        "source_tables": [
            {"name": "VBAK", "business_name": "Sales Document Header",
             "columns": len(vbak_cols), "row_count": 4200000, "system": "S/4HANA ERP"},
            {"name": "KNA1", "business_name": "Customer General Data",
             "columns": len(kna1_cols), "row_count": 320000,  "system": "S/4HANA ERP"},
        ],
        "views": [view1, view2, view3, view4, view5],
        "icon_registry": OPERATOR_ICON_META,
        "layer_meta": LAYER_META,
        "kind_meta": KIND_META,
        "_note": "Mocked response — replace run_id with a real ID to get live data.",
    }


# ── GET /runs/{run_id}/canvas — full sequential canvas ─────────────────────────

@router.get("/runs/{run_id}/canvas")
async def get_sequential_canvas(
    run_id: str,
    _: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Return all views for a run in sequential Datasphere build order (L0→L1→L2→L3→L4).
    Each view includes:
    - Its operator-level canvas nodes and edges (with icon metadata)
    - Exact Datasphere-native push-ready JSON
    - Layer badge, kind badge, and sequence number
    """
    from app.api.v1.runs import _IN_MEMORY_CANVAS, _IN_MEMORY_RUNS

    # 1. Check in-memory synthesized canvas first (exact tables & prompt from user session)
    if run_id in _IN_MEMORY_CANVAS:
        logger.info("Serving custom synthesized canvas from session for run %s (%d views)", run_id, len(_IN_MEMORY_CANVAS[run_id].get("views", [])))
        return _IN_MEMORY_CANVAS[run_id]

    # Validate run exists
    try:
        run_uuid = uuid.UUID(run_id)
        run_result = await db.execute(select(Run).where(Run.id == run_uuid))
        run = run_result.scalar_one_or_none()
    except Exception:
        run = None

    if not run:
        # Check if run exists in in-memory store with user requirement & metadata
        in_mem = _IN_MEMORY_RUNS.get(run_id)
        if in_mem:
            try:
                from app.agent.metadata_parser import parse_human_metadata
                from app.agent.datasphere_canvas_builder import synthesize_datasphere_views
                from app.services.ds_native_renderer import render_ds_native
                meta = getattr(in_mem, "user_metadata", None)
                req_text = getattr(in_mem, "requirement_text", "")
                tables_meta = parse_human_metadata(meta) if meta else []
                if tables_meta:
                    synth_views = synthesize_datasphere_views(
                        requirement_text=req_text,
                        parsed_requirement={"domain": "SAP Datasphere Modeling"},
                        tables_meta=tables_meta,
                    )
                    c_views = []
                    for seq, s_dict in enumerate(synth_views, start=1):
                        ds_j = render_ds_native(s_dict)
                        c_views.append({
                            "sequence": seq,
                            "view_spec_id": f"spec-{seq}-{s_dict.get('objectId')}",
                            "object_id": s_dict.get("objectId") or f"V_{seq}",
                            "layer": s_dict.get("layer", "L1"),
                            "layer_meta": LAYER_META.get(s_dict.get("layer", "L1"), {}),
                            "kind": s_dict.get("kind", "graphical_view"),
                            "kind_meta": KIND_META.get(s_dict.get("kind", "graphical_view"), {}),
                            "business_name": s_dict.get("businessName") or s_dict.get("objectId"),
                            "description": s_dict.get("description", ""),
                            "approval_state": "draft",
                            "version": 1,
                            "confidence_score": 0.98,
                            "canvas": ds_j.get("canvas", {"nodes": [], "edges": []}),
                            "columns": ds_j.get("columns", []),
                            "associations": ds_j.get("associations", []),
                            "ds_json": ds_j,
                            "sources": s_dict.get("sources", []),
                        })
                    res = {
                        "run_id": run_id,
                        "run_name": getattr(in_mem, "name", "Datasphere Model"),
                        "run_state": "AWAITING_APPROVAL",
                        "total_views": len(c_views),
                        "source_tables": tables_meta,
                        "views": c_views,
                        "icon_registry": OPERATOR_ICON_META,
                        "layer_meta": LAYER_META,
                        "kind_meta": KIND_META,
                    }
                    _IN_MEMORY_CANVAS[run_id] = res
                    return res
            except Exception as dyn_err:
                logger.warning("Dynamic synthesis from in-memory run failed: %s", dyn_err)

        logger.info("Run %s not found in DB or session; returning reference canvas", run_id)
        mock_res = await get_mock_canvas()
        mock_res["run_id"] = run_id
        mock_res["run_name"] = f"Datasphere Model ({run_id[:8] if len(run_id) >= 8 else run_id})"
        return mock_res

    # Load all view specs
    result = await db.execute(
        select(ViewSpec)
        .where(ViewSpec.run_id == uuid.UUID(run_id))
    )
    specs: list[ViewSpec] = result.scalars().all()

    if not specs:
        try:
            from app.agent.metadata_parser import parse_human_metadata
            from app.agent.datasphere_canvas_builder import synthesize_datasphere_views
            from app.agent.nodes import _save_view_spec, _save_graph_elements

            meta = run.user_metadata
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

            synthesized = synthesize_datasphere_views(
                requirement_text=run.requirement_text or "Sales Analytics Model",
                parsed_requirement={"domain": "SAP Datasphere Modeling", "requirement": run.requirement_text},
                tables_meta=tables_meta,
            )
            for s in synthesized:
                await _save_view_spec(run_id, s)
            await _save_graph_elements(run_id, synthesized, tables_meta)

            res = await db.execute(select(ViewSpec).where(ViewSpec.run_id == uuid.UUID(run_id)))
            specs = res.scalars().all()
        except Exception as synth_err:
            logger.warning("Dynamic synthesis for run %s: %s; using reference model", run_id, synth_err)
            mock_res = await get_mock_canvas()
            mock_res["run_id"] = run_id
            mock_res["run_name"] = run.name
            return mock_res

    if not specs:
        mock_res = await get_mock_canvas()
        mock_res["run_id"] = run_id
        mock_res["run_name"] = run.name
        return mock_res

    # Sort by layer order, then by creation time
    sorted_specs = sorted(
        specs,
        key=lambda vs: (LAYER_ORDER.get(vs.layer, 99), vs.created_at),
    )

    views = []
    for seq, vs in enumerate(sorted_specs, start=1):
        spec_dict = vs.spec_json or {}
        ds_json = _safe_render(spec_dict)
        canvas = ds_json.get("canvas", {"nodes": [], "edges": []})

        views.append({
            "sequence": seq,
            "view_spec_id": str(vs.id),
            "object_id": vs.object_id,
            "layer": vs.layer,
            "layer_meta": LAYER_META.get(vs.layer, {}),
            "kind": vs.kind,
            "kind_meta": KIND_META.get(vs.kind, {}),
            "business_name": vs.business_name or vs.object_id,
            "description": spec_dict.get("description", ""),
            "approval_state": vs.approval_state,
            "version": vs.version,
            "confidence_score": spec_dict.get("confidence_score", 0.95),
            "canvas": canvas,
            "columns": ds_json.get("columns", []),
            "associations": ds_json.get("associations", []),
            "ds_json": ds_json,
            "sources": spec_dict.get("sources", []),
        })

    return {
        "run_id": run_id,
        "run_name": run.name,
        "run_state": run.state,
        "total_views": len(views),
        "layer_summary": _layer_summary(sorted_specs),
        "views": views,
        "icon_registry": OPERATOR_ICON_META,
        "layer_meta": LAYER_META,
        "kind_meta": KIND_META,
    }


# ── GET /runs/{run_id}/canvas/summary — lightweight list ──────────────────────

@router.get("/runs/{run_id}/canvas/summary")
async def get_canvas_summary(
    run_id: str,
    _: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Lightweight sequential list — no canvas nodes, just view identity and layer info.
    Used for side navigation / table of contents in the UI.
    """
    result = await db.execute(
        select(ViewSpec).where(ViewSpec.run_id == uuid.UUID(run_id))
    )
    specs: list[ViewSpec] = result.scalars().all()
    sorted_specs = sorted(specs, key=lambda vs: (LAYER_ORDER.get(vs.layer, 99), vs.created_at))

    return {
        "run_id": run_id,
        "total_views": len(sorted_specs),
        "layer_summary": _layer_summary(sorted_specs),
        "views": [
            {
                "sequence": i + 1,
                "view_spec_id": str(vs.id),
                "object_id": vs.object_id,
                "layer": vs.layer,
                "layer_meta": LAYER_META.get(vs.layer, {}),
                "kind": vs.kind,
                "kind_meta": KIND_META.get(vs.kind, {}),
                "business_name": vs.business_name or vs.object_id,
                "approval_state": vs.approval_state,
            }
            for i, vs in enumerate(sorted_specs)
        ],
    }


# ── GET /runs/{run_id}/canvas/{view_spec_id} — single view canvas ──────────────

@router.get("/runs/{run_id}/canvas/{view_spec_id}")
async def get_single_view_canvas(
    run_id: str,
    view_spec_id: str,
    _: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Return the full operator canvas for a single view with:
    - All canvas nodes (Source, Projection, Join, Filter, Aggregation, Hierarchy, Output)
    - Icon metadata for each node type
    - Datasphere-native push-ready JSON
    - Sequence number in the full run
    """
    # Load this spec
    vs = await _get_vs_or_404(db, run_id, view_spec_id)
    spec_dict = vs.spec_json or {}
    ds_json = _safe_render(spec_dict)
    canvas = ds_json.get("canvas", {"nodes": [], "edges": []})

    # Compute sequence number
    all_result = await db.execute(
        select(ViewSpec).where(ViewSpec.run_id == uuid.UUID(run_id))
    )
    all_specs = sorted(all_result.scalars().all(),
                       key=lambda s: (LAYER_ORDER.get(s.layer, 99), s.created_at))
    seq = next((i + 1 for i, s in enumerate(all_specs) if str(s.id) == view_spec_id), 1)
    total = len(all_specs)

    return {
        "sequence": seq,
        "total_views": total,
        "view_spec_id": view_spec_id,
        "run_id": run_id,
        "object_id": vs.object_id,
        "layer": vs.layer,
        "layer_meta": LAYER_META.get(vs.layer, {}),
        "kind": vs.kind,
        "kind_meta": KIND_META.get(vs.kind, {}),
        "business_name": vs.business_name or vs.object_id,
        "description": spec_dict.get("description", ""),
        "approval_state": vs.approval_state,
        "version": vs.version,
        "confidence_score": spec_dict.get("confidence_score", 0.95),
        "canvas": canvas,
        "columns": ds_json.get("columns", []),
        "associations": ds_json.get("associations", []),
        "ds_json": ds_json,
        "icon_registry": OPERATOR_ICON_META,
        "sources": spec_dict.get("sources", []),
        "navigation": {
            "previous_view_id": str(all_specs[seq - 2].id) if seq > 1 else None,
            "next_view_id": str(all_specs[seq].id) if seq < total else None,
        },
    }


# ── GET /views/{spec_id}/ds-json — push-ready Datasphere JSON ─────────────────

@router.get("/views/{spec_id}/ds-json")
async def get_ds_json(
    spec_id: str,
    _: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Return only the exact Datasphere-native JSON for a single ViewSpec.
    This is what gets pushed to Datasphere via the import API.
    """
    result = await db.execute(select(ViewSpec).where(ViewSpec.id == uuid.UUID(spec_id)))
    vs = result.scalar_one_or_none()
    if not vs:
        raise HTTPException(status_code=404, detail="ViewSpec not found")

    ds_json = _safe_render(vs.spec_json or {})
    # Remove canvas from push payload (canvas is UI-only)
    push_payload = {k: v for k, v in ds_json.items() if k != "canvas"}
    return {
        "spec_id": spec_id,
        "object_id": vs.object_id,
        "kind": vs.kind,
        "layer": vs.layer,
        "ds_json": push_payload,
    }


# ── POST /runs/{run_id}/canvas/reorder — update display sequence ──────────────

class ReorderRequest(BaseModel):
    ordered_view_ids: list[str]


@router.post("/runs/{run_id}/canvas/reorder")
async def reorder_canvas_views(
    run_id: str,
    body: ReorderRequest,
    _: Annotated[dict, Depends(require_role(Role.ADMIN, Role.MODELER))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """
    Store a custom display sequence for the canvas (override default layer order).
    Returns the new ordered summary.
    """
    # Validate all IDs belong to this run
    result = await db.execute(
        select(ViewSpec).where(ViewSpec.run_id == uuid.UUID(run_id))
    )
    existing_ids = {str(vs.id) for vs in result.scalars().all()}
    for vid in body.ordered_view_ids:
        if vid not in existing_ids:
            raise HTTPException(status_code=400, detail=f"ViewSpec {vid} not in run {run_id}")

    # Store order in run agent_state
    run_result = await db.execute(select(Run).where(Run.id == uuid.UUID(run_id)))
    run = run_result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    agent_state = run.agent_state or {}
    agent_state["canvas_view_order"] = body.ordered_view_ids
    run.agent_state = agent_state
    await db.commit()

    return {"status": "ok", "ordered_view_ids": body.ordered_view_ids}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_render(spec_dict: dict) -> dict:
    """Render spec to DS native JSON, returning a safe fallback on error."""
    try:
        return render_ds_native(spec_dict)
    except Exception as exc:
        logger.warning("ds_native_render failed for %s: %s", spec_dict.get("objectId", "?"), exc)
        return {
            "kind": spec_dict.get("kind", "graphical_view"),
            "objectId": spec_dict.get("objectId") or spec_dict.get("view_name", "UNKNOWN"),
            "canvas": {"nodes": [], "edges": []},
            "columns": [],
            "associations": [],
            "_error": str(exc),
        }


def _layer_summary(specs: list) -> dict:
    """Count views per layer."""
    summary: dict[str, int] = {}
    for vs in specs:
        summary[vs.layer] = summary.get(vs.layer, 0) + 1
    return summary


async def _get_vs_or_404(db: AsyncSession, run_id: str, spec_id: str) -> ViewSpec:
    result = await db.execute(
        select(ViewSpec).where(
            ViewSpec.id == uuid.UUID(spec_id),
            ViewSpec.run_id == uuid.UUID(run_id),
        )
    )
    vs = result.scalar_one_or_none()
    if not vs:
        raise HTTPException(status_code=404, detail="ViewSpec not found in this run")
    return vs


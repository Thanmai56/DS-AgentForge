"""
SAP Datasphere Native JSON Renderer.

Produces exact Datasphere-format JSON for each view kind:
  - graphical_view  → kind: "DataBuilder.View"  (definitionType: GRAPHICAL)
  - sql_view        → kind: "DataBuilder.View"  (definitionType: SQL)
  - business_entity → kind: "DataBuilder.BusinessEntity"
  - analytic_model  → kind: "DataBuilder.AnalyticModel"
  - replication_config → kind: "DataBuilder.ReplicationFlow"

Each output carries a 'canvas' section matching the Datasphere Data Builder
visual editor topology so the front-end can render the exact same layout.

Datasphere Operator Node Types (matching Data Builder icons):
  tableSource   – source table node (database/cube icon)
  viewSource    – source view node (view icon)
  projection    – projection/column selection (funnel/column icon)
  join          – join operator (Venn diagram icon)
  filter        – filter operator (sigma/σ icon)
  aggregation   – aggregation / measure rollup (Σ icon)
  union         – union operator (∪ icon)
  association   – association link (arrow with cardinality label)
  hierarchy     – hierarchy node (tree icon)
  output        – view output terminal (target/flag icon)
  measureSource – measure input for analytic model (ruler icon)
"""
from typing import Any


# ── Icon metadata shipped to the frontend ─────────────────────────────────────
# Each entry: icon_name (SVG component key), tooltip (shown in UI), color
OPERATOR_ICON_META: dict[str, dict[str, str]] = {
    "tableSource": {
        "icon": "DatabaseIcon",
        "label": "Source Table",
        "tooltip": "Raw source table or replicated local table from a connected source system.",
        "color": "#0070F2",       # SAP Blue
        "shape": "rect",
    },
    "viewSource": {
        "icon": "ViewIcon",
        "label": "Source View",
        "tooltip": "Another view used as an input to this view.",
        "color": "#0070F2",
        "shape": "rect",
    },
    "projection": {
        "icon": "ProjectionIcon",
        "label": "Projection",
        "tooltip": (
            "Selects, renames, reorders, and hides columns. "
            "Calculated columns using Datasphere formula syntax can be added here."
        ),
        "color": "#6E6E6E",       # Grey
        "shape": "diamond",
    },
    "join": {
        "icon": "JoinIcon",
        "label": "Join",
        "tooltip": (
            "Combines two inputs on join keys. "
            "Supports Inner, Left Outer, Right Outer, and Cross joins. "
            "Join conditions use equality on matched columns."
        ),
        "color": "#E76500",       # SAP Orange
        "shape": "circle",
    },
    "filter": {
        "icon": "FilterIcon",
        "label": "Filter",
        "tooltip": (
            'Restricts rows using Datasphere filter grammar: e.g. "STATUS" != \'CANCELLED\' '
            "or \"DATE\" >= '2023-01-01'. "
            "Columns are double-quoted; string literals use single quotes."
        ),
        "color": "#BB0000",       # SAP Red
        "shape": "diamond",
    },
    "aggregation": {
        "icon": "AggregationIcon",
        "label": "Aggregation",
        "tooltip": (
            "Groups rows by dimension columns and computes aggregates (SUM, COUNT, AVG, MIN, MAX) "
            "on measure columns. Required for analytic model fact sources."
        ),
        "color": "#188918",       # SAP Green
        "shape": "diamond",
    },
    "union": {
        "icon": "UnionIcon",
        "label": "Union",
        "tooltip": "Stacks rows from two inputs with compatible schemas (UNION ALL or UNION DISTINCT).",
        "color": "#6A1B9A",       # Purple
        "shape": "circle",
    },
    "association": {
        "icon": "AssociationIcon",
        "label": "Association",
        "tooltip": (
            "Navigational link between two entities with cardinality (n..1, 1..1, etc.). "
            "Used by analytic models to navigate from fact to dimension. "
            "Does NOT perform a join — it is a semantic navigation path."
        ),
        "color": "#0070F2",
        "shape": "arrow",
    },
    "hierarchy": {
        "icon": "HierarchyIcon",
        "label": "Hierarchy",
        "tooltip": (
            "Defines how dimension members roll up. "
            "Parent-Child: each row has a parent_id pointing to another row. "
            "Level: explicit level columns (Region → Country → City)."
        ),
        "color": "#E76500",
        "shape": "tree",
    },
    "output": {
        "icon": "OutputIcon",
        "label": "View Output",
        "tooltip": "The final output node — represents the view result exposed to consumers.",
        "color": "#1B6FA8",
        "shape": "rect",
    },
    "measureSource": {
        "icon": "MeasureIcon",
        "label": "Measure Source",
        "tooltip": "Analytic Model input: fact source providing numeric KPI measures (SUM, COUNT, etc.).",
        "color": "#188918",
        "shape": "rect",
    },
    "dimensionSource": {
        "icon": "DimensionIcon",
        "label": "Dimension Source",
        "tooltip": "Analytic Model input: dimension entity providing drill-down attributes.",
        "color": "#0070F2",
        "shape": "rect",
    },
}


# ── Main renderer ─────────────────────────────────────────────────────────────

def render_ds_native(spec: dict[str, Any]) -> dict[str, Any]:
    """
    Convert a ModelForge ViewSpec into exact SAP Datasphere-native JSON.
    Returns the full artifact including a 'canvas' section for the UI.
    """
    kind = spec.get("kind", "graphical_view")

    if kind == "graphical_view":
        return _render_graphical_view(spec)
    elif kind == "sql_view":
        return _render_sql_view(spec)
    elif kind == "business_entity":
        return _render_business_entity(spec)
    elif kind == "analytic_model":
        return _render_analytic_model(spec)
    elif kind == "replication_config":
        return _render_replication_config(spec)
    else:
        return _render_graphical_view(spec)


# ── Graphical View ─────────────────────────────────────────────────────────────

def _render_graphical_view(spec: dict) -> dict:
    obj_id = spec.get("objectId") or spec.get("view_name", "UNKNOWN")
    sources = spec.get("sources", [])
    operators = spec.get("operators", [])
    associations = spec.get("associations", [])
    columns = _collect_output_columns(spec)

    canvas = _build_graphical_canvas(obj_id, sources, operators, associations)

    return {
        "kind": "DataBuilder.View",
        "version": "1.0.0",
        "objectId": obj_id,
        "dbObject": obj_id,
        "businessName": spec.get("businessName") or spec.get("business_name", obj_id),
        "description": spec.get("description", ""),
        "definitionType": "GRAPHICAL",
        "space": spec.get("space", ""),
        "layer": spec.get("layer", "L1"),
        "canvas": canvas,
        "columns": columns,
        "associations": [_ds_association(a) for a in associations],
        "_meta": {
            "layer": spec.get("layer", "L1"),
            "generatedBy": "DS ModelForge",
            "confidenceScore": spec.get("confidence_score", 0.95),
        },
    }


# ── SQL View ──────────────────────────────────────────────────────────────────

def _render_sql_view(spec: dict) -> dict:
    obj_id = spec.get("objectId") or spec.get("view_name", "UNKNOWN")
    columns = _collect_output_columns(spec)

    # Canvas for SQL view: just source → sql_node → output
    canvas_nodes = [
        {
            "id": "sql_node",
            "type": "sqlEditor",
            "label": "SQL Definition",
            "position": {"x": 200, "y": 120},
            "iconMeta": {
                "icon": "SqlIcon",
                "label": "SQL View",
                "tooltip": "Defines the view using a SQL SELECT statement. "
                           "Supports all Datasphere SQL functions and double-quoted column names.",
                "color": "#1B6FA8",
                "shape": "rect",
            },
            "data": {"sqlQuery": spec.get("sqlQuery", spec.get("sql", ""))},
        },
        {
            "id": "output",
            "type": "output",
            "label": obj_id,
            "position": {"x": 500, "y": 120},
            "iconMeta": OPERATOR_ICON_META["output"],
            "data": {},
        },
    ]
    canvas_edges = [{"from": "sql_node", "to": "output"}]

    return {
        "kind": "DataBuilder.View",
        "version": "1.0.0",
        "objectId": obj_id,
        "dbObject": obj_id,
        "businessName": spec.get("businessName") or spec.get("business_name", obj_id),
        "description": spec.get("description", ""),
        "definitionType": "SQL",
        "space": spec.get("space", ""),
        "layer": spec.get("layer", "L2"),
        "sqlQuery": spec.get("sqlQuery", spec.get("sql", "")),
        "canvas": {"nodes": canvas_nodes, "edges": canvas_edges},
        "columns": columns,
        "_meta": {
            "layer": spec.get("layer", "L2"),
            "generatedBy": "DS ModelForge",
            "confidenceScore": spec.get("confidence_score", 0.92),
        },
    }


# ── Business Entity ───────────────────────────────────────────────────────────

def _render_business_entity(spec: dict) -> dict:
    obj_id = spec.get("objectId") or spec.get("view_name", "UNKNOWN")
    sources = spec.get("sources", [])
    operators = spec.get("operators", [])
    hierarchies = spec.get("hierarchies", [])
    associations = spec.get("associations", [])

    canvas = _build_entity_canvas(obj_id, sources, operators, hierarchies, associations)
    columns = _collect_output_columns(spec)

    key_attrs = [c for c in columns if c.get("isKey")]
    other_attrs = [c for c in columns if not c.get("isKey")]

    return {
        "kind": "DataBuilder.BusinessEntity",
        "version": "1.0.0",
        "objectId": obj_id,
        "dbObject": obj_id,
        "businessName": spec.get("businessName") or spec.get("business_name", obj_id),
        "description": spec.get("description", ""),
        "space": spec.get("space", ""),
        "layer": "L3",
        "keyAttributes": [_ds_column(c) for c in key_attrs],
        "attributes": [_ds_column(c) for c in other_attrs],
        "hierarchies": [_ds_hierarchy(h) for h in hierarchies],
        "associations": [_ds_association(a) for a in associations],
        "canvas": canvas,
        "_meta": {
            "layer": "L3",
            "generatedBy": "DS ModelForge",
            "confidenceScore": spec.get("confidence_score", 0.94),
        },
    }


# ── Analytic Model ────────────────────────────────────────────────────────────

def _render_analytic_model(spec: dict) -> dict:
    obj_id = spec.get("objectId") or spec.get("view_name", "UNKNOWN")
    all_cols = _collect_output_columns(spec)
    measures = [c for c in all_cols if c.get("semanticUsage") == "measure" or c.get("semantic") == "measure"]
    dimensions = [c for c in all_cols if c.get("semanticUsage") in ("dimension", "key", "date")
                  or c.get("semantic") in ("dimension", "key", "date")]
    associations = spec.get("associations", [])

    # Canvas: fact source node + dimension sources + associations → analytic model output
    canvas = _build_analytic_model_canvas(obj_id, spec, measures, dimensions, associations)

    return {
        "kind": "DataBuilder.AnalyticModel",
        "version": "1.0.0",
        "objectId": obj_id,
        "businessName": spec.get("businessName") or spec.get("business_name", obj_id),
        "description": spec.get("description", ""),
        "space": spec.get("space", ""),
        "layer": "L4",
        "factSource": _ds_fact_source(spec),
        "measures": [_ds_measure(c) for c in measures],
        "dimensions": [_ds_dimension_member(c) for c in dimensions],
        "associatedDimensions": [_ds_assoc_dimension(a) for a in associations],
        "canvas": canvas,
        "_meta": {
            "layer": "L4",
            "generatedBy": "DS ModelForge",
            "confidenceScore": spec.get("confidence_score", 0.96),
        },
    }


# ── Replication Config ────────────────────────────────────────────────────────

def _render_replication_config(spec: dict) -> dict:
    return {
        "kind": "DataBuilder.ReplicationFlow",
        "version": "1.0.0",
        "objectId": spec.get("objectId") or spec.get("view_name", "UNKNOWN"),
        "description": spec.get("description", ""),
        "space": spec.get("space", ""),
        "layer": "L0",
        "remoteSource": spec.get("remote_source", ""),
        "remoteObject": spec.get("remote_object", ""),
        "targetLocalTable": spec.get("target_local_table", ""),
        "replicationMode": spec.get("replication_mode", "SCHEDULED"),
        "fullLoadFirst": spec.get("full_load_first", True),
        "columns": spec.get("projected_columns", []),
        "canvas": {
            "nodes": [
                {
                    "id": "remote_src",
                    "type": "tableSource",
                    "label": spec.get("remote_object", "Remote Table"),
                    "position": {"x": 40, "y": 120},
                    "iconMeta": OPERATOR_ICON_META["tableSource"],
                    "data": {"objectName": spec.get("remote_object"), "system": spec.get("remote_source")},
                },
                {
                    "id": "replication_node",
                    "type": "replication",
                    "label": "Replication Flow",
                    "position": {"x": 300, "y": 120},
                    "iconMeta": {
                        "icon": "ReplicationIcon",
                        "label": "Replication",
                        "tooltip": "Replicates a full snapshot from a remote source to a local table in Datasphere.",
                        "color": "#E76500",
                        "shape": "rect",
                    },
                    "data": {"mode": spec.get("replication_mode", "SNAPSHOT")},
                },
                {
                    "id": "local_table",
                    "type": "output",
                    "label": spec.get("target_local_table", "Local Table"),
                    "position": {"x": 560, "y": 120},
                    "iconMeta": OPERATOR_ICON_META["output"],
                    "data": {},
                },
            ],
            "edges": [
                {"from": "remote_src", "to": "replication_node"},
                {"from": "replication_node", "to": "local_table"},
            ],
        },
        "_meta": {"layer": "L0", "generatedBy": "DS ModelForge"},
    }


# ── Canvas Builders ───────────────────────────────────────────────────────────

def _build_graphical_canvas(obj_id: str, sources: list, operators: list, associations: list) -> dict:
    """
    Build the operator-level canvas for a graphical view.
    Layout: Source(s) → Join(s) → Filter(s) → Projection → Output
    X spacing: 280px per operator column, Y spacing: 200px per row.
    """
    nodes: list[dict] = []
    edges: list[dict] = []
    x = 40

    # ── Source nodes ─────────────────────────────
    src_ids: list[str] = []
    for i, src in enumerate(sources):
        src_name = src.get("object_name") or src.get("alias", f"Source_{i+1}")
        src_type = src.get("object_type", "table")
        node_type = "viewSource" if src_type == "view" else "tableSource"
        node_id = f"src_{src_name}"
        nodes.append({
            "id": node_id,
            "type": node_type,
            "label": src_name,
            "position": {"x": x, "y": 80 + i * 220},
            "iconMeta": OPERATOR_ICON_META[node_type],
            "data": {
                "objectName": src_name,
                "alias": src.get("alias", src_name),
                "objectType": src_type,
            },
        })
        src_ids.append(node_id)

    x += 280

    # ── Join nodes ───────────────────────────────
    join_ops = [op for op in operators if op.get("op") == "join"]
    last_join_id: str | None = None
    for j_idx, jop in enumerate(join_ops):
        join_id = jop.get("id") or f"join_{j_idx}"
        join_type = jop.get("type", "left").upper()
        conditions = jop.get("conditions", [])
        condition_strs = [
            f"{c.get('left', '?')} = {c.get('right', '?')}"
            for c in conditions
        ]
        nodes.append({
            "id": join_id,
            "type": "join",
            "label": jop.get("name", f"Join {j_idx+1}"),
            "position": {"x": x, "y": 80 + j_idx * 220},
            "iconMeta": {**OPERATOR_ICON_META["join"],
                         "tooltip": f"{join_type} JOIN — Conditions: {'; '.join(condition_strs)}"},
            "data": {
                "joinType": join_type,
                "leftSource": jop.get("left"),
                "rightSource": jop.get("right"),
                "conditions": conditions,
            },
        })
        # Connect left source
        left_src = jop.get("left")
        left_id = f"src_{left_src}" if left_src else (src_ids[0] if src_ids else None)
        if left_id:
            edges.append({"from": left_id, "to": join_id, "label": "Left"})
        # Connect right source
        right_src = jop.get("right")
        right_id = f"src_{right_src}" if right_src else (src_ids[j_idx + 1] if j_idx + 1 < len(src_ids) else None)
        if right_id:
            edges.append({"from": right_id, "to": join_id, "label": "Right"})
        last_join_id = join_id

    if join_ops:
        x += 280

    # ── Filter nodes ─────────────────────────────
    filter_ops = [op for op in operators if op.get("op") == "filter"]
    last_filter_id: str | None = None
    for f_idx, fop in enumerate(filter_ops):
        filter_id = fop.get("id") or f"filter_{f_idx}"
        expr = fop.get("expression", "")
        nodes.append({
            "id": filter_id,
            "type": "filter",
            "label": fop.get("name", f"Filter {f_idx+1}"),
            "position": {"x": x, "y": 80 + f_idx * 160},
            "iconMeta": {**OPERATOR_ICON_META["filter"],
                         "tooltip": f"Filter condition: {expr}\n\n"
                                    + OPERATOR_ICON_META["filter"]["tooltip"]},
            "data": {"expression": expr, "rationale": fop.get("rationale", "")},
        })
        # Wire from previous join, or directly from sources
        prev = last_join_id or (src_ids[0] if src_ids else None)
        if prev:
            edges.append({"from": prev, "to": filter_id})
        last_filter_id = filter_id

    if filter_ops:
        x += 280

    # ── Projection nodes ─────────────────────────
    proj_ops = [op for op in operators if op.get("op") == "projection"]
    last_proj_id: str | None = None
    for p_idx, pop in enumerate(proj_ops):
        proj_id = pop.get("id") or f"proj_{p_idx}"
        cols = pop.get("columns", [])
        calc_cols = [c for c in cols if c.get("isCalculated")]
        tooltip_extra = ""
        if calc_cols:
            tooltip_extra = f"\n\nCalculated columns: {', '.join(c['name'] for c in calc_cols)}"
        nodes.append({
            "id": proj_id,
            "type": "projection",
            "label": pop.get("name", f"Projection {p_idx+1}"),
            "position": {"x": x, "y": 80},
            "iconMeta": {**OPERATOR_ICON_META["projection"],
                         "tooltip": OPERATOR_ICON_META["projection"]["tooltip"] + tooltip_extra},
            "data": {
                "columns": [
                    {
                        "name": c.get("name"),
                        "businessName": c.get("businessName", c.get("name")),
                        "dataType": c.get("dataType", "NVARCHAR(255)"),
                        "semantic": c.get("semantic", "dimension"),
                        "isKey": c.get("isKey", False),
                        "aggregation": c.get("aggregation"),
                        "isCalculated": c.get("isCalculated", False),
                        "expression": c.get("expression"),
                    }
                    for c in cols
                ],
            },
        })
        prev = last_filter_id or last_join_id or (src_ids[0] if src_ids else None)
        if prev:
            edges.append({"from": prev, "to": proj_id})
        last_proj_id = proj_id

    if proj_ops:
        x += 280

    # ── Aggregation nodes ─────────────────────────
    agg_ops = [op for op in operators if op.get("op") == "aggregation"]
    last_agg_id: str | None = None
    for a_idx, aop in enumerate(agg_ops):
        agg_id = aop.get("id") or f"agg_{a_idx}"
        nodes.append({
            "id": agg_id,
            "type": "aggregation",
            "label": aop.get("name", f"Aggregation {a_idx+1}"),
            "position": {"x": x, "y": 80},
            "iconMeta": OPERATOR_ICON_META["aggregation"],
            "data": {
                "measures": aop.get("measures", []),
                "groupByColumns": aop.get("group_by", []),
            },
        })
        prev = last_proj_id or last_filter_id or last_join_id or (src_ids[0] if src_ids else None)
        if prev:
            edges.append({"from": prev, "to": agg_id})
        last_agg_id = agg_id

    if agg_ops:
        x += 280

    # ── Output node ───────────────────────────────
    output_id = "output"
    nodes.append({
        "id": output_id,
        "type": "output",
        "label": obj_id,
        "position": {"x": x, "y": 80},
        "iconMeta": OPERATOR_ICON_META["output"],
        "data": {"objectId": obj_id},
    })
    last = last_agg_id or last_proj_id or last_filter_id or last_join_id or (src_ids[0] if src_ids else None)
    if last:
        edges.append({"from": last, "to": output_id})

    # ── Association edges (dashed semantic links) ─
    for assoc in associations:
        target = assoc.get("target") or assoc.get("target_view")
        card = assoc.get("cardinality", "n..1")
        if target:
            edges.append({
                "from": obj_id,
                "to": target,
                "edgeType": "association",
                "label": f"{card}",
                "iconMeta": OPERATOR_ICON_META["association"],
                "dashed": True,
            })

    return {"nodes": nodes, "edges": edges}


def _build_entity_canvas(obj_id: str, sources: list, operators: list,
                          hierarchies: list, associations: list) -> dict:
    """Canvas for L3 Business Entity (dimension with hierarchies)."""
    nodes: list[dict] = []
    edges: list[dict] = []
    x = 40

    # Source staging view
    for i, src in enumerate(sources):
        src_name = src.get("object_name") or src.get("alias", "Source")
        node_id = f"src_{src_name}"
        nodes.append({
            "id": node_id,
            "type": "viewSource",
            "label": src_name,
            "position": {"x": x, "y": 80 + i * 200},
            "iconMeta": OPERATOR_ICON_META["viewSource"],
            "data": {"objectName": src_name, "alias": src.get("alias", src_name)},
        })

    x += 280

    # Projection
    proj_ops = [op for op in operators if op.get("op") == "projection"]
    proj_id = "proj_entity"
    if proj_ops:
        pop = proj_ops[0]
        cols = pop.get("columns", [])
        key_cols = [c for c in cols if c.get("isKey")]
        attr_cols = [c for c in cols if not c.get("isKey")]
        nodes.append({
            "id": proj_id,
            "type": "projection",
            "label": pop.get("name", "Attributes & Keys"),
            "position": {"x": x, "y": 80},
            "iconMeta": {**OPERATOR_ICON_META["projection"],
                         "tooltip": f"Key attributes: {', '.join(c['name'] for c in key_cols)}\n"
                                    f"Other attributes: {len(attr_cols)} columns"},
            "data": {"keyAttributes": [c.get("name") for c in key_cols],
                     "attributes": [c.get("name") for c in attr_cols]},
        })
        src_names = [src.get("object_name") or src.get("alias") for src in sources]
        for sn in src_names:
            if sn:
                edges.append({"from": f"src_{sn}", "to": proj_id})
        x += 280

    # Hierarchy nodes
    for h_idx, h in enumerate(hierarchies):
        h_id = f"hierarchy_{h_idx}"
        h_type = h.get("type", "level")
        if h_type == "parent_child":
            tip = (f"Parent-Child Hierarchy: '{h.get('parent_attribute')}' → '{h.get('child_attribute')}'. "
                   "Each row references its parent in the same table. Supports unlimited depth.")
        else:
            levels = h.get("levels", [])
            tip = f"Level Hierarchy: {' → '.join(levels)}. Fixed-depth drill path."
        nodes.append({
            "id": h_id,
            "type": "hierarchy",
            "label": h.get("name", f"Hierarchy {h_idx+1}"),
            "position": {"x": x, "y": 80 + h_idx * 180},
            "iconMeta": {**OPERATOR_ICON_META["hierarchy"], "tooltip": tip},
            "data": {
                "hierarchyType": h_type,
                "parentAttribute": h.get("parent_attribute"),
                "childAttribute": h.get("child_attribute"),
                "levels": h.get("levels", []),
            },
        })
        edges.append({"from": proj_id if proj_ops else (f"src_{sources[0].get('object_name')}" if sources else "src"), "to": h_id})

    if hierarchies:
        x += 280

    # Output
    nodes.append({
        "id": "output",
        "type": "output",
        "label": obj_id,
        "position": {"x": x, "y": 80},
        "iconMeta": OPERATOR_ICON_META["output"],
        "data": {"objectId": obj_id, "entityType": "BusinessEntity"},
    })
    last = f"hierarchy_0" if hierarchies else (proj_id if proj_ops else None)
    if last:
        edges.append({"from": last, "to": "output"})

    # Association edges
    for assoc in associations:
        target = assoc.get("target") or assoc.get("target_view")
        if target:
            edges.append({
                "from": obj_id,
                "to": target,
                "edgeType": "association",
                "label": assoc.get("cardinality", "n..1"),
                "iconMeta": OPERATOR_ICON_META["association"],
                "dashed": True,
            })

    return {"nodes": nodes, "edges": edges}


def _build_analytic_model_canvas(obj_id: str, spec: dict, measures: list,
                                  dimensions: list, associations: list) -> dict:
    """Canvas for L4 Analytic Model."""
    nodes: list[dict] = []
    edges: list[dict] = []

    # Fact source (L2 view)
    inputs = spec.get("inputs", [])
    fact_input = inputs[0] if inputs else {}
    fact_name = fact_input.get("objectName") or fact_input.get("alias", "Fact")
    nodes.append({
        "id": "fact_source",
        "type": "measureSource",
        "label": fact_name,
        "position": {"x": 40, "y": 80},
        "iconMeta": {**OPERATOR_ICON_META["measureSource"],
                     "tooltip": f"Fact view providing {len(measures)} measures: "
                                f"{', '.join(m.get('name','?') for m in measures[:5])}"
                                + ("..." if len(measures) > 5 else "")},
        "data": {
            "objectName": fact_name,
            "measures": [m.get("name") for m in measures],
        },
    })

    # Dimension sources (one per association)
    for d_idx, assoc in enumerate(associations):
        dim_name = assoc.get("target") or assoc.get("target_view", f"Dim_{d_idx}")
        d_id = f"dim_{d_idx}"
        nodes.append({
            "id": d_id,
            "type": "dimensionSource",
            "label": dim_name,
            "position": {"x": 40, "y": 300 + d_idx * 180},
            "iconMeta": {**OPERATOR_ICON_META["dimensionSource"],
                         "tooltip": f"Dimension entity '{dim_name}' — "
                                    f"Cardinality: {assoc.get('cardinality', 'n..1')}. "
                                    "Provides drill-down attributes for reporting."},
            "data": {
                "objectName": dim_name,
                "cardinality": assoc.get("cardinality", "n..1"),
                "foreignKeyMappings": assoc.get("foreign_key_mappings", []),
            },
        })
        edges.append({
            "from": d_id,
            "to": "am_node",
            "edgeType": "association",
            "label": assoc.get("cardinality", "n..1"),
            "iconMeta": OPERATOR_ICON_META["association"],
            "dashed": True,
        })

    # Central analytic model node
    nodes.append({
        "id": "am_node",
        "type": "analyticModel",
        "label": obj_id,
        "position": {"x": 400, "y": 80 + len(associations) * 40},
        "iconMeta": {
            "icon": "AnalyticModelIcon",
            "label": "Analytic Model",
            "tooltip": (
                f"Multi-dimensional analytic model with {len(measures)} measures "
                f"and {len(dimensions)} dimensions. "
                "Ready for SAP Analytics Cloud (SAC) consumption."
            ),
            "color": "#188918",
            "shape": "rect",
        },
        "data": {
            "objectId": obj_id,
            "measureCount": len(measures),
            "dimensionCount": len(dimensions),
        },
    })
    edges.append({"from": "fact_source", "to": "am_node"})

    return {"nodes": nodes, "edges": edges}


# ── Field helpers ─────────────────────────────────────────────────────────────

def _collect_output_columns(spec: dict) -> list[dict]:
    """Pull columns from the last projection operator, or from spec.columns."""
    operators = spec.get("operators", [])
    proj_ops = [op for op in operators if op.get("op") == "projection"]
    if proj_ops:
        raw = proj_ops[-1].get("columns", [])
    else:
        raw = spec.get("columns", [])
    return [_ds_column(c) for c in raw]


def _ds_column(c: dict) -> dict:
    semantic = c.get("semantic") or c.get("semantic_role") or c.get("semanticUsage", "dimension")
    return {
        "name": c.get("name") or c.get("column_name"),
        "businessName": c.get("businessName") or c.get("business_name") or c.get("name") or c.get("column_name"),
        "dataType": c.get("dataType") or c.get("data_type", "NVARCHAR(255)"),
        "semanticUsage": semantic,
        "aggregation": c.get("aggregation"),
        "currencyKey": c.get("currencyKey") or c.get("currency_key"),
        "unitKey": c.get("unitKey"),
        "isKey": c.get("isKey") or c.get("is_key", False),
        "isCalculated": c.get("isCalculated", False),
        "expression": c.get("expression"),
    }


def _ds_measure(c: dict) -> dict:
    return {
        "name": c.get("name") or c.get("column_name"),
        "businessName": c.get("businessName") or c.get("business_name") or c.get("name"),
        "dataType": c.get("dataType") or c.get("data_type", "DECIMAL(16,2)"),
        "aggregation": c.get("aggregation", "SUM"),
        "currencyKey": c.get("currencyKey") or c.get("currency_key"),
        "unitKey": c.get("unitKey"),
    }


def _ds_dimension_member(c: dict) -> dict:
    return {
        "name": c.get("name") or c.get("column_name"),
        "businessName": c.get("businessName") or c.get("business_name") or c.get("name"),
        "dataType": c.get("dataType") or c.get("data_type", "NVARCHAR(255)"),
        "semanticUsage": c.get("semantic") or c.get("semanticUsage", "dimension"),
    }


def _ds_fact_source(spec: dict) -> dict:
    inputs = spec.get("inputs", [])
    if inputs:
        inp = inputs[0]
        return {"objectName": inp.get("objectName") or inp.get("alias", ""), "alias": inp.get("alias", "")}
    sources = spec.get("sources", [])
    if sources:
        s = sources[0]
        return {"objectName": s.get("object_name") or s.get("alias", ""), "alias": s.get("alias", "")}
    return {}


def _ds_hierarchy(h: dict) -> dict:
    h_type = h.get("type", "level")
    base = {
        "name": h.get("name", "Hierarchy"),
        "type": "ParentChild" if h_type == "parent_child" else "Level",
    }
    if h_type == "parent_child":
        base["parentAttribute"] = h.get("parent_attribute")
        base["childAttribute"] = h.get("child_attribute")
    else:
        base["levels"] = [{"name": lvl, "ordinal": i + 1} for i, lvl in enumerate(h.get("levels", []))]
    return base


def _ds_association(a: dict) -> dict:
    return {
        "name": a.get("name", "Association"),
        "target": a.get("target") or a.get("target_view", ""),
        "cardinality": a.get("cardinality", "n..1"),
        "joinConditions": a.get("conditions", []),
        "foreignKeyMappings": a.get("foreign_key_mappings", []),
        "integrity": a.get("integrity", "notRequired"),
    }


def _ds_assoc_dimension(a: dict) -> dict:
    return {
        "dimensionObject": a.get("target") or a.get("target_view", ""),
        "associationName": a.get("name", "Association"),
        "cardinality": a.get("cardinality", "n..1"),
    }

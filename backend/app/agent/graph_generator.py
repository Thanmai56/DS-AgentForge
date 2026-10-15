"""
Graph Generator — converts ViewSpecs into GraphNode/GraphEdge DB records.

Two modes:
1. MACRO view (architecture chain) — one node per view, used by the lineage/impact graphs.
   Nodes: source_table → L1 staging → L2 core → L3 dimension → L4 analytic model
   Edge kind: data_flow

2. MICRO view (operator canvas) — one node per Datasphere operator, used by the canvas UI.
   Nodes: tableSource / viewSource → join → filter → projection → aggregation → hierarchy → output
   Edge kind: data_flow, association

Both sets are stored in GraphNode/GraphEdge so the frontend can switch views.
The 'view_mode' field on each node tells the frontend which graph to render.
"""
from typing import Any


# ── X layout constants ────────────────────────────────────────────────────────
MACRO_X = {"Source": 40.0, "L0": 40.0, "L1": 400.0, "L2": 780.0, "L3": 780.0, "L4": 1180.0}
MICRO_X_STEP = 280  # px between operator columns


def generate_graph_elements(
    run_id: str,
    view_specs: list[dict[str, Any]],
    source_tables: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Returns (nodes, edges) for GraphNode/GraphEdge storage.
    Generates BOTH macro architecture nodes and micro operator nodes.
    """
    nodes: list[dict] = []
    edges: list[dict] = []
    source_tables = source_tables or []

    # ── MACRO: source table nodes ─────────────────────────────────────────────
    for idx, st in enumerate(source_tables):
        t_name = st.get("name") or st.get("object_name") or f"SOURCE_{idx+1}"
        node_key = f"src_{t_name}"
        nodes.append({
            "run_id": run_id,
            "node_key": node_key,
            "object_id": t_name,
            "kind": "tableSource",
            "label": t_name,
            "layer": "Source",
            "pos_x": MACRO_X["Source"],
            "pos_y": 80.0 + idx * 220.0,
            "payload": {
                "view_mode": "macro",
                "object_name": t_name,
                "business_name": st.get("business_name") or f"Raw Table: {t_name}",
                "columns": [
                    {
                        "column_name": c.get("name"),
                        "data_type": c.get("data_type", "NVARCHAR"),
                        "is_key": c.get("is_key", False),
                        "semantic_role": c.get("semantic_role", "dimension"),
                    }
                    for c in st.get("columns", [])
                ],
                "row_count": st.get("row_count", 150000),
                "icon": "DatabaseIcon",
                "iconMeta": {
                    "icon": "DatabaseIcon",
                    "label": "Source Table",
                    "tooltip": f"Raw source table '{t_name}' from the connected source system.",
                    "color": "#0070F2",
                    "shape": "rect",
                },
            },
        })

    # ── MACRO + MICRO: one loop per view spec ─────────────────────────────────
    layer_counts: dict[str, int] = {}

    for vs_idx, vs in enumerate(view_specs):
        v_name = vs.get("objectId") or vs.get("view_name") or f"VIEW_{vs_idx+1}"
        layer = vs.get("layer", "L1")
        kind = vs.get("kind", "graphical_view")

        layer_counts[layer] = layer_counts.get(layer, 0) + 1
        layer_pos_idx = layer_counts[layer] - 1

        # Map kind to react node type for macro view
        macro_type = _kind_to_macro_type(kind, vs)

        base_x = MACRO_X.get(layer, 600.0)
        base_y = _macro_y(layer, layer_pos_idx)

        # ── MACRO node ───────────────────────────────────────────────────────
        nodes.append({
            "run_id": run_id,
            "node_key": v_name,
            "object_id": v_name,
            "kind": macro_type,
            "label": v_name,
            "layer": layer,
            "pos_x": base_x,
            "pos_y": base_y,
            "payload": {
                "view_mode": "macro",
                "view_name": v_name,
                "kind": kind,
                "layer": layer,
                "business_name": vs.get("businessName") or vs.get("business_name", v_name),
                "description": vs.get("description", ""),
                "confidence_score": vs.get("confidence_score", 0.95),
                "column_count": len(vs.get("columns", [])),
                "sources": vs.get("sources", []),
                "iconMeta": _macro_icon_meta(kind),
            },
        })

        # ── MACRO edges from source tables/views ─────────────────────────────
        for src in vs.get("sources", []):
            src_obj = src.get("object_name")
            if src_obj:
                from_key = (
                    f"src_{src_obj}"
                    if any(s.get("name") == src_obj for s in source_tables)
                    else src_obj
                )
                edges.append({
                    "run_id": run_id,
                    "from_node_key": from_key,
                    "to_node_key": v_name,
                    "edge_kind": "data_flow",
                    "payload": {"view_mode": "macro", "animated": True},
                })

        # ── MACRO association edges ────────────────────────────────────────
        for assoc in vs.get("associations", []):
            target = assoc.get("target") or assoc.get("target_view")
            if target:
                edges.append({
                    "run_id": run_id,
                    "from_node_key": v_name,
                    "to_node_key": target,
                    "edge_kind": "association",
                    "payload": {
                        "view_mode": "macro",
                        "animated": False,
                        "label": f"{assoc.get('cardinality', 'n..1')} Association",
                        "cardinality": assoc.get("cardinality", "n..1"),
                        "conditions": assoc.get("conditions", []),
                        "dashed": True,
                    },
                })

        # ── MICRO operator nodes (within each view) ───────────────────────────
        micro_nodes, micro_edges = _build_micro_operator_nodes(run_id, vs, source_tables)
        nodes.extend(micro_nodes)
        edges.extend(micro_edges)

    return nodes, edges


# ── Micro operator graph builder ──────────────────────────────────────────────

def _build_micro_operator_nodes(
    run_id: str, vs: dict, source_tables: list[dict]
) -> tuple[list[dict], list[dict]]:
    """
    Generate per-view operator-level nodes and edges (micro canvas).
    Prefixed with view name to avoid key collisions across views.
    """
    from app.services.ds_native_renderer import OPERATOR_ICON_META

    v_name = vs.get("objectId") or vs.get("view_name", "VIEW")
    prefix = f"{v_name}__"
    operators = vs.get("operators", [])
    sources = vs.get("sources", [])
    associations = vs.get("associations", [])
    hierarchies = vs.get("hierarchies", [])
    layer = vs.get("layer", "L1")

    nodes: list[dict] = []
    edges: list[dict] = []

    # Layout: micro nodes start at x=40, increment 280px per operator column
    x = 40.0

    # Base Y for this view's micro canvas (stagger per view for the combined layout)
    base_y = 80.0

    # Source nodes
    src_node_keys: list[str] = []
    for i, src in enumerate(sources):
        src_name = src.get("object_name") or src.get("alias", f"Src{i+1}")
        src_type = src.get("object_type", "table")
        node_type = "viewSource" if src_type == "view" else "tableSource"
        nk = f"{prefix}src_{src_name}"
        nodes.append({
            "run_id": run_id,
            "node_key": nk,
            "object_id": src_name,
            "kind": node_type,
            "label": src_name,
            "layer": layer,
            "pos_x": x,
            "pos_y": base_y + i * 200.0,
            "payload": {
                "view_mode": "micro",
                "parent_view": v_name,
                "objectName": src_name,
                "alias": src.get("alias", src_name),
                "objectType": src_type,
                "iconMeta": OPERATOR_ICON_META[node_type],
            },
        })
        src_node_keys.append(nk)

    x += MICRO_X_STEP

    # Join operators
    join_ops = [op for op in operators if op.get("op") == "join"]
    join_node_keys: list[str] = []
    for j_idx, jop in enumerate(join_ops):
        nk = f"{prefix}{jop.get('id', f'join_{j_idx}')}"
        conds = jop.get("conditions", [])
        cond_str = "; ".join(f"{c.get('left','?')} = {c.get('right','?')}" for c in conds)
        nodes.append({
            "run_id": run_id,
            "node_key": nk,
            "object_id": jop.get("name", f"Join_{j_idx+1}"),
            "kind": "join",
            "label": jop.get("name", f"Join {j_idx+1}"),
            "layer": layer,
            "pos_x": x,
            "pos_y": base_y + j_idx * 200.0,
            "payload": {
                "view_mode": "micro",
                "parent_view": v_name,
                "joinType": jop.get("type", "left").upper(),
                "leftSource": jop.get("left"),
                "rightSource": jop.get("right"),
                "conditions": conds,
                "iconMeta": {
                    **OPERATOR_ICON_META["join"],
                    "tooltip": f"{jop.get('type','LEFT').upper()} JOIN\nConditions: {cond_str}",
                },
            },
        })
        # Wire: left source → join
        left_id = f"{prefix}src_{jop.get('left')}" if jop.get("left") else (src_node_keys[0] if src_node_keys else None)
        if left_id:
            edges.append({"run_id": run_id, "from_node_key": left_id, "to_node_key": nk,
                          "edge_kind": "data_flow", "payload": {"view_mode": "micro", "label": "Left"}})
        right_id = f"{prefix}src_{jop.get('right')}" if jop.get("right") else (src_node_keys[j_idx + 1] if j_idx + 1 < len(src_node_keys) else None)
        if right_id:
            edges.append({"run_id": run_id, "from_node_key": right_id, "to_node_key": nk,
                          "edge_kind": "data_flow", "payload": {"view_mode": "micro", "label": "Right"}})
        join_node_keys.append(nk)

    if join_ops:
        x += MICRO_X_STEP

    # Filter operators
    filter_ops = [op for op in operators if op.get("op") == "filter"]
    filter_node_keys: list[str] = []
    for f_idx, fop in enumerate(filter_ops):
        nk = f"{prefix}{fop.get('id', f'filter_{f_idx}')}"
        nodes.append({
            "run_id": run_id,
            "node_key": nk,
            "object_id": fop.get("name", f"Filter_{f_idx+1}"),
            "kind": "filter",
            "label": fop.get("name", f"Filter {f_idx+1}"),
            "layer": layer,
            "pos_x": x,
            "pos_y": base_y + f_idx * 160.0,
            "payload": {
                "view_mode": "micro",
                "parent_view": v_name,
                "expression": fop.get("expression", ""),
                "rationale": fop.get("rationale", ""),
                "iconMeta": {
                    **OPERATOR_ICON_META["filter"],
                    "tooltip": f"Filter: {fop.get('expression', '')}\n\n{fop.get('rationale', '')}",
                },
            },
        })
        prev = join_node_keys[-1] if join_node_keys else (src_node_keys[0] if src_node_keys else None)
        if prev:
            edges.append({"run_id": run_id, "from_node_key": prev, "to_node_key": nk,
                          "edge_kind": "data_flow", "payload": {"view_mode": "micro"}})
        filter_node_keys.append(nk)

    if filter_ops:
        x += MICRO_X_STEP

    # Projection operators
    proj_ops = [op for op in operators if op.get("op") == "projection"]
    proj_node_keys: list[str] = []
    for p_idx, pop in enumerate(proj_ops):
        nk = f"{prefix}{pop.get('id', f'proj_{p_idx}')}"
        cols = pop.get("columns", [])
        calc_cols = [c for c in cols if c.get("isCalculated")]
        nodes.append({
            "run_id": run_id,
            "node_key": nk,
            "object_id": pop.get("name", f"Projection_{p_idx+1}"),
            "kind": "projection",
            "label": pop.get("name", f"Projection {p_idx+1}"),
            "layer": layer,
            "pos_x": x,
            "pos_y": base_y,
            "payload": {
                "view_mode": "micro",
                "parent_view": v_name,
                "columnCount": len(cols),
                "calculatedColumns": [{"name": c["name"], "expression": c.get("expression", "")} for c in calc_cols],
                "iconMeta": {
                    **OPERATOR_ICON_META["projection"],
                    "tooltip": (
                        f"{len(cols)} columns selected"
                        + (f", including {len(calc_cols)} calculated column(s): "
                           f"{', '.join(c['name'] for c in calc_cols)}" if calc_cols else "")
                        + f"\n\n{OPERATOR_ICON_META['projection']['tooltip']}"
                    ),
                },
                "columns": cols,
            },
        })
        prev = filter_node_keys[-1] if filter_node_keys else join_node_keys[-1] if join_node_keys else (src_node_keys[0] if src_node_keys else None)
        if prev:
            edges.append({"run_id": run_id, "from_node_key": prev, "to_node_key": nk,
                          "edge_kind": "data_flow", "payload": {"view_mode": "micro"}})
        proj_node_keys.append(nk)

    if proj_ops:
        x += MICRO_X_STEP

    # Aggregation operators
    agg_ops = [op for op in operators if op.get("op") == "aggregation"]
    agg_node_keys: list[str] = []
    for a_idx, aop in enumerate(agg_ops):
        nk = f"{prefix}{aop.get('id', f'agg_{a_idx}')}"
        nodes.append({
            "run_id": run_id,
            "node_key": nk,
            "object_id": aop.get("name", f"Aggregation_{a_idx+1}"),
            "kind": "aggregation",
            "label": aop.get("name", f"Aggregation {a_idx+1}"),
            "layer": layer,
            "pos_x": x,
            "pos_y": base_y,
            "payload": {
                "view_mode": "micro",
                "parent_view": v_name,
                "measures": aop.get("measures", []),
                "groupBy": aop.get("group_by", []),
                "iconMeta": OPERATOR_ICON_META["aggregation"],
            },
        })
        prev = proj_node_keys[-1] if proj_node_keys else filter_node_keys[-1] if filter_node_keys else (src_node_keys[0] if src_node_keys else None)
        if prev:
            edges.append({"run_id": run_id, "from_node_key": prev, "to_node_key": nk,
                          "edge_kind": "data_flow", "payload": {"view_mode": "micro"}})
        agg_node_keys.append(nk)

    if agg_ops:
        x += MICRO_X_STEP

    # Hierarchy nodes (L3 entities)
    hierarchy_node_keys: list[str] = []
    for h_idx, h in enumerate(hierarchies):
        nk = f"{prefix}hierarchy_{h_idx}"
        h_type = h.get("type", "level")
        if h_type == "parent_child":
            tip = (f"Parent-Child Hierarchy '{h.get('name')}': "
                   f"parent='{h.get('parent_attribute')}' → child='{h.get('child_attribute')}'. "
                   "Unlimited depth rollup.")
        else:
            tip = f"Level Hierarchy '{h.get('name')}': {' → '.join(h.get('levels', []))}"
        nodes.append({
            "run_id": run_id,
            "node_key": nk,
            "object_id": h.get("name", f"Hierarchy_{h_idx+1}"),
            "kind": "hierarchy",
            "label": h.get("name", f"Hierarchy {h_idx+1}"),
            "layer": layer,
            "pos_x": x,
            "pos_y": base_y + h_idx * 180.0,
            "payload": {
                "view_mode": "micro",
                "parent_view": v_name,
                "hierarchyType": h_type,
                "parentAttribute": h.get("parent_attribute"),
                "childAttribute": h.get("child_attribute"),
                "levels": h.get("levels", []),
                "iconMeta": {**OPERATOR_ICON_META["hierarchy"], "tooltip": tip},
            },
        })
        prev = proj_node_keys[-1] if proj_node_keys else (src_node_keys[0] if src_node_keys else None)
        if prev:
            edges.append({"run_id": run_id, "from_node_key": prev, "to_node_key": nk,
                          "edge_kind": "data_flow", "payload": {"view_mode": "micro"}})
        hierarchy_node_keys.append(nk)

    if hierarchy_node_keys:
        x += MICRO_X_STEP

    # Output terminal node
    out_nk = f"{prefix}output"
    nodes.append({
        "run_id": run_id,
        "node_key": out_nk,
        "object_id": v_name,
        "kind": "output",
        "label": v_name,
        "layer": layer,
        "pos_x": x,
        "pos_y": base_y,
        "payload": {
            "view_mode": "micro",
            "parent_view": v_name,
            "objectId": v_name,
            "iconMeta": OPERATOR_ICON_META["output"],
        },
    })
    last = (
        hierarchy_node_keys[-1] if hierarchy_node_keys
        else agg_node_keys[-1] if agg_node_keys
        else proj_node_keys[-1] if proj_node_keys
        else filter_node_keys[-1] if filter_node_keys
        else join_node_keys[-1] if join_node_keys
        else src_node_keys[0] if src_node_keys
        else None
    )
    if last:
        edges.append({"run_id": run_id, "from_node_key": last, "to_node_key": out_nk,
                      "edge_kind": "data_flow", "payload": {"view_mode": "micro"}})

    # Association edges (semantic dashed links)
    for assoc in associations:
        target = assoc.get("target") or assoc.get("target_view")
        if target:
            edges.append({
                "run_id": run_id,
                "from_node_key": out_nk,
                "to_node_key": f"{target}__output",  # target view's output node
                "edge_kind": "association",
                "payload": {
                    "view_mode": "micro",
                    "label": assoc.get("cardinality", "n..1"),
                    "cardinality": assoc.get("cardinality", "n..1"),
                    "conditions": assoc.get("conditions", []),
                    "dashed": True,
                    "iconMeta": OPERATOR_ICON_META["association"],
                },
            })

    return nodes, edges


# ── Helpers ───────────────────────────────────────────────────────────────────

def _kind_to_macro_type(kind: str, vs: dict) -> str:
    if kind == "analytic_model":
        return "analyticModel"
    if kind == "business_entity":
        return "dimension"
    if kind == "sql_view":
        return "sqlView"
    if kind == "replication_config":
        return "replication"
    # Graphical view: fact vs staging
    layer = vs.get("layer", "L1")
    if layer == "L2" and any(c.get("semantic_role") == "measure" for c in vs.get("columns", [])):
        return "fact"
    return "graphicalView"


def _macro_y(layer: str, idx: int) -> float:
    if layer == "L1":
        return 60.0 + idx * 220.0
    if layer == "L2":
        return 120.0 + idx * 260.0
    if layer == "L3":
        return 420.0 + idx * 200.0
    return 160.0 + idx * 260.0


def _macro_icon_meta(kind: str) -> dict:
    return {
        "graphical_view": {"icon": "GraphicalViewIcon", "label": "Graphical View", "color": "#0070F2"},
        "sql_view": {"icon": "SqlViewIcon", "label": "SQL View", "color": "#1B6FA8"},
        "business_entity": {"icon": "EntityIcon", "label": "Business Entity", "color": "#188918"},
        "analytic_model": {"icon": "AnalyticModelIcon", "label": "Analytic Model", "color": "#BB0000"},
        "replication_config": {"icon": "ReplicationIcon", "label": "Replication", "color": "#6E6E6E"},
    }.get(kind, {"icon": "ViewIcon", "label": "View", "color": "#0070F2"})

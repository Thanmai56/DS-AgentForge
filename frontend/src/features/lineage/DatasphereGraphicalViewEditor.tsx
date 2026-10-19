// src/features/lineage/DatasphereGraphicalViewEditor.tsx
// Datasphere-style graphical view editor matching real SAP Datasphere Data Builder:
// - Light canvas, left-to-right flow with dagre auto-layout
// - Sources on left, operator rounded squares in middle, blue-headed output on right
// - Thin blue orthogonal connectors
// - Live validation blockers
// - Manual editing with Undo / Redo
// - "Ask AI to revise" box with Diff Preview (added green, removed red, changed amber, Accept/Reject)

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
  Connection,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import {
  GitMerge,
  Filter,
  Columns,
  Sigma,
  Layers,
  Database,
  Undo2,
  Redo2,
  Sparkles,
  RefreshCw,
  Plus,
  Send,
  AlertTriangle,
  CheckCircle2,
  X,
  LayoutGrid,
} from 'lucide-react';

import {
  ViewGraph,
  ViewGraphNode,
  Operation,
  AIRevisionResult,
} from './viewGraphTypes';
import {
  DatasphereSourceNode,
  DatasphereOperatorNode,
  DatasphereOutputNode,
} from './nodes/DatasphereEditorNodes';
import { DataspherePropertiesPanel } from './DataspherePropertiesPanel';
import {
  applyOperationApi,
  undoOperationApi,
  redoOperationApi,
  aiReviseViewApi,
} from './lineageApi';

const nodeTypes = {
  SOURCE: DatasphereSourceNode,
  JOIN: DatasphereOperatorNode,
  CALCULATION: DatasphereOperatorNode,
  FILTER: DatasphereOperatorNode,
  PROJECTION: DatasphereOperatorNode,
  UNION: DatasphereOperatorNode,
  OUTPUT: DatasphereOutputNode,
};

// ── Dagre Auto-Layout Helper ────────────────────────────────────────────────
function layoutViewGraph(nodes: ViewGraphNode[], edges: { source: string; target: string }[]): ViewGraphNode[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'LR',
    nodesep: 50,
    ranksep: 110,
    marginx: 50,
    marginy: 50,
  });

  nodes.forEach((n) => {
    let width = 120;
    let height = 90;
    if (n.node_type === 'SOURCE') {
      width = 260;
      height = 80;
    } else if (n.node_type === 'OUTPUT') {
      width = 280;
      height = 85;
    }
    g.setNode(n.id, { width, height });
  });

  edges.forEach((e) => {
    g.setEdge(e.source, e.target);
  });

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    let width = 120;
    let height = 90;
    if (n.node_type === 'SOURCE') {
      width = 260;
      height = 80;
    } else if (n.node_type === 'OUTPUT') {
      width = 280;
      height = 85;
    }
    return {
      ...n,
      position: {
        x: Math.round(pos.x - width / 2),
        y: Math.round(pos.y - height / 2),
      },
    };
  });
}

interface GraphicalViewEditorProps {
  planId: string;
  initialGraph: ViewGraph;
  onGraphChanged?: (graph: ViewGraph) => void;
}

export const DatasphereGraphicalViewEditor: React.FC<GraphicalViewEditorProps> = ({
  planId,
  initialGraph,
  onGraphChanged,
}) => {
  const [graph, setGraph] = useState<ViewGraph>(initialGraph);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // AI Revision state
  const [aiInstruction, setAiInstruction] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIRevisionResult | null>(null);
  const [aiRejectionMessage, setAiRejectionMessage] = useState<string | null>(null);

  // Validation blockers
  const [showBlockersDrawer, setShowBlockersDrawer] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    setGraph(initialGraph);
  }, [initialGraph]);

  // Compute upstream columns for properties panel
  const upstreamColumns = useMemo(() => {
    const setCols = new Set<string>();
    graph.nodes.forEach((n) => {
      n.columns?.forEach((c) => setCols.add(c));
      if (n.details.calculation_name) setCols.add(n.details.calculation_name);
    });
    return Array.from(setCols).sort();
  }, [graph]);

  // Active displayed graph (preview graph if in AI diff mode, else normal graph)
  const activeDisplayGraph = useMemo(() => {
    if (aiResult && aiResult.valid && aiResult.preview_graph) {
      // Mark diff status on nodes
      const diff = aiResult.diff;
      const previewNodes = aiResult.preview_graph.nodes.map((n) => {
        let diffStatus: 'added' | 'removed' | 'modified' | null = null;
        if (diff.added_nodes.includes(n.id)) diffStatus = 'added';
        else if (diff.modified_nodes.includes(n.id)) diffStatus = 'modified';
        return { ...n, diffStatus };
      });
      return {
        ...aiResult.preview_graph,
        nodes: previewNodes,
      };
    }
    return graph;
  }, [graph, aiResult]);

  // React Flow Nodes
  const flowNodes: Node[] = useMemo(() => {
    return activeDisplayGraph.nodes.map((n) => ({
      id: n.id,
      type: n.node_type,
      position: n.position || { x: 100, y: 100 },
      data: n,
      selected: n.id === selectedNodeId,
    }));
  }, [activeDisplayGraph, selectedNodeId]);

  // React Flow Edges (orthogonal thin blue connectors)
  const flowEdges: Edge[] = useMemo(() => {
    return activeDisplayGraph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.source_handle || null,
      targetHandle: e.target_handle || null,
      type: 'smoothstep',
      style: { stroke: '#0070F2', strokeWidth: 1.8 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#0070F2',
        width: 14,
        height: 14,
      },
    }));
  }, [activeDisplayGraph]);

  // All blockers
  const allBlockers = useMemo(() => {
    const list: string[] = [];
    graph.nodes.forEach((n) => {
      if (n.errors) {
        n.errors.forEach((err) => {
          if (!list.includes(err)) list.push(err);
        });
      }
    });
    return list;
  }, [graph]);

  // ── Operations Handler ────────────────────────────────────────────────────
  const handleApplyOperation = async (op: Operation) => {
    try {
      const res = await applyOperationApi(planId, graph.view_id, op);
      setGraph(res.graph);
      setCanUndo(res.can_undo);
      setCanRedo(res.can_redo);
      if (onGraphChanged) onGraphChanged(res.graph);
    } catch (err: any) {
      alert(`Operation failed: ${err.message}`);
    }
  };

  const handleUndo = async () => {
    try {
      const res = await undoOperationApi(planId, graph.view_id);
      setGraph(res.graph);
      setCanUndo(res.can_undo);
      setCanRedo(res.can_redo);
      if (onGraphChanged) onGraphChanged(res.graph);
    } catch (err: any) {
      console.warn('Undo error:', err);
    }
  };

  const handleRedo = async () => {
    try {
      const res = await redoOperationApi(planId, graph.view_id);
      setGraph(res.graph);
      setCanUndo(res.can_undo);
      setCanRedo(res.can_redo);
      if (onGraphChanged) onGraphChanged(res.graph);
    } catch (err: any) {
      console.warn('Redo error:', err);
    }
  };

  // ── Auto Layout ───────────────────────────────────────────────────────────
  const handleAutoLayout = () => {
    const laidOut = layoutViewGraph(
      graph.nodes,
      graph.edges.map((e) => ({ source: e.source, target: e.target }))
    );
    setGraph((prev) => ({ ...prev, nodes: laidOut }));
  };

  // ── Node Click & Select ───────────────────────────────────────────────────
  const handleNodeClick = (_: any, node: Node) => {
    setSelectedNodeId(node.id);
  };

  // ── Drag & Edge Updates ───────────────────────────────────────────────────
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setGraph((prev) => {
        const updated = applyNodeChanges(changes, flowNodes as any);
        return {
          ...prev,
          nodes: prev.nodes.map((n) => {
            const match = updated.find((u: any) => u.id === n.id);
            if (match && match.position) {
              return { ...n, position: match.position };
            }
            return n;
          }),
        };
      });
    },
    [flowNodes]
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    // If edge removed
    changes.forEach((c) => {
      if (c.type === 'remove') {
        handleApplyOperation({
          op: 'remove_edge',
          edge_id: c.id,
        });
      }
    });
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source && connection.target) {
      handleApplyOperation({
        op: 'add_edge',
        payload: {
          source: connection.source,
          target: connection.target,
          source_handle: connection.sourceHandle,
          target_handle: connection.targetHandle,
        },
      });
    }
  }, []);

  // ── Add Node From Palette ─────────────────────────────────────────────────
  const handleAddNodeFromPalette = (type: string) => {
    setPaletteOpen(false);
    const count = graph.nodes.length + 1;
    const nid = `${type.toLowerCase()}_${count}`;
    const name =
      type === 'JOIN'
        ? 'Inner Join'
        : type === 'CALCULATION'
        ? `CALC_${count}`
        : type === 'FILTER'
        ? 'Filter'
        : type === 'PROJECTION'
        ? 'Projection'
        : type === 'UNION'
        ? 'Union'
        : `Source_${count}`;

    handleApplyOperation({
      op: 'add_node',
      node_id: nid,
      payload: {
        node_type: type,
        name,
        details:
          type === 'JOIN'
            ? { join_type: 'inner', key_pairs: [] }
            : type === 'CALCULATION'
            ? { calculation_name: name, expression: '1', data_type: 'Decimal' }
            : type === 'FILTER'
            ? { filter_expression: "STATUS = 'ACTIVE'" }
            : {},
        position: { x: 380, y: 160 },
      },
    });
  };

  // ── AI Revision Submission ────────────────────────────────────────────────
  const handleAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInstruction.trim() || isAiLoading) return;

    setIsAiLoading(true);
    setAiRejectionMessage(null);
    try {
      const res = await aiReviseViewApi(planId, graph.view_id, aiInstruction.trim());
      if (res.valid) {
        setAiResult(res);
      } else {
        setAiResult(null);
        setAiRejectionMessage(res.message || 'Operation could not be applied.');
      }
    } catch (err: any) {
      setAiRejectionMessage(err.message || 'AI revision request failed.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleAcceptAiDiff = async () => {
    if (!aiResult || !aiResult.preview_graph) return;
    // Apply each operation to commit
    for (const op of aiResult.operations) {
      await handleApplyOperation(op);
    }
    setAiResult(null);
    setAiInstruction('');
  };

  const handleRejectAiDiff = () => {
    setAiResult(null);
    setAiInstruction('');
  };

  const selectedNode = useMemo(() => {
    return graph.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [graph, selectedNodeId]);

  return (
    <div className="relative h-full w-full flex flex-col bg-[#FAFBFD] overflow-hidden select-none text-[#1D2D3E]">
      {/* ── TOP ACTION & CONTROL BAR ── */}
      <div className="px-5 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-2xs z-20">
        {/* Left: View Identifier & Status */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-slate-800 font-mono tracking-tight">
              {graph.view_name}
            </span>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-slate-100 text-slate-600 border border-slate-200">
              v{graph.version}
            </span>
          </div>

          {/* Validation Status Pill */}
          {allBlockers.length === 0 ? (
            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>Valid Graph</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setShowBlockersDrawer(!showBlockersDrawer)}
              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 cursor-pointer"
            >
              <AlertTriangle className="w-3 h-3 text-amber-600" />
              <span>{allBlockers.length} Blocker(s)</span>
            </button>
          )}
        </div>

        {/* Center: "Ask AI to revise" input */}
        <form onSubmit={handleAiSubmit} className="flex-1 max-w-md mx-2">
          <div className="relative flex items-center">
            <input
              type="text"
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              placeholder="Ask AI to revise (e.g., 'change the join to left outer')..."
              className="w-full pl-8 pr-20 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg placeholder-slate-400 focus:outline-none focus:border-[#0070F2] focus:bg-white transition-colors"
            />
            <Sparkles className="w-3.5 h-3.5 text-[#0070F2] absolute left-2.5 pointer-events-none" />
            <button
              type="submit"
              disabled={isAiLoading || !aiInstruction.trim()}
              className="absolute right-1 px-2 py-0.5 text-[11px] font-bold text-white bg-[#0070F2] hover:bg-[#0058C4] rounded transition-colors flex items-center space-x-1 disabled:opacity-40 cursor-pointer"
            >
              {isAiLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              <span>Revise</span>
            </button>
          </div>
        </form>

        {/* Right: Actions (Undo, Redo, Palette, Auto-Layout) */}
        <div className="flex items-center space-x-1.5">
          {/* Undo */}
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo"
            className="p-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>

          {/* Redo */}
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo"
            className="p-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>

          {/* Add Node Palette Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPaletteOpen(!paletteOpen)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center space-x-1 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#0070F2]" />
              <span>Add Node</span>
            </button>

            {paletteOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-1.5 space-y-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => handleAddNodeFromPalette('JOIN')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-blue-50 text-slate-800 flex items-center space-x-2 cursor-pointer"
                >
                  <GitMerge className="w-3.5 h-3.5 text-[#0070F2]" />
                  <span>Join Operator</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddNodeFromPalette('CALCULATION')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-blue-50 text-slate-800 flex items-center space-x-2 cursor-pointer"
                >
                  <Sigma className="w-3.5 h-3.5 text-[#0070F2]" />
                  <span>Calculation</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddNodeFromPalette('FILTER')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-blue-50 text-slate-800 flex items-center space-x-2 cursor-pointer"
                >
                  <Filter className="w-3.5 h-3.5 text-[#0070F2]" />
                  <span>Filter Operator</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddNodeFromPalette('PROJECTION')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-blue-50 text-slate-800 flex items-center space-x-2 cursor-pointer"
                >
                  <Columns className="w-3.5 h-3.5 text-[#0070F2]" />
                  <span>Projection</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddNodeFromPalette('UNION')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-blue-50 text-slate-800 flex items-center space-x-2 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 text-[#0070F2]" />
                  <span>Union Operator</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddNodeFromPalette('SOURCE')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-blue-50 text-slate-800 flex items-center space-x-2 cursor-pointer border-t border-slate-100"
                >
                  <Database className="w-3.5 h-3.5 text-slate-600" />
                  <span>Input Source</span>
                </button>
              </div>
            )}
          </div>

          {/* Auto Layout */}
          <button
            type="button"
            onClick={handleAutoLayout}
            title="Auto-Layout (Left to Right)"
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center space-x-1 transition-colors cursor-pointer"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-slate-600" />
            <span>Layout</span>
          </button>
        </div>
      </div>

      {/* ── AI DIFF PREVIEW BANNER (Added green, removed red, modified amber) ── */}
      {aiResult && aiResult.valid && (
        <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between z-20 text-xs animate-in slide-in-from-top-1">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            <span className="font-bold text-amber-900">AI Diff Preview:</span>
            <span className="text-amber-800">{aiResult.message}</span>
            <span className="text-[11px] text-amber-700 italic">
              (Review highlighted nodes: Amber = Modified, Green = Added)
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleRejectAiDiff}
              className="px-3 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-md font-bold transition-colors cursor-pointer"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={handleAcceptAiDiff}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-bold transition-colors flex items-center space-x-1 cursor-pointer shadow-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Accept AI Change</span>
            </button>
          </div>
        </div>
      )}

      {/* ── AI REJECTION NOTICE ── */}
      {aiRejectionMessage && (
        <div className="px-6 py-2.5 bg-red-50 border-b border-red-200 flex items-center justify-between z-20 text-xs text-red-900 animate-in slide-in-from-top-1">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span className="font-semibold">{aiRejectionMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setAiRejectionMessage(null)}
            className="text-red-500 hover:text-red-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── VALIDATION BLOCKERS DRAWER ── */}
      {showBlockersDrawer && allBlockers.length > 0 && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200 z-20 text-xs text-red-900 flex items-start justify-between">
          <div className="space-y-1">
            <span className="font-bold flex items-center space-x-1.5">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span>Active Validation Blockers ({allBlockers.length})</span>
            </span>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-red-800">
              {allBlockers.map((b, idx) => (
                <li key={idx}>{b}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => setShowBlockersDrawer(false)}
            className="text-red-500 hover:text-red-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── MAIN REACT FLOW CANVAS ── */}
      <div className="flex-1 relative w-full h-full">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={handleNodeClick}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.2}
          maxZoom={2.0}
        >
          {/* Light canvas background with subtle dots */}
          <Background color="#CBD5E1" gap={20} size={1} variant={BackgroundVariant.Dots} />
          <Controls className="!bg-white !border !border-slate-300 !rounded-lg !shadow-md" />
          <MiniMap
            nodeColor={(n: any) => {
              if (n.type === 'SOURCE') return '#60A5FA';
              if (n.type === 'OUTPUT') return '#0070F2';
              return '#93C5FD';
            }}
            maskColor="rgba(240, 244, 248, 0.7)"
            className="!border !border-slate-300 !rounded-lg !shadow-md"
          />
        </ReactFlow>

        {/* ── PROPERTIES PANEL ── */}
        {selectedNode && (
          <DataspherePropertiesPanel
            node={selectedNode}
            upstreamColumns={upstreamColumns}
            onClose={() => setSelectedNodeId(null)}
            onApplyOperation={handleApplyOperation}
            onDeleteNode={(nodeId) => {
              handleApplyOperation({ op: 'remove_node', node_id: nodeId });
              setSelectedNodeId(null);
            }}
          />
        )}
      </div>
    </div>
  );
};

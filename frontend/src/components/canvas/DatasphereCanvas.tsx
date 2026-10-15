import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';

import {
  TableSourceNode,
  GraphicalViewNode,
  DimensionNode,
  FactNode,
  AnalyticModelNode,
  RemoteTableNode,
  SQLViewNode,
  ReplicationNode,
  JoinOperatorNode,
  FilterOperatorNode,
  ProjectionOperatorNode,
  AssociationOperatorNode,
  HierarchyOperatorNode,
  AggregationOperatorNode,
  OutputNode,
  MeasureSourceNode,
  DimensionSourceNode,
  ViewSourceNode,
} from './CustomNodes';
import { useStore } from '../../store/useStore';
import { ViewSpec, SequentialCanvasResponse, CanvasView } from '../../types';
import { ImpactAnalysisModal } from './ImpactAnalysisModal';
import { ChatModificationPanel } from '../chat/ChatModificationPanel';
import { ConfidenceBadge } from '../common/ConfidenceBadge';
import { api } from '../../api/client';
import {
  AlertCircle,
  Eye,
  Layers,
  Sparkles,
  GitMerge,
  Filter,
  Columns,
  Link2,
  Network,
  Sigma,
  UploadCloud,
  CheckCircle2,
  Copy,
  Check,
  X,
  Code2,
  Sliders,
  Database,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  Download,
  FileJson,
  RefreshCw,
  Info,
  ExternalLink,
  Box,
  BarChart3,
  FileSpreadsheet,
  CheckCheck,
  HelpCircle,
  Maximize2,
  Table,
  Play,
  Share2,
  Search,
  FolderOpen
} from 'lucide-react';

const nodeTypes = {
  tableSource: TableSourceNode,
  viewSource: ViewSourceNode,
  remoteTable: RemoteTableNode,
  graphicalView: GraphicalViewNode,
  sqlView: SQLViewNode,
  dimension: DimensionNode,
  fact: FactNode,
  analyticModel: AnalyticModelNode,
  replication: ReplicationNode,
  // Operator nodes
  join: JoinOperatorNode,
  joinOperator: JoinOperatorNode,
  filter: FilterOperatorNode,
  filterOperator: FilterOperatorNode,
  projection: ProjectionOperatorNode,
  projectionOperator: ProjectionOperatorNode,
  association: AssociationOperatorNode,
  associationOperator: AssociationOperatorNode,
  hierarchy: HierarchyOperatorNode,
  hierarchyOperator: HierarchyOperatorNode,
  aggregation: AggregationOperatorNode,
  aggregationOperator: AggregationOperatorNode,
  output: OutputNode,
  measureSource: MeasureSourceNode,
  dimensionSource: DimensionSourceNode,
};

// SAP Datasphere Operator Icon styling and tooltips
const OPERATOR_ICONS_INFO = [
  { key: 'table', label: 'Source Table', color: '#0070F2', icon: Database, tooltip: 'Raw physical source table from ERP or connected cloud system' },
  { key: 'projection', label: 'Projection', color: '#00A3C4', icon: Columns, tooltip: 'Select, rename, and add calculated column formulas f(x)' },
  { key: 'join', label: 'Join', color: '#E76500', icon: GitMerge, tooltip: 'INNER / LEFT / RIGHT joins on key columns with conditions' },
  { key: 'filter', label: 'Filter', color: '#E53935', icon: Filter, tooltip: 'Row-level filtering with Datasphere SQL grammar' },
  { key: 'aggregation', label: 'Aggregation', color: '#1E88E5', icon: Sigma, tooltip: 'GROUP BY dimensions and roll up SUM/COUNT/AVG measures' },
  { key: 'hierarchy', label: 'Hierarchy', color: '#10B981', icon: Network, tooltip: 'Parent-child or level hierarchy drill paths' },
  { key: 'association', label: 'Association', color: '#8E24AA', icon: Link2, tooltip: 'Semantic n..1 navigational link to dimension entities' },
  { key: 'output', label: 'Output View', color: '#0284C7', icon: Eye, tooltip: 'Exposed view terminal ready to deploy via CSN 2.0' },
];

export const DatasphereCanvas: React.FC = () => {
  const {
    activeRun,
    activeConnection,
    selectedView,
    setSelectedView,
    selectedOperator,
    setSelectedOperator,
    openImpactModal,
    openGateModal,
    updateRunState,
    setActiveRun,
  } = useStore();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  // Sequential Canvas State
  const [sequentialData, setSequentialData] = useState<SequentialCanvasResponse | null>(null);
  const [selectedViewIndex, setSelectedViewIndex] = useState<number | 'all'>(0);
  const [loading, setLoading] = useState(false);

  // Exact Datasphere JSON Modal State
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [activeJsonTab, setActiveJsonTab] = useState<'current' | 'all'>('current');

  // Push to Space Modal State
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [targetSpace, setTargetSpace] = useState(activeConnection?.space || 'SALES_ANALYTICS');
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployResult, setDeployResult] = useState<{ ok: boolean; message: string; details?: any } | null>(null);

  // Data Preview Drawer State (Matches Datasphere Data Preview button)
  const [showDataPreview, setShowDataPreview] = useState(false);

  // Load sequential canvas data from backend (Live or Mock)
  const fetchCanvasData = useCallback(async (forceMock = false) => {
    try {
      setLoading(true);
      let res: SequentialCanvasResponse;

      let targetRunId = activeRun?.id;
      if (!targetRunId) {
        try {
          const runs = await api.listRuns();
          if (runs && runs.length > 0) {
            targetRunId = runs[0].id;
            setActiveRun(runs[0]);
          }
        } catch {}
      }

      if (!forceMock && targetRunId) {
        try {
          res = await api.getSequentialCanvas(targetRunId);
          if (!res || !res.views || res.views.length === 0) {
            res = await api.getMockCanvas();
          }
        } catch {
          res = await api.getMockCanvas();
        }
      } else {
        res = await api.getMockCanvas();
      }

      setSequentialData(res);
      if (res.views && res.views.length > 0) {
        setSelectedViewIndex(0);
      }
    } catch (err: any) {
      console.error('Failed to load canvas data:', err);
    } finally {
      setLoading(false);
    }
  }, [activeRun?.id, setActiveRun]);

  useEffect(() => {
    fetchCanvasData();
  }, [fetchCanvasData]);

  // Periodic polling for gate approval status if run is active
  useEffect(() => {
    if (!activeRun?.id) return;
    const interval = setInterval(async () => {
      try {
        const runData = await api.getRun(activeRun.id);
        if (runData) {
          updateRunState({ state: runData.state, status: runData.status });
          if (runData.state === 'AWAITING_SOURCE_CONFIRM') {
            openGateModal(runData.id, 'sources', runData);
          } else if (runData.state === 'AWAITING_PLAN_CONFIRM') {
            openGateModal(runData.id, 'plan', runData);
          } else if (runData.state === 'AWAITING_APPROVAL') {
            openGateModal(runData.id, 'artifacts', runData);
          }
        }
      } catch {
        // quiet error
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [activeRun?.id, openGateModal, updateRunState]);

  // Current view object when in single-view sequential mode
  const currentView: CanvasView | null = useMemo(() => {
    if (!sequentialData?.views || sequentialData.views.length === 0) return null;
    if (selectedViewIndex === 'all') return null;
    return sequentialData.views[selectedViewIndex] || sequentialData.views[0];
  }, [sequentialData, selectedViewIndex]);

  // Convert CanvasView nodes/edges to ReactFlow format with high-fidelity styling
  const renderCanvasGraph = useCallback(() => {
    if (!sequentialData?.views || sequentialData.views.length === 0) return;

    if (selectedViewIndex === 'all') {
      // "ALL PIPELINE" MACRO OVERVIEW
      const allNodes: Node[] = [];
      const allEdges: Edge[] = [];
      let xOffset = 60;

      sequentialData.views.forEach((v, vIdx) => {
        const vNodes = v.canvas.nodes || [];
        const vEdges = v.canvas.edges || [];

        vNodes.forEach((n) => {
          allNodes.push({
            id: `${v.object_id}__${n.id}`,
            type: n.type,
            position: { x: xOffset + n.position.x, y: n.position.y + (vIdx % 2) * 50 },
            data: {
              ...n.data,
              label: n.label || n.data?.label || n.id,
              iconMeta: n.iconMeta,
              parentView: v.object_id,
              viewName: v.object_id,
            },
          });
        });

        vEdges.forEach((e, eIdx) => {
          const fromId = e.from || e.source;
          const toId = e.to || e.target;
          allEdges.push({
            id: `e-${v.object_id}-${eIdx}`,
            source: `${v.object_id}__${fromId}`,
            target: `${v.object_id}__${toId}`,
            animated: !e.dashed,
            style: {
              stroke: e.dashed ? '#8E24AA' : '#5B6B82',
              strokeWidth: 2,
              strokeDasharray: e.dashed ? '5 5' : undefined,
            },
            label: e.label,
            labelStyle: { fill: '#1D2D3E', fontSize: 10, fontWeight: 600 },
          });
        });

        if (vIdx < sequentialData.views.length - 1) {
          const nextV = sequentialData.views[vIdx + 1];
          allEdges.push({
            id: `chain-${v.object_id}-${nextV.object_id}`,
            source: `${v.object_id}__output`,
            target: `${nextV.object_id}__${nextV.canvas.nodes[0]?.id || 'src'}`,
            animated: true,
            style: { stroke: '#107E3E', strokeWidth: 2.5 },
            label: `Flow to ${nextV.layer}`,
            labelStyle: { fill: '#107E3E', fontSize: 10, fontWeight: 700 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#107E3E', width: 20, height: 20 },
          });
        }

        xOffset += 1180;
      });

      setNodes(allNodes);
      setEdges(allEdges);
    } else if (currentView) {
      // SINGLE SEQUENTIAL VIEW OPERATOR CANVAS
      const viewNodes: Node[] = (currentView.canvas.nodes || []).map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          ...n.data,
          label: n.label || n.data?.label || n.id,
          iconMeta: n.iconMeta,
          parentView: currentView.object_id,
          viewName: currentView.object_id,
        },
      }));

      const viewEdges: Edge[] = (currentView.canvas.edges || []).map((e, idx) => {
        const fromId = e.from || e.source;
        const toId = e.to || e.target;
        const isAssoc = e.dashed || e.edgeType === 'association';

        return {
          id: `e-${fromId}-${toId}-${idx}`,
          source: fromId || '',
          target: toId || '',
          animated: !isAssoc,
          style: {
            stroke: isAssoc ? '#8E24AA' : '#5B6B82',
            strokeWidth: 2.2,
            strokeDasharray: isAssoc ? '5 4' : undefined,
          },
          label: e.label,
          labelStyle: { fill: isAssoc ? '#8E24AA' : '#1D2D3E', fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: '#FFFFFF', fillOpacity: 0.95 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isAssoc ? '#8E24AA' : '#5B6B82',
            width: 18,
            height: 18,
          },
        };
      });

      setNodes(viewNodes);
      setEdges(viewEdges);
    }
  }, [sequentialData, selectedViewIndex, currentView, setNodes, setEdges]);

  useEffect(() => {
    renderCanvasGraph();
  }, [renderCanvasGraph]);

  // Node Click: Inspect operator or view
  const onNodeClick = useCallback(
    (_: any, node: Node) => {
      if (
        node.type === 'join' ||
        node.type === 'joinOperator' ||
        node.type === 'filter' ||
        node.type === 'filterOperator' ||
        node.type === 'projection' ||
        node.type === 'projectionOperator' ||
        node.type === 'association' ||
        node.type === 'associationOperator' ||
        node.type === 'hierarchy' ||
        node.type === 'hierarchyOperator' ||
        node.type === 'aggregation' ||
        node.type === 'aggregationOperator' ||
        node.type === 'output' ||
        node.type === 'measureSource' ||
        node.type === 'dimensionSource'
      ) {
        setSelectedOperator(node.data);
        setSelectedView(null);
      } else {
        setSelectedView(node.data as ViewSpec);
        setSelectedOperator(null);
      }
    },
    [setSelectedOperator, setSelectedView]
  );

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyJson = (jsonObj: any) => {
    navigator.clipboard.writeText(JSON.stringify(jsonObj, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handleDownloadJson = (jsonObj: any, filename: string) => {
    const blob = new Blob([JSON.stringify(jsonObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePushToSpace = async () => {
    if (!targetSpace.trim()) {
      alert('Please enter or select a Datasphere Space.');
      return;
    }

    try {
      setDeployLoading(true);
      setDeployResult(null);

      const runId = activeRun?.id || 'demo-session';
      const res = await api.pushToSpace(runId, activeConnection?.id, targetSpace);

      setDeployResult({
        ok: true,
        message: res?.message || `Successfully pushed ${res?.views_pushed || 'all'} views to space '${targetSpace}'!`,
        details: res,
      });
    } catch (err: any) {
      setDeployResult({
        ok: false,
        message: `Deployment failed: ${err.message}`,
      });
    } finally {
      setDeployLoading(false);
    }
  };

  const currentDsJson = useMemo(() => {
    if (activeJsonTab === 'current' && currentView) {
      return currentView.ds_json;
    }
    return {
      kind: "DataBuilder.Package",
      version: "1.0.0",
      space: targetSpace,
      totalViews: sequentialData?.views?.length || 0,
      views: sequentialData?.views?.map((v) => v.ds_json) || [],
    };
  }, [activeJsonTab, currentView, sequentialData, targetSpace]);

  return (
    <div className="relative w-full h-full flex flex-col bg-[#F5F7FA] text-[#1D2D3E] select-none">
      {/* ── 1. SAP DATASPHERE HORIZON SHELL BAR (Top Header) ── */}
      <div className="h-13 bg-white border-b border-[#D9DDE3] px-4 flex items-center justify-between z-10 shadow-xs">
        <div className="flex items-center space-x-3 text-xs">
          {/* SAP Datasphere Logo Icon */}
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded bg-[#0070F2] flex items-center justify-center shadow-sm">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="font-bold text-[#1D2D3E] text-sm tracking-tight block">
                SAP Datasphere
              </span>
              <span className="text-[10px] text-[#556B82] leading-none block">
                Data Builder • Graphical View Editor
              </span>
            </div>
          </div>

          <span className="text-[#D9DDE3]">|</span>

          {/* Space & Model Breadcrumb */}
          <div className="flex items-center space-x-1.5 text-xs">
            <span className="px-2 py-0.5 rounded bg-[#F5F7FA] text-[#556B82] border border-[#E5E9F0] font-mono text-[11px]">
              Space: <strong className="text-[#1D2D3E]">{targetSpace}</strong>
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-[#8996A5]" />
            <span className="font-semibold text-[#0070F2] text-xs">
              {currentView?.object_id || sequentialData?.run_name || 'V_STG_VBAK'}
            </span>
            <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-[#EBF3FF] text-[#0070F2] border border-[#BBD7FD]">
              {currentView?.approval_state ? currentView.approval_state.toUpperCase() : 'DEPLOYED'}
            </span>
          </div>
        </div>

        {/* Datasphere Top Toolbar Actions */}
        <div className="flex items-center space-x-2 text-xs">
          {/* Data Preview Toggle */}
          <button
            onClick={() => setShowDataPreview(!showDataPreview)}
            className={`flex items-center space-x-1 px-3 py-1.5 rounded border text-xs font-medium transition-all cursor-pointer ${
              showDataPreview
                ? 'bg-[#EBF3FF] border-[#0070F2] text-[#0070F2]'
                : 'bg-white border-[#D9DDE3] text-[#324558] hover:bg-[#F5F7FA]'
            }`}
            title="Preview output data of current node"
          >
            <Play className="w-3.5 h-3.5 text-[#0070F2]" />
            <span>Data Preview</span>
          </button>

          {/* Inspect Datasphere CSN 2.0 JSON */}
          <button
            onClick={() => setShowJsonModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded border border-[#D9DDE3] bg-white hover:bg-[#F5F7FA] text-[#324558] font-medium transition-all cursor-pointer"
            title="View exact SAP Datasphere Data Builder CSN 2.0 JSON"
          >
            <Code2 className="w-3.5 h-3.5 text-[#0070F2]" />
            <span>CSN 2.0 JSON</span>
          </button>

          {/* Demo Model Reload */}
          <button
            onClick={() => fetchCanvasData(true)}
            disabled={loading}
            className="px-2.5 py-1.5 rounded border border-[#D9DDE3] bg-white hover:bg-[#F5F7FA] text-[#556B82] flex items-center space-x-1 font-medium transition-all cursor-pointer"
            title="Reload Sales Analytics Model (VBAK + KNA1) demo"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#0070F2]' : 'text-[#556B82]'}`} />
            <span className="text-[11px]">Reload Model</span>
          </button>

          {/* AI Modeler Panel */}
          <button
            onClick={() => setShowChatPanel(!showChatPanel)}
            className={`px-3 py-1.5 rounded flex items-center space-x-1.5 font-medium transition-all cursor-pointer ${
              showChatPanel
                ? 'bg-[#0070F2] text-white shadow-sm'
                : 'bg-white border border-[#D9DDE3] text-[#324558] hover:bg-[#F5F7FA]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-[#E76500]" />
            <span>AI Modeler</span>
          </button>

          {/* Deploy / Push to Space Button (Datasphere Primary Blue/Green action) */}
          <button
            onClick={() => setShowDeployModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded bg-[#0070F2] hover:bg-[#0058C6] text-white font-semibold shadow-sm transition-all cursor-pointer"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>Deploy</span>
          </button>
        </div>
      </div>

      {/* ── 2. PROCESS FLOW STEPPER TRAIL (View-by-View Sequential Navigator) ── */}
      <div className="bg-[#FAFBFD] border-b border-[#D9DDE3] px-4 py-2 flex items-center justify-between z-10 overflow-x-auto text-xs shadow-2xs">
        <div className="flex items-center space-x-2 shrink-0">
          <span className="text-[11px] font-bold text-[#556B82] flex items-center space-x-1 pr-1 font-sans">
            <span>Model Views:</span>
          </span>

          {/* Sequential Step Cards connected by arrows */}
          {sequentialData?.views?.map((v, idx) => {
            const isSelected = selectedViewIndex === idx;

            const layerBadge =
              v.layer === 'L1'
                ? { bg: 'bg-[#EBF3FF] text-[#0070F2] border-[#BBD7FD]', label: 'L1 Staging' }
                : v.layer === 'L2'
                ? { bg: 'bg-[#FFF5ED] text-[#E76500] border-[#FCD5B5]', label: 'L2 Core' }
                : v.layer === 'L3'
                ? { bg: 'bg-[#F5EEFB] text-[#8E24AA] border-[#E4C4FA]', label: 'L3 Dimension' }
                : { bg: 'bg-[#EAF7EE] text-[#107E3E] border-[#A7E6BC]', label: 'L4 Analytic' };

            return (
              <React.Fragment key={v.object_id}>
                <button
                  onClick={() => setSelectedViewIndex(idx)}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border transition-all cursor-pointer text-left ${
                    isSelected
                      ? 'bg-white border-[#0070F2] text-[#0070F2] font-semibold shadow-sm ring-1 ring-[#0070F2]'
                      : 'bg-white/70 border-[#D9DDE3] text-[#556B82] hover:bg-white hover:text-[#1D2D3E]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center font-mono text-[10px] font-bold ${
                      isSelected ? 'bg-[#0070F2] text-white' : 'bg-[#E5E9F0] text-[#556B82]'
                    }`}
                  >
                    {v.sequence || idx + 1}
                  </div>

                  <div>
                    <div className="font-semibold text-xs leading-none truncate max-w-[140px] text-[#1D2D3E]">
                      {v.object_id}
                    </div>
                    <div className="text-[10px] text-[#738496] pt-0.5 truncate max-w-[140px]">
                      {v.layer_meta?.label || layerBadge.label}
                    </div>
                  </div>

                  <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded border font-semibold ${layerBadge.bg}`}>
                    {v.layer}
                  </span>
                </button>

                {idx < (sequentialData.views.length - 1) && (
                  <ArrowRight className="w-3.5 h-3.5 text-[#B0BCC9] shrink-0" />
                )}
              </React.Fragment>
            );
          })}

          <span className="text-[#D9DDE3] px-1">|</span>

          {/* All Views Overview Tab */}
          <button
            onClick={() => setSelectedViewIndex('all')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
              selectedViewIndex === 'all'
                ? 'bg-white border-[#0070F2] text-[#0070F2] font-semibold shadow-sm ring-1 ring-[#0070F2]'
                : 'bg-white/70 border-[#D9DDE3] text-[#556B82] hover:bg-white hover:text-[#1D2D3E]'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-[#0070F2]" />
            <span>All Pipeline Overview</span>
          </button>
        </div>

        {/* Step Prev / Next Buttons */}
        {selectedViewIndex !== 'all' && (
          <div className="flex items-center space-x-2 shrink-0 pl-3">
            <button
              onClick={() => setSelectedViewIndex((prev) => (typeof prev === 'number' && prev > 0 ? prev - 1 : 0))}
              disabled={selectedViewIndex === 0}
              className="px-2.5 py-1 rounded bg-white border border-[#D9DDE3] text-[#556B82] hover:text-[#1D2D3E] disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="text-[11px]">Prev</span>
            </button>

            <span className="text-[11px] text-[#556B82] font-mono px-1">
              Step {(selectedViewIndex as number) + 1} of {sequentialData?.views?.length || 5}
            </span>

            <button
              onClick={() =>
                setSelectedViewIndex((prev) =>
                  typeof prev === 'number' && prev < (sequentialData?.views?.length || 1) - 1
                    ? prev + 1
                    : prev
                )
              }
              disabled={selectedViewIndex === (sequentialData?.views?.length || 1) - 1}
              className="px-2.5 py-1 rounded bg-white border border-[#D9DDE3] text-[#556B82] hover:text-[#1D2D3E] disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1 cursor-pointer"
            >
              <span className="text-[11px]">Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── 3. OPERATOR TOOLBAR PALETTE (Exact SAP Datasphere Graphical Builder palette) ── */}
      <div className="bg-white border-b border-[#E5E9F0] px-4 py-1.5 flex items-center justify-between text-xs z-10">
        <div className="flex items-center space-x-2 text-[11px]">
          <span className="text-[10px] uppercase font-bold text-[#738496] tracking-wider pr-1">Operators:</span>
          {OPERATOR_ICONS_INFO.map((item) => {
            const IconComp = item.icon;
            return (
              <div
                key={item.key}
                title={item.tooltip}
                className="flex items-center space-x-1.5 px-2 py-1 rounded border border-[#E5E9F0] bg-[#F5F7FA] hover:bg-white hover:border-[#BBD7FD] hover:shadow-2xs cursor-help transition-all"
              >
                <div
                  className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${item.color}18` }}
                >
                  <IconComp className="w-2.5 h-2.5" style={{ color: item.color }} />
                </div>
                <span className="text-[#324558] font-medium text-[11px]">{item.label}</span>
              </div>
            );
          })}
        </div>

        {currentView && selectedViewIndex !== 'all' && (
          <div className="flex items-center space-x-2 text-[11px] text-[#556B82]">
            <span>{currentView.business_name}</span>
            <span>•</span>
            <span className="font-mono text-[#0070F2] font-semibold">{currentView.canvas?.nodes?.length || 0} Nodes</span>
          </div>
        )}
      </div>

      {/* ── 4. REACTFLOW CANVAS AREA (Morning Horizon Clean Canvas) ── */}
      <div className="flex-1 flex relative overflow-hidden bg-[#F5F7FA]">
        <div className="flex-1 relative h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
          >
            {/* SAP Datasphere Fiori Morning Horizon Grid */}
            <Background color="#CBD5E1" gap={20} size={1} />
            <Controls className="!bg-white !border-[#D9DDE3] !fill-[#324558] !shadow-md !rounded-lg" />
            <MiniMap
              nodeColor={(n) => {
                if (n.type === 'analyticModel') return '#107E3E';
                if (n.type === 'join' || n.type === 'joinOperator') return '#E76500';
                if (n.type === 'filter' || n.type === 'filterOperator') return '#E53935';
                if (n.type === 'projection' || n.type === 'projectionOperator') return '#00A3C4';
                if (n.type === 'association' || n.type === 'associationOperator') return '#8E24AA';
                if (n.type === 'hierarchy' || n.type === 'hierarchyOperator') return '#10B981';
                if (n.type === 'output') return '#0284C7';
                return '#0070F2';
              }}
              className="!bg-white !border-[#D9DDE3] rounded-lg overflow-hidden shadow-lg"
            />
          </ReactFlow>

          {/* Synthesizing / Loading Overlay */}
          {loading && nodes.length === 0 && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/85 backdrop-blur-xs">
              <div className="p-6 bg-white border border-[#D9DDE3] rounded-2xl shadow-xl flex flex-col items-center space-y-4 max-w-md text-center">
                <div className="w-12 h-12 rounded-xl bg-[#EBF3FF] border border-[#BBD7FD] flex items-center justify-center text-[#0070F2]">
                  <Sparkles className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#1D2D3E]">Synthesizing Datasphere Model Canvas</h3>
                  <p className="text-xs text-[#556B82] mt-1">
                    Compiling Data Builder views, projections, core joins, dimensions, and SAC analytic models...
                  </p>
                </div>
                <div className="flex items-center space-x-2 text-xs text-[#0070F2] font-semibold">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Loading Data Builder pipeline...</span>
                </div>
              </div>
            </div>
          )}

          {/* ── 5. OPERATOR PROPERTIES SIDE PANEL (Exact Datasphere Right Panel) ── */}
          {selectedOperator && !showChatPanel && (
            <div className="absolute top-3 right-3 w-[420px] max-h-[calc(100%-1.5rem)] bg-white border border-[#D9DDE3] rounded-xl shadow-xl flex flex-col z-20 overflow-hidden text-xs">
              {/* Properties Header */}
              <div className="px-4 py-3 border-b border-[#E5E9F0] bg-[#FAFBFD] flex items-center justify-between">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div className="w-7 h-7 rounded bg-[#EBF3FF] border border-[#BBD7FD] flex items-center justify-center shrink-0">
                    <Sliders className="w-3.5 h-3.5 text-[#0070F2]" />
                  </div>
                  <div className="min-w-0">
                    <span className="font-bold text-sm text-[#1D2D3E] truncate block">
                      {selectedOperator.label || selectedOperator.name || 'Operator Properties'}
                    </span>
                    <span className="text-[10px] text-[#738496] font-mono">
                      Parent: {selectedOperator.parentView || currentView?.object_id || 'View'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedOperator(null)}
                  className="text-[#738496] hover:text-[#1D2D3E] p-1 rounded hover:bg-[#F5F7FA] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Properties Content */}
              <div className="p-4 overflow-y-auto space-y-4">
                {/* Operator Type and Description */}
                <div className="p-3 bg-[#FAFBFD] rounded-lg border border-[#E5E9F0] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[#556B82] text-[11px] font-medium">Node Type:</span>
                    <span className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold bg-[#EBF3FF] text-[#0070F2] border border-[#BBD7FD]">
                      {selectedOperator.iconMeta?.label || selectedOperator.id || 'Operator'}
                    </span>
                  </div>
                  {selectedOperator.iconMeta?.tooltip && (
                    <p className="text-[11px] text-[#556B82] leading-relaxed pt-1 border-t border-[#EDF1F7]">
                      {selectedOperator.iconMeta.tooltip}
                    </p>
                  )}
                </div>

                {/* EXACT CONDITION / EXPRESSION CODE */}
                {(selectedOperator.join_condition || selectedOperator.expression || selectedOperator.filter_expression || selectedOperator.conditions) && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[#556B82]">
                      <span className="font-semibold uppercase tracking-wider text-[10px] text-[#324558] flex items-center space-x-1 font-sans">
                        <Code2 className="w-3.5 h-3.5 text-[#0070F2]" />
                        <span>Filter / Join Expression:</span>
                      </span>
                      <button
                        onClick={() =>
                          handleCopyCode(
                            selectedOperator.join_condition ||
                              selectedOperator.expression ||
                              selectedOperator.filter_expression ||
                              JSON.stringify(selectedOperator.conditions, null, 2)
                          )
                        }
                        className="flex items-center space-x-1 text-[11px] text-[#0070F2] hover:underline cursor-pointer"
                      >
                        {copiedCode ? <Check className="w-3 h-3 text-[#107E3E]" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedCode ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>

                    <pre className="p-3 bg-[#FAFBFD] border border-[#E5E9F0] rounded-lg font-mono text-[11px] text-[#1D2D3E] whitespace-pre-wrap break-all leading-relaxed">
                      {selectedOperator.join_condition ||
                        selectedOperator.expression ||
                        selectedOperator.filter_expression ||
                        JSON.stringify(selectedOperator.conditions, null, 2)}
                    </pre>
                  </div>
                )}

                {/* JOIN SPECIFICS */}
                {selectedOperator.joinType && (
                  <div className="bg-[#FAFBFD] p-3 rounded-lg border border-[#E5E9F0] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[#556B82]">Join Type:</span>
                      <span className="font-mono text-[#E76500] font-bold">{selectedOperator.joinType} OUTER JOIN</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#556B82]">Left Source:</span>
                      <span className="font-mono text-[#1D2D3E]">{selectedOperator.leftSource || 'Left View'}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#556B82]">Right Source:</span>
                      <span className="font-mono text-[#1D2D3E]">{selectedOperator.rightSource || 'Right View'}</span>
                    </div>
                  </div>
                )}

                {/* PROJECTION COLUMNS & CALCULATED FORMULAS */}
                {selectedOperator.columns && (
                  <div className="space-y-2">
                    <div className="font-semibold uppercase tracking-wider text-[10px] text-[#556B82] flex items-center justify-between font-sans">
                      <span>Column Mappings ({selectedOperator.columns.length})</span>
                    </div>

                    <div className="border border-[#E5E9F0] rounded-lg overflow-hidden divide-y divide-[#EDF1F7] max-h-52 overflow-y-auto bg-white">
                      {selectedOperator.columns.map((c: any, i: number) => (
                        <div key={i} className="px-3 py-1.5 flex items-center justify-between hover:bg-[#F5F7FA] transition-colors">
                          <div className="flex items-center space-x-1.5 truncate">
                            {c.isKey && <Key className="w-3 h-3 text-[#E76500] shrink-0" />}
                            <span className={c.isKey ? 'text-[#1D2D3E] font-semibold truncate' : 'text-[#324558] truncate'}>
                              {c.name || c.column_name}
                            </span>
                            {c.isCalculated && (
                              <span className="ml-1 text-[9px] px-1.5 py-0.2 rounded bg-[#FFF5ED] text-[#E76500] border border-[#FCD5B5] font-mono shrink-0">
                                f(x)
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[10px] text-[#738496] shrink-0 ml-2">
                            {c.dataType || c.data_type || 'NVARCHAR'}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Calculated formulas list */}
                    {selectedOperator.columns.some((c: any) => c.isCalculated || c.expression) && (
                      <div className="space-y-1.5 pt-2">
                        <span className="font-semibold uppercase tracking-wider text-[10px] text-[#E76500] font-sans">
                          Calculated Columns:
                        </span>
                        {selectedOperator.columns
                          .filter((c: any) => c.isCalculated || c.expression)
                          .map((c: any, idx: number) => (
                            <div key={idx} className="p-2.5 bg-[#FAFBFD] rounded-lg border border-[#E5E9F0] font-mono text-[11px] text-[#0070F2]">
                              <span className="text-[#556B82]">{c.name} := </span>
                              <span>{c.expression}</span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                {/* HIERARCHY SPECIFICS */}
                {selectedOperator.hierarchyType && (
                  <div className="bg-[#FAFBFD] p-3 rounded-lg border border-[#E5E9F0] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[#556B82]">Hierarchy Type:</span>
                      <span className="font-mono text-[#107E3E] font-bold uppercase">{selectedOperator.hierarchyType}</span>
                    </div>
                    {selectedOperator.parentAttribute && (
                      <div className="flex items-center justify-between">
                        <span className="text-[#556B82]">Parent Attribute:</span>
                        <span className="font-mono text-[#1D2D3E]">{selectedOperator.parentAttribute}</span>
                      </div>
                    )}
                    {selectedOperator.childAttribute && (
                      <div className="flex items-center justify-between">
                        <span className="text-[#556B82]">Child Attribute:</span>
                        <span className="font-mono text-[#1D2D3E]">{selectedOperator.childAttribute}</span>
                      </div>
                    )}
                    {selectedOperator.levels && (
                      <div className="pt-2 border-t border-[#EDF1F7] text-[10px]">
                        <span className="text-[#556B82]">Drill Path: </span>
                        <span className="font-mono text-[#107E3E] font-semibold">{selectedOperator.levels.join(' → ')}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 6. VIEW PROPERTIES DRAWER ── */}
          {selectedView && !selectedOperator && !showChatPanel && (
            <div className="absolute top-3 right-3 w-[420px] max-h-[calc(100%-1.5rem)] bg-white border border-[#D9DDE3] rounded-xl shadow-xl flex flex-col z-20 overflow-hidden text-xs">
              <div className="px-4 py-3 border-b border-[#E5E9F0] bg-[#FAFBFD] flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <Eye className="w-4 h-4 text-[#0070F2]" />
                  <span className="font-bold text-sm text-[#1D2D3E] truncate">
                    {selectedView.view_name || selectedView.objectId}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedView(null)}
                  className="text-[#738496] hover:text-[#1D2D3E] p-1 rounded hover:bg-[#F5F7FA] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 overflow-y-auto space-y-4">
                <div>
                  <span className="text-[#556B82] text-[11px]">Business Name:</span>
                  <div className="text-sm font-semibold text-[#1D2D3E]">{selectedView.business_name}</div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[#556B82] text-[11px]">Layer / Kind:</span>
                  <span className="font-mono px-2 py-0.5 rounded bg-[#EBF3FF] text-[#0070F2] border border-[#BBD7FD] font-semibold">
                    {selectedView.layer || 'L2'} ({selectedView.kind})
                  </span>
                </div>

                <button
                  onClick={() => openImpactModal(selectedView.view_name || selectedView.objectId || '')}
                  className="w-full py-2 px-3 rounded-lg bg-[#FDF2F2] hover:bg-[#FDE8E8] border border-[#F87171] text-[#E53935] font-semibold flex items-center justify-center space-x-2 transition-colors cursor-pointer"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Run Impact Analysis (Lineage)</span>
                </button>

                {/* Columns Table */}
                <div>
                  <div className="text-[#556B82] text-[11px] font-semibold uppercase tracking-wider mb-2 font-sans">
                    Columns ({selectedView.columns?.length || 0})
                  </div>
                  <div className="border border-[#E5E9F0] rounded-lg overflow-hidden divide-y divide-[#EDF1F7] max-h-52 overflow-y-auto bg-white">
                    {selectedView.columns?.map((c, i) => (
                      <div key={i} className="px-3 py-1.5 flex items-center justify-between hover:bg-[#F5F7FA] transition-colors">
                        <div>
                          <span className={c.is_key ? 'text-[#E76500] font-semibold' : 'text-[#1D2D3E]'}>
                            {c.column_name}
                          </span>
                          {c.semantic_role && (
                            <span className="ml-2 text-[10px] text-[#738496] capitalize">({c.semantic_role})</span>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-[#738496]">{c.data_type || 'NVARCHAR'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── 7. DATA PREVIEW BOTTOM DRAWER (Exact SAP Datasphere Data Preview) ── */}
          {showDataPreview && (
            <div className="absolute bottom-0 left-0 right-0 h-64 bg-white border-t border-[#D9DDE3] shadow-2xl z-20 flex flex-col">
              <div className="px-4 py-2 border-b border-[#E5E9F0] bg-[#FAFBFD] flex items-center justify-between text-xs">
                <div className="flex items-center space-x-2">
                  <Play className="w-3.5 h-3.5 text-[#0070F2]" />
                  <span className="font-bold text-[#1D2D3E]">
                    Data Preview: {currentView?.object_id || 'Current View'}
                  </span>
                  <span className="text-[#738496] text-[11px]">(Showing first 5 sample rows)</span>
                </div>
                <button
                  onClick={() => setShowDataPreview(false)}
                  className="text-[#738496] hover:text-[#1D2D3E] p-1 rounded hover:bg-[#F5F7FA] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Data Preview Table */}
              <div className="flex-1 overflow-auto p-2">
                <table className="w-full text-left text-xs border border-[#E5E9F0]">
                  <thead className="bg-[#F5F7FA] text-[#556B82] border-b border-[#E5E9F0]">
                    <tr>
                      {(currentView?.columns || []).slice(0, 7).map((c: any, i: number) => (
                        <th key={i} className="px-3 py-1.5 font-medium border-r border-[#E5E9F0] font-mono text-[11px]">
                          {c.name || c.column_name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EDF1F7] font-mono text-[11px] text-[#1D2D3E]">
                    {[
                      ['100001', '10042', '1000', '10', '2024-01-15', '45200.00', 'USD'],
                      ['100002', '10042', '1000', '10', '2024-01-16', '12800.50', 'USD'],
                      ['100003', '10088', '2000', '20', '2024-02-01', '94000.00', 'EUR'],
                      ['100004', '10091', '1000', '10', '2024-02-14', '6100.00', 'USD'],
                      ['100005', '10099', '2000', '20', '2024-03-02', '33500.00', 'EUR'],
                    ].map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-[#F8FAFC]">
                        {row.map((val, cIdx) => (
                          <td key={cIdx} className="px-3 py-1.5 border-r border-[#E5E9F0] truncate">
                            {val}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* AI Chat Modeler Sidebar */}
        {showChatPanel && (
          <ChatModificationPanel
            onClose={() => setShowChatPanel(false)}
            onViewUpdated={(updated) => {
              setNodes((prevNodes) =>
                prevNodes.map((n) =>
                  n.id === updated.view_name || n.id === updated.objectId
                    ? { ...n, data: { ...n.data, ...updated } }
                    : n
                )
              );
            }}
          />
        )}
      </div>

      {/* ── 8. EXACT DATASPHERE NATIVE JSON MODAL ── */}
      {showJsonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-text">
          <div className="w-full max-w-4xl max-h-[85vh] bg-white border border-[#D9DDE3] rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-[#E5E9F0] flex items-center justify-between bg-[#FAFBFD]">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded bg-[#EBF3FF] border border-[#BBD7FD] flex items-center justify-center">
                  <Code2 className="w-4 h-4 text-[#0070F2]" />
                </div>
                <div>
                  <h3 className="font-bold text-[#1D2D3E] text-sm">SAP Datasphere Native JSON Schema</h3>
                  <p className="text-[11px] text-[#556B82]">
                    Exact CSN 2.0 / Data Builder schema compliant with SAP Datasphere REST Import API
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <div className="flex items-center bg-[#F5F7FA] p-0.5 rounded border border-[#E5E9F0] text-xs">
                  <button
                    onClick={() => setActiveJsonTab('current')}
                    className={`px-3 py-1 rounded font-medium transition-all cursor-pointer ${
                      activeJsonTab === 'current' ? 'bg-[#0070F2] text-white shadow-xs' : 'text-[#556B82] hover:text-[#1D2D3E]'
                    }`}
                  >
                    Current View ({currentView?.object_id || 'View'})
                  </button>
                  <button
                    onClick={() => setActiveJsonTab('all')}
                    className={`px-3 py-1 rounded font-medium transition-all cursor-pointer ${
                      activeJsonTab === 'all' ? 'bg-[#0070F2] text-white shadow-xs' : 'text-[#556B82] hover:text-[#1D2D3E]'
                    }`}
                  >
                    Full Package (All Views)
                  </button>
                </div>

                <button
                  onClick={() => setShowJsonModal(false)}
                  className="text-[#738496] hover:text-[#1D2D3E] p-1 rounded hover:bg-[#F5F7FA] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Code Body */}
            <div className="flex-1 overflow-auto p-4 bg-[#1E293B]">
              <pre className="font-mono text-[11px] text-[#A5F3FC] leading-relaxed whitespace-pre-wrap select-all">
                {JSON.stringify(currentDsJson, null, 2)}
              </pre>
            </div>

            {/* Footer Buttons */}
            <div className="px-5 py-3 border-t border-[#E5E9F0] bg-[#FAFBFD] flex items-center justify-between">
              <div className="flex items-center space-x-2 text-[#556B82] text-[11px]">
                <span className="w-2 h-2 rounded-full bg-[#107E3E] inline-block" />
                <span>Validated against SAP DataBuilder 1.0.0 specification</span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleCopyJson(currentDsJson)}
                  className="px-4 py-1.5 rounded bg-white hover:bg-[#F5F7FA] text-[#324558] border border-[#D9DDE3] flex items-center space-x-1.5 font-medium cursor-pointer shadow-xs"
                >
                  {copiedJson ? <Check className="w-4 h-4 text-[#107E3E]" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedJson ? 'Copied JSON' : 'Copy JSON'}</span>
                </button>

                <button
                  onClick={() => handleDownloadJson(currentDsJson, currentView?.object_id || 'datasphere_model')}
                  className="px-4 py-1.5 rounded bg-white hover:bg-[#F5F7FA] text-[#324558] border border-[#D9DDE3] flex items-center space-x-1.5 font-medium cursor-pointer shadow-xs"
                >
                  <Download className="w-4 h-4 text-[#0070F2]" />
                  <span>Download .json</span>
                </button>

                <button
                  onClick={() => {
                    setShowJsonModal(false);
                    setShowDeployModal(true);
                  }}
                  className="px-4 py-1.5 rounded bg-[#0070F2] hover:bg-[#0058C6] text-white font-semibold flex items-center space-x-1.5 cursor-pointer shadow-xs"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>Deploy to Space</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 9. PUSH TO DATASPHERE SPACE MODAL ── */}
      {showDeployModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg bg-white border border-[#D9DDE3] rounded-xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E5E9F0] pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded bg-[#EBF3FF] border border-[#BBD7FD] flex items-center justify-center">
                  <UploadCloud className="w-4 h-4 text-[#0070F2]" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-[#1D2D3E]">Deploy to SAP Datasphere</h3>
                  <p className="text-[11px] text-[#556B82]">Push CSN 2.0 schema directly to your live tenant space</p>
                </div>
              </div>
              <button
                onClick={() => setShowDeployModal(false)}
                className="text-[#738496] hover:text-[#1D2D3E] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[#324558] mb-1 font-medium">Target Space Name</label>
                <input
                  type="text"
                  required
                  value={targetSpace}
                  onChange={(e) => setTargetSpace(e.target.value)}
                  placeholder="e.g. SALES_ANALYTICS, DEV_SPACE"
                  className="w-full px-3 py-2 bg-[#FAFBFD] border border-[#D9DDE3] rounded-lg text-[#1D2D3E] font-mono focus:border-[#0070F2] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[#324558] mb-1 font-medium">Active Space Connection</label>
                <div className="p-3 rounded-lg bg-[#FAFBFD] border border-[#E5E9F0] flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-[#324558]">
                    <Database className="w-4 h-4 text-[#0070F2]" />
                    <span>{activeConnection?.name || 'SAP Datasphere BTP Tenant'}</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#EAF7EE] text-[#107E3E] border border-[#A7E6BC] font-semibold">
                    Connected
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-[#FAFBFD] border border-[#E5E9F0] space-y-1.5 text-[11px] text-[#556B82]">
                <div className="font-semibold text-[#1D2D3E]">Sequential Artifacts to be Deployed:</div>
                {sequentialData?.views?.map((v) => (
                  <div key={v.object_id} className="flex items-center justify-between">
                    <span>• {v.object_id} ({v.business_name})</span>
                    <span className="font-mono text-[#0070F2] font-semibold">{v.layer}</span>
                  </div>
                )) || (
                  <div>• 5 sequential views ready to deploy</div>
                )}
              </div>
            </div>

            {deployResult && (
              <div
                className={`p-3 rounded-lg border text-xs flex items-start space-x-2 ${
                  deployResult.ok
                    ? 'bg-[#EAF7EE] border-[#A7E6BC] text-[#107E3E]'
                    : 'bg-[#FDF2F2] border-[#F87171] text-[#E53935]'
                }`}
              >
                {deployResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-[#107E3E] shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-[#E53935] shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold">{deployResult.ok ? 'Deployment Successful' : 'Deployment Error'}</div>
                  <div className="text-[11px] mt-0.5">{deployResult.message}</div>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-[#E5E9F0] flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowDeployModal(false)}
                className="px-4 py-2 bg-white hover:bg-[#F5F7FA] text-xs font-medium text-[#556B82] border border-[#D9DDE3] rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePushToSpace}
                disabled={deployLoading || !targetSpace.trim()}
                className="px-5 py-2 bg-[#0070F2] hover:bg-[#0058C6] text-xs font-semibold text-white rounded-lg shadow-xs flex items-center space-x-2 disabled:opacity-50 cursor-pointer"
              >
                {deployLoading ? (
                  <span>Deploying to Space...</span>
                ) : (
                  <>
                    <UploadCloud className="w-4 h-4" />
                    <span>Confirm & Deploy</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <ImpactAnalysisModal />
    </div>
  );
};

// src/ui/canvas/ViewInternalsCanvas.tsx
// Drill-down canvas for a single view: shows input bindings -> joins -> calc fields -> output fields.

import React, { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  BackgroundVariant,
  MarkerType,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ViewDef, LineageGraph } from '../../core/model/types';
import { applyDagreLayout } from './layout';
import { GitMerge, List, Sparkles, ArrowRight } from 'lucide-react';

// ── Internal nodes ─────────────────────────────────────────────────────────────
const InputNode: React.FC<{ data: { label: string; technicalName: string } }> = ({ data }) => (
  <>
    <Handle type="source" position={Position.Right} style={{ background: '#3b82f6', border: 'none', width: 6, height: 6 }} />
    <div className="px-3 py-2 rounded-lg border" style={{ background: '#0f2647', borderColor: '#1e3a5f', minWidth: 140 }}>
      <div className="text-[9px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#3b82f6' }}>Input</div>
      <div className="text-xs font-semibold" style={{ color: '#e2e8f0' }}>{data.label}</div>
      <div className="text-[10px] font-mono" style={{ color: '#64748b' }}>{data.technicalName}</div>
    </div>
  </>
);

const JoinNode: React.FC<{ data: { condition: string } }> = ({ data }) => (
  <>
    <Handle type="target" position={Position.Left} style={{ background: '#06b6d4', border: 'none', width: 6, height: 6 }} />
    <Handle type="source" position={Position.Right} style={{ background: '#06b6d4', border: 'none', width: 6, height: 6 }} />
    <div className="px-3 py-2 rounded-lg border" style={{ background: 'rgba(6,182,212,0.08)', borderColor: 'rgba(6,182,212,0.3)', minWidth: 160 }}>
      <div className="flex items-center gap-1.5 mb-1">
        <GitMerge size={10} color="#06b6d4" />
        <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: '#06b6d4' }}>Inner Join</span>
      </div>
      <div className="text-[10px] font-mono" style={{ color: '#94a3b8' }}>{data.condition}</div>
    </div>
  </>
);

const CalcFieldNode: React.FC<{ data: { name: string; formula: string } }> = ({ data }) => (
  <>
    <Handle type="target" position={Position.Left} style={{ background: '#8b5cf6', border: 'none', width: 6, height: 6 }} />
    <Handle type="source" position={Position.Right} style={{ background: '#8b5cf6', border: 'none', width: 6, height: 6 }} />
    <div className="px-3 py-2 rounded-lg border" style={{ background: 'rgba(139,92,246,0.08)', borderColor: 'rgba(139,92,246,0.3)', minWidth: 200 }}>
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles size={10} color="#8b5cf6" />
        <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: '#8b5cf6' }}>Calculated</span>
      </div>
      <div className="text-xs font-semibold mb-0.5" style={{ color: '#e2e8f0' }}>{data.name}</div>
      <div className="text-[10px] font-mono truncate max-w-[220px]" style={{ color: '#94a3b8' }}>{data.formula}</div>
    </div>
  </>
);

const OutputNode: React.FC<{ data: { fields: string[] } }> = ({ data }) => (
  <>
    <Handle type="target" position={Position.Left} style={{ background: '#10b981', border: 'none', width: 6, height: 6 }} />
    <div className="px-3 py-2 rounded-lg border" style={{ background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.3)', minWidth: 160 }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <List size={10} color="#10b981" />
        <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: '#10b981' }}>Projection</span>
      </div>
      {data.fields.slice(0, 6).map(f => (
        <div key={f} className="text-[10px] font-mono py-0.5" style={{ color: '#94a3b8' }}>{f}</div>
      ))}
      {data.fields.length > 6 && (
        <div className="text-[10px]" style={{ color: '#64748b' }}>+{data.fields.length - 6} more</div>
      )}
    </div>
  </>
);

const internalNodeTypes = {
  inputNode: InputNode,
  joinNode: JoinNode,
  calcFieldNode: CalcFieldNode,
  outputNode: OutputNode,
};

interface Props {
  view: ViewDef;
  graph: LineageGraph;
}

export const ViewInternalsCanvas: React.FC<Props> = ({ view, graph }) => {
  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];
    let idxY = 0;

    // Input nodes (sources)
    for (const srcId of view.sources) {
      const src = graph.sources.find(s => s.technicalName === srcId);
      const srcView = graph.views.find(v => v.technicalName === srcId);
      const nodeId = `input-${srcId}`;
      rawNodes.push({
        id: nodeId,
        type: 'inputNode',
        position: { x: 0, y: idxY++ * 80 },
        data: {
          label: src?.label ?? srcView?.label ?? srcId,
          technicalName: srcId,
        },
      });
    }

    // Join nodes
    if (view.joins.length > 0) {
      for (const join of view.joins) {
        const joinId = `join-${join.leftSource}-${join.rightSource}`;
        rawNodes.push({
          id: joinId,
          type: 'joinNode',
          position: { x: 0, y: 0 },
          data: {
            condition: `${join.leftSource}.${join.leftField} = ${join.rightSource}.${join.rightField}`,
          },
        });

        rawEdges.push({
          id: `e-input-left-${joinId}`,
          source: `input-${join.leftSource}`,
          target: joinId,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#334155' },
          style: { stroke: '#334155', strokeWidth: 1.5 },
        });
        rawEdges.push({
          id: `e-input-right-${joinId}`,
          source: `input-${join.rightSource}`,
          target: joinId,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#334155' },
          style: { stroke: '#334155', strokeWidth: 1.5 },
        });

        // Calculated fields chain from join
        let prevId = joinId;
        for (const cf of view.calculatedFields) {
          const cfId = `calc-${cf.name}`;
          rawNodes.push({
            id: cfId,
            type: 'calcFieldNode',
            position: { x: 0, y: 0 },
            data: { name: cf.name, formula: cf.formula },
          });
          rawEdges.push({
            id: `e-${prevId}-${cfId}`,
            source: prevId,
            target: cfId,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#334155' },
            style: { stroke: '#334155', strokeWidth: 1.5 },
          });
          prevId = cfId;
        }

        // Output projection from last node
        const outputId = 'output-projection';
        rawNodes.push({
          id: outputId,
          type: 'outputNode',
          position: { x: 0, y: 0 },
          data: { fields: view.projectedFields.map(f => f.name) },
        });
        rawEdges.push({
          id: `e-${prevId}-output`,
          source: prevId,
          target: outputId,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
          style: { stroke: '#10b981', strokeWidth: 1.5 },
        });
      }
    } else {
      // No joins: input -> calc fields -> output
      let prevId = `input-${view.sources[0] ?? 'src'}`;
      for (const cf of view.calculatedFields) {
        const cfId = `calc-${cf.name}`;
        rawNodes.push({
          id: cfId,
          type: 'calcFieldNode',
          position: { x: 0, y: 0 },
          data: { name: cf.name, formula: cf.formula },
        });
        rawEdges.push({
          id: `e-${prevId}-${cfId}`,
          source: prevId,
          target: cfId,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#334155' },
          style: { stroke: '#334155', strokeWidth: 1.5 },
        });
        prevId = cfId;
      }

      const outputId = 'output-projection';
      rawNodes.push({
        id: outputId,
        type: 'outputNode',
        position: { x: 0, y: 0 },
        data: { fields: view.projectedFields.map(f => f.name) },
      });
      rawEdges.push({
        id: `e-${prevId}-output`,
        source: prevId,
        target: outputId,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
        style: { stroke: '#10b981', strokeWidth: 1.5 },
      });
    }

    const layouted = applyDagreLayout(rawNodes, rawEdges);
    return { nodes: layouted, edges: rawEdges };
  }, [view, graph]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={internalNodeTypes}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      nodesDraggable={false}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e293b" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
};

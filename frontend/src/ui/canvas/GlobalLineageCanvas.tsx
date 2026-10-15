// src/ui/canvas/GlobalLineageCanvas.tsx
// Main canvas: Sources -> Intermediate/Dimension Views -> Fact View -> Analytic Model
// Dagre auto-layout, left-to-right.

import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  BackgroundVariant,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { LineageGraph } from '../../core/model/types';
import { applyDagreLayout } from './layout';
import { SourceNode } from './nodes/SourceNode';
import { ViewNode } from './nodes/ViewNode';
import { AnalyticModelNode } from './nodes/AnalyticModelNode';
import { usePlanStore } from '../../state/planStore';
import { useNavigationStore } from '../../state/navigationStore';

const nodeTypes = {
  source: SourceNode,
  view: ViewNode,
  analyticModel: AnalyticModelNode,
};

interface Props {
  graph: LineageGraph;
}

export const GlobalLineageCanvas: React.FC<Props> = ({ graph }) => {
  const openDrawer = usePlanStore(s => s.openDrawer);
  const push = useNavigationStore(s => s.push);

  const handleOpenDrawer = useCallback((id: string) => {
    openDrawer(id);
  }, [openDrawer]);

  const handleDrillDown = useCallback((viewId: string) => {
    push({ type: 'view', id: viewId });
  }, [push]);

  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    // Source nodes
    for (const src of graph.sources) {
      rawNodes.push({
        id: src.id,
        type: 'source',
        position: { x: 0, y: 0 },
        data: {
          label: src.label,
          technicalName: src.technicalName,
          sourceId: src.id,
          onOpenDrawer: handleOpenDrawer,
        },
      });
    }

    // View nodes
    for (const view of graph.views) {
      rawNodes.push({
        id: view.id,
        type: 'view',
        position: { x: 0, y: 0 },
        data: {
          label: view.label,
          technicalName: view.technicalName,
          viewId: view.id,
          kind: view.kind,
          onDrillDown: handleDrillDown,
        },
      });

      // Edges from sources to this view
      for (const srcId of view.sources) {
        // srcId is the technicalName – find the actual node id
        const srcNode = graph.sources.find(s => s.technicalName === srcId);
        const srcViewNode = graph.views.find(v => v.technicalName === srcId);
        const fromId = srcNode?.id ?? srcViewNode?.id ?? srcId;

        rawEdges.push({
          id: `e-${fromId}-${view.id}`,
          source: fromId,
          target: view.id,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#334155' },
          style: { stroke: '#334155', strokeWidth: 1.5 },
          animated: false,
        });
      }
    }

    // Analytic model node
    const lastView = graph.views[graph.views.length - 1];
    rawNodes.push({
      id: graph.analyticModelId,
      type: 'analyticModel',
      position: { x: 0, y: 0 },
      data: {
        label: graph.analyticModelLabel,
        technicalName: graph.analyticModelId,
        onDrillDown: handleDrillDown,
      },
    });

    if (lastView) {
      rawEdges.push({
        id: `e-${lastView.id}-${graph.analyticModelId}`,
        source: lastView.id,
        target: graph.analyticModelId,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
        style: { stroke: '#10b981', strokeWidth: 1.5 },
      });
    }

    const layouted = applyDagreLayout(rawNodes, rawEdges);
    return { nodes: layouted, edges: rawEdges };
  }, [graph, handleOpenDrawer, handleDrillDown]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={true}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e293b" />
      <Controls showInteractive={false} />
      <MiniMap
        nodeColor={(n) => {
          const t = n.type;
          if (t === 'source') return '#1e3a5f';
          if (t === 'analyticModel') return '#1a3d2b';
          const kind = (n.data as { kind?: string }).kind;
          if (kind === 'fact') return '#2d1b4e';
          if (kind === 'dimension') return '#2d1f4e';
          return '#1a2540';
        }}
        maskColor="rgba(10,15,30,0.8)"
      />
    </ReactFlow>
  );
};

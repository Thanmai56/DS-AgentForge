import { Edge, MarkerType, Node } from 'reactflow';
import { Plan, PlanNode } from './types';

export type PlanGraphNodeData =
  | {
      kind: 'source';
      sourceName: string;
      layer: 'L0';
      onSelectSource?: (sourceName: string) => void;
    }
  | {
      kind: 'step';
      planNode: PlanNode;
      stepNumber: number;
      layer: string;
      onSelectNode?: (node: PlanNode) => void;
    };

export interface PlanFlowGraph {
  nodes: Node<PlanGraphNodeData>[];
  edges: Edge[];
}

const LAYERS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;

function getNodeLayer(node: PlanNode): string {
  if (node.layer && LAYERS.includes(node.layer as (typeof LAYERS)[number])) {
    return node.layer;
  }

  const operation = node.operation.toLowerCase();
  if (operation === 'source') return 'L0';
  if (operation === 'projection' || operation === 'filter') {
    return node.is_existing ? 'L2' : 'L1';
  }
  if (operation === 'analytic_model') return 'L4';
  if (operation === 'join' || operation === 'calculated_column') return 'L3';
  return 'L2';
}

export function buildPlanFlowGraph(plan: Plan): PlanFlowGraph {
  const planNodeIds = new Set(plan.nodes.map((node) => node.id));
  const stepNodes = plan.nodes.filter((node) => node.operation.toLowerCase() !== 'source');
  const layerIndexes = new Map<string, number>();
  const sourceIndexes = new Map<string, number>();
  const sourceNames = Array.from(
    new Set(
      [
        ...plan.nodes
          .filter((node) => node.operation.toLowerCase() === 'source')
          .map((node) => node.id),
        ...stepNodes.flatMap((node) => node.inputs.filter((input) =>
          !planNodeIds.has(input)
          || plan.nodes.find((planNode) => planNode.id === input)?.operation.toLowerCase() === 'source',
        )),
      ],
    ),
  );
  const sourceNodeIds = new Map(sourceNames.map((name) => [name, `source:${name}`]));

  const nodes: Node<PlanGraphNodeData>[] = [
    ...sourceNames.map((sourceName) => {
      const row = sourceIndexes.get('L0') || 0;
      sourceIndexes.set('L0', row + 1);
      return {
        id: sourceNodeIds.get(sourceName)!,
        type: 'source',
        position: { x: 24, y: 118 + row * 320 },
        data: { kind: 'source' as const, sourceName, layer: 'L0' as const },
      };
    }),
    ...stepNodes.map((planNode, index) => {
      const layer = getNodeLayer(planNode);
      const row = layerIndexes.get(layer) || 0;
      layerIndexes.set(layer, row + 1);
      const column = LAYERS.indexOf(layer as (typeof LAYERS)[number]);
      return {
        id: planNode.id,
        type: 'step',
        position: { x: 24 + column * 360, y: 118 + row * 320 },
        data: { kind: 'step' as const, planNode, stepNumber: index + 1, layer },
      };
    }),
  ];

  let edgeIndex = 0;
  const edges: Edge[] = stepNodes.flatMap((node) =>
    node.inputs.map((input) => {
      const source = sourceNodeIds.get(input) || input;
      edgeIndex += 1;
      return {
        id: `plan-edge-${edgeIndex}`,
        source,
        target: node.id,
        type: 'smoothstep',
        style: { stroke: '#64748B', strokeWidth: 1.8 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#64748B',
          width: 14,
          height: 14,
        },
      };
    }),
  );

  return { nodes, edges };
}

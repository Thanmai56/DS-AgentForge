import { describe, expect, it } from 'vitest';
import { Plan } from '../types';
import { buildPlanFlowGraph } from '../planGraph';

const plan: Plan = {
  analysis: [],
  nodes: [
    {
      id: 'L1_MARD',
      operation: 'projection',
      inputs: ['MARD'],
      columns: ['MATNR', 'LABST'],
      details: {},
      reason: 'Project material stock columns.',
      layer: 'L1',
    },
    {
      id: 'L1_MBEW',
      operation: 'projection',
      inputs: ['MBEW'],
      columns: ['MATNR', 'SALK3'],
      details: {},
      reason: 'Project material valuation columns.',
      layer: 'L1',
    },
    {
      id: 'L3_STOCK',
      operation: 'join',
      inputs: ['L1_MARD', 'L1_MBEW'],
      columns: ['MATNR', 'LABST', 'SALK3'],
      details: { join_type: 'left', on: [['MATNR', 'MATNR']] },
      reason: 'Join stock and valuation.',
      layer: 'L3',
    },
    {
      id: 'L4_STOCK_AM',
      operation: 'analytic_model',
      inputs: ['L3_STOCK'],
      columns: ['MATNR', 'SOH_QTY', 'SOH_VALUE'],
      details: {},
      reason: 'Expose stock KPIs.',
      layer: 'L4',
    },
  ],
  measures: [],
  dimensions: [],
  assumptions: [],
  blockers: [],
};

describe('buildPlanFlowGraph', () => {
  it('shows referenced sources and connects each dependency to its step', () => {
    const graph = buildPlanFlowGraph(plan);

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'source:MARD',
      'source:MBEW',
      'L1_MARD',
      'L1_MBEW',
      'L3_STOCK',
      'L4_STOCK_AM',
    ]);
    expect(graph.edges.map(({ source, target }) => [source, target])).toEqual([
      ['source:MARD', 'L1_MARD'],
      ['source:MBEW', 'L1_MBEW'],
      ['L1_MARD', 'L3_STOCK'],
      ['L1_MBEW', 'L3_STOCK'],
      ['L3_STOCK', 'L4_STOCK_AM'],
    ]);
    expect(graph.nodes.find((node) => node.id === 'L1_MARD')?.data).toMatchObject({ layer: 'L1' });
    expect(graph.nodes.find((node) => node.id === 'L4_STOCK_AM')?.data).toMatchObject({ layer: 'L4' });
  });

  it('does not duplicate source nodes when multiple steps use the same input', () => {
    const sharedSourcePlan = {
      ...plan,
      nodes: [
        plan.nodes[0],
        { ...plan.nodes[1], inputs: ['MARD'] },
      ],
    };

    const graph = buildPlanFlowGraph(sharedSourcePlan);
    expect(graph.nodes.filter((node) => node.data.kind === 'source')).toHaveLength(1);
  });
});

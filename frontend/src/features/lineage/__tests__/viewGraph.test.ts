// frontend/src/features/lineage/__tests__/viewGraph.test.ts
import { describe, it, expect } from 'vitest';
import { ViewGraph, ViewGraphNode, Operation } from '../viewGraphTypes';

describe('ViewGraph Frontend Models & Operations', () => {
  const samplePOViewGraph: ViewGraph = {
    view_id: 'F_PO_PROCESSING_TIME_APT',
    view_name: 'F_PO_PROCESSING_TIME_APT',
    version: 1,
    nodes: [
      {
        id: 'src_ZIPOHDRAPT',
        name: 'ZIPOHDRAPT',
        node_type: 'SOURCE',
        is_existing: true,
        columns: ['PURCHASEORDER', 'CREATIONDATE', 'COMPANYCODE'],
        details: {},
        position: { x: 60, y: 80 },
      },
      {
        id: 'src_V_PO_FINAL_DELIVERY_APT',
        name: 'V_PO_FINAL_DELIVERY_APT',
        node_type: 'SOURCE',
        is_existing: true,
        columns: ['PURCHASEORDER', 'FINAL_DELIVERY_DATE'],
        details: {},
        position: { x: 60, y: 240 },
      },
      {
        id: 'join_po',
        name: 'Inner Join',
        node_type: 'JOIN',
        details: {
          join_type: 'inner',
          key_pairs: [['PURCHASEORDER', 'PURCHASEORDER']],
        },
        position: { x: 360, y: 160 },
      },
      {
        id: 'calc_days',
        name: 'CALC_PROCESSING_DAYS',
        node_type: 'CALCULATION',
        details: {
          calculation_name: 'CALC_PROCESSING_DAYS',
          expression: 'DAYS_BETWEEN(CREATIONDATE, FINAL_DELIVERY_DATE) + 1',
        },
        position: { x: 580, y: 160 },
      },
      {
        id: 'out_terminal',
        name: 'F_PO_PROCESSING_TIME_APT',
        node_type: 'OUTPUT',
        columns: ['PURCHASEORDER', 'CREATIONDATE', 'FINAL_DELIVERY_DATE', 'CALC_PROCESSING_DAYS'],
        details: {},
        position: { x: 800, y: 160 },
      },
    ],
    edges: [
      { id: 'e1', source: 'src_ZIPOHDRAPT', target: 'join_po' },
      { id: 'e2', source: 'src_V_PO_FINAL_DELIVERY_APT', target: 'join_po' },
      { id: 'e3', source: 'join_po', target: 'calc_days' },
      { id: 'e4', source: 'calc_days', target: 'out_terminal' },
    ],
  };

  it('1. Verifies PO example left-to-right flow topology', () => {
    const srcNodes = samplePOViewGraph.nodes.filter((n) => n.node_type === 'SOURCE');
    const joinNode = samplePOViewGraph.nodes.find((n) => n.node_type === 'JOIN');
    const calcNode = samplePOViewGraph.nodes.find((n) => n.node_type === 'CALCULATION');
    const outNode = samplePOViewGraph.nodes.find((n) => n.node_type === 'OUTPUT');

    expect(srcNodes.length).toBe(2);
    expect(joinNode).toBeDefined();
    expect(calcNode).toBeDefined();
    expect(outNode).toBeDefined();

    // Verify left-to-right positions
    expect(srcNodes[0].position.x).toBeLessThan(joinNode!.position.x);
    expect(joinNode!.position.x).toBeLessThan(calcNode!.position.x);
    expect(calcNode!.position.x).toBeLessThan(outNode!.position.x);
  });

  it('2. Verifies Join node key pairs and type', () => {
    const joinNode = samplePOViewGraph.nodes.find((n) => n.node_type === 'JOIN');
    expect(joinNode!.details.join_type).toBe('inner');
    expect(joinNode!.details.key_pairs).toEqual([['PURCHASEORDER', 'PURCHASEORDER']]);
  });

  it('3. Verifies Calculation expression and output node columns', () => {
    const calcNode = samplePOViewGraph.nodes.find((n) => n.node_type === 'CALCULATION');
    expect(calcNode!.details.expression).toContain('DAYS_BETWEEN');

    const outNode = samplePOViewGraph.nodes.find((n) => n.node_type === 'OUTPUT');
    expect(outNode!.columns).toContain('CALC_PROCESSING_DAYS');
  });
});

import { describe, expect, it } from 'vitest';
import { CompressedEntity } from '../../../utils/schemaCompressor';
import { Plan } from '../types';
import { addPlanTransform, getRequiredNodeColumns, preparePlanPipeline } from '../planPipeline';

const sources: CompressedEntity[] = [
  {
    name: 'ORDERS',
    business_name: 'Orders',
    kind: 'table',
    sources: [],
    fields: [
      { name: 'ORDER_ID', data_type: 'cds.Integer', is_key: true, label: 'Order ID', semantic_role: 'key' },
      { name: 'CUSTOMER_ID', data_type: 'cds.Integer', is_key: false, label: 'Customer ID', semantic_role: 'dimension' },
      { name: 'STATUS', data_type: 'cds.String', is_key: false, label: 'Status', semantic_role: 'dimension' },
    ],
  },
  {
    name: 'CUSTOMERS',
    business_name: 'Customers',
    kind: 'table',
    sources: [],
    fields: [
      { name: 'CUSTOMER_ID', data_type: 'cds.Integer', is_key: true, label: 'Customer ID', semantic_role: 'key' },
      { name: 'CUSTOMER_NAME', data_type: 'cds.String', is_key: false, label: 'Customer Name', semantic_role: 'dimension' },
    ],
  },
];

const plan: Plan = {
  analysis: [],
  nodes: [
    {
      id: 'L3_ORDERS_FACT',
      operation: 'join',
      inputs: ['ORDERS', 'CUSTOMERS'],
      columns: ['ORDER_ID', 'CUSTOMER_ID', 'CUSTOMER_NAME'],
      details: {
        join_type: 'left',
        on: [['ORDERS.CUSTOMER_ID', 'CUSTOMERS.CUSTOMER_ID']],
      },
      reason: 'Join orders with customers.',
      layer: 'L3',
    },
  ],
  measures: [],
  dimensions: [],
  assumptions: [],
  blockers: [],
};

describe('plan pipeline preparation', () => {
  it('creates one L1 wrapper per source and rewires the planned joins', () => {
    const prepared = preparePlanPipeline(plan, sources);
    const wrappers = prepared.nodes.filter((node) => node.is_wrapper);
    const join = prepared.nodes.find((node) => node.id === 'L3_ORDERS_FACT');

    expect(wrappers).toHaveLength(sources.length);
    expect(wrappers.every((node) => node.layer === 'L1')).toBe(true);
    expect(wrappers.find((node) => node.inputs[0] === 'ORDERS')?.columns).toEqual([
      'ORDER_ID',
      'CUSTOMER_ID',
      'STATUS',
    ]);
    expect(join?.inputs).toEqual(['WRAP_ORDERS', 'WRAP_CUSTOMERS']);
    expect(join?.details.on).toEqual([['WRAP_ORDERS.CUSTOMER_ID', 'WRAP_CUSTOMERS.CUSTOMER_ID']]);
  });

  it('resolves application L0 source IDs to uploaded source names before creating L1 wrappers', () => {
    const layeredPlan: Plan = {
      ...plan,
      nodes: [
        {
          id: 'L0_ORDERS',
          operation: 'source',
          inputs: [],
          columns: ['ORDER_ID', 'CUSTOMER_ID', 'STATUS'],
          details: {},
          reason: 'Uploaded orders table.',
          layer: 'L0',
        },
        {
          id: 'L1_ORDERS_VIEW',
          operation: 'projection',
          inputs: ['L0_ORDERS'],
          columns: ['ORDER_ID', 'CUSTOMER_ID'],
          details: {},
          reason: 'Project order fields.',
          layer: 'L1',
        },
        {
          ...plan.nodes[0],
          inputs: ['L1_ORDERS_VIEW', 'CUSTOMERS'],
          details: {
            ...plan.nodes[0].details,
            on: [['L0_ORDERS.CUSTOMER_ID', 'CUSTOMERS.CUSTOMER_ID']],
          },
        },
      ],
    };

    const prepared = preparePlanPipeline(layeredPlan, sources);
    const ordersWrapper = prepared.nodes.find((node) => node.id === 'WRAP_ORDERS');
    const join = prepared.nodes.find((node) => node.id === 'L3_ORDERS_FACT');

    expect(prepared.nodes.map((node) => node.id)).not.toContain('L0_ORDERS');
    expect(ordersWrapper?.inputs).toEqual(['ORDERS']);
    expect(join?.inputs).toContain('WRAP_ORDERS');
    expect(join?.details.on).toEqual([['WRAP_ORDERS.CUSTOMER_ID', 'WRAP_CUSTOMERS.CUSTOMER_ID']]);
  });

  it('omits delta entities and their wrappers from the prepared plan', () => {
    const deltaSource: CompressedEntity = {
      name: 'I_SUPPLIER_Delta',
      business_name: 'Supplier Delta',
      kind: 'table',
      sources: [],
      fields: [
        { name: 'SUPPLIER', data_type: 'cds.String', is_key: true, label: 'Supplier', semantic_role: 'key' },
      ],
    };
    const planWithDelta: Plan = {
      ...plan,
      nodes: [
        {
          id: 'I_SUPPLIER_Delta',
          operation: 'source',
          inputs: [],
          columns: ['SUPPLIER'],
          details: {},
          reason: 'Delta replication source.',
          is_existing: true,
          layer: 'L0',
        },
        ...plan.nodes.map((node) => node.id === 'L3_ORDERS_FACT'
          ? {
              ...node,
              inputs: [...node.inputs, 'I_SUPPLIER_Delta'],
              details: {
                ...node.details,
                on: [...(node.details.on || []), ['I_SUPPLIER_Delta.SUPPLIER', 'ORDERS.ORDER_ID']],
              },
            }
          : node),
      ],
    };

    const prepared = preparePlanPipeline(planWithDelta, [...sources, deltaSource]);
    const join = prepared.nodes.find((node) => node.id === 'L3_ORDERS_FACT');

    expect(prepared.nodes.map((node) => node.id)).not.toContain('I_SUPPLIER_Delta');
    expect(prepared.nodes.map((node) => node.id)).not.toContain('WRAP_I_SUPPLIER_Delta');
    expect(prepared.nodes.filter((node) => node.is_wrapper).map((node) => node.inputs[0]))
      .not.toContain('I_SUPPLIER_Delta');
    expect(join?.inputs).not.toContain('WRAP_I_SUPPLIER_Delta');
    expect(join?.details.on).not.toContainEqual(['I_SUPPLIER_Delta.SUPPLIER', 'ORDERS.ORDER_ID']);
  });

  it('configures projection and filter on the wrapper without adding pipeline nodes', () => {
    const prepared = preparePlanPipeline(plan, sources);
    const ordersWrapper = prepared.nodes.find((node) => node.id === 'WRAP_ORDERS')!;
    const projection = addPlanTransform(prepared, ordersWrapper, 'projection');
    const join = projection.plan.nodes.find((node) => node.id === 'L3_ORDERS_FACT');

    expect(projection.node.layer).toBe('L1');
    expect(projection.node.is_projection_enabled).toBe(true);
    expect(projection.plan.nodes).toHaveLength(prepared.nodes.length);
    expect(join?.inputs[0]).toBe('WRAP_ORDERS');
    expect(join?.details.on?.[0][0]).toBe('WRAP_ORDERS.CUSTOMER_ID');
    expect(getRequiredNodeColumns(projection.node, projection.plan)).toContain('CUSTOMER_ID');

    const filter = addPlanTransform(projection.plan, projection.node, 'filter');
    filter.node.details.condition = "STATUS = 'OPEN'";
    expect(filter.node.id).toBe(projection.node.id);
    expect(filter.node.is_filter_enabled).toBe(true);
    expect(filter.node.inputs).toEqual(['ORDERS']);
    expect(filter.plan.nodes).toHaveLength(prepared.nodes.length);
    expect(filter.plan.nodes.find((node) => node.id === 'L3_ORDERS_FACT')?.inputs[0]).toBe('WRAP_ORDERS');
    expect(getRequiredNodeColumns(filter.node, filter.plan)).toContain('STATUS');
  });

  it('folds source-level projection and filter steps into their wrapper', () => {
    const sourceLevelPlan: Plan = {
      ...plan,
      nodes: [
        {
          id: 'L1_ORDERS_PROJECTION',
          operation: 'projection',
          inputs: ['ORDERS'],
          columns: ['ORDER_ID'],
          details: {},
          reason: 'Keep join fields.',
          is_existing: false,
          layer: 'L1',
        },
        {
          id: 'L1_ORDERS_FILTER',
          operation: 'filter',
          inputs: ['L1_ORDERS_PROJECTION'],
          columns: ['ORDER_ID', 'CUSTOMER_ID'],
          details: { condition: "STATUS = 'OPEN'" },
          reason: 'Keep open orders.',
          is_existing: false,
          layer: 'L1',
        },
        {
          ...plan.nodes[0],
          inputs: ['L1_ORDERS_FILTER', 'CUSTOMERS'],
          details: {
            ...plan.nodes[0].details,
            on: [['L1_ORDERS_FILTER.CUSTOMER_ID', 'CUSTOMERS.CUSTOMER_ID']],
          },
        },
      ],
    };

    const prepared = preparePlanPipeline(sourceLevelPlan, sources);
    const ordersWrapper = prepared.nodes.find((node) => node.id === 'WRAP_ORDERS');
    const join = prepared.nodes.find((node) => node.id === 'L3_ORDERS_FACT');

    expect(prepared.nodes.some((node) => node.id === 'L1_ORDERS_PROJECTION')).toBe(false);
    expect(prepared.nodes.some((node) => node.id === 'L1_ORDERS_FILTER')).toBe(false);
    expect(ordersWrapper?.columns).toEqual(['ORDER_ID', 'CUSTOMER_ID']);
    expect(ordersWrapper?.details.condition).toBe("STATUS = 'OPEN'");
    expect(ordersWrapper?.is_projection_enabled).toBe(true);
    expect(ordersWrapper?.is_filter_enabled).toBe(true);
    expect(join?.inputs).toEqual(['WRAP_ORDERS', 'WRAP_CUSTOMERS']);
    expect(join?.details.on).toEqual([['WRAP_ORDERS.CUSTOMER_ID', 'WRAP_CUSTOMERS.CUSTOMER_ID']]);
  });

  it('folds existing L1/L2 projection nodes into wrappers and removes intermediate views', () => {
    const layeredPlan: Plan = {
      ...plan,
      nodes: [
        {
          id: 'L1_ORDERS',
          operation: 'projection',
          inputs: ['ORDERS'],
          columns: ['ORDER_ID', 'CUSTOMER_ID'],
          details: {},
          reason: 'Existing wrapper-style projection.',
          is_existing: true,
          layer: 'L1',
        },
        {
          id: 'L2_ORDERS_HELPER',
          operation: 'projection',
          inputs: ['L1_ORDERS'],
          columns: ['ORDER_ID', 'CUSTOMER_ID'],
          details: {},
          reason: 'Existing helper view.',
          is_existing: true,
          layer: 'L2',
        },
        {
          ...plan.nodes[0],
          inputs: ['L2_ORDERS_HELPER', 'CUSTOMERS'],
          details: {
            ...plan.nodes[0].details,
            on: [['L2_ORDERS_HELPER.CUSTOMER_ID', 'CUSTOMERS.CUSTOMER_ID']],
          },
        },
      ],
    };

    const prepared = preparePlanPipeline(layeredPlan, sources);
    const join = prepared.nodes.find((node) => node.id === 'L3_ORDERS_FACT');

    expect(prepared.nodes.map((node) => node.id)).not.toContain('L1_ORDERS');
    expect(prepared.nodes.map((node) => node.id)).not.toContain('L2_ORDERS_HELPER');
    expect(prepared.nodes.filter((node) => node.layer === 'L1').every((node) => node.is_wrapper)).toBe(true);
    expect(prepared.nodes.some((node) => node.layer === 'L2')).toBe(false);
    expect(prepared.nodes.find((node) => node.id === 'WRAP_ORDERS')?.columns)
      .toEqual(['ORDER_ID', 'CUSTOMER_ID']);
    expect(join?.inputs).toEqual(['WRAP_ORDERS', 'WRAP_CUSTOMERS']);
    expect(join?.details.on).toEqual([['WRAP_ORDERS.CUSTOMER_ID', 'WRAP_CUSTOMERS.CUSTOMER_ID']]);
  });

  it('keeps source columns selected by downstream fact nodes in projected wrappers', () => {
    const projectedPlan: Plan = {
      ...plan,
      nodes: [
        {
          id: 'L1_ORDERS',
          operation: 'projection',
          inputs: ['ORDERS'],
          columns: ['ORDER_ID'],
          details: {},
          reason: 'Project order key.',
          layer: 'L1',
        },
        {
          id: 'L1_CUSTOMERS',
          operation: 'projection',
          inputs: ['CUSTOMERS'],
          columns: ['CUSTOMER_ID'],
          details: {},
          reason: 'Project customer key.',
          layer: 'L1',
        },
        {
          id: 'L3_ORDERS_FACT',
          operation: 'join',
          inputs: ['L1_ORDERS', 'L1_CUSTOMERS'],
          columns: ['ORDER_ID', 'CUSTOMER_ID', 'STATUS', 'CUSTOMER_NAME'],
          details: {
            join_type: 'left',
            on: [['L1_ORDERS.CUSTOMER_ID', 'L1_CUSTOMERS.CUSTOMER_ID']],
          },
          reason: 'Join orders with customer details.',
          layer: 'L3',
        },
      ],
    };

    const prepared = preparePlanPipeline(projectedPlan, sources);

    expect(prepared.nodes.find((node) => node.id === 'WRAP_ORDERS')?.columns)
      .toContain('STATUS');
    expect(prepared.nodes.find((node) => node.id === 'WRAP_CUSTOMERS')?.columns)
      .toContain('CUSTOMER_NAME');
  });

  it('inlines L2 joins into the fact instead of leaving a missing view dependency', () => {
    const layeredPlan: Plan = {
      ...plan,
      nodes: [
        {
          id: 'L2_ORDERS_CUSTOMERS',
          operation: 'join',
          inputs: ['ORDERS', 'CUSTOMERS'],
          columns: ['ORDER_ID', 'CUSTOMER_ID', 'CUSTOMER_NAME'],
          details: {
            join_type: 'left',
            on: [['ORDERS.CUSTOMER_ID', 'CUSTOMERS.CUSTOMER_ID']],
          },
          reason: 'Existing intermediate join.',
          is_existing: true,
          layer: 'L2',
        },
        {
          ...plan.nodes[0],
          inputs: ['L2_ORDERS_CUSTOMERS'],
          details: {},
        },
      ],
    };

    const prepared = preparePlanPipeline(layeredPlan, sources);
    const fact = prepared.nodes.find((node) => node.id === 'L3_ORDERS_FACT');

    expect(prepared.nodes.map((node) => node.id)).not.toContain('L2_ORDERS_CUSTOMERS');
    expect(prepared.nodes.some((node) => node.layer === 'L2')).toBe(false);
    expect(fact?.inputs).toEqual(['WRAP_ORDERS', 'WRAP_CUSTOMERS']);
    expect(fact?.details.join_type).toBe('left');
    expect(fact?.details.on).toEqual([['WRAP_ORDERS.CUSTOMER_ID', 'WRAP_CUSTOMERS.CUSTOMER_ID']]);
  });
});

import { describe, expect, it } from 'vitest';
import { CompressedEntity } from '../../../utils/schemaCompressor';
import { Plan } from '../types';
import { buildPlanExportEntities, selectGeneratedPlanEntities } from '../planExport';

describe('buildPlanExportEntities', () => {
  it('builds export entities from the accepted plan dependencies and expressions', () => {
    const source: CompressedEntity = {
      name: 'STOCK',
      business_name: 'Stock Source',
      kind: 'table',
      sources: [],
      fields: [
        { name: 'MATNR', data_type: 'NVARCHAR(40)', is_key: true, label: 'Material', semantic_role: 'key' },
        { name: 'LABST', data_type: 'DECIMAL(13,3)', is_key: false, label: 'Stock', semantic_role: 'measure' },
      ],
    };
    const plan: Plan = {
      analysis: [],
      nodes: [
        {
          id: 'L1_STOCK',
          operation: 'projection',
          inputs: ['STOCK'],
          columns: ['MATNR', 'LABST'],
          details: {},
          reason: 'Project stock fields.',
          layer: 'L1',
        },
        {
          id: 'L3_STOCK_FACT',
          operation: 'calculated_column',
          inputs: ['L1_STOCK'],
          columns: ['MATNR', 'LABST', 'STOCK_VALUE'],
          details: { formula: 'LABST * UNIT_PRICE' },
          reason: 'Calculate inventory value.',
          layer: 'L3',
        },
        {
          id: 'L4_STOCK_MODEL',
          operation: 'analytic_model',
          inputs: ['L3_STOCK_FACT'],
          columns: ['MATNR', 'STOCK_VALUE'],
          details: {},
          reason: 'Expose inventory KPIs.',
          layer: 'L4',
        },
      ],
      measures: [{ name: 'STOCK_VALUE', aggregation: 'SUM', column: 'STOCK_VALUE' }],
      dimensions: ['MATNR'],
      assumptions: [],
      blockers: [],
    };

    const entities = buildPlanExportEntities(plan, [source]);
    expect(entities.map((entity) => entity.name)).toEqual([
      'STOCK',
      'L1_STOCK',
      'L3_STOCK_FACT',
      'L4_STOCK_MODEL',
    ]);
    expect(entities[2].sources).toEqual(['L1_STOCK']);
    expect(entities[2].calculatedFields).toEqual([
      { name: 'STOCK_VALUE', label: 'STOCK_VALUE', formula: 'LABST * UNIT_PRICE' },
    ]);
    expect(entities[3].groupBy).toEqual(['MATNR']);
    expect(entities[3].fields.find((field) => field.name === 'STOCK_VALUE')?.semantic_role).toBe('measure');
  });

  it('keeps existing source objects as query dependencies instead of exporting empty local tables', () => {
    const source: CompressedEntity = {
      name: 'EXISTING_SOURCE',
      business_name: 'Existing Datasphere source',
      kind: 'table',
      sources: [],
      fields: [
        { name: 'ID', data_type: 'cds.String', is_key: true, label: 'ID', semantic_role: 'key' },
      ],
    };
    const plan: Plan = {
      analysis: [],
      nodes: [
        {
          id: 'EXISTING_SOURCE',
          operation: 'source',
          inputs: [],
          columns: ['ID'],
          details: {},
          reason: 'Already exists in Datasphere.',
          layer: 'L0',
        },
        {
          id: 'L1_SOURCE_VIEW',
          operation: 'projection',
          inputs: ['EXISTING_SOURCE'],
          columns: ['ID'],
          details: {},
          reason: 'Create relational dataset over existing source.',
          layer: 'L1',
        },
        {
          id: 'EXISTING_VIEW',
          operation: 'projection',
          inputs: ['EXISTING_SOURCE'],
          columns: ['ID'],
          details: {},
          reason: 'Already exists.',
          is_existing: true,
          layer: 'L2',
        },
      ],
      measures: [],
      dimensions: ['ID'],
      assumptions: [],
      blockers: [],
    };

    const lineageEntities = buildPlanExportEntities(plan, [source]);
    expect(lineageEntities.map((entity) => entity.name)).toContain('EXISTING_SOURCE');

    const generatedEntities = selectGeneratedPlanEntities(plan, lineageEntities);
    expect(generatedEntities.map((entity) => entity.name)).toEqual(['WRAP_EXISTING_SOURCE']);
    expect(generatedEntities[0].sources).toEqual(['EXISTING_SOURCE']);
    expect(lineageEntities.map((entity) => entity.name)).not.toContain('L1_SOURCE_VIEW');
    expect(lineageEntities.map((entity) => entity.name)).not.toContain('EXISTING_VIEW');
  });

  it('does not add delta replication sources to plan lineage entities', () => {
    const source: CompressedEntity = {
      name: 'I_SUPPLIER',
      business_name: 'Supplier',
      kind: 'table',
      sources: [],
      fields: [
        { name: 'SUPPLIER', data_type: 'cds.String', is_key: true, label: 'Supplier', semantic_role: 'key' },
      ],
    };
    const delta: CompressedEntity = {
      ...source,
      name: 'I_SUPPLIER_Delta',
      business_name: 'Supplier Delta',
    };
    const plan: Plan = {
      analysis: [],
      nodes: [
        {
          id: 'WRAP_I_SUPPLIER',
          operation: 'projection',
          inputs: ['I_SUPPLIER'],
          columns: ['SUPPLIER'],
          details: {},
          reason: 'Wrapper for supplier source.',
          is_wrapper: true,
          layer: 'L1',
        },
        {
          id: 'I_SUPPLIER_Delta',
          operation: 'source',
          inputs: [],
          columns: ['SUPPLIER'],
          details: {},
          reason: 'Delta source.',
          layer: 'L0',
        },
        {
          id: 'WRAP_I_SUPPLIER_Delta',
          operation: 'projection',
          inputs: ['I_SUPPLIER_Delta'],
          columns: ['SUPPLIER'],
          details: {},
          reason: 'Delta wrapper.',
          is_wrapper: true,
          layer: 'L1',
        },
        {
          id: 'FACT_SUPPLIER',
          operation: 'join',
          inputs: ['WRAP_I_SUPPLIER', 'WRAP_I_SUPPLIER_Delta'],
          columns: ['SUPPLIER'],
          details: {
            on: [['WRAP_I_SUPPLIER.SUPPLIER', 'WRAP_I_SUPPLIER_Delta.SUPPLIER']],
          },
          reason: 'Join suppliers.',
          layer: 'L3',
        },
      ],
      measures: [],
      dimensions: [],
      assumptions: [],
      blockers: [],
    };

    const entities = buildPlanExportEntities(plan, [source, delta]);

    expect(entities.map((entity) => entity.name)).toEqual(['I_SUPPLIER', 'WRAP_I_SUPPLIER', 'FACT_SUPPLIER']);
    expect(entities.find((entity) => entity.name === 'FACT_SUPPLIER')?.sources).toEqual(['WRAP_I_SUPPLIER']);
    expect(entities.find((entity) => entity.name === 'FACT_SUPPLIER')?.joins).toEqual([]);
  });

  it('exports every fact-level formula as its own output column', () => {
    const source: CompressedEntity = {
      name: 'ORDERS',
      business_name: 'Orders',
      kind: 'table',
      sources: [],
      fields: [
        { name: 'QUANTITY', data_type: 'cds.Decimal', is_key: false, label: 'Quantity', semantic_role: 'measure' },
        { name: 'UNIT_PRICE', data_type: 'cds.Decimal', is_key: false, label: 'Unit price', semantic_role: 'measure' },
      ],
    };
    const plan: Plan = {
      analysis: [],
      nodes: [
        {
          id: 'FACT_ORDERS',
          operation: 'join',
          inputs: ['ORDERS'],
          columns: ['QUANTITY', 'UNIT_PRICE', 'ORDER_VALUE', 'ORDER_VALUE_WITH_TAX'],
          calculated_fields: [
            { name: 'ORDER_VALUE', formula: 'QUANTITY * UNIT_PRICE', label: 'Order value', data_type: 'cds.Decimal(15,2)' },
            { name: 'ORDER_VALUE_WITH_TAX', formula: 'QUANTITY * UNIT_PRICE * 1.2', label: 'Order value with tax', data_type: 'cds.Decimal(15,2)' },
          ],
          details: {},
          reason: 'Calculate order values.',
          layer: 'L3',
        },
      ],
      measures: [
        { name: 'ORDER_VALUE', aggregation: 'SUM', column: 'ORDER_VALUE' },
        { name: 'ORDER_VALUE_WITH_TAX', aggregation: 'SUM', column: 'ORDER_VALUE_WITH_TAX' },
      ],
      dimensions: [],
      assumptions: [],
      blockers: [],
    };

    const fact = buildPlanExportEntities(plan, [source]).find((entity) => entity.name === 'FACT_ORDERS');

    expect(fact?.fields.map((field) => field.name)).toContain('ORDER_VALUE');
    expect(fact?.fields.map((field) => field.name)).toContain('ORDER_VALUE_WITH_TAX');
    expect(fact?.fields.find((field) => field.name === 'ORDER_VALUE')?.data_type).toBe('cds.Decimal(15,2)');
    expect(fact?.calculatedFields).toEqual([
      { name: 'ORDER_VALUE', label: 'Order value', formula: 'QUANTITY * UNIT_PRICE' },
      { name: 'ORDER_VALUE_WITH_TAX', label: 'Order value with tax', formula: 'QUANTITY * UNIT_PRICE * 1.2' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { CompressedEntity } from '../../../utils/schemaCompressor';
import { Plan } from '../types';
import { buildPlanExportEntities } from '../planExport';

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
});

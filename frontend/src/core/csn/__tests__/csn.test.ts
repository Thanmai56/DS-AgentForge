// src/core/csn/__tests__/csn.test.ts
// Tests for CSN templates, formula converter, topo exporter, and patch utility.

import { describe, it, expect } from 'vitest';
import { buildLocalTable, buildSimpleView, buildJoinView } from '../templates.verified';
import { formulaToCsn } from '../formulaConverter';
import { exportCsnFiles, patchExistingCsn } from '../topoExporter';
import { PO_PROCESSING_TIME_GRAPH } from '../../../../fixtures/po-processing-time';

// ── Verified templates ─────────────────────────────────────────────────────────
describe('buildLocalTable – verified template', () => {
  it('matches ds.md local-table structure', () => {
    const result = buildLocalTable({
      technicalName: 'CUSTOMER_TABLE',
      label: 'Customer Table',
      fields: [
        { name: 'CUSTOMER_ID', label: 'Customer ID', type: 'cds.Integer', key: true, notNull: true },
        { name: 'CUSTOMER_NAME', label: 'Customer Name', type: 'cds.String', length: 200, notNull: true },
        { name: 'CREATED_DATE', label: 'Created Date', type: 'cds.Date', notNull: true },
      ],
    });

    expect(result).toEqual({
      definitions: {
        CUSTOMER_TABLE: {
          kind: 'entity',
          elements: {
            CUSTOMER_ID: { '@EndUserText.label': 'Customer ID', type: 'cds.Integer', key: true, notNull: true },
            CUSTOMER_NAME: { '@EndUserText.label': 'Customer Name', type: 'cds.String', length: 200, notNull: true },
            CREATED_DATE: { '@EndUserText.label': 'Created Date', type: 'cds.Date', notNull: true },
          },
          '@EndUserText.label': 'Customer Table',
        },
      },
    });
  });

  it('round-trips through JSON.parse', () => {
    const result = buildLocalTable({
      technicalName: 'T1',
      label: 'T1',
      fields: [{ name: 'ID', label: 'ID', type: 'cds.Integer', key: true, notNull: true }],
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('buildSimpleView – verified template', () => {
  it('matches ds.md simple view structure', () => {
    const result = buildSimpleView({
      technicalName: 'SIMPLE_VIEW',
      label: 'Simple View',
      description: 'A simple view example',
      purpose: 'Demonstrate view creation',
      sourceTable: 'TEST_LOCAL_TABLE',
      sourceAlias: 'T',
      fields: [
        { name: 'ID', label: 'ID', type: 'cds.Integer', notNull: true },
        { name: 'NAME', label: 'Name', type: 'cds.String', length: 100 },
      ],
    });

    expect(result.definitions).toHaveProperty('SIMPLE_VIEW');
    const def = (result.definitions as Record<string, unknown>)['SIMPLE_VIEW'] as Record<string, unknown>;
    expect(def['kind']).toBe('entity');
    expect(def['@EndUserText.label']).toBe('Simple View');
    expect(def['@ObjectModel.modelingPattern']).toEqual({ '#': 'DATA_STRUCTURE' });
    expect(def['@ObjectModel.supportedCapabilities']).toEqual([{ '#': 'DATA_STRUCTURE' }]);
  });

  it('round-trips through JSON.parse', () => {
    const result = buildSimpleView({
      technicalName: 'V1',
      label: 'V1',
      sourceTable: 'SRC',
      sourceAlias: 'S',
      fields: [{ name: 'A', label: 'A', type: 'cds.Integer' }],
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('buildJoinView – verified template', () => {
  it('matches ds.md join view structure', () => {
    const result = buildJoinView({
      technicalName: 'JOIN_VIEW',
      label: 'Join View',
      description: 'A view with join example',
      purpose: 'Demonstrate join in views',
      joinType: 'inner',
      leftRef: 'USER_INFO_TABLE',
      leftAlias: 'U',
      rightRef: 'TEST_LOCAL_TABLE',
      rightAlias: 'T',
      onLeft: ['U', 'USER_ID'],
      onRight: ['T', 'ID'],
      fields: [
        { name: 'USER_ID', label: 'User ID', type: 'cds.Integer', notNull: true },
        { name: 'USER_NAME', label: 'User Name', type: 'cds.String', length: 100 },
        { name: 'EMAIL', label: 'Email', type: 'cds.String', length: 200 },
      ],
    });

    const def = (result.definitions as Record<string, unknown>)['JOIN_VIEW'] as Record<string, unknown>;
    const query = def['query'] as Record<string, unknown>;
    const sel = query['SELECT'] as Record<string, unknown>;
    const from = sel['from'] as Record<string, unknown>;

    expect(from['join']).toBe('inner');
    expect(from['on']).toEqual([{ ref: ['U', 'USER_ID'] }, '=', { ref: ['T', 'ID'] }]);
    expect(def['@ObjectModel.modelingPattern']).toEqual({ '#': 'DATA_STRUCTURE' });
  });
});

// ── Formula converter ──────────────────────────────────────────────────────────
describe('formulaToCsn', () => {
  it('simple division', () => {
    const result = formulaToCsn('Processing_Days / Total_Delivered_Order');
    expect(result).toEqual([
      { ref: ['Processing_Days'] },
      '/',
      { ref: ['Total_Delivered_Order'] },
    ]);
  });

  it('function call', () => {
    const result = formulaToCsn('DAYS_BETWEEN(Order_Creation_Date, Order_Delivery_Date)');
    expect(result).toEqual([{
      func: 'DAYS_BETWEEN',
      args: [{ ref: ['Order_Creation_Date'] }, { ref: ['Order_Delivery_Date'] }],
    }]);
  });

  it('function + constant', () => {
    const result = formulaToCsn('DAYS_BETWEEN(Order_Creation_Date, Order_Delivery_Date) + 1');
    expect(result[1]).toBe('+');
    expect(result[2]).toEqual({ val: 1 });
  });

  it('string literal', () => {
    const result = formulaToCsn("CONCAT(PURCHASEORDER, '-')");
    expect(result[0]).toEqual({
      func: 'CONCAT',
      args: [{ ref: ['PURCHASEORDER'] }, { val: '-' }],
    });
  });

  it('nested function', () => {
    const result = formulaToCsn('ABS(ROUND(Processing_Days, 2))');
    expect((result[0] as { func: string }).func).toBe('ABS');
  });

  it('CASE expression produces xpr', () => {
    const result = formulaToCsn('CASE WHEN Processing_Days > 0 THEN Processing_Days ELSE 0 END');
    expect(Array.isArray(result)).toBe(true);
    // Should contain 'case' keyword inside
    const flat = JSON.stringify(result);
    expect(flat).toContain('case');
  });

  it('round-trips through JSON.parse', () => {
    const result = formulaToCsn('Processing_Days / Total_Delivered_Order');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

// ── Topo exporter ──────────────────────────────────────────────────────────────
describe('exportCsnFiles', () => {
  it('returns files in topological order', () => {
    const files = exportCsnFiles(PO_PROCESSING_TIME_GRAPH);
    expect(files.length).toBeGreaterThan(0);

    // Intermediate view must come before fact view
    const intermediateIdx = files.findIndex(f => f.technicalName === 'V_PO_FINAL_DELIVERY_APT');
    const factIdx = files.findIndex(f => f.technicalName === 'F_PO_PROCESSING_TIME_APT');
    const amIdx = files.findIndex(f => f.technicalName === 'AM_PO_APT');

    expect(intermediateIdx).toBeLessThan(factIdx);
    expect(factIdx).toBeLessThan(amIdx);
  });

  it('order field matches position', () => {
    const files = exportCsnFiles(PO_PROCESSING_TIME_GRAPH);
    for (let i = 0; i < files.length; i++) {
      expect(files[i].order).toBe(i + 1);
    }
  });

  it('fact view uses experimental template', () => {
    const files = exportCsnFiles(PO_PROCESSING_TIME_GRAPH);
    const fact = files.find(f => f.technicalName === 'F_PO_PROCESSING_TIME_APT');
    expect(fact?.templateKind).toBe('experimental');
  });

  it('analytic model uses experimental template', () => {
    const files = exportCsnFiles(PO_PROCESSING_TIME_GRAPH);
    const am = files.find(f => f.technicalName === 'AM_PO_APT');
    expect(am?.templateKind).toBe('experimental');
  });

  it('intermediate view uses verified template', () => {
    const files = exportCsnFiles(PO_PROCESSING_TIME_GRAPH);
    const iv = files.find(f => f.technicalName === 'V_PO_FINAL_DELIVERY_APT');
    expect(iv?.templateKind).toBe('verified');
  });

  it('all files round-trip through JSON.parse', () => {
    const files = exportCsnFiles(PO_PROCESSING_TIME_GRAPH);
    for (const f of files) {
      const str = JSON.stringify(f.content);
      expect(JSON.parse(str)).toEqual(f.content);
    }
  });
});

// ── patchExistingCsn ───────────────────────────────────────────────────────────
describe('patchExistingCsn', () => {
  const original = {
    definitions: {
      F_PO_PROCESSING_TIME_APT: {
        kind: 'entity',
        elements: {
          PURCHASEORDER: { '@EndUserText.label': 'Purchase Order Number', type: 'cds.String', length: 10 },
          Processing_Days: { '@EndUserText.label': 'Processing Days', type: 'cds.Integer' },
        },
      },
    },
  };

  it('adds only new elements', () => {
    const { patched, addedKeys } = patchExistingCsn(
      original,
      'F_PO_PROCESSING_TIME_APT',
      {
        APT: {
          '@EndUserText.label': 'Average Processing Time',
          type: 'cds.Decimal',
          precision: 31,
          scale: 10,
        },
      }
    );

    expect(addedKeys).toEqual(['APT']);
    const defs = patched['definitions'] as Record<string, unknown>;
    const entity = defs['F_PO_PROCESSING_TIME_APT'] as Record<string, unknown>;
    const elements = entity['elements'] as Record<string, unknown>;
    expect(elements).toHaveProperty('APT');
    expect(elements).toHaveProperty('PURCHASEORDER'); // unchanged
    expect(elements).toHaveProperty('Processing_Days'); // unchanged
  });

  it('does not modify original', () => {
    patchExistingCsn(original, 'F_PO_PROCESSING_TIME_APT', { NEW_COL: { type: 'cds.Integer' } });
    const defs = original['definitions'] as Record<string, unknown>;
    const entity = defs['F_PO_PROCESSING_TIME_APT'] as Record<string, unknown>;
    const elements = entity['elements'] as Record<string, unknown>;
    expect(elements).not.toHaveProperty('NEW_COL');
  });

  it('skips already-existing elements', () => {
    const { addedKeys } = patchExistingCsn(
      original,
      'F_PO_PROCESSING_TIME_APT',
      { PURCHASEORDER: { '@EndUserText.label': 'OVERWRITE' } }
    );
    expect(addedKeys).toHaveLength(0);
  });
});

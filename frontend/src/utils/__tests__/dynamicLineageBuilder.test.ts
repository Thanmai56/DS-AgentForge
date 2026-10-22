import { describe, it, expect } from 'vitest';
import { compressAndExtractSchema } from '../schemaCompressor';
import { buildDynamicLineage } from '../dynamicLineageBuilder';

describe('schemaCompressor - Zero Hardcoding Tests', () => {
  it('should parse an arbitrary custom schema array (e.g. Sales domain)', () => {
    const customInput = [
      {
        name: 'VBAK',
        business_name: 'Sales Document: Header Data',
        columns: [
          { name: 'VBELN', data_type: 'NVARCHAR(10)', is_key: true, label: 'Sales Document' },
          { name: 'KUNNR', data_type: 'NVARCHAR(10)', is_key: false, label: 'Customer Number' },
          { name: 'NETWR', data_type: 'DECIMAL(15,2)', is_key: false, label: 'Net Value', semantic_role: 'measure' },
        ],
      },
      {
        name: 'KNA1',
        business_name: 'General Data in Customer Master',
        columns: [
          { name: 'KUNNR', data_type: 'NVARCHAR(10)', is_key: true, label: 'Customer Number' },
          { name: 'NAME1', data_type: 'NVARCHAR(35)', is_key: false, label: 'Name 1' },
          { name: 'LAND1', data_type: 'NVARCHAR(3)', is_key: false, label: 'Country Key' },
        ],
      },
    ];

    const compressed = compressAndExtractSchema(customInput);
    expect(compressed).toHaveLength(2);
    expect(compressed[0].name).toBe('VBAK');
    expect(compressed[0].fields).toHaveLength(3);
    expect(compressed[0].fields[0].is_key).toBe(true);
    expect(compressed[1].name).toBe('KNA1');
    expect(compressed[1].fields).toHaveLength(3);
  });

  it('should parse arbitrary dictionary/map of tables', () => {
    const dictInput = {
      FLIGHTS: {
        business_name: 'Flight Schedule',
        columns: [
          { name: 'CARRID', data_type: 'NVARCHAR(3)', key: true },
          { name: 'CONNID', data_type: 'NVARCHAR(4)', key: true },
          { name: 'PRICE', data_type: 'DECIMAL(9,2)', semantic_role: 'measure' },
        ],
      },
      AIRLINES: {
        business_name: 'Airline Carrier Names',
        columns: [
          { name: 'CARRID', data_type: 'NVARCHAR(3)', key: true },
          { name: 'CARRNAME', data_type: 'NVARCHAR(20)' },
        ],
      },
    };

    const compressed = compressAndExtractSchema(dictInput);
    expect(compressed).toHaveLength(2);
    expect(compressed.map((c) => c.name)).toContain('FLIGHTS');
    expect(compressed.map((c) => c.name)).toContain('AIRLINES');
  });

  it('should parse arbitrary CSN definitions without "Z" prefix requirement', () => {
    const csnInput = {
      definitions: {
        CUSTOM_HEADER: {
          kind: 'entity',
          '@EndUserText.label': 'Custom Header Entity',
          elements: {
            DOC_ID: { key: true, type: 'cds.String', length: 10 },
            AMOUNT: { type: 'cds.Decimal', precision: 12, scale: 2 },
          },
        },
      },
    };

    const compressed = compressAndExtractSchema(csnInput);
    expect(compressed).toHaveLength(1);
    expect(compressed[0].name).toBe('CUSTOM_HEADER');
    expect(compressed[0].kind).toBe('table');
    expect(compressed[0].fields[0].name).toBe('DOC_ID');
    expect(compressed[0].fields[0].is_key).toBe(true);
  });

  it('excludes delta replication entities from compressed metadata and lineage', () => {
    const compressed = compressAndExtractSchema({
      definitions: {
        'RAD_S3P.I_SUPPLIER': {
          kind: 'entity',
          '@DataWarehouse.delta': { deltaFromEntities: ['I_SUPPLIER_Delta'] },
          elements: { Supplier: { type: 'cds.String' } },
        },
        'RAD_S3P.I_SUPPLIER_Delta': {
          kind: 'entity',
          elements: { Supplier: { type: 'cds.String' } },
        },
      },
    });
    const lineage = buildDynamicLineage(compressed);

    expect(compressed.map((entity) => entity.name)).toEqual(['RAD_S3P.I_SUPPLIER']);
    expect(lineage.nodes.map((node) => node.technicalName)).not.toContain('RAD_S3P.I_SUPPLIER_Delta');
  });

  it('excludes delta-suffixed sources from table-list uploads', () => {
    const compressed = compressAndExtractSchema([
      { name: 'I_SUPPLIER', columns: [{ name: 'SUPPLIER', data_type: 'NVARCHAR' }] },
      { name: 'I_SUPPLIER_Delta', columns: [{ name: 'SUPPLIER', data_type: 'NVARCHAR' }] },
    ]);

    expect(compressed.map((entity) => entity.name)).toEqual(['I_SUPPLIER']);
  });

  it('classifies query-backed CSN entities as views and extracts their source table', () => {
    const csnInput = {
      definitions: {
        V_MBEW_DIM: {
          kind: 'entity',
          '@EndUserText.label': 'Material Valuation Dimension',
          elements: {
            MATNR: { type: 'cds.String', length: 40, key: true },
            TEST: {
              type: 'cds.Decimal',
              precision: 10,
              scale: 2,
              '@EndUserText.label': 'Test flag',
              '@AnalyticsDetails.measureType': { '#': 'BASE' },
            },
          },
          query: {
            SELECT: {
              from: { ref: ['MBEW'], as: 'MBEW' },
              columns: [
                { ref: ['MBEW', 'MATNR'] },
                { ref: ['MBEW', 'TEST'] },
              ],
            },
          },
        },
      },
    };

    const [view] = compressAndExtractSchema(csnInput);
    expect(view.kind).toBe('view');
    expect(view.sources).toEqual(['MBEW']);
    expect(view.fields.map((field) => field.name)).toEqual(['MATNR']);

    const lineage = buildDynamicLineage([view]);
    expect(lineage.nodes.map((node) => node.technicalName)).toEqual(['V_MBEW_DIM', 'MBEW']);
    expect(lineage.edges).toContainEqual({
      id: 'edge-MBEW-V_MBEW_DIM',
      source: 'MBEW',
      target: 'V_MBEW_DIM',
    });
    expect(lineage.warnings).toContain(
      'Source "MBEW" is referenced by an uploaded view but its schema was not uploaded.',
    );
    expect(lineage.nodes.every((node) =>
      node.fields.every((field) => field.name.toUpperCase() !== 'TEST'),
    )).toBe(true);
  });

  it('omits TEST columns from uploaded table column arrays', () => {
    const [table] = compressAndExtractSchema([{
      name: 'MBEW',
      columns: [
        { name: 'MATNR', data_type: 'NVARCHAR(40)', is_key: true },
        { name: 'TEST', data_type: 'DECIMAL(10,2)', semantic_role: 'measure' },
      ],
    }]);

    expect(table.fields.map((field) => field.name)).toEqual(['MATNR']);
  });

  it('never includes TEST fields in generated source or dimension nodes', () => {
    const lineage = buildDynamicLineage([{
      name: 'MBEW',
      business_name: 'Material Valuation',
      kind: 'table',
      fields: [
        { name: 'MATNR', data_type: 'NVARCHAR(40)', is_key: true, label: 'Material', semantic_role: 'key' },
        { name: 'TEST', data_type: 'cds.String', is_key: false, label: 'Test', semantic_role: 'dimension' },
      ],
      sources: [],
    }]);

    expect(lineage.nodes.flatMap((node) => node.fields.map((field) => field.name)))
      .not.toContain('TEST');
  });
});

describe('dynamicLineageBuilder - Zero Hardcoding Tests', () => {
  it('preserves the accepted plan graph instead of inferring a different model', () => {
    const planEntities = [
      {
        name: 'EKKO',
        business_name: 'PO Header',
        kind: 'table' as const,
        fields: [
          { name: 'PURCHASEORDER', data_type: 'NVARCHAR', is_key: true, label: 'PO', semantic_role: 'key' as const },
          { name: 'CREATIONDATE', data_type: 'DATE', is_key: false, label: 'Creation Date', semantic_role: 'date' as const },
        ],
        sources: [],
      },
      {
        name: 'L3_FINALIZED_FACT',
        business_name: 'Finalized Fact',
        kind: 'fact' as const,
        fields: [],
        sources: ['EKKO', 'L1_HISTORY'],
      },
      {
        name: 'L4_FINALIZED_MODEL',
        business_name: 'Finalized Model',
        kind: 'analytic_model' as const,
        fields: [],
        sources: ['L3_FINALIZED_FACT'],
      },
    ];

    const lineage = buildDynamicLineage(planEntities, 'Purchase order processing time', {
      preserveInputGraph: true,
    });

    expect(lineage.nodes.map((node) => node.technicalName)).toEqual([
      'EKKO',
      'L3_FINALIZED_FACT',
      'L4_FINALIZED_MODEL',
      'L1_HISTORY',
    ]);
    expect(lineage.edges).toContainEqual({
      id: 'edge-L3_FINALIZED_FACT-L4_FINALIZED_MODEL',
      source: 'L3_FINALIZED_FACT',
      target: 'L4_FINALIZED_MODEL',
    });
    expect(lineage.nodes.map((node) => node.technicalName)).not.toContain('V_EKKO_DIM');
    expect(lineage.nodes.map((node) => node.technicalName)).not.toContain('F_PO_PROCESSING_TIME_APT');
  });

  it('dynamically generates full 4-tier semantic lineage for arbitrary tables', () => {
    const tables = [
      {
        name: 'VBAK',
        business_name: 'Sales Header',
        kind: 'table' as const,
        fields: [
          { name: 'VBELN', data_type: 'NVARCHAR(10)', is_key: true, label: 'Sales Order', semantic_role: 'key' as const },
          { name: 'KUNNR', data_type: 'NVARCHAR(10)', is_key: false, label: 'Customer', semantic_role: 'dimension' as const },
          { name: 'NETWR', data_type: 'DECIMAL(15,2)', is_key: false, label: 'Net Amount', semantic_role: 'measure' as const },
        ],
        sources: [],
      },
      {
        name: 'KNA1',
        business_name: 'Customer Master',
        kind: 'table' as const,
        fields: [
          { name: 'KUNNR', data_type: 'NVARCHAR(10)', is_key: true, label: 'Customer', semantic_role: 'key' as const },
          { name: 'NAME1', data_type: 'NVARCHAR(35)', is_key: false, label: 'Name', semantic_role: 'dimension' as const },
        ],
        sources: [],
      },
    ];

    const lineage = buildDynamicLineage(tables);
    expect(lineage.nodes).toHaveLength(5);

    // Tier 0: Source Tables
    const nodeNames = lineage.nodes.map((n) => n.technicalName);
    expect(nodeNames).toContain('VBAK');
    expect(nodeNames).toContain('KNA1');

    // Tier 1: Dimension View for KNA1
    expect(nodeNames).toContain('V_KNA1_DIM');

    // Tier 2: Fact View for VBAK
    expect(nodeNames).toContain('F_VBAK_FACT');

    // Tier 3: Analytic Model for VBAK
    expect(nodeNames).toContain('AM_VBAK_MODEL');

    // Check dynamic joins
    const factNode = lineage.nodes.find((n) => n.technicalName === 'F_VBAK_FACT');
    expect(factNode).toBeDefined();
    expect(factNode?.sources).toEqual(['VBAK', 'V_KNA1_DIM']);
    expect(factNode?.joins).toHaveLength(1);
    expect(factNode?.joins?.[0]).toMatchObject({
      leftSource: 'VBAK',
      rightSource: 'V_KNA1_DIM',
      leftField: 'KUNNR',
      rightField: 'KUNNR',
    });
    expect(factNode?.filters).toBeUndefined();

    // Check dynamic edges
    expect(lineage.edges.length).toBeGreaterThanOrEqual(3);
    const edgeTargets = lineage.edges.map((e) => `${e.source}->${e.target}`);
    expect(edgeTargets).toContain('KNA1->V_KNA1_DIM');
    expect(edgeTargets).toContain('VBAK->F_VBAK_FACT');
    expect(edgeTargets).toContain('V_KNA1_DIM->F_VBAK_FACT');
    expect(edgeTargets).toContain('F_VBAK_FACT->AM_VBAK_MODEL');
  });

  it('builds processing-time measures from PO dates instead of rounding quantity', () => {
    const tables = [
      {
        name: 'ZIPOHDRAPT',
        business_name: 'Purchase Order Header',
        kind: 'table' as const,
        fields: [
          { name: 'PURCHASEORDER', data_type: 'NVARCHAR(10)', is_key: true, label: 'Purchase Order', semantic_role: 'key' as const },
          { name: 'CREATIONDATE', data_type: 'VARCHAR(8)', is_key: false, label: 'Creation Date', semantic_role: 'date' as const },
          { name: 'SUPPLIER', data_type: 'NVARCHAR(10)', is_key: false, label: 'Supplier', semantic_role: 'dimension' as const },
        ],
        sources: [],
      },
      {
        name: 'ZIPOHISTEXT',
        business_name: 'Purchase Order History',
        kind: 'table' as const,
        fields: [
          { name: 'PURCHASEORDER', data_type: 'NVARCHAR(10)', is_key: true, label: 'Purchase Order', semantic_role: 'key' as const },
          { name: 'DELIVERYDATE', data_type: 'VARCHAR(8)', is_key: false, label: 'Delivery Date', semantic_role: 'date' as const },
          { name: 'QUANTITY', data_type: 'DECIMAL(13,3)', is_key: false, label: 'Goods Receipt Quantity', semantic_role: 'measure' as const },
        ],
        sources: [],
      },
      {
        name: 'LFA1',
        business_name: 'Vendor Master',
        kind: 'table' as const,
        fields: [
          { name: 'LIFNR', data_type: 'NVARCHAR(10)', is_key: true, label: 'Vendor', semantic_role: 'key' as const },
          { name: 'NAME1', data_type: 'NVARCHAR(35)', is_key: false, label: 'Vendor Name', semantic_role: 'dimension' as const },
        ],
        sources: [],
      },
    ];

    const lineage = buildDynamicLineage(
      tables,
      'Build a purchasing view chain to compute PO Average Processing Time in days across vendor dimensions.',
    );
    const fact = lineage.nodes.find((node) => node.kind === 'fact');
    const model = lineage.nodes.find((node) => node.kind === 'analytic_model');
    const finalDelivery = lineage.nodes.find((node) => node.technicalName === 'V_PO_FINAL_DELIVERY_APT');

    expect(lineage.warnings).toContain(
      'No explicit completed-order flag was found; only orders with a final delivery date are included.',
    );
    expect(lineage.nodes.map((node) => node.technicalName)).toContain('V_LFA1_DIM');
    expect(finalDelivery?.groupBy).toEqual(['PURCHASEORDER']);
    expect(fact?.calculatedFields?.find((field) => field.name === 'Processing_Days')?.formula)
      .toBe('DAYS_BETWEEN(Order_Creation_Date, Order_Delivery_Date)');
    expect(fact?.filters).toContain('FINAL_DELIVERY_DATE IS NOT NULL');
    expect(fact?.fields.some((field) => field.name === 'QUANTITY')).toBe(false);
    expect(fact?.joins).toContainEqual(expect.objectContaining({
      leftField: 'SUPPLIER',
      rightField: 'LIFNR',
    }));
    expect(fact?.fields.some((field) => field.name === 'NET_TOTAL')).toBe(false);
    expect(model?.calculatedFields?.[0]).toMatchObject({
      name: 'AVERAGE_PROCESSING_TIME',
      formula: 'AVG(Processing_Days)',
    });
    expect(model?.fields.find((field) => field.name === 'AVERAGE_PROCESSING_TIME')?.aggregation)
      .toBe('AVG');

    const withoutVendor = buildDynamicLineage(
      tables.slice(0, 2),
      'Build a purchasing view chain for average processing time.',
    );
    expect(withoutVendor.warnings).toContain(
      'Vendor master data was not provided or could not be matched; vendor dimensions are not joined.',
    );
  });

  it('completes the PO chain when uploaded metadata already includes the final-delivery view', () => {
    const uploaded = [
      {
        name: 'ZIPOHDRAPT',
        business_name: 'Purchase Order Header',
        kind: 'table' as const,
        fields: [
          { name: 'PURCHASEORDER', data_type: 'NVARCHAR(10)', is_key: true, label: 'PO', semantic_role: 'key' as const },
          { name: 'CREATIONDATE', data_type: 'VARCHAR(8)', is_key: false, label: 'Creation Date', semantic_role: 'date' as const },
          { name: 'SUPPLIER', data_type: 'NVARCHAR(10)', is_key: false, label: 'Supplier', semantic_role: 'dimension' as const },
        ],
        sources: [],
      },
      {
        name: 'V_PO_FINAL_DELIVERY_APT',
        business_name: 'PO Final Delivery',
        kind: 'view' as const,
        fields: [
          { name: 'PURCHASEORDER', data_type: 'NVARCHAR(10)', is_key: true, label: 'PO', semantic_role: 'key' as const },
          { name: 'FINAL_DELIVERY_DATE', data_type: 'VARCHAR(8)', is_key: false, label: 'Final Delivery Date', semantic_role: 'date' as const },
        ],
        sources: ['ZIPOHISTEXT'],
      },
    ];

    const lineage = buildDynamicLineage(
      uploaded,
      'Build a purchasing view chain joining PO headers, history, and vendor master to calculate PO Average Processing Time.',
    );
    const names = lineage.nodes.map((node) => node.technicalName);

    expect(names).toContain('F_PO_PROCESSING_TIME_FACT');
    expect(names).toContain('AM_PO_PROCESSING_TIME_MODEL');
    expect(names.filter((name) => name === 'V_PO_FINAL_DELIVERY_APT')).toHaveLength(1);
    expect(lineage.edges).toContainEqual({
      id: 'edge-V_PO_FINAL_DELIVERY_APT-F_PO_PROCESSING_TIME_FACT',
      source: 'V_PO_FINAL_DELIVERY_APT',
      target: 'F_PO_PROCESSING_TIME_FACT',
    });
    expect(lineage.warnings).toContain(
      'Source "ZIPOHISTEXT" is referenced by an uploaded view but its schema was not uploaded.',
    );
  });

  it('does not fall back to an unrelated amount KPI when PO date fields are missing', () => {
    const lineage = buildDynamicLineage(
      [{
        name: 'PO_HISTORY',
        business_name: 'PO History',
        kind: 'table',
        fields: [{
          name: 'QUANTITY',
          data_type: 'DECIMAL',
          is_key: false,
          label: 'Quantity',
          semantic_role: 'measure',
        }],
        sources: [],
      }],
      'Compute average processing time in days.',
    );

    expect(lineage.nodes.some((node) => node.technicalName === 'AM_PO_HISTORY_MODEL')).toBe(false);
    expect(lineage.nodes.some((node) => node.fields.some((field) => field.name === 'NET_TOTAL'))).toBe(false);
    expect(lineage.warnings).toContain(
      'Could not build the processing-time model: source metadata must include a PO number, creation date, and delivery date.',
    );
  });
});

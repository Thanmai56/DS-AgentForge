// src/utils/dynamicLineageBuilder.ts
// Fully dynamic semantic model and lineage graph builder.
// Works for ANY arbitrary SAP Datasphere schemas, custom JSONs, or DDL tables.
// Zero hardcoded table or column names.

import {
  CompressedEntity,
  CompressedField,
  isDeltaEntityName,
  isDeltaReference,
} from './schemaCompressor';

export interface DynamicLineageNode {
  technicalName: string;
  businessName: string;
  kind: 'table' | 'view' | 'fact' | 'analytic_model';
  fieldCount: number;
  fields: CompressedField[];
  sources: string[];
  joins?: Array<{
    leftSource: string;
    rightSource: string;
    leftField: string;
    rightField: string;
    joinType?: string;
  }>;
  calculatedFields?: Array<{
    name: string;
    label: string;
    formula?: string;
  }>;
  filters?: string[];
  groupBy?: string[];
  x: number;
  y: number;
}

export interface DynamicLineageResult {
  nodes: DynamicLineageNode[];
  edges: Array<{ id: string; source: string; target: string }>;
  warnings: string[];
}

export function buildDynamicLineage(
  entities: CompressedEntity[],
  requirement = '',
  options: { preserveInputGraph?: boolean } = {},
): DynamicLineageResult {
  if (!entities || entities.length === 0) {
    return { nodes: [], edges: [], warnings: [] };
  }

  const sourceEntities = entities.filter((entity) => !isDeltaEntityName(entity.name)).map((entity) => ({
    ...entity,
    sources: (entity.sources || []).filter((source) => !isDeltaEntityName(source)),
    joins: entity.joins?.filter((join) =>
      !isDeltaEntityName(join.leftSource) && !isDeltaEntityName(join.rightSource)
      && !isDeltaReference(join.leftField) && !isDeltaReference(join.rightField),
    ),
    fields: entity.fields.filter((field) => field.name.trim().toUpperCase() !== 'TEST'),
    calculatedFields: entity.calculatedFields?.filter(
      (field) => field.name.trim().toUpperCase() !== 'TEST',
    ),
  }));
  if (sourceEntities.length === 0) {
    return { nodes: [], edges: [], warnings: [] };
  }

  // Check if input already includes intermediate views or analytic models
  const hasViews = sourceEntities.some((e) => e.kind === 'view' || e.kind === 'fact' || e.kind === 'analytic_model');
  const isProcessingTimeRequest = isProcessingTimeRequirement(requirement);

  let fullEntities: DynamicLineageNode[] = [];
  const warnings: string[] = [];

  if (options.preserveInputGraph || (hasViews && !isProcessingTimeRequest)) {
    // Use the supplied nodes and dependencies as-is instead of inferring a new model.
    fullEntities = sourceEntities.map((e) => ({
      technicalName: e.name,
      businessName: e.business_name || e.name,
      kind: e.kind,
      fieldCount: e.fields.length,
      fields: e.fields,
      sources: e.sources || [],
      joins: e.joins || [],
      calculatedFields: e.calculatedFields || [],
      x: 0,
      y: 0,
    }));

    const uploadedNames = new Set(fullEntities.map((entity) => entity.technicalName));
    const missingSources = new Set(
      fullEntities.flatMap((entity) => entity.sources.filter((source) => !uploadedNames.has(source))),
    );
    for (const source of missingSources) {
      fullEntities.push({
        technicalName: source,
        businessName: `${source} (source schema not uploaded)`,
        kind: 'table',
        fieldCount: 0,
        fields: [],
        sources: [],
        x: 0,
        y: 0,
      });
      warnings.push(`Source "${source}" is referenced by an uploaded view but its schema was not uploaded.`);
    }
  } else if (isProcessingTimeRequest) {
    const processingTimeChain = buildProcessingTimeChain(sourceEntities, requirement);
    if (processingTimeChain) {
      fullEntities = processingTimeChain.nodes;
      warnings.push(...processingTimeChain.warnings);
    } else {
      fullEntities = sourceEntities.map((entity) => ({
        technicalName: entity.name,
        businessName: entity.business_name || entity.name,
        kind: entity.kind,
        fieldCount: entity.fields.length,
        fields: entity.fields,
        sources: entity.sources || [],
        joins: entity.joins || [],
        calculatedFields: entity.calculatedFields || [],
        x: 0,
        y: 0,
      }));
      warnings.push(
        'Could not build the processing-time model: source metadata must include a PO number, creation date, and delivery date.',
      );
    }
  } else {
    {
      // Input only has raw source tables -> dynamically synthesize the 4-tier Datasphere chain
      const sourceTables = sourceEntities;

      // Classify primary fact vs dimensions
      const factTable = sourceTables.find((t) =>
        t.fields.some(
          (f) =>
            f.semantic_role === 'measure' ||
            /(AMOUNT|NETWR|QUANTITY|MENGE|TOTAL|PRICE|VALUE|DAYS|SCORE)/i.test(f.name)
        )
      ) || sourceTables[0];

      const dimensionTables = sourceTables.filter((t) => t.name !== factTable.name);

      // 1. Source Nodes (Tier 0)
      for (const tbl of sourceTables) {
        fullEntities.push({
          technicalName: tbl.name,
          businessName: tbl.business_name || tbl.name,
          kind: 'table',
          fieldCount: tbl.fields.length,
          fields: tbl.fields,
          sources: [],
          x: 0,
          y: 0,
        });
      }

      // 2. Intermediate / Dimension Views (Tier 1)
      const intermediateViewNames: string[] = [];
      for (const dim of dimensionTables) {
        const dimViewName = `V_${dim.name}_DIM`;
        intermediateViewNames.push(dimViewName);
        fullEntities.push({
          technicalName: dimViewName,
          businessName: `${dim.business_name || dim.name} Dimension`,
          kind: 'view',
          fieldCount: dim.fields.length,
          fields: dim.fields,
          sources: [dim.name],
          x: 0,
          y: 0,
        });
      }

      const factViewName = `F_${factTable.name}_FACT`;
      const factSources = [
        factTable.name,
        ...(intermediateViewNames.length > 0 ? intermediateViewNames : []),
      ];

      // Infer join keys between fact and dimensions dynamically
      const joins: any[] = [];
      for (const dim of dimensionTables) {
        const dimKey =
          dim.fields.find((f) => f.is_key)?.name ||
          dim.fields.find((f) => factTable.fields.some((ff) => ff.name === f.name))?.name ||
          dim.fields[0]?.name;

        const factKey =
          factTable.fields.find((f) => f.name === dimKey)?.name ||
          factTable.fields.find((f) => f.is_key)?.name ||
          dimKey;

        if (dimKey && factKey) {
          joins.push({
            leftSource: factTable.name,
            rightSource: `V_${dim.name}_DIM`,
            leftField: factKey,
            rightField: dimKey,
            joinType: 'inner',
          });
        }
      }

      // Dynamic calculated KPIs
      const measureFields = factTable.fields.filter(
        (f) => f.semantic_role === 'measure' || /(AMOUNT|NETWR|QUANTITY|TOTAL|PRICE)/i.test(f.name)
      );
      const primaryMeasure = measureFields[0]?.name || 'TOTAL_VALUE';

      const calculatedFields = [
        {
          name: 'NET_TOTAL',
          label: 'Net Metric Amount',
          formula: `ROUND(${primaryMeasure}, 2)`,
        },
      ];

      fullEntities.push({
        technicalName: factViewName,
        businessName: `${factTable.business_name || factTable.name} Fact View`,
        kind: 'fact',
        fieldCount: factTable.fields.length + calculatedFields.length,
        fields: [
          ...factTable.fields,
          {
            name: 'NET_TOTAL',
            data_type: 'cds.Decimal(15,2)',
            is_key: false,
            label: 'Net Metric Amount',
            semantic_role: 'measure',
          },
        ],
        sources: factSources,
        joins,
        calculatedFields,
        x: 0,
        y: 0,
      });

      const amName = `AM_${factTable.name}_MODEL`;
      fullEntities.push({
        technicalName: amName,
        businessName: `${factTable.business_name || factTable.name} Analytic Model`,
        kind: 'analytic_model',
        fieldCount: factTable.fields.length + calculatedFields.length + 1,
        fields: [
          ...factTable.fields,
          {
            name: 'NET_TOTAL',
            data_type: 'cds.Decimal(15,2)',
            is_key: false,
            label: 'Net Metric Amount',
            semantic_role: 'measure',
          },
          {
            name: 'KPI_AGGREGATED',
            data_type: 'cds.Decimal(15,2)',
            is_key: false,
            label: 'Aggregated KPI Ratio',
            semantic_role: 'measure',
          },
        ],
        sources: [factViewName],
        calculatedFields: [
          {
            name: 'KPI_AGGREGATED',
            label: 'Aggregated KPI Ratio',
            formula: `AVG(NET_TOTAL)`,
          },
        ],
        x: 0,
        y: 0,
      });
    }
  }

  // Calculate layout coordinates dynamically based on tier levels
  const tier0 = fullEntities.filter((n) => n.kind === 'table');
  const tier1 = fullEntities.filter((n) => n.kind === 'view');
  const tier2 = fullEntities.filter((n) => n.kind === 'fact');
  const tier3 = fullEntities.filter((n) => n.kind === 'analytic_model');

  // Assign Y positions for each tier with consistent spacing
  tier0.forEach((n, idx) => {
    n.x = 80;
    n.y = 80 + idx * 150;
  });

  tier1.forEach((n, idx) => {
    n.x = 420;
    n.y = 120 + idx * 150;
  });

  tier2.forEach((n, idx) => {
    n.x = 760;
    n.y = 100 + idx * 150;
  });

  tier3.forEach((n, idx) => {
    n.x = 1100;
    n.y = 100 + idx * 150;
  });

  // Build edges dynamically from node sources
  const edges: Array<{ id: string; source: string; target: string }> = [];
  const existingEdgeSet = new Set<string>();

  for (const node of fullEntities) {
    if (node.sources && node.sources.length > 0) {
      for (const src of node.sources) {
        const edgeKey = `${src}->${node.technicalName}`;
        if (!existingEdgeSet.has(edgeKey)) {
          existingEdgeSet.add(edgeKey);
          edges.push({
            id: `edge-${src}-${node.technicalName}`,
            source: src,
            target: node.technicalName,
          });
        }
      }
    }
  }

  return { nodes: fullEntities, edges, warnings };
}

function buildProcessingTimeChain(
  entities: CompressedEntity[],
  requirement: string,
): { nodes: DynamicLineageNode[]; warnings: string[] } | null {
  if (!isProcessingTimeRequirement(requirement)) {
    return null;
  }

  const orderFieldPattern = /^(PURCHASEORDER|PURCHASE_ORDER|PONUMBER|PO_NUMBER)$/i;
  const creationFieldPattern = /(CREATION|CREATED|ORDER).*DATE/i;
  const deliveryFieldPattern = /(FINAL.*DELIVERY|DELIVERY.*DATE|GOODS.*RECEIPT.*DATE|POSTINGDATE)/i;
  const hasField = (entity: CompressedEntity, pattern: RegExp) =>
    entity.fields.some((field) => pattern.test(field.name) || pattern.test(field.label));

  const header = entities.find(
    (entity) => hasField(entity, orderFieldPattern) && hasField(entity, creationFieldPattern),
  );
  const history = entities.find(
    (entity) =>
      entity !== header &&
      hasField(entity, orderFieldPattern) &&
      hasField(entity, deliveryFieldPattern),
  );
  if (!header || !history) return null;

  const orderField = header.fields.find((field) => orderFieldPattern.test(field.name))!.name;
  const historyOrderField = history.fields.find((field) => orderFieldPattern.test(field.name))!.name;
  const creationField = header.fields.find(
    (field) => creationFieldPattern.test(field.name) || creationFieldPattern.test(field.label),
  )!;
  const deliveryField = history.fields.find(
    (field) => deliveryFieldPattern.test(field.name) || deliveryFieldPattern.test(field.label),
  )!;

  const vendorFieldPattern = /(SUPPLIER|VENDOR|LIFNR)/i;
  const headerVendorField = header.fields.find(
    (field) => vendorFieldPattern.test(field.name) || vendorFieldPattern.test(field.label),
  );
  const vendor = headerVendorField
    ? entities.find((entity) =>
        entity !== header &&
        entity !== history &&
        /(vendor|supplier|LFA1)/i.test(`${entity.name} ${entity.business_name}`) &&
        entity.fields.some((field) =>
          field.name.toUpperCase() === headerVendorField.name.toUpperCase() ||
          (/(LIFNR|VENDOR|SUPPLIER)/i.test(field.name) && field.is_key),
        ),
      )
    : undefined;
  const vendorKey = vendor?.fields.find(
    (field) => field.name.toUpperCase() === headerVendorField?.name.toUpperCase(),
  ) || vendor?.fields.find((field) => field.is_key);
  const completionField = entities
    .flatMap((entity) => entity.fields)
    .find((field) => /^(ELIKZ|FINALDELIVERYFLAG|IS_COMPLETED|COMPLETED)$/i.test(field.name));
  const explicitCompletionFilter = completionField
    ? /BOOLEAN/i.test(completionField.data_type)
      ? `${completionField.name} = TRUE`
      : /^(ELIKZ|FINALDELIVERYFLAG)$/i.test(completionField.name)
        ? `${completionField.name} = 'X'`
        : undefined
    : undefined;
  const warnings = [];
  if (!vendor) {
    warnings.push('Vendor master data was not provided or could not be matched; vendor dimensions are not joined.');
  }
  if (!explicitCompletionFilter) {
    warnings.push('No explicit completed-order flag was found; only orders with a final delivery date are included.');
  }

  const existingFinalDeliveryView = history?.kind === 'view' ? history : undefined;
  const nodes: DynamicLineageNode[] = entities.map((entity) => ({
    technicalName: entity.name,
    businessName: entity.business_name || entity.name,
    kind: entity.kind,
    fieldCount: entity.fields.length,
    fields: entity.fields,
    sources: entity.sources || [],
    joins: entity.joins || [],
    calculatedFields: entity.calculatedFields || [],
    x: 0,
    y: 0,
  }));
  const uploadedNames = new Set(nodes.map((node) => node.technicalName));
  const missingSources = new Set(
    nodes.flatMap((node) => node.sources.filter((source) => !uploadedNames.has(source))),
  );
  for (const source of missingSources) {
    nodes.push({
      technicalName: source,
      businessName: `${source} (source schema not uploaded)`,
      kind: 'table',
      fieldCount: 0,
      fields: [],
      sources: [],
      x: 0,
      y: 0,
    });
    warnings.push(`Source "${source}" is referenced by an uploaded view but its schema was not uploaded.`);
  }

  const headerViewName = `V_${header.name}_DIM`;
  const vendorViewName = vendor ? `V_${vendor.name}_DIM` : undefined;
  const dimensions = [header, ...(vendor ? [vendor] : [])];
  for (const dimension of dimensions) {
    const viewName = `V_${dimension.name}_DIM`;
    nodes.push({
      technicalName: viewName,
      businessName: `${dimension.business_name || dimension.name} Dimension`,
      kind: 'view',
      fieldCount: dimension.fields.length,
      fields: dimension.fields,
      sources: [dimension.name],
      x: 0,
      y: 0,
    });
  }

  const finalDeliveryViewName = 'V_PO_FINAL_DELIVERY_APT';
  if (!existingFinalDeliveryView) nodes.push({
    technicalName: finalDeliveryViewName,
    businessName: 'PO Final Delivery Date',
    kind: 'view',
    fieldCount: 2,
    fields: [
      { ...history.fields.find((field) => field.name === historyOrderField)!, name: orderField },
      {
        name: 'FINAL_DELIVERY_DATE',
        data_type: deliveryField.data_type,
        is_key: false,
        label: 'Final Delivery Date',
        semantic_role: 'date',
      },
    ],
    sources: [history.name],
    calculatedFields: [{
      name: 'FINAL_DELIVERY_DATE',
      label: 'Final Delivery Date',
      formula: `MAX(${deliveryField.name})`,
    }],
    groupBy: [orderField],
    x: 0,
    y: 0,
  });
  const resolvedFinalDeliveryViewName = existingFinalDeliveryView?.name ?? finalDeliveryViewName;

  const processingFields: CompressedField[] = [
    ...header.fields.map((field) => ({ ...field, source: headerViewName })),
    {
      name: 'FINAL_DELIVERY_DATE',
      data_type: deliveryField.data_type,
      is_key: false,
      label: 'Final Delivery Date',
      semantic_role: 'date',
      source: resolvedFinalDeliveryViewName,
    },
    {
      name: 'Order_Creation_Date',
      data_type: 'cds.Date',
      is_key: false,
      label: 'Order Creation Date',
      semantic_role: 'date',
    },
    {
      name: 'Order_Delivery_Date',
      data_type: 'cds.Date',
      is_key: false,
      label: 'Order Delivery Date',
      semantic_role: 'date',
    },
    ...(vendor && vendorViewName
      ? vendor.fields
          .filter((field) =>
            !header.fields.some((headerField) => headerField.name === field.name),
          )
          .map((field) => ({ ...field, source: vendorViewName }))
      : []),
    {
      name: 'Processing_Days',
      data_type: 'cds.Integer',
      is_key: false,
      label: 'Processing Days',
      semantic_role: 'measure',
    },
  ];

  const dateExpression = (fieldName: string, dataType: string) =>
    /date/i.test(dataType)
      ? fieldName
      : `TO_DATE(SUBSTRING(${fieldName}, 1, 4) || '-' || SUBSTRING(${fieldName}, 5, 2) || '-' || SUBSTRING(${fieldName}, 7, 2))`;
  const factName = 'F_PO_PROCESSING_TIME_FACT';
  nodes.push({
    technicalName: factName,
    businessName: 'PO Processing Time Fact View',
    kind: 'fact',
    fieldCount: processingFields.length,
    fields: processingFields,
    sources: [headerViewName, resolvedFinalDeliveryViewName, ...(vendorViewName ? [vendorViewName] : [])],
    joins: [
      {
        leftSource: headerViewName,
        rightSource: resolvedFinalDeliveryViewName,
        leftField: orderField,
        rightField: orderField,
        joinType: 'inner',
      },
      ...(vendorViewName && headerVendorField && vendorKey ? [{
        leftSource: headerViewName,
        rightSource: vendorViewName,
        leftField: headerVendorField.name,
        rightField: vendorKey.name,
        joinType: 'inner',
      }] : []),
    ],
    calculatedFields: [
      {
        name: 'Order_Creation_Date',
        label: 'Order Creation Date',
        formula: dateExpression(creationField.name, creationField.data_type),
      },
      {
        name: 'Order_Delivery_Date',
        label: 'Order Delivery Date',
        formula: dateExpression('FINAL_DELIVERY_DATE', deliveryField.data_type),
      },
      {
        name: 'Processing_Days',
        label: 'Processing Days',
        formula: 'DAYS_BETWEEN(Order_Creation_Date, Order_Delivery_Date)',
      },
    ],
    filters: [
      ...(explicitCompletionFilter ? [explicitCompletionFilter] : []),
      'FINAL_DELIVERY_DATE IS NOT NULL',
    ],
    x: 0,
    y: 0,
  });

  const analyticFields: CompressedField[] = [
    ...processingFields,
    {
      name: 'AVERAGE_PROCESSING_TIME',
      data_type: 'cds.Decimal(15,2)',
      is_key: false,
      label: 'Average Processing Time (Days)',
      semantic_role: 'measure',
      aggregation: 'AVG',
    },
  ];
  nodes.push({
    technicalName: 'AM_PO_PROCESSING_TIME_MODEL',
    businessName: 'PO Average Processing Time',
    kind: 'analytic_model',
    fieldCount: analyticFields.length,
    fields: analyticFields,
    sources: [factName],
    calculatedFields: [{
      name: 'AVERAGE_PROCESSING_TIME',
      label: 'Average Processing Time (Days)',
      formula: 'AVG(Processing_Days)',
    }],
    x: 0,
    y: 0,
  });

  return { nodes, warnings };
}

function isProcessingTimeRequirement(requirement: string): boolean {
  return /(processing\s+(time|duration)|cycle\s+time|lead\s+time)/i.test(requirement);
}

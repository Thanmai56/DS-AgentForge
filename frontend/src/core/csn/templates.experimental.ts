// src/core/csn/templates.experimental.ts
// Structures sourced from real Datasphere exports (AM_PO_APT.json, F_PO_PROCESSING_TIME_APT.json).
// Each item marked: // VERIFY against real Datasphere export
// These are marked experimental because ds.md does not document them,
// but the user provided the real exports so they are trusted.

import type { FieldDef, CsnToken } from '../model/types';
import { buildElement } from './templates.verified';

// ── Fact view ─────────────────────────────────────────────────────────────────
// VERIFY against real Datasphere export
export function buildFactView(params: {
  technicalName: string;
  label: string;
  description?: string;
  purpose?: string;
  fields: FieldDef[];         // dimension fields
  measureFields: FieldDef[];  // measure fields with @AnalyticsDetails
  kpiFields: Array<{
    name: string;
    label: string;
    xpr: CsnToken[];
  }>;
  /** Raw query.SELECT from the existing CSN if deep-cloning */
  queryFrom?: unknown;
}): Record<string, unknown> {
  const elements: Record<string, unknown> = {};

  for (const f of params.fields) elements[f.name] = buildElement(f);

  for (const m of params.measureFields) {
    const el = buildElement(m);
    (el as Record<string, unknown>)['@AnalyticsDetails.measureType'] = { '#': 'BASE' }; // VERIFY
    (el as Record<string, unknown>)['@Aggregation.default'] = { '#': 'SUM' }; // VERIFY
    elements[m.name] = el;
  }

  for (const kpi of params.kpiFields) {
    elements[kpi.name] = {
      '@EndUserText.label': kpi.label,
      type: 'cds.Decimal',
      precision: 31,
      scale: 10,
      '@AnalyticsDetails.measureType': { '#': 'CALCULATION' }, // VERIFY
      '@Aggregation.default': { '#': 'FORMULA' }, // VERIFY
    };
  }

  // Use provided query.from or build a placeholder
  const queryFrom = params.queryFrom ?? { ref: [params.technicalName + '_SRC'], as: 'SRC' };

  return {
    definitions: {
      [params.technicalName]: {
        kind: 'entity',
        elements,
        query: {
          SELECT: {
            from: queryFrom,
          },
        },
        '@EndUserText.label': params.label,
        '@ObjectModel.modelingPattern': { '#': 'FACT' }, // VERIFY
        '@ObjectModel.supportedCapabilities': [
          { '#': 'SQL_DATA_SOURCE' }, // VERIFY
          { '#': 'ANALYTICAL_PROVIDER' }, // VERIFY
        ],
        ...(params.description
          ? { '@DataWarehouse.businessDefinition.description': params.description }
          : {}),
      },
    },
  };
}

// ── Analytic model ─────────────────────────────────────────────────────────────
// VERIFY against real Datasphere export
export function buildAnalyticModel(params: {
  technicalName: string;
  label: string;
  factViewRef: string;
  factViewAlias: string;
  dimensionFields: FieldDef[];
  measureFields: FieldDef[];
  kpiFields: Array<{
    name: string;
    label: string;
    xpr: CsnToken[];
  }>;
}): Record<string, unknown> {
  const elements: Record<string, unknown> = {};

  for (const f of params.dimensionFields) {
    elements[f.name] = { '@EndUserText.label': f.label };
  }

  for (const m of params.measureFields) {
    elements[m.name] = {
      '@EndUserText.label': m.label,
      '@AnalyticsDetails.measureType': { '#': 'BASE' }, // VERIFY
    };
  }

  for (const kpi of params.kpiFields) {
    elements[kpi.name] = {
      '@EndUserText.label': kpi.label,
      '@AnalyticsDetails.measureType': { '#': 'CALCULATION' }, // VERIFY
      '@Aggregation.default': { '#': 'FORMULA' }, // VERIFY
    };
  }

  // Build columns: dimension + measure refs + kpi xpr columns
  const columns: unknown[] = [
    ...params.dimensionFields.map(f => ({
      ref: [params.factViewAlias, f.name],
      as: f.name,
    })),
    ...params.measureFields.map(m => ({
      ref: [params.factViewAlias, m.name],
      as: m.name,
    })),
    ...params.kpiFields.map(kpi => ({
      xpr: kpi.xpr,
      as: kpi.name,
    })),
  ];

  return {
    definitions: {
      [params.technicalName]: {
        kind: 'entity',
        '@EndUserText.label': params.label,
        elements,
        '@ObjectModel.modelingPattern': { '#': 'ANALYTICAL_CUBE' }, // VERIFY
        '@ObjectModel.supportedCapabilities': [
          { '#': 'ANALYTICAL_PROVIDER' }, // VERIFY
          { '#': '_DWC_AM_EDITABLE_DIMENSION_NAMES' }, // VERIFY
        ],
        '@DataWarehouse.editorType': { '#': 'DWCQueryModelEditor' }, // VERIFY
        '@DataWarehouse.hanaCatalog.viewType': { '#': 'CALCULATION_VIEW' }, // VERIFY
        query: {
          SELECT: {
            from: {
              ref: [params.factViewRef],
              as: params.factViewAlias,
            },
            columns,
            mixin: {},
          },
        },
      },
    },
  };
}

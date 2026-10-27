// src/core/csn/templates.experimental.ts
// Structures sourced from real Datasphere exports (AM_PO_APT.json, F_PO_PROCESSING_TIME_APT.json).
// Each item marked: // VERIFY against real Datasphere export
// These are marked experimental because ds.md does not document them,
// but the user provided the real exports so they are trusted.

import type { FieldDef, CsnToken } from '../model/types';
import { buildElement } from './templates.verified';

export type FactQueryColumn =
  | { ref: string[]; as?: string; key?: boolean }
  | { xpr: CsnToken[]; as: string }
  | { val: string | number | boolean | null; as: string };

function factColumnName(column: FactQueryColumn): string {
  return 'ref' in column
    ? column.as || column.ref[column.ref.length - 1]
    : column.as;
}

function hasWhereOperator(tokens: CsnToken[]): boolean {
  return tokens.some((token) =>
    typeof token === 'string'
    && /^(?:=|<>|!=|<=|>=|<|>|is|and|or|in|like|between)$/i.test(token.trim()),
  );
}

export function buildFactQuery(
  queryFrom: unknown,
  inputColumns: FactQueryColumn[],
  kpiFields: Array<{ name: string; xpr: CsnToken[] }>,
  queryOptions: { where?: CsnToken[]; groupBy?: Array<{ ref: string[] }> } = {},
): Record<string, unknown> {
  const baseColumns = inputColumns.filter((column) => 'ref' in column);
  const baseNames = new Set(baseColumns.map(factColumnName));
  const sourceAliasesByField = new Map<string, Set<string>>();

  for (const column of baseColumns) {
    if (!('ref' in column) || column.ref.length < 2) continue;
    const fieldName = factColumnName(column);
    const aliases = sourceAliasesByField.get(fieldName) || new Set<string>();
    aliases.add(column.ref[column.ref.length - 2]);
    sourceAliasesByField.set(fieldName, aliases);
  }

  const calculatedByName = new Map<string, CsnToken[]>();
  for (const column of inputColumns) {
    if ('xpr' in column) calculatedByName.set(column.as, column.xpr);
    else if ('val' in column) calculatedByName.set(column.as, [{ val: column.val }]);
  }
  for (const kpi of kpiFields) {
    if (!calculatedByName.has(kpi.name)) calculatedByName.set(kpi.name, kpi.xpr);
  }

  const isCalculatedReference = (token: CsnToken, name: string): boolean => {
    if (typeof token === 'string' || !('ref' in token) || token.ref[token.ref.length - 1] !== name) return false;
    const sourceAliases = sourceAliasesByField.get(name);
    return !(token.ref.length > 1 && sourceAliases?.has(token.ref[token.ref.length - 2]));
  };

  const dependencies = new Map<string, Set<string>>();
  const collectDependencies = (tokens: CsnToken[], target: Set<string>): void => {
    for (const token of tokens) {
      if (typeof token === 'string') continue;
      if ('ref' in token) {
        const name = token.ref[token.ref.length - 1];
        if (name && calculatedByName.has(name) && !baseNames.has(name)
          && isCalculatedReference(token, name)) {
          target.add(name);
        }
      } else if ('xpr' in token) {
        collectDependencies(token.xpr, target);
      } else if ('args' in token) {
        token.args.forEach((arg) => collectDependencies([arg], target));
      }
    }
  };
  for (const [name, expression] of calculatedByName) {
    const refs = new Set<string>();
    collectDependencies(expression, refs);
    dependencies.set(name, refs);
  }

  const pending = new Set(calculatedByName.keys());
  const completed = new Set(baseNames);
  const calculationLayers: Array<Array<{ as: string; xpr: CsnToken[] }>> = [];
  while (pending.size > 0) {
    const ready = Array.from(pending).filter((name) =>
      Array.from(dependencies.get(name) || []).every((dependency) => completed.has(dependency)),
    );
    if (ready.length === 0) {
      throw new Error(
        `Fact calculated columns contain a circular or unresolved dependency: ${Array.from(pending).join(', ')}`,
      );
    }
    calculationLayers.push(ready.map((name) => ({
      as: name,
      xpr: calculatedByName.get(name)!,
    })));
    ready.forEach((name) => {
      pending.delete(name);
      completed.add(name);
    });
  }

  const rewriteReferences = (tokens: CsnToken[], inputAlias: string): CsnToken[] =>
    tokens.map((token): CsnToken => {
      if (typeof token === 'string') return token;
      if ('ref' in token) {
        const fieldName = token.ref[token.ref.length - 1];
        const sourceAliases = sourceAliasesByField.get(fieldName);
        const explicitlyReferencesSource = token.ref.length > 1
          && sourceAliases?.has(token.ref[token.ref.length - 2]);
        if (explicitlyReferencesSource || baseNames.has(fieldName)
          || calculatedByName.has(fieldName)) {
          return { ...token, ref: [inputAlias, fieldName] };
        }
        return token;
      }
      if ('xpr' in token) {
        return { ...token, xpr: rewriteReferences(token.xpr, inputAlias) };
      }
      if ('args' in token) {
        return {
          ...token,
          args: token.args.map((arg) => rewriteReferences([arg], inputAlias)[0]),
        };
      }
      return token;
    });

  const baseAlias = 'Source Columns 1';
  let currentSelect: Record<string, unknown> = {
    from: queryFrom,
    columns: baseColumns.map((column) => ({ ...column })),
  };
  let currentAlias = baseAlias;
  let visibleColumns = baseColumns.map((column) => ({
    name: factColumnName(column),
    key: 'key' in column ? column.key : undefined,
  }));

  calculationLayers.forEach((layer, index) => {
    const columns: FactQueryColumn[] = visibleColumns.map((column) => ({
      ref: [currentAlias, column.name],
      ...(column.key ? { key: true } : {}),
    }));
    columns.push(...layer.map((column) => ({
      as: column.as,
      xpr: rewriteReferences(column.xpr, currentAlias),
    })));

    currentSelect = {
      from: { SELECT: currentSelect, as: currentAlias },
      columns,
    };
    currentAlias = `Calculated Columns ${index + 1}`;
    visibleColumns = [
      ...visibleColumns,
      ...layer.map((column) => ({ name: column.as, key: undefined })),
    ];
  });

  const outputNames = Array.from(new Set([
    ...inputColumns.map(factColumnName),
    ...kpiFields.map((field) => field.name),
  ]));
  const outputColumns = outputNames.map((name) => ({
    ref: [currentAlias, name],
    ...(baseColumns.find((column) => factColumnName(column) === name && 'key' in column && column.key)
      ? { key: true }
      : {}),
  }));
  const where = queryOptions.where && hasWhereOperator(queryOptions.where)
    ? rewriteReferences(queryOptions.where, currentAlias)
    : undefined;
  return {
    SELECT: {
      from: { SELECT: currentSelect, as: currentAlias },
      columns: outputColumns,
      ...(where ? { where } : {}),
      ...(queryOptions.groupBy && queryOptions.groupBy.length > 0
        ? { groupBy: queryOptions.groupBy.map((column) => ({
          ref: [currentAlias, column.ref[column.ref.length - 1]],
        })) }
        : {}),
    },
  };
}

export function buildFactLayerMetadata(): Record<string, unknown> {
  return {
    '@ObjectModel.modelingPattern': { '#': 'ANALYTICAL_FACT' },
    '@ObjectModel.supportedCapabilities': [{ '#': 'DATA_STRUCTURE' }],
    '@DataWarehouse.consumption.external': false,
  };
}

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
  queryFrom: unknown;
  queryColumns: FactQueryColumn[];
}): Record<string, unknown> {
  const elements: Record<string, unknown> = {};

  for (const f of params.fields) elements[f.name] = buildElement(f);

  for (const m of params.measureFields) {
    const el = buildElement(m);
    (el as Record<string, unknown>)['@AnalyticsDetails.measureType'] = { '#': 'BASE' };
    (el as Record<string, unknown>)['@Aggregation.default'] = { '#': m.aggregation || 'SUM' };
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

  return {
    definitions: {
      [params.technicalName]: {
        kind: 'entity',
        elements,
        query: buildFactQuery(params.queryFrom, params.queryColumns, params.kpiFields),
        '@EndUserText.label': params.label,
        ...buildFactLayerMetadata(),
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

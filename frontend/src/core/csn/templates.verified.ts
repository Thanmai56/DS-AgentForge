// src/core/csn/templates.verified.ts
// Structures directly observed in ds.md and the real JSON exports provided by the user.
// Each builder returns a plain JSON-serializable object.

import type { FieldDef, CsnToken } from '../model/types';

// ── Element builder ────────────────────────────────────────────────────────────
export function buildElement(field: FieldDef): Record<string, unknown> {
  const el: Record<string, unknown> = {
    '@EndUserText.label': field.label,
    type: field.type,
  };
  if (field.length !== undefined) el['length'] = field.length;
  if (field.precision !== undefined) el['precision'] = field.precision;
  if (field.scale !== undefined) el['scale'] = field.scale;
  if (field.key) el['key'] = true;
  if (field.notNull) el['notNull'] = true;
  return el;
}

// ── Local table wrapper ────────────────────────────────────────────────────────
export function buildLocalTable(params: {
  technicalName: string;
  label: string;
  fields: FieldDef[];
}): Record<string, unknown> {
  const elements: Record<string, unknown> = {};
  for (const f of params.fields) elements[f.name] = buildElement(f);

  return {
    definitions: {
      [params.technicalName]: {
        kind: 'entity',
        elements,
        '@EndUserText.label': params.label,
      },
    },
  };
}

// ── Simple view (single source) ────────────────────────────────────────────────
export function buildSimpleView(params: {
  technicalName: string;
  label: string;
  description?: string;
  purpose?: string;
  tags?: Array<{ key: string; text: string }>;
  sourceTable: string;
  sourceAlias: string;
  fields: FieldDef[];
  calcColumns?: Array<{ name: string; xpr: CsnToken[]; field: FieldDef }>;
}): Record<string, unknown> {
  const elements: Record<string, unknown> = {};
  for (const f of params.fields) elements[f.name] = buildElement(f);

  const columns: unknown[] = params.fields.map(f => ({ ref: [params.sourceAlias, f.name] }));
  if (params.calcColumns) {
    for (const cc of params.calcColumns) {
      elements[cc.name] = buildElement(cc.field);
      columns.push({ xpr: cc.xpr, as: cc.name });
    }
  }

  const def: Record<string, unknown> = {
    kind: 'entity',
    elements,
    query: {
      SELECT: {
        from: { ref: [params.sourceTable], as: params.sourceAlias },
        columns,
      },
    },
    '@EndUserText.label': params.label,
    '@ObjectModel.modelingPattern': { '#': 'DATA_STRUCTURE' },
    '@ObjectModel.supportedCapabilities': [{ '#': 'DATA_STRUCTURE' }],
  };
  if (params.description) def['@DataWarehouse.businessDefinition.description'] = params.description;
  if (params.purpose) def['@DataWarehouse.businessDefinition.purpose'] = params.purpose;
  if (params.tags?.length) def['@DataWarehouse.businessDefinition.tags'] = params.tags;

  return { definitions: { [params.technicalName]: def } };
}

// ── Join view ──────────────────────────────────────────────────────────────────
export function buildJoinView(params: {
  technicalName: string;
  label: string;
  description?: string;
  purpose?: string;
  tags?: Array<{ key: string; text: string }>;
  joinType: 'inner' | 'left' | 'right';
  leftRef: string;
  leftAlias: string;
  rightRef: string;
  rightAlias: string;
  onLeft: string[];   // ref path for left side of ON clause
  onRight: string[];  // ref path for right side
  fields: FieldDef[];
  calcColumns?: Array<{ name: string; xpr: CsnToken[]; field: FieldDef }>;
}): Record<string, unknown> {
  const elements: Record<string, unknown> = {};
  for (const f of params.fields) elements[f.name] = buildElement(f);

  const columns: unknown[] = params.fields.map(f => ({
    ref: [params.leftAlias, f.name],
  }));
  if (params.calcColumns) {
    for (const cc of params.calcColumns) {
      elements[cc.name] = buildElement(cc.field);
      columns.push({ xpr: cc.xpr, as: cc.name });
    }
  }

  const def: Record<string, unknown> = {
    kind: 'entity',
    elements,
    query: {
      SELECT: {
        from: {
          join: params.joinType,
          args: [
            { ref: [params.leftRef], as: params.leftAlias },
            { ref: [params.rightRef], as: params.rightAlias },
          ],
          on: [{ ref: params.onLeft }, '=', { ref: params.onRight }],
        },
        columns,
      },
    },
    '@EndUserText.label': params.label,
    '@ObjectModel.modelingPattern': { '#': 'DATA_STRUCTURE' },
    '@ObjectModel.supportedCapabilities': [{ '#': 'DATA_STRUCTURE' }],
  };
  if (params.description) def['@DataWarehouse.businessDefinition.description'] = params.description;
  if (params.purpose) def['@DataWarehouse.businessDefinition.purpose'] = params.purpose;
  if (params.tags?.length) def['@DataWarehouse.businessDefinition.tags'] = params.tags;

  return { definitions: { [params.technicalName]: def } };
}

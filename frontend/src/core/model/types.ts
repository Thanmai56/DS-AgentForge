// src/core/model/types.ts
// Pure TypeScript types – no React imports

export type FieldType =
  | 'cds.String'
  | 'cds.Integer'
  | 'cds.Decimal'
  | 'cds.Date'
  | 'cds.Boolean'
  | string;

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  length?: number;
  precision?: number;
  scale?: number;
  key?: boolean;
  notNull?: boolean;
  isMeasure?: boolean;
  isCalc?: boolean;
}

export interface SourceDef {
  id: string;
  technicalName: string;
  label: string;
  fields: FieldDef[];
  /** 'source' = raw remote/local table; 'view' = intermediate view */
  nodeType: 'source' | 'view';
}

export type ViewKind = 'dimension' | 'intermediate' | 'fact';

export interface JoinDef {
  leftSource: string;   // technicalName or view id
  rightSource: string;
  leftField: string;
  rightField: string;
  joinType: 'inner' | 'left' | 'right';
}

export interface ViewDef {
  id: string;
  technicalName: string;
  label: string;
  kind: ViewKind;
  sources: string[];     // ids of SourceDef or other ViewDef
  joins: JoinDef[];
  projectedFields: FieldDef[];
  /** Calculated fields added by this view */
  calculatedFields: CalcFieldDef[];
  description?: string;
  purpose?: string;
  tags?: Array<{ key: string; text: string }>;
}

export interface CalcFieldDef {
  name: string;
  label: string;
  type: FieldType;
  formula: string;  // SQL text
  csnXpr?: CsnToken[];
}

export interface KpiDef {
  id: string;
  name: string;
  label: string;
  description?: string;
  formula: string;   // SQL text
  csnXpr?: CsnToken[];
  formulaState: FormulaState;
  targetView: string; // technicalName of the fact view
}

export type FormulaState = 'unvalidated' | 'validating' | 'valid' | 'invalid';

// ── CSN Token types (mirrors real Datasphere xpr structure) ──────────────────
export type CsnToken =
  | { ref: string[] }
  | { val: string | number | boolean }
  | { func: string; args: CsnToken[] }
  | { xpr: CsnToken[] }
  | string; // operator: '+', '-', '*', '/', '=', '||', etc.

// ── Lineage Graph ─────────────────────────────────────────────────────────────
export interface LineageGraph {
  sources: SourceDef[];
  views: ViewDef[];
  kpis: KpiDef[];
  analyticModelId: string;
  analyticModelLabel: string;
}

// ── Navigation ─────────────────────────────────────────────────────────────────
export type NavFrame =
  | { type: 'main' }
  | { type: 'view'; id: string };

// ── CSN output ────────────────────────────────────────────────────────────────
export type TemplateKind = 'verified' | 'experimental';

export interface CsnFile {
  /** CSN object technical name */
  technicalName: string;
  label: string;
  /** Which template tier was used */
  templateKind: TemplateKind;
  /** Topological order index (1-based) */
  order: number;
  /** JSON-serializable CSN */
  content: Record<string, unknown>;
}

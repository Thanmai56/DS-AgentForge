// src/state/validationStore.ts
// Per-KPI formula validation state machine.
// State transitions: unvalidated -> validating -> valid | invalid
// ANY edit resets to 'unvalidated'.

import { create } from 'zustand';
import type { FormulaState, KpiDef } from '../core/model/types';
import type { ValidationIssue } from '../core/validate';

export interface KpiValidationEntry {
  kpiId: string;
  formula: string;
  state: FormulaState;
  issues: ValidationIssue[];
}

interface ValidationState {
  entries: Map<string, KpiValidationEntry>;
  /** Set formula text for a KPI; resets state to 'unvalidated' */
  setFormula: (kpiId: string, formula: string) => void;
  /** Start validation for a KPI */
  startValidating: (kpiId: string) => void;
  /** Record validation result */
  setResult: (kpiId: string, ok: boolean, issues: ValidationIssue[]) => void;
  /** Initialize entries from KPI definitions */
  initKpis: (kpis: KpiDef[]) => void;
  /** True when ALL KPIs are valid */
  allValid: () => boolean;
  /** Get entry for a KPI */
  getEntry: (kpiId: string) => KpiValidationEntry | undefined;
}

export const useValidationStore = create<ValidationState>((set, get) => ({
  entries: new Map(),

  initKpis(kpis) {
    const entries = new Map<string, KpiValidationEntry>();
    for (const kpi of kpis) {
      entries.set(kpi.id, {
        kpiId: kpi.id,
        formula: kpi.formula,
        state: 'unvalidated',
        issues: [],
      });
    }
    set({ entries });
  },

  setFormula(kpiId, formula) {
    set(state => {
      const entries = new Map(state.entries);
      const existing = entries.get(kpiId);
      entries.set(kpiId, {
        kpiId,
        formula,
        state: 'unvalidated',
        issues: existing?.issues ?? [],
      });
      return { entries };
    });
  },

  startValidating(kpiId) {
    set(state => {
      const entries = new Map(state.entries);
      const existing = entries.get(kpiId);
      if (!existing) return state;
      entries.set(kpiId, { ...existing, state: 'validating' });
      return { entries };
    });
  },

  setResult(kpiId, ok, issues) {
    set(state => {
      const entries = new Map(state.entries);
      const existing = entries.get(kpiId);
      if (!existing) return state;
      entries.set(kpiId, {
        ...existing,
        state: ok ? 'valid' : 'invalid',
        issues,
      });
      return { entries };
    });
  },

  allValid() {
    const { entries } = get();
    if (entries.size === 0) return false;
    for (const entry of entries.values()) {
      if (entry.state !== 'valid') return false;
    }
    return true;
  },

  getEntry(kpiId) {
    return get().entries.get(kpiId);
  },
}));

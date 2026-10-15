// src/state/__tests__/validationStore.test.ts
// Tests for the gate invariant: Proceed only when ALL KPIs are valid

import { describe, it, expect, beforeEach } from 'vitest';
import { useValidationStore } from '../validationStore';
import type { KpiDef } from '../../core/model/types';

const MOCK_KPI: KpiDef = {
  id: 'kpi-APT',
  name: 'APT',
  label: 'Average Processing Time',
  formula: 'Processing_Days / Total_Delivered_Order',
  formulaState: 'unvalidated',
  targetView: 'F_PO_PROCESSING_TIME_APT',
};

function resetStore() {
  const store = useValidationStore.getState();
  store.initKpis([MOCK_KPI]);
}

describe('ValidationStore – gate invariant', () => {
  beforeEach(() => resetStore());

  it('starts as unvalidated', () => {
    const entry = useValidationStore.getState().getEntry('kpi-APT');
    expect(entry?.state).toBe('unvalidated');
  });

  it('allValid is false when unvalidated', () => {
    expect(useValidationStore.getState().allValid()).toBe(false);
  });

  it('editing formula resets state to unvalidated', () => {
    const store = useValidationStore.getState();
    store.setResult('kpi-APT', true, []);
    expect(store.getEntry('kpi-APT')?.state).toBe('valid');

    store.setFormula('kpi-APT', 'new formula');
    expect(useValidationStore.getState().getEntry('kpi-APT')?.state).toBe('unvalidated');
  });

  it('allValid is false during validating state', () => {
    const store = useValidationStore.getState();
    store.startValidating('kpi-APT');
    expect(useValidationStore.getState().getEntry('kpi-APT')?.state).toBe('validating');
    expect(useValidationStore.getState().allValid()).toBe(false);
  });

  it('allValid is false when invalid', () => {
    useValidationStore.getState().setResult('kpi-APT', false, [
      { severity: 'error', message: 'bad', startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
    ]);
    expect(useValidationStore.getState().allValid()).toBe(false);
  });

  it('allValid is true only when all KPIs are valid', () => {
    useValidationStore.getState().setResult('kpi-APT', true, []);
    expect(useValidationStore.getState().allValid()).toBe(true);
  });

  it('with 2 KPIs: allValid requires BOTH valid', () => {
    const kpi2: KpiDef = { ...MOCK_KPI, id: 'kpi-2', name: 'KPI2', formula: 'X', targetView: 'F' };
    useValidationStore.getState().initKpis([MOCK_KPI, kpi2]);

    useValidationStore.getState().setResult('kpi-APT', true, []);
    expect(useValidationStore.getState().allValid()).toBe(false); // kpi-2 still unvalidated

    useValidationStore.getState().setResult('kpi-2', true, []);
    expect(useValidationStore.getState().allValid()).toBe(true);
  });

  it('allValid returns false with no KPIs', () => {
    useValidationStore.getState().initKpis([]);
    expect(useValidationStore.getState().allValid()).toBe(false);
  });
});

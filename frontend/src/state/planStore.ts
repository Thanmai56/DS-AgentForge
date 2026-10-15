// src/state/planStore.ts
// Holds the active LineageGraph + CsnFile output + page navigation.

import { create } from 'zustand';
import type { LineageGraph, CsnFile } from '../core/model/types';
import type { CsnToken } from '../core/model/types';

type AppPage = 'planning' | 'delivery';

interface PlanState {
  graph: LineageGraph | null;
  csnFiles: CsnFile[];
  currentPage: AppPage;
  drawerSourceId: string | null;

  setGraph: (g: LineageGraph) => void;
  setCsnFiles: (files: CsnFile[]) => void;
  /** Navigate to delivery page – only succeeds if allKpisValid is true */
  proceedToDelivery: (allKpisValid: boolean, kpiFormulas: Map<string, { formula: string; csnXpr: CsnToken[] }>) => boolean;
  backToPlanning: () => void;
  openDrawer: (sourceId: string) => void;
  closeDrawer: () => void;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  graph: null,
  csnFiles: [],
  currentPage: 'planning',
  drawerSourceId: null,

  setGraph(g) {
    set({ graph: g });
  },

  setCsnFiles(files) {
    set({ csnFiles: files });
  },

  proceedToDelivery(allKpisValid, kpiFormulas) {
    if (!allKpisValid) return false;

    // Write validated formulas back onto the graph KPIs
    const { graph } = get();
    if (!graph) return false;

    const updatedGraph: LineageGraph = {
      ...graph,
      kpis: graph.kpis.map(kpi => {
        const fm = kpiFormulas.get(kpi.id);
        return fm ? { ...kpi, formula: fm.formula, csnXpr: fm.csnXpr, formulaState: 'valid' as const } : kpi;
      }),
    };

    set({ graph: updatedGraph, currentPage: 'delivery' });
    return true;
  },

  backToPlanning() {
    set({ currentPage: 'planning' });
  },

  openDrawer(sourceId) {
    set({ drawerSourceId: sourceId });
  },

  closeDrawer() {
    set({ drawerSourceId: null });
  },
}));

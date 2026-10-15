import { create } from 'zustand';
import { Connection, Run, ViewSpec, RunGate } from '../types';

interface AppState {
  // Active Connection
  activeConnection: Connection | null;
  setActiveConnection: (conn: Connection | null) => void;

  // Active Run
  activeRun: Run | null;
  setActiveRun: (run: Run | null) => void;
  updateRunState: (partial: Partial<Run>) => void;

  // Selected View on Canvas
  selectedView: ViewSpec | null;
  setSelectedView: (view: ViewSpec | null) => void;

  // Selected Operator on Canvas
  selectedOperator: any | null;
  setSelectedOperator: (op: any | null) => void;

  // Human Interrupt Gate Modal
  pendingGate: {
    isOpen: boolean;
    runId: string | null;
    gateType: RunGate | null;
    data: any;
  };
  dismissedGate: { runId: string; gateType: RunGate } | null;
  openGateModal: (runId: string, gateType: RunGate, data: any) => void;
  closeGateModal: () => void;

  // Impact Analysis Modal
  impactModal: {
    isOpen: boolean;
    objectName: string | null;
  };
  openImpactModal: (objectName: string) => void;
  closeImpactModal: () => void;

  // Extracted Source Entities from Uploaded Files/Metadata
  extractedEntities: any[];
  setExtractedEntities: (entities: any[]) => void;
  businessRequirement: string;
  setBusinessRequirement: (requirement: string) => void;
}

const getSavedRun = (): Run | null => {
  try {
    const raw = localStorage.getItem('activeRun');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const awaitingStatesByGate: Record<RunGate, readonly string[]> = {
  sources: ['AWAITING_SOURCE_CONFIRM', 'waiting_source_confirm'],
  plan: ['AWAITING_PLAN_CONFIRM', 'waiting_plan_confirm'],
  artifacts: ['AWAITING_APPROVAL', 'waiting_artifact_approve'],
};

export const useStore = create<AppState>((set) => ({
  activeConnection: null,
  setActiveConnection: (conn) => set({ activeConnection: conn }),

  activeRun: getSavedRun(),
  setActiveRun: (run) => {
    try {
      if (run) {
        localStorage.setItem('activeRun', JSON.stringify(run));
      } else {
        localStorage.removeItem('activeRun');
      }
    } catch {}
    set({ activeRun: run });
  },
  updateRunState: (partial) =>
    set((state) => {
      const updated = state.activeRun ? { ...state.activeRun, ...partial } : null;
      const nextRunState = partial.state ?? partial.status;
      const dismissedGate =
        state.dismissedGate &&
        nextRunState !== undefined &&
        !awaitingStatesByGate[state.dismissedGate.gateType].includes(nextRunState)
          ? null
          : state.dismissedGate;
      try {
        if (updated) {
          localStorage.setItem('activeRun', JSON.stringify(updated));
        }
      } catch {}
      return { activeRun: updated, dismissedGate };
    }),

  selectedView: null,
  setSelectedView: (view) => set({ selectedView: view }),

  selectedOperator: null,
  setSelectedOperator: (op) => set({ selectedOperator: op }),

  pendingGate: {
    isOpen: false,
    runId: null,
    gateType: null,
    data: null,
  },
  dismissedGate: null,
  openGateModal: (runId, gateType, data) =>
    set((state) => {
      if (
        state.dismissedGate?.runId === runId &&
        state.dismissedGate.gateType === gateType
      ) {
        return state;
      }
      return {
        pendingGate: {
          isOpen: true,
          runId,
          gateType,
          data,
        },
      };
    }),
  closeGateModal: () =>
    set((state) => ({
      dismissedGate:
        state.pendingGate.isOpen &&
        state.pendingGate.runId &&
        state.pendingGate.gateType
          ? {
              runId: state.pendingGate.runId,
              gateType: state.pendingGate.gateType,
            }
          : state.dismissedGate,
      pendingGate: {
        isOpen: false,
        runId: null,
        gateType: null,
        data: null,
      },
    })),

  impactModal: {
    isOpen: false,
    objectName: null,
  },
  openImpactModal: (objectName) =>
    set({
      impactModal: {
        isOpen: true,
        objectName,
      },
    }),
  closeImpactModal: () =>
    set({
      impactModal: {
        isOpen: false,
        objectName: null,
      },
    }),

  extractedEntities: [],
  setExtractedEntities: (entities) => set({ extractedEntities: entities }),
  businessRequirement: '',
  setBusinessRequirement: (requirement) => set({ businessRequirement: requirement }),
}));

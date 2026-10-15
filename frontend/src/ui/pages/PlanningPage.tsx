// src/ui/pages/PlanningPage.tsx
// Page 1: Lineage editor with global canvas, drill-down, breadcrumb, source drawer, formula gate.

import React, { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { GitBranch, Loader2 } from 'lucide-react';
import { MockPlanProvider } from '../../core/plan/MockPlanProvider';
import { usePlanStore } from '../../state/planStore';
import { useValidationStore } from '../../state/validationStore';
import { useNavigationStore } from '../../state/navigationStore';
import { GlobalLineageCanvas } from '../canvas/GlobalLineageCanvas';
import { ViewInternalsCanvas } from '../canvas/ViewInternalsCanvas';
import { Breadcrumb } from '../panels/Breadcrumb';
import { SourceDrawer } from '../panels/SourceDrawer';
import { FormulaGate } from '../panels/FormulaGate';
import type { LineageGraph } from '../../core/model/types';

const provider = new MockPlanProvider();

export const PlanningPage: React.FC = () => {
  const graph = usePlanStore(s => s.graph);
  const setGraph = usePlanStore(s => s.setGraph);
  const drawerSourceId = usePlanStore(s => s.drawerSourceId);
  const initKpis = useValidationStore(s => s.initKpis);
  const stack = useNavigationStore(s => s.stack);
  const [loading, setLoading] = useState(false);

  // Load graph on mount if not yet loaded
  useEffect(() => {
    if (!graph) {
      setLoading(true);
      provider.generatePlan('PO Processing Time KPI').then(g => {
        setGraph(g);
        initKpis(g.kpis);
        setLoading(false);
      });
    }
  }, []);

  const currentFrame = stack[stack.length - 1];

  if (loading || !graph) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'var(--text-secondary)' }}>
        <Loader2 size={32} className="animate-spin" color="#3b82f6" />
        <span className="text-sm">Loading lineage plan…</span>
      </div>
    );
  }

  // Determine what to show in the canvas area
  const isViewDrilldown = currentFrame.type === 'view';
  const currentView = isViewDrilldown
    ? graph.views.find(v => v.id === currentFrame.id) ?? null
    : null;
  const isAnalyticModel = isViewDrilldown && currentFrame.id === graph.analyticModelId;

  // Show formula gate when fact/analytic model context
  const showFormulaGate = isViewDrilldown && (
    currentView?.kind === 'fact' || isAnalyticModel
  );

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <Breadcrumb graph={graph} />

      {/* Canvas area */}
      <div className="flex-1 relative overflow-hidden">
        <ReactFlowProvider>
          {currentFrame.type === 'main' && <GlobalLineageCanvas graph={graph} />}
          {isViewDrilldown && currentView && (
            <ViewInternalsCanvas view={currentView} graph={graph} />
          )}
          {isViewDrilldown && !currentView && (
            <AnalyticModelDrilldown graph={graph} />
          )}
        </ReactFlowProvider>

        {/* Source Drawer – absolute overlay, never replaces canvas */}
        {drawerSourceId && <SourceDrawer sources={graph.sources} />}
      </div>

      {/* Formula Gate – docked at bottom when in fact/analytic model context */}
      {showFormulaGate && (
        <div className="flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="px-4 pt-2 pb-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#64748b' }}>
              KPI Formula Gate — review and validate before proceeding
            </div>
          </div>
          {graph.kpis.map((kpi, idx) => (
            <FormulaGate
              key={kpi.id}
              kpi={kpi}
              graph={graph}
              isLast={idx === graph.kpis.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Analytic Model drill-down ──────────────────────────────────────────────────
const AnalyticModelDrilldown: React.FC<{ graph: LineageGraph }> = ({ graph }) => {
  const factView = graph.views.find(v => v.kind === 'fact');
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
      <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.15)' }}>
        <GitBranch size={24} color="#10b981" />
      </div>
      <div className="text-center max-w-sm">
        <div className="text-sm font-semibold mb-2" style={{ color: '#e2e8f0' }}>{graph.analyticModelLabel}</div>
        <div className="text-xs" style={{ color: '#64748b' }}>
          Consumes fact view: <span className="font-mono text-[#06b6d4]">{factView?.technicalName}</span>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#64748b' }}>KPIs</div>
          {graph.kpis.map(kpi => (
            <div key={kpi.id} className="glass-card px-4 py-2 text-left" style={{ minWidth: 280 }}>
              <div className="text-xs font-semibold" style={{ color: '#e2e8f0' }}>{kpi.label}</div>
              <div className="text-[11px] font-mono mt-1" style={{ color: '#94a3b8' }}>{kpi.formula}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

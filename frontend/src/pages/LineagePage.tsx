// src/pages/LineagePage.tsx
// Datasphere Lineage & Graphical View Editor Host.
// Provides a View Switcher:
// - "Overview" tab: Original object-level semantic lineage (completely unchanged).
// - Proposed view tabs: Datasphere-style graphical view editor for each proposed view in the accepted plan.

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Network, Layers, Database, Sparkles, RefreshCw } from 'lucide-react';
import { DatasphereLineageView } from '../components/lineage/DatasphereLineageView';
import { DatasphereGraphicalViewEditor } from '../features/lineage/DatasphereGraphicalViewEditor';
import { ViewGraph } from '../features/lineage/viewGraphTypes';
import { synthesizeLineageApi, getAllViewGraphsApi } from '../features/lineage/lineageApi';

export const LineagePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialViewParam = searchParams.get('view') || 'overview';

  const [activeTab, setActiveTab] = useState<string>(initialViewParam);
  const [viewGraphs, setViewGraphs] = useState<Record<string, ViewGraph>>({});
  const [loading, setLoading] = useState<boolean>(true);

  // Retrieve planId and activePlan from sessionStorage
  const planId = useMemo(() => {
    return sessionStorage.getItem('activePlanId') || 'default_plan';
  }, []);

  const activePlan = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('activePlan');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  // Fetch or synthesize view graphs on mount
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    synthesizeLineageApi(planId, activePlan)
      .then((graphs) => {
        if (!isMounted) return;
        setViewGraphs(graphs);

        // If URL requested a specific view, activate it, otherwise if initialViewParam is proposed view
        if (initialViewParam !== 'overview' && graphs[initialViewParam]) {
          setActiveTab(initialViewParam);
        } else if (initialViewParam === 'overview') {
          setActiveTab('overview');
        } else {
          // Default to first proposed view if available
          const firstViewId = Object.keys(graphs)[0];
          if (firstViewId) {
            setActiveTab(firstViewId);
            setSearchParams({ view: firstViewId });
          }
        }
      })
      .catch((err) => {
        console.warn('Could not synthesize lineage, using fallback:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [planId, activePlan]);

  const handleSelectTab = (tabId: string) => {
    setActiveTab(tabId);
    setSearchParams({ view: tabId });
  };

  const proposedViewList = Object.keys(viewGraphs);

  return (
    <div className="h-full w-full flex flex-col bg-[#F8FAFC] overflow-hidden text-[#1D2D3E]">
      {/* ── TOP VIEW SWITCHER TABS ── */}
      <div className="px-6 py-2 bg-white border-b border-slate-200 flex items-center justify-between shrink-0 shadow-2xs z-30">
        <div className="flex items-center space-x-1 overflow-x-auto pr-2">
          {/* 1. Overview Tab (Object-Level Lineage - Unchanged) */}
          <button
            type="button"
            onClick={() => handleSelectTab('overview')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-[#0070F2] text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Overview (End-to-End Lineage)</span>
          </button>

          {/* Separator */}
          {proposedViewList.length > 0 && (
            <div className="h-4 w-px bg-slate-300 mx-1.5" />
          )}

          {/* 2. Proposed View Tabs */}
          {proposedViewList.map((vId) => {
            const vg = viewGraphs[vId];
            const isSelected = activeTab === vId;
            const outputNode = vg.nodes.find((n) => n.node_type === 'OUTPUT');
            const colCount = outputNode?.columns?.length || 0;

            return (
              <button
                key={vId}
                type="button"
                onClick={() => handleSelectTab(vId)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#0070F2] text-white shadow-2xs'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100 border border-transparent'
                }`}
              >
                <Layers className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-[#0070F2]'}`} />
                <span className="font-mono">{vg.view_name || vId}</span>
                {colCount > 0 && (
                  <span
                    className={`text-[10px] px-1 rounded font-mono ${
                      isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {colCount} cols
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Status Indicator */}
        <div className="flex items-center space-x-2 text-xs text-slate-500 shrink-0">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          <span className="hidden sm:inline">Datasphere Modeling Canvas</span>
        </div>
      </div>

      {/* ── TAB CONTENT ── */}
      <div className="flex-1 relative overflow-hidden">
        {loading ? (
          <div className="h-full w-full flex flex-col items-center justify-center space-y-2 text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin text-[#0070F2]" />
            <span className="text-xs font-semibold">Loading graphical view editor...</span>
          </div>
        ) : activeTab === 'overview' ? (
          /* Keep original object-level lineage completely unchanged */
          <DatasphereLineageView />
        ) : viewGraphs[activeTab] ? (
          /* Render Datasphere Graphical View Editor for the selected proposed view */
          <DatasphereGraphicalViewEditor
            key={activeTab}
            planId={planId}
            initialGraph={viewGraphs[activeTab]}
            onGraphChanged={(updated) => {
              setViewGraphs((prev) => ({
                ...prev,
                [activeTab]: updated,
              }));
            }}
          />
        ) : (
          <div className="p-8 text-center text-slate-500 text-xs">
            View graph '{activeTab}' not found.
          </div>
        )}
      </div>
    </div>
  );
};

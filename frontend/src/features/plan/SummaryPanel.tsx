// frontend/src/features/plan/SummaryPanel.tsx
// Displays modeling analysis, assumptions, blockers, and KPI measures

import React from 'react';
import {
  FileText,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  Sigma,
  ChevronDown,
  ChevronUp,
  Table
} from 'lucide-react';
import { Plan } from './types';

interface SummaryPanelProps {
  plan: Plan;
  metadataSummary?: string;
  profileSummary?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const SummaryPanel: React.FC<SummaryPanelProps> = ({
  plan,
  metadataSummary: _metadataSummary,
  profileSummary,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const sampleSummary = React.useMemo(() => {
    try {
      const raw = sessionStorage.getItem('activeSampleDataSummary');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const planWarnings = React.useMemo<string[]>(() => {
    try {
      const raw = sessionStorage.getItem('activePlanWarnings');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }, []);

  return (
    <div className="bg-white border-t border-slate-200 shadow-md transition-all text-[#1D2D3E]">
      {/* Header bar / Toggle */}
      <div
        onClick={onToggleCollapse}
        className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors select-none"
      >
        <div className="flex items-center space-x-3">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
            <FileText className="w-4 h-4 text-[#0070F2]" />
            <span>Plan Summary & Assumptions</span>
          </span>

          {/* Sample Data Pill */}
          {sampleSummary?.has_samples && (
            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
              <Table className="w-3 h-3 text-teal-600" />
              <span>Sample Rows Aligned ({sampleSummary.retained_rows} rows)</span>
            </span>
          )}

          {/* Blockers Pill */}
          {plan.blockers && plan.blockers.length > 0 ? (
            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-300">
              <AlertTriangle className="w-3 h-3 text-red-600" />
              <span>{plan.blockers.length} Blocker(s)</span>
            </span>
          ) : (
            <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
              <CheckCircle className="w-3 h-3 text-emerald-600" />
              <span>0 Blockers</span>
            </span>
          )}

          <span className="text-xs text-slate-400 font-normal">
            ({plan.measures.length} Measures, {plan.dimensions.length} Dimensions)
          </span>
        </div>

        <button type="button" className="text-slate-500 hover:text-slate-800">
          {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expandable Body */}
      {!isCollapsed && (
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 max-h-72 overflow-y-auto text-xs">
          {/* Column 1: Analysis & Blockers */}
          <div className="space-y-4">
            {plan.blockers && plan.blockers.length > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1">
                <span className="text-[11px] font-bold text-red-900 uppercase tracking-wide flex items-center space-x-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                  <span>Modeling Blockers (Action Required)</span>
                </span>
                <ul className="list-disc list-inside space-y-1 text-red-800 text-xs">
                  {plan.blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] mb-2">
                Architectural Analysis
              </h3>
              <ul className="space-y-1 text-slate-600 leading-relaxed">
                {plan.analysis.map((line, i) => (
                  <li key={i} className="flex items-start space-x-1.5">
                    <span className="text-[#0070F2] font-bold">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Column 2: Measures & Dimensions */}
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] mb-2 flex items-center space-x-1.5">
                <Sigma className="w-3.5 h-3.5 text-teal-600" />
                <span>KPI Measures</span>
              </h3>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-1 px-2">Measure</th>
                      <th className="py-1 px-2">Agg</th>
                      <th className="py-1 px-2">Source Col</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plan.measures.map((m, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="py-1 px-2 font-mono font-semibold text-slate-900">{m.name}</td>
                        <td className="py-1 px-2 text-slate-500 uppercase">{m.aggregation}</td>
                        <td className="py-1 px-2 font-mono text-slate-600">{m.column}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] mb-1.5">
                Target Dimensions
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {plan.dimensions.map((dim, i) => (
                  <span key={i} className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[10px]">
                    {dim}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Column 3: Assumptions & Profiler Evidence */}
          <div className="space-y-4">
            <div>
              <h3 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] mb-2 flex items-center space-x-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-purple-600" />
                <span>Assumptions</span>
              </h3>
              <ul className="space-y-1 text-slate-600 leading-relaxed">
                {plan.assumptions && plan.assumptions.length > 0 ? (
                  plan.assumptions.map((asm, i) => (
                    <li key={i} className="flex items-start space-x-1.5">
                      <span className="text-purple-600 font-bold">•</span>
                      <span>{asm}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-slate-400 italic">No specific assumptions recorded.</li>
                )}
              </ul>
            </div>

            {profileSummary && (
              <div>
                <h3 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] mb-1.5">
                  Profiler Evidence Quote
                </h3>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-700 max-h-24 overflow-y-auto whitespace-pre-wrap">
                  {profileSummary}
                </div>
              </div>
            )}

            {sampleSummary?.has_samples && (
              <div>
                <h3 className="font-bold text-slate-800 uppercase tracking-wide text-[11px] mb-1.5 flex items-center space-x-1.5">
                  <Table className="w-3.5 h-3.5 text-teal-600" />
                  <span>Pasted Sample Mapping</span>
                </h3>
                <div className="p-2.5 rounded-lg bg-teal-50/60 border border-teal-200 text-[11px] text-teal-900 space-y-1">
                  <div>
                    <span className="font-semibold">Mapped Tables:</span>{' '}
                    <span className="font-mono">{sampleSummary.mapped_tables.join(', ') || 'None'}</span>
                  </div>
                  <div>
                    <span className="font-semibold">Rows Retained:</span>{' '}
                    <span className="font-mono">{sampleSummary.retained_rows}</span> (row limit: {sampleSummary.row_limit})
                  </div>
                </div>
              </div>
            )}

            {planWarnings.length > 0 && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg space-y-1">
                <span className="text-[10px] font-bold text-amber-900 uppercase tracking-wide flex items-center space-x-1">
                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                  <span>Pipeline Warnings ({planWarnings.length})</span>
                </span>
                <ul className="list-disc list-inside space-y-0.5 text-amber-800 text-[11px]">
                  {planWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// src/ui/panels/FormulaGate.tsx
// HITL Formula Gate – docked panel with Monaco editor + state machine.
// Visible when fact view or analytic model is in context.

import React, { useCallback, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { CheckCircle, XCircle, Loader2, ChevronRight, AlertTriangle, Zap } from 'lucide-react';
import type { KpiDef, LineageGraph } from '../../core/model/types';
import { useValidationStore } from '../../state/validationStore';
import { usePlanStore } from '../../state/planStore';
import { validateFormula } from '../../core/validate';
import { formulaToCsn } from '../../core/csn/formulaConverter';
import { exportCsnFiles } from '../../core/csn/topoExporter';

interface Props {
  kpi: KpiDef;
  graph: LineageGraph;
  isLast: boolean;
}

const STATE_CONFIG = {
  unvalidated: { color: '#64748b', icon: null, label: 'Not validated' },
  validating: { color: '#06b6d4', icon: <Loader2 size={13} className="animate-spin" color="#06b6d4" />, label: 'Validating…' },
  valid: { color: '#10b981', icon: <CheckCircle size={13} color="#10b981" />, label: 'Valid' },
  invalid: { color: '#f43f5e', icon: <XCircle size={13} color="#f43f5e" />, label: 'Invalid' },
};

export const FormulaGate: React.FC<Props> = ({ kpi, graph, isLast }) => {
  const entry = useValidationStore(s => s.getEntry(kpi.id));
  const setFormula = useValidationStore(s => s.setFormula);
  const startValidating = useValidationStore(s => s.startValidating);
  const setResult = useValidationStore(s => s.setResult);
  const allValid = useValidationStore(s => s.allValid);
  const proceedToDelivery = usePlanStore(s => s.proceedToDelivery);
  const graph_ = usePlanStore(s => s.graph);
  const setCsnFiles = usePlanStore(s => s.setCsnFiles);
  const monacoRef = useRef<Parameters<NonNullable<Parameters<typeof Editor>[0]['onMount']>>[1] | null>(null);
  const editorRef = useRef<Parameters<NonNullable<Parameters<typeof Editor>[0]['onMount']>>[0] | null>(null);

  const state = entry?.state ?? 'unvalidated';
  const cfg = STATE_CONFIG[state];

  // Available fields for the fact view
  const factView = graph.views.find(v => v.kind === 'fact');
  const availableFields = factView?.projectedFields.map(f => f.name) ?? [];
  const fieldTypes = new Map(
    factView?.projectedFields.map(f => [f.name.toUpperCase(), f.type]) ?? []
  );

  const handleValidate = useCallback(async () => {
    if (!entry) return;
    startValidating(kpi.id);

    // Small async yield so React renders "validating" state
    await new Promise(r => setTimeout(r, 60));

    const result = validateFormula(entry.formula, { availableFields, fieldTypes });

    // Update Monaco markers
    if (monacoRef.current && editorRef.current) {
      const monaco = monacoRef.current;
      const model = editorRef.current.getModel();
      if (model) {
        const markers = result.issues.map(issue => ({
          severity: issue.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
          message: issue.message,
          startLineNumber: issue.startLine,
          startColumn: issue.startCol,
          endLineNumber: issue.endLine,
          endColumn: issue.endCol,
        }));
        monaco.editor.setModelMarkers(model, 'kpi-validator', markers);
      }
    }

    setResult(kpi.id, result.ok, result.issues);
  }, [entry, kpi.id, availableFields, startValidating, setResult]);

  const handleProceed = useCallback(() => {
    if (!allValid()) return;
    const g = graph_ ?? graph;

    // Build KPI formula map
    const kpiFormulas = new Map<string, { formula: string; csnXpr: ReturnType<typeof formulaToCsn> }>();
    for (const k of g.kpis) {
      const e = useValidationStore.getState().getEntry(k.id);
      if (e) {
        kpiFormulas.set(k.id, {
          formula: e.formula,
          csnXpr: formulaToCsn(e.formula),
        });
      }
    }

    const updatedGraph = {
      ...g,
      kpis: g.kpis.map(k => {
        const fm = kpiFormulas.get(k.id);
        return fm ? { ...k, formula: fm.formula, csnXpr: fm.csnXpr, formulaState: 'valid' as const } : k;
      }),
    };

    const files = exportCsnFiles(updatedGraph);
    setCsnFiles(files);

    const success = proceedToDelivery(true, kpiFormulas);
    if (!success) {
      alert('Cannot proceed: not all KPI formulas are valid.');
    }
  }, [allValid, graph, graph_, proceedToDelivery, setCsnFiles]);

  if (!entry) return null;

  return (
    <div
      className="flex flex-col border-t"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
      id={`formula-gate-${kpi.id}`}
    >
      {/* KPI header */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <Zap size={13} color="#f59e0b" />
          <span className="text-xs font-semibold" style={{ color: '#e2e8f0' }}>{kpi.label}</span>
          <span className="text-[10px] font-mono" style={{ color: '#64748b' }}>({kpi.name})</span>
        </div>
        <div className="flex items-center gap-1.5">
          {cfg.icon}
          <span className="text-[11px] font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
        </div>
      </div>

      {/* Monaco editor */}
      <div style={{ height: 80, background: 'var(--bg-secondary)' }}>
        <Editor
          value={entry.formula}
          language="sql"
          theme="vs-dark"
          height="80px"
          options={{
            minimap: { enabled: false },
            lineNumbers: 'off',
            glyphMargin: false,
            folding: false,
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: 'JetBrains Mono, monospace',
            padding: { top: 8, bottom: 8 },
            overviewRulerBorder: false,
            scrollbar: { vertical: 'hidden' },
          }}
          onChange={(value) => {
            setFormula(kpi.id, value ?? '');
          }}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;
          }}
        />
      </div>

      {/* Issues list */}
      {entry.issues.length > 0 && (
        <div className="px-4 py-2 flex flex-col gap-1 max-h-24 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.2)' }}>
          {entry.issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px]">
              {issue.severity === 'error'
                ? <XCircle size={11} color="#f43f5e" className="mt-0.5 flex-shrink-0" />
                : <AlertTriangle size={11} color="#f59e0b" className="mt-0.5 flex-shrink-0" />}
              <span style={{ color: issue.severity === 'error' ? '#fca5a5' : '#fcd34d' }}>
                [{issue.startLine}:{issue.startCol}] {issue.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between px-4 py-2.5 gap-3">
        <button
          onClick={handleValidate}
          disabled={state === 'validating'}
          id={`btn-validate-${kpi.id}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={{
            background: state === 'validating' ? 'rgba(6,182,212,0.1)' : 'rgba(6,182,212,0.15)',
            color: '#06b6d4',
            border: '1px solid rgba(6,182,212,0.3)',
            cursor: state === 'validating' ? 'not-allowed' : 'pointer',
            opacity: state === 'validating' ? 0.7 : 1,
          }}
        >
          {state === 'validating' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
          Validate
        </button>

        {isLast && (
          <button
            onClick={handleProceed}
            disabled={!allValid()}
            id="btn-proceed"
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: allValid() ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(100,116,139,0.2)',
              color: allValid() ? '#fff' : '#64748b',
              border: 'none',
              cursor: allValid() ? 'pointer' : 'not-allowed',
              boxShadow: allValid() ? '0 0 20px rgba(16,185,129,0.3)' : 'none',
            }}
          >
            Proceed to Delivery
            <ChevronRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
};

// frontend/src/features/plan/EditStepPanel.tsx
// Slide-over panel to edit a selected modeling step or request an AI revision

import React, { useState, useEffect } from 'react';
import { X, Check, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';
import { getNodeConditions, getNodeFormulas, PlanNode, Plan } from './types';
import { revisePlanApi } from './planApi';

interface EditStepPanelProps {
  planId: string;
  node: PlanNode | null;
  onClose: () => void;
  onPlanUpdated: (updatedPlan: Plan, affectedNodes: string[]) => void;
  availableColumns?: string[];
  requiredColumns?: string[];
  onManualStepUpdated?: (node: PlanNode) => void;
}

export const EditStepPanel: React.FC<EditStepPanelProps> = ({
  planId,
  node,
  onClose,
  onPlanUpdated,
  availableColumns = [],
  requiredColumns = [],
  onManualStepUpdated,
}) => {
  if (!node) return null;

  // Local state for direct editing
  const [joinType, setJoinType] = useState(node.details?.join_type || 'inner');
  const [condition, setCondition] = useState(getNodeConditions(node).join(' AND '));
  const [formula, setFormula] = useState(getNodeFormulas(node)[0] || '');
  const [reason, setReason] = useState(node.reason || '');
  const [joinKeys, setJoinKeys] = useState<string[][]>(node.details?.on || []);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(node.columns);

  // Natural language revision state
  const [instruction, setInstruction] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setJoinType(node.details?.join_type || 'inner');
    setCondition(getNodeConditions(node).join(' AND '));
    setFormula(getNodeFormulas(node)[0] || '');
    setReason(node.reason || '');
    setJoinKeys(node.details?.on || []);
    setSelectedColumns(node.columns);
    setErrorMsg(null);
  }, [node]);

  // Handle direct step modification
  const handleApplyDirectEdit = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    const editedNode: PlanNode = {
      ...node,
      reason,
      details: {
        ...node.details,
        join_type: node.operation.toLowerCase() === 'join' ? joinType : node.details?.join_type,
        condition: condition.trim(),
        conditions: condition.trim() ? [condition.trim()] : [],
        filters: condition.trim() ? [condition.trim()] : [],
        formula: formula.trim(),
        formulas: formula.trim() ? [formula.trim()] : [],
        on: joinKeys,
      },
      columns: selectedColumns,
    };

    if ((node.operation.toLowerCase() === 'filter' || (node.is_wrapper && node.is_filter_enabled)) && !condition.trim()) {
      setErrorMsg('Enter a filter condition before applying this step.');
      setIsSubmitting(false);
      return;
    }
    if (
      (node.operation.toLowerCase() === 'projection' && !node.is_wrapper)
      || (node.is_wrapper && node.is_projection_enabled)
    ) {
      if (selectedColumns.length === 0) {
        setErrorMsg('Select at least one column for this projection.');
        setIsSubmitting(false);
        return;
      }
    }

    if ((node.is_manual || node.is_wrapper) && onManualStepUpdated) {
      onManualStepUpdated(editedNode);
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await revisePlanApi(planId, { editedNode });
      onPlanUpdated(res.plan, res.affected_nodes);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update step.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle natural language revision
  const handleReviseWithAI = async () => {
    if (!instruction.trim()) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await revisePlanApi(planId, { instruction });
      onPlanUpdated(res.plan, res.affected_nodes);
      setInstruction('');
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'AI revision failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-96 max-w-full bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col animate-in slide-in-from-right duration-200 text-[#1D2D3E]">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Edit Step Card</span>
          <h2 className="text-sm font-bold font-mono text-slate-900 truncate">{node.id}</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body: Form */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
        {/* Error Alert */}
        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-tight">{errorMsg}</span>
          </div>
        )}

        {/* Operation Info */}
        <div className="space-y-1">
          <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider">Operation Type</label>
          <div className="p-2 rounded bg-slate-100 font-mono text-slate-800 font-semibold uppercase">
            {node.operation}
          </div>
        </div>

        {/* Join Type Selector (if join) */}
        {node.operation.toLowerCase() === 'join' && (
          <div className="space-y-2">
            <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider">Join Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(['inner', 'left', 'right'] as const).map((jt) => (
                <button
                  key={jt}
                  type="button"
                  onClick={() => setJoinType(jt)}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold uppercase transition-all cursor-pointer ${
                    joinType === jt
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {jt}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 italic mt-1">
              {joinType === 'inner'
                ? 'Only keeps records matching both views.'
                : joinType === 'left'
                ? 'Preserves all records from primary view.'
                : 'Preserves all records from secondary view.'}
            </p>
          </div>
        )}

        {/* Filter Condition (if filter) */}
        {(node.operation.toLowerCase() === 'filter' || (node.is_wrapper && node.is_filter_enabled)) && (
          <div className="space-y-1">
            <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider">Filter Condition</label>
            <textarea
              rows={3}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="e.g. GOODSMOVEMENTTYPE = '101'"
              className="w-full resize-y p-2 border border-slate-300 rounded-lg font-mono text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
            <p className="text-[10px] text-slate-500">Use a valid SQL condition. The filter will be exported as the view WHERE clause.</p>
          </div>
        )}

        {((node.operation.toLowerCase() === 'projection' && !node.is_wrapper)
          || (node.is_wrapper && node.is_projection_enabled)) && (
          <div className="space-y-2">
            <div>
              <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider">Columns to pass through</label>
              <p className="mt-1 text-[10px] text-slate-500">Required downstream columns are locked and cannot be removed.</p>
            </div>
            <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {availableColumns.map((column) => {
                const isRequired = requiredColumns.includes(column);
                const isSelected = selectedColumns.includes(column);
                return (
                  <label key={column} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={isSelected || isRequired}
                      disabled={isRequired}
                      onChange={(event) => setSelectedColumns((current) =>
                        event.target.checked
                          ? [...current, column]
                          : current.filter((item) => item !== column),
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-800">{column}</span>
                    {isRequired && (
                      <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                        Required
                      </span>
                    )}
                  </label>
                );
              })}
              {availableColumns.length === 0 && (
                <p className="p-3 text-[11px] text-slate-500">No source column metadata is available for this step.</p>
              )}
            </div>
          </div>
        )}

        {/* Calculation Formula */}
        {(node.operation.toLowerCase() === 'calculated_column' || formula) && (
          <div className="space-y-1">
            <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider">Formula / Expression</label>
            <textarea
              rows={2}
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="e.g. DAYS_BETWEEN(START, END) + 1"
              className="w-full p-2 border border-slate-300 rounded-lg font-mono text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        )}

        {/* Reason / Purpose */}
        <div className="space-y-1">
          <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider">Business Purpose (Why)</label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full p-2 border border-slate-300 rounded-lg text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        </div>

        {/* Direct Apply Button */}
        <button
          type="button"
          onClick={handleApplyDirectEdit}
          disabled={isSubmitting}
          className="w-full py-2 px-4 rounded-lg bg-[#0070F2] hover:bg-[#0058C4] text-white font-semibold transition-colors flex items-center justify-center space-x-2 cursor-pointer shadow-xs disabled:opacity-50"
        >
          {isSubmitting ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Check className="w-4 h-4" />
              <span>Apply Step Edits</span>
            </>
          )}
        </button>

        {/* Divider */}
        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase font-bold text-slate-400 bg-white px-2">
            Or Ask AI To Revise
          </div>
        </div>

        {/* AI Revision Box */}
        <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-200 space-y-2">
          <label className="text-[11px] font-bold text-blue-900 flex items-center space-x-1">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            <span>Type Instruction for AI</span>
          </label>
          <textarea
            rows={2}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. Change join to LEFT join and keep only completed orders."
            className="w-full p-2 bg-white border border-blue-200 rounded-lg text-xs placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleReviseWithAI}
            disabled={isSubmitting || !instruction.trim()}
            className="w-full py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Revise with AI</span>
          </button>
        </div>
      </div>
    </div>
  );
};

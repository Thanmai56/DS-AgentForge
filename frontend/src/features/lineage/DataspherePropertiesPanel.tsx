// src/features/lineage/DataspherePropertiesPanel.tsx
// Interactive slide-over properties inspector for editing ViewGraph nodes:
// Join type and keys, filter expression, calculation expression, column include/exclude and rename.

import React, { useState, useEffect } from 'react';
import {
  X,
  GitMerge,
  Filter,
  Columns,
  Sigma,
  Trash2,
  Plus,
  Check,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { ViewGraphNode, Operation, JoinType } from './viewGraphTypes';

interface PropertiesPanelProps {
  node: ViewGraphNode | null;
  upstreamColumns: string[];
  onClose: () => void;
  onApplyOperation: (op: Operation) => void;
  onDeleteNode?: (nodeId: string) => void;
}

export const DataspherePropertiesPanel: React.FC<PropertiesPanelProps> = ({
  node,
  upstreamColumns,
  onClose,
  onApplyOperation,
  onDeleteNode,
}) => {
  if (!node) return null;

  const nType = node.node_type;
  const isSource = nType === 'SOURCE';
  const isOutput = nType === 'OUTPUT';

  // Join state
  const [joinType, setJoinType] = useState<string>(node.details.join_type || 'inner');
  const [keyPairs, setKeyPairs] = useState<string[][]>(node.details.key_pairs || []);

  // Filter state
  const [filterExpr, setFilterExpr] = useState<string>(node.details.filter_expression || '');

  // Calculation state
  const [calcName, setCalcName] = useState<string>(node.details.calculation_name || node.name || '');
  const [calcExpr, setCalcExpr] = useState<string>(node.details.expression || '');
  const [calcType, setCalcType] = useState<string>(node.details.data_type || 'Decimal');

  // Node Name state
  const [nodeName, setNodeName] = useState<string>(node.name || '');

  useEffect(() => {
    setJoinType(node.details.join_type || 'inner');
    setKeyPairs(node.details.key_pairs || []);
    setFilterExpr(node.details.filter_expression || '');
    setCalcName(node.details.calculation_name || node.name || '');
    setCalcExpr(node.details.expression || '');
    setCalcType(node.details.data_type || 'Decimal');
    setNodeName(node.name || '');
  }, [node]);

  // Handlers
  const handleJoinTypeChange = (newType: string) => {
    setJoinType(newType);
    onApplyOperation({
      op: 'set_join',
      node_id: node.id,
      payload: { join_type: newType, key_pairs: keyPairs },
    });
  };

  const handleAddKeyPair = () => {
    const defaultCol = upstreamColumns[0] || 'PURCHASEORDER';
    const updated = [...keyPairs, [defaultCol, defaultCol]];
    setKeyPairs(updated);
    onApplyOperation({
      op: 'set_join',
      node_id: node.id,
      payload: { join_type: joinType, key_pairs: updated },
    });
  };

  const handleUpdateKeyPair = (index: number, side: 0 | 1, value: string) => {
    const updated = keyPairs.map((pair, idx) => {
      if (idx !== index) return pair;
      const nextPair = [...pair];
      nextPair[side] = value;
      return nextPair;
    });
    setKeyPairs(updated);
    onApplyOperation({
      op: 'set_join',
      node_id: node.id,
      payload: { join_type: joinType, key_pairs: updated },
    });
  };

  const handleRemoveKeyPair = (index: number) => {
    const updated = keyPairs.filter((_, idx) => idx !== index);
    setKeyPairs(updated);
    onApplyOperation({
      op: 'set_join',
      node_id: node.id,
      payload: { join_type: joinType, key_pairs: updated },
    });
  };

  const handleSaveCalculation = () => {
    onApplyOperation({
      op: 'set_calculation',
      node_id: node.id,
      payload: {
        calculation_name: calcName.trim(),
        expression: calcExpr.trim(),
        data_type: calcType,
      },
    });
  };

  const handleSaveFilter = () => {
    onApplyOperation({
      op: 'set_filter',
      node_id: node.id,
      payload: {
        filter_expression: filterExpr.trim(),
      },
    });
  };

  return (
    <div className="fixed inset-y-0 right-0 w-96 max-w-full bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col animate-in slide-in-from-right duration-200 text-[#1D2D3E]">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-blue-100 border border-blue-200 flex items-center justify-center shrink-0">
            {nType === 'JOIN' && <GitMerge className="w-4 h-4 text-[#0070F2]" />}
            {nType === 'FILTER' && <Filter className="w-4 h-4 text-[#0070F2]" />}
            {nType === 'CALCULATION' && <Sigma className="w-4 h-4 text-[#0070F2]" />}
            {nType === 'PROJECTION' && <Columns className="w-4 h-4 text-[#0070F2]" />}
            {nType === 'SOURCE' && <Columns className="w-4 h-4 text-[#0070F2]" />}
            {nType === 'OUTPUT' && <Check className="w-4 h-4 text-[#0070F2]" />}
          </div>
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
              {nType} Node Inspector
            </span>
            <h2 className="text-sm font-bold font-mono text-slate-900 truncate" title={node.name}>
              {node.name}
            </h2>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
        {/* Node Validation Errors (if any) */}
        {node.errors && node.errors.length > 0 && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1.5 text-red-800">
            <div className="flex items-center space-x-1.5 font-bold text-[11px] text-red-900">
              <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
              <span>Validation Issues</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-[11px]">
              {node.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ── JOIN PROPERTIES ── */}
        {nType === 'JOIN' && (
          <div className="space-y-4">
            <div>
              <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider block mb-1.5">
                Join Type
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {(['inner', 'left', 'right', 'full'] as const).map((jt) => (
                  <button
                    key={jt}
                    type="button"
                    onClick={() => handleJoinTypeChange(jt)}
                    className={`py-2 px-1 rounded-lg border text-xs font-bold uppercase transition-all cursor-pointer ${
                      joinType.toLowerCase() === jt
                        ? 'bg-[#0070F2] text-white border-[#0070F2] shadow-xs'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {jt}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 italic mt-1.5">
                {joinType.toLowerCase() === 'inner'
                  ? 'Keeps only rows matching both views.'
                  : joinType.toLowerCase() === 'left'
                  ? 'Keeps all rows from primary view; unmatched secondary attributes appear as null.'
                  : joinType.toLowerCase() === 'right'
                  ? 'Keeps all rows from secondary view.'
                  : 'Keeps all rows from both views.'}
              </p>
            </div>

            {/* Key Pairs Table */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider">
                  Join Key Conditions
                </label>
                <button
                  type="button"
                  onClick={handleAddKeyPair}
                  className="px-2 py-0.5 rounded text-[10px] font-semibold text-[#0070F2] bg-blue-50 hover:bg-blue-100 flex items-center space-x-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Key</span>
                </button>
              </div>

              <div className="space-y-2">
                {keyPairs.length === 0 ? (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-center text-slate-400 text-xs">
                    No join keys defined. Click "Add Key".
                  </div>
                ) : (
                  keyPairs.map((pair, idx) => (
                    <div key={idx} className="flex items-center space-x-1.5 bg-slate-50 p-2 rounded-lg border border-slate-200">
                      <input
                        type="text"
                        value={pair[0] || ''}
                        onChange={(e) => handleUpdateKeyPair(idx, 0, e.target.value.trim().toUpperCase())}
                        placeholder="Left Column"
                        className="flex-1 px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono"
                      />
                      <span className="font-bold text-slate-400">=</span>
                      <input
                        type="text"
                        value={pair[1] || ''}
                        onChange={(e) => handleUpdateKeyPair(idx, 1, e.target.value.trim().toUpperCase())}
                        placeholder="Right Column"
                        className="flex-1 px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveKeyPair(idx)}
                        className="p-1 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── CALCULATION PROPERTIES ── */}
        {nType === 'CALCULATION' && (
          <div className="space-y-4">
            <div>
              <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider block mb-1">
                Calculation Field Name
              </label>
              <input
                type="text"
                value={calcName}
                onChange={(e) => setCalcName(e.target.value.toUpperCase())}
                placeholder="e.g. CALC_PROCESSING_DAYS"
                className="w-full p-2 border border-slate-300 rounded-lg font-mono text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider block mb-1">
                Data Type
              </label>
              <select
                value={calcType}
                onChange={(e) => setCalcType(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
              >
                <option value="Integer">Integer</option>
                <option value="Decimal">Decimal</option>
                <option value="Date">Date</option>
                <option value="String">String (NVARCHAR)</option>
              </select>
            </div>

            <div>
              <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider block mb-1">
                Formula Expression
              </label>
              <textarea
                rows={3}
                value={calcExpr}
                onChange={(e) => setCalcExpr(e.target.value)}
                placeholder="e.g. DAYS_BETWEEN(CREATIONDATE, FINAL_DELIVERY_DATE) + 1"
                className="w-full p-2 border border-slate-300 rounded-lg font-mono text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={handleSaveCalculation}
              className="w-full py-2 px-3 bg-[#0070F2] hover:bg-[#0058C4] text-white font-bold rounded-lg transition-colors flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Apply Calculation</span>
            </button>
          </div>
        )}

        {/* ── FILTER PROPERTIES ── */}
        {nType === 'FILTER' && (
          <div className="space-y-4">
            <div>
              <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider block mb-1">
                Filter Expression
              </label>
              <textarea
                rows={3}
                value={filterExpr}
                onChange={(e) => setFilterExpr(e.target.value)}
                placeholder="e.g. GOODSMOVEMENTTYPE = '101' AND STATUS = 'ACTIVE'"
                className="w-full p-2 border border-slate-300 rounded-lg font-mono text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={handleSaveFilter}
              className="w-full py-2 px-3 bg-[#0070F2] hover:bg-[#0058C4] text-white font-bold rounded-lg transition-colors flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Apply Filter</span>
            </button>
          </div>
        )}

        {/* ── PROJECTION / COLUMNS ── */}
        {(nType === 'PROJECTION' || nType === 'SOURCE' || nType === 'OUTPUT') && (
          <div>
            <label className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider block mb-1.5">
              Available Columns ({node.columns?.length || 0})
            </label>
            <div className="max-h-56 overflow-y-auto space-y-1 bg-slate-50 p-2 rounded-lg border border-slate-200">
              {node.columns?.map((col, idx) => (
                <div key={idx} className="flex items-center justify-between text-[11px] font-mono py-1 px-2 bg-white rounded border border-slate-100">
                  <span className="text-slate-800 font-medium truncate">{col}</span>
                  {nType === 'PROJECTION' && (
                    <button
                      type="button"
                      onClick={() =>
                        onApplyOperation({
                          op: node.details.excluded_columns?.includes(col) ? 'include_column' : 'exclude_column',
                          node_id: node.id,
                          payload: { column: col },
                        })
                      }
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded cursor-pointer ${
                        node.details.excluded_columns?.includes(col)
                          ? 'bg-red-100 text-red-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {node.details.excluded_columns?.includes(col) ? 'EXCLUDED' : 'INCLUDED'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delete node option (forbidden for Source & Output) */}
        {!isSource && !isOutput && onDeleteNode && (
          <div className="pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => onDeleteNode(node.id)}
              className="w-full py-2 px-3 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Node</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

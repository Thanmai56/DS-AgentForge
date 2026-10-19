// src/features/lineage/nodes/DatasphereEditorNodes.tsx
// High-fidelity custom nodes matching the SAP Datasphere Graphical View Editor.
// 1. Source Node (Left): White card, blue tab on the left, technical name, column count.
// 2. Operator Nodes (Middle): Blue rounded squares with an icon and small label underneath.
// 3. Output Node (Right): Blue-headed card with view's technical name and column count.

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import {
  GitMerge,
  Filter,
  Columns,
  Sigma,
  Layers,
  Database,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { ViewGraphNode } from '../viewGraphTypes';

// ── Shared Horizon Handle ───────────────────────────────────────────────────
const HorizonHandle: React.FC<{
  type: 'target' | 'source';
  position: Position;
  color?: string;
  className?: string;
}> = ({ type, position, color = '#0070F2', className = '' }) => (
  <Handle
    type={type}
    position={position}
    className={`!w-3 !h-3 !border-2 !border-white !rounded-full shadow-sm transition-transform hover:!scale-125 cursor-crosshair ${className}`}
    style={{ backgroundColor: color }}
  />
);

// ── 1. Source Node (Left column) ────────────────────────────────────────────
export const DatasphereSourceNode = memo(({ data, selected }: NodeProps<ViewGraphNode>) => {
  const colCount = data.columns ? data.columns.length : 0;
  const hasErrors = data.errors && data.errors.length > 0;

  return (
    <div
      className={`relative w-64 bg-white rounded-lg border text-slate-800 transition-all select-none flex overflow-hidden shadow-xs ${
        selected
          ? 'border-[#0070F2] ring-2 ring-[#0070F2]/30 shadow-md'
          : hasErrors
          ? 'border-red-400 ring-1 ring-red-300'
          : 'border-slate-300 hover:border-[#0070F2]/70 hover:shadow-sm'
      }`}
    >
      {/* Blue tab on the left edge */}
      <div className="w-2.5 bg-[#0070F2] shrink-0" />

      {/* Card Content */}
      <div className="flex-1 p-3 space-y-1.5 min-w-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 min-w-0">
            <Database className="w-3.5 h-3.5 text-[#0070F2] shrink-0" />
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
              Source Object
            </span>
          </div>
          {hasErrors && (
            <span title={data.errors?.join('\n')}>
              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
            </span>
          )}
        </div>

        <div className="font-mono text-xs font-bold text-slate-900 truncate" title={data.name}>
          {data.name}
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
          <span>Columns:</span>
          <span className="font-mono font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.2 rounded text-[10px]">
            {colCount} cols
          </span>
        </div>
      </div>

      {/* Outgoing Handle on Right */}
      <HorizonHandle type="source" position={Position.Right} color="#0070F2" />
    </div>
  );
});

// ── 2. Operator Node (Middle column - Blue rounded square) ──────────────────
export const DatasphereOperatorNode = memo(({ data, selected }: NodeProps<ViewGraphNode>) => {
  const nType = data.node_type;
  const joinType = (data.details.join_type || 'inner').toLowerCase();
  const hasErrors = data.errors && data.errors.length > 0;

  // Icon selection
  let IconComponent = Columns;
  let defaultLabel = 'Operator';

  if (nType === 'JOIN') {
    IconComponent = GitMerge;
    defaultLabel = `${joinType.charAt(0).toUpperCase() + joinType.slice(1)} Join`;
  } else if (nType === 'CALCULATION') {
    IconComponent = Sigma;
    defaultLabel = data.details.calculation_name || data.name || 'Calculation';
  } else if (nType === 'FILTER') {
    IconComponent = Filter;
    defaultLabel = 'Filter';
  } else if (nType === 'PROJECTION') {
    IconComponent = Columns;
    defaultLabel = 'Projection';
  } else if (nType === 'UNION') {
    IconComponent = Layers;
    defaultLabel = 'Union';
  }

  // Diff styles
  const diff = data.diffStatus;
  const diffClass =
    diff === 'added'
      ? 'ring-4 ring-emerald-400 border-emerald-500 bg-emerald-50'
      : diff === 'removed'
      ? 'ring-4 ring-rose-400 border-rose-500 bg-rose-50 opacity-60'
      : diff === 'modified'
      ? 'ring-4 ring-amber-400 border-amber-500 bg-amber-50 animate-pulse'
      : selected
      ? 'ring-4 ring-[#0070F2]/30 border-[#0070F2] shadow-md scale-105'
      : hasErrors
      ? 'border-red-400 ring-2 ring-red-200'
      : 'border-[#0070F2] hover:border-[#0058C4] hover:shadow-md';

  return (
    <div className="flex flex-col items-center justify-center select-none group cursor-pointer">
      {/* Target Handle on Left */}
      <HorizonHandle type="target" position={Position.Left} color="#0070F2" className="-ml-1" />

      {/* Operator Rounded Square Card */}
      <div className="relative">
        <div
          className={`w-14 h-14 rounded-2xl bg-white border-2 flex items-center justify-center transition-all duration-150 shadow-sm ${diffClass}`}
        >
          <IconComponent className="w-6 h-6 text-[#0070F2]" />
        </div>

        {/* Diff badge overlay */}
        {diff === 'added' && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-emerald-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center shadow-xs">
            +
          </span>
        )}
        {diff === 'removed' && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center shadow-xs">
            -
          </span>
        )}
        {diff === 'modified' && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-amber-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center shadow-xs" title="Modified by AI">
            <Sparkles className="w-2.5 h-2.5" />
          </span>
        )}
        {!diff && hasErrors && (
          <span
            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center shadow-xs"
            title={data.errors?.join('\n')}
          >
            !
          </span>
        )}
      </div>

      {/* Label Underneath (Exact Datasphere style) */}
      <div className="mt-1.5 text-center max-w-[120px]">
        <div className="font-semibold text-xs text-slate-800 truncate group-hover:text-[#0070F2] transition-colors leading-tight">
          {defaultLabel}
        </div>
        {nType === 'JOIN' && data.details.key_pairs && data.details.key_pairs.length > 0 && (
          <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5" title={data.details.key_pairs.map(p => p.join('=')).join(', ')}>
            {data.details.key_pairs[0].join('=')}
          </div>
        )}
      </div>

      {/* Source Handle on Right */}
      <HorizonHandle type="source" position={Position.Right} color="#0070F2" className="-mr-1" />
    </div>
  );
});

// ── 3. Output Node (Right column - Blue-headed card) ────────────────────────
export const DatasphereOutputNode = memo(({ data, selected }: NodeProps<ViewGraphNode>) => {
  const colCount = data.columns ? data.columns.length : 0;
  const hasErrors = data.errors && data.errors.length > 0;

  return (
    <div
      className={`relative w-72 bg-white rounded-lg border text-slate-800 transition-all select-none overflow-hidden shadow-xs ${
        selected
          ? 'border-[#0070F2] ring-2 ring-[#0070F2]/30 shadow-md'
          : hasErrors
          ? 'border-red-400 ring-1 ring-red-300'
          : 'border-slate-300 hover:border-[#0070F2]/70 hover:shadow-sm'
      }`}
    >
      {/* Incoming Handle on Left */}
      <HorizonHandle type="target" position={Position.Left} color="#0070F2" />

      {/* Blue-Headed Card Header */}
      <div className="px-3 py-2 bg-[#0070F2] text-white flex items-center justify-between">
        <div className="flex items-center space-x-1.5 min-w-0">
          <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
          <span className="text-[10px] font-bold tracking-wider uppercase">
            Output View
          </span>
        </div>
        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white/20 text-white font-semibold">
          TERMINAL
        </span>
      </div>

      {/* Card Body */}
      <div className="p-3 space-y-1.5">
        <div className="font-mono text-xs font-bold text-slate-900 truncate" title={data.name}>
          {data.name}
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
          <span>Output Columns:</span>
          <span className="font-mono font-semibold text-[#0070F2] bg-blue-50 px-1.5 py-0.2 rounded text-[10px]">
            {colCount} cols
          </span>
        </div>

        {hasErrors && (
          <div className="text-[10px] text-red-600 bg-red-50 p-1.5 rounded flex items-start space-x-1">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="truncate">{data.errors?.[0]}</span>
          </div>
        )}
      </div>
    </div>
  );
});

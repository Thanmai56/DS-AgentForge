// frontend/src/features/plan/StepCard.tsx
// Visual step card displaying operation details, plain-English reason, and hover column preview

import React, { useState } from 'react';
import {
  GitMerge,
  Filter,
  Columns,
  Calculator,
  Sigma,
  Layers,
  Link,
  Database,
  CheckCircle2,
  HelpCircle,
  Sparkles
} from 'lucide-react';
import { PlanNode } from './types';

interface StepCardProps {
  node: PlanNode;
  stepNumber: number;
  isSelected?: boolean;
  onSelect: (node: PlanNode) => void;
}

export const StepCard: React.FC<StepCardProps> = ({
  node,
  stepNumber,
  isSelected = false,
  onSelect,
}) => {
  const [showColumnsPopover, setShowColumnsPopover] = useState(false);

  // Operation specific styling and metadata
  const getOpConfig = (op: string) => {
    switch (op.toLowerCase()) {
      case 'join':
        return {
          label: 'JOIN',
          icon: GitMerge,
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          badgeBg: 'bg-blue-100 text-blue-800',
          hoverBorder: 'hover:border-blue-400',
        };
      case 'filter':
        return {
          label: 'FILTER',
          icon: Filter,
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          badgeBg: 'bg-amber-100 text-amber-800',
          hoverBorder: 'hover:border-amber-400',
        };
      case 'projection':
        return {
          label: 'PROJECTION',
          icon: Columns,
          bg: 'bg-slate-50',
          border: 'border-slate-200',
          badgeBg: 'bg-slate-100 text-slate-800',
          hoverBorder: 'hover:border-slate-400',
        };
      case 'calculated_column':
        return {
          label: 'CALCULATION',
          icon: Calculator,
          bg: 'bg-emerald-50',
          border: 'border-emerald-200',
          badgeBg: 'bg-emerald-100 text-emerald-800',
          hoverBorder: 'hover:border-emerald-400',
        };
      case 'measure':
        return {
          label: 'MEASURE',
          icon: Sigma,
          bg: 'bg-teal-50',
          border: 'border-teal-200',
          badgeBg: 'bg-teal-100 text-teal-800',
          hoverBorder: 'hover:border-teal-400',
        };
      case 'analytic_model':
        return {
          label: 'ANALYTIC MODEL',
          icon: Layers,
          bg: 'bg-purple-50',
          border: 'border-purple-200',
          badgeBg: 'bg-purple-100 text-purple-800',
          hoverBorder: 'hover:border-purple-400',
        };
      case 'association':
        return {
          label: 'ASSOCIATION',
          icon: Link,
          bg: 'bg-sky-50',
          border: 'border-sky-200',
          badgeBg: 'bg-sky-100 text-sky-800',
          hoverBorder: 'hover:border-sky-400',
        };
      default:
        return {
          label: op.toUpperCase(),
          icon: Database,
          bg: 'bg-gray-50',
          border: 'border-gray-200',
          badgeBg: 'bg-gray-100 text-gray-800',
          hoverBorder: 'hover:border-gray-400',
        };
    }
  };

  const config = getOpConfig(node.operation);
  const OpIcon = config.icon;

  // Natural language sentence explaining join behavior
  const getRowsKeptSentence = (joinType: string) => {
    const jt = (joinType || 'inner').toLowerCase();
    if (jt === 'left') {
      return 'Keeps all rows from primary view; unmatched secondary attributes appear as null.';
    } else if (jt === 'right') {
      return 'Keeps all rows from secondary view; unmatched primary records appear as null.';
    } else if (jt === 'full') {
      return 'Keeps all rows from both views whether or not keys match.';
    }
    return 'Keeps only rows that have matching keys on both sides.';
  };

  return (
    <div
      onClick={() => onSelect(node)}
      className={`relative group rounded-xl border p-4 text-left transition-all cursor-pointer shadow-xs select-none ${
        config.bg
      } ${
        isSelected
          ? 'ring-2 ring-[#0070F2] border-[#0070F2] bg-white shadow-md'
          : `${config.border} ${config.hoverBorder} hover:shadow-md`
      }`}
    >
      {/* Top Header: Step Number, Operation Badge, Existing Pill */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center space-x-2">
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-white border border-slate-300 text-[10px] font-bold text-slate-700 shadow-2xs">
            {stepNumber}
          </span>
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center space-x-1 ${config.badgeBg}`}>
            <OpIcon className="w-3 h-3 mr-1" />
            <span>{node.is_wrapper ? 'RELATIONAL DATASET WRAPPER' : config.label}</span>
          </span>
          {node.layer && (
            <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px] font-bold text-slate-500">
              {node.layer}
            </span>
          )}
          {node.details?.join_type && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase bg-blue-600 text-white tracking-wide">
              {node.details.join_type}
            </span>
          )}
        </div>

        {/* Existing vs Proposed Badge */}
        {node.is_existing ? (
          <span className="inline-flex items-center space-x-1 text-[10px] font-semibold text-emerald-800 bg-emerald-100/90 border border-emerald-300 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>Existing CDS View</span>
          </span>
        ) : (
          <span className="inline-flex items-center space-x-1 text-[10px] font-semibold text-blue-800 bg-blue-100/90 border border-blue-200 px-2 py-0.5 rounded-full">
            <Sparkles className="w-3 h-3 text-blue-600" />
            <span>Proposed Step</span>
          </span>
        )}
      </div>

      {/* Step Technical ID */}
      <div className="font-mono text-xs font-bold text-[#1D2D3E] tracking-tight truncate">
        {node.id}
      </div>

      {/* Step Plain-English Purpose / What & Why */}
      <p className="mt-1.5 text-xs text-slate-700 leading-relaxed font-normal">
        {node.reason || 'Transforms source entities according to analytical requirements.'}
      </p>

      {node.is_wrapper && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            node.is_projection_enabled
              ? 'bg-blue-100 text-blue-800'
              : 'bg-slate-100 text-slate-500'
          }`}>
            Projection {node.is_projection_enabled ? 'enabled' : 'not configured'}
          </span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            node.is_filter_enabled
              ? 'bg-amber-100 text-amber-800'
              : 'bg-slate-100 text-slate-500'
          }`}>
            Filter {node.is_filter_enabled ? 'enabled' : 'not configured'}
          </span>
        </div>
      )}

      {/* Join specific "Rows Kept" sentence */}
      {node.operation.toLowerCase() === 'join' && (
        <div className="mt-2.5 p-2 rounded-lg bg-blue-50/80 border border-blue-100 text-[11px] text-blue-900 leading-normal flex items-start space-x-1.5">
          <HelpCircle className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Rows Kept: </span>
            <span>{getRowsKeptSentence(node.details?.join_type || '')}</span>
            {node.details?.on && node.details.on.length > 0 && (
              <div className="mt-1 font-mono text-[10px] text-blue-800 bg-white/80 px-1.5 py-0.5 rounded inline-block">
                ON {node.details.on.map(pair => `${pair[0]} = ${pair[1]}`).join(' AND ')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filter condition callout */}
      {node.details?.condition && (
        <div className="mt-2 p-1.5 rounded bg-amber-50 border border-amber-100 font-mono text-[11px] text-amber-900 truncate">
          WHERE {node.details.condition}
        </div>
      )}

      {/* Calculation formula callout */}
      {(node.calculated_fields?.length || node.details?.formula) && (
        <div className="mt-2 space-y-1">
          {node.calculated_fields?.map((field) => (
            <div
              key={field.name}
              className="rounded border border-emerald-100 bg-emerald-50 p-1.5 font-mono text-[11px] text-emerald-900"
            >
              <span className="font-bold">{field.name} = </span>{field.formula}
            </div>
          ))}
          {!node.calculated_fields?.length && node.details?.formula && (
            <div className="rounded border border-emerald-100 bg-emerald-50 p-1.5 font-mono text-[11px] text-emerald-900">
              = {node.details.formula}
            </div>
          )}
        </div>
      )}

      {/* Inputs & Output Columns Hover Pill */}
      <div className="mt-3 pt-2.5 border-t border-slate-200/70 flex items-center justify-between text-[11px] text-slate-600">
        <div className="flex items-center space-x-1 text-slate-500 truncate max-w-[55%]">
          <span className="text-[10px] uppercase font-semibold text-slate-400">Inputs:</span>
          <span className="font-mono text-slate-700 truncate">{node.inputs.join(', ') || 'Source'}</span>
        </div>

        {/* Hover Target for Columns Popover */}
        <div
          className="relative inline-block"
          onMouseEnter={() => setShowColumnsPopover(true)}
          onMouseLeave={() => setShowColumnsPopover(false)}
        >
          <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 font-medium hover:border-[#0070F2] hover:text-[#0070F2] transition-colors cursor-help inline-flex items-center space-x-1">
            <Columns className="w-3 h-3" />
            <span>{node.columns.length} columns</span>
          </span>

          {/* Popover Tooltip */}
          {showColumnsPopover && (
            <div className="absolute right-0 bottom-full mb-2 z-50 w-64 p-3 bg-white rounded-xl shadow-xl border border-slate-200 text-left">
              <div className="text-[11px] font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center justify-between border-b pb-1">
                <span>Output Columns ({node.columns.length})</span>
                <span className="text-[10px] font-mono text-slate-400">{node.id}</span>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {node.columns.map((col, idx) => (
                  <div key={idx} className="flex items-center space-x-1.5 text-xs text-slate-700 font-mono py-0.5 border-b border-slate-50 last:border-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0070F2]" />
                    <span className="truncate">{col}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Columns3, Database, ExternalLink, Filter, Layers, Table, X } from 'lucide-react';
import { LineageNodeData } from '../../components/lineage/DatasphereLineageView';
import { PlanNode } from './types';

interface PlanComponentInspectorProps {
  entity: LineageNodeData;
  node?: PlanNode;
  onClose: () => void;
  onEdit?: () => void;
  onAddTransform?: (operation: 'projection' | 'filter') => void;
  onOpenLineage: () => void;
}

export const PlanComponentInspector: React.FC<PlanComponentInspectorProps> = ({
  entity,
  node,
  onClose,
  onEdit,
  onAddTransform,
  onOpenLineage,
}) => {
  const [activeTab, setActiveTab] = useState<'elements' | 'lineage'>('elements');
  const hasInternalLineage = Boolean(
    entity.sources?.length || entity.joins?.length || entity.calculatedFields?.length,
  );

  useEffect(() => {
    setActiveTab('elements');
  }, [entity.technicalName]);

  return (
    <aside className="absolute inset-y-0 left-0 z-30 flex w-[340px] max-w-[90%] flex-col border-r border-slate-200 bg-white shadow-xl">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 p-4">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {entity.kind === 'table' ? <Database className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
            <span>{node?.layer || (entity.kind === 'table' ? 'L0 Source' : entity.kind.replace('_', ' '))}</span>
            {node && <span className="rounded bg-white px-1.5 py-0.5 text-[9px]">{node.operation}</span>}
          </div>
          <h2 className="truncate font-mono text-sm font-bold text-slate-900">{entity.technicalName}</h2>
          <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{entity.businessName}</p>
        </div>
        <button
          type="button"
          aria-label="Close component details"
          onClick={onClose}
          className="rounded p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('elements')}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-semibold ${
            activeTab === 'elements' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'
          }`}
        >
          <Table className="h-3.5 w-3.5" />
          Elements ({entity.fields.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('lineage')}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-3 text-xs font-semibold ${
            activeTab === 'lineage' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Lineage
        </button>
      </div>

      {activeTab === 'elements' ? (
        <>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2">
            {entity.fields.length ? entity.fields.map((field) => (
              <div key={field.name} className="rounded-md p-2 hover:bg-slate-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs font-semibold text-slate-800">
                    {field.is_key && <span className="mr-1.5 rounded bg-amber-100 px-1 text-[9px] text-amber-800">KEY</span>}
                    {field.name}
                  </span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                    {field.data_type}
                  </span>
                </div>
                {field.label && field.label !== field.name && (
                  <p className="mt-1 truncate text-[11px] text-slate-500">{field.label}</p>
                )}
              </div>
            )) : (
              <p className="p-4 text-xs text-slate-500">No element metadata is available for this component.</p>
            )}
          </div>
          {node && (
            <div className="border-t border-slate-200 p-3">
              {node.is_wrapper && onAddTransform && (
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onAddTransform('projection')}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2 py-2 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    <Columns3 className="h-3.5 w-3.5" />
                    Configure Projection
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddTransform('filter')}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                  >
                    <Filter className="h-3.5 w-3.5" />
                    Configure Filter
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={onEdit}
                className="w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              >
                Edit plan step
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {hasInternalLineage ? (
            <>
              <p className="mb-3 text-xs leading-relaxed text-slate-600">
                Inspect the inputs and transformation flow that produce this component.
              </p>
              <button
                type="button"
                onClick={onOpenLineage}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0070F2] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#0058C6]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open internal lineage
              </button>
              {entity.sources?.length ? (
                <div className="mt-4 space-y-2">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Inputs</h3>
                  {entity.sources.map((source) => (
                    <div key={source} className="rounded border border-slate-200 bg-slate-50 p-2 font-mono text-xs text-slate-700">
                      {source}
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-xs leading-relaxed text-slate-500">
              This source has no upstream lineage in the supplied metadata. Its available elements are listed in the Elements tab.
            </p>
          )}
        </div>
      )}
    </aside>
  );
};

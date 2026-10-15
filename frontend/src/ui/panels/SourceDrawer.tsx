// src/ui/panels/SourceDrawer.tsx
// Right-side drawer showing source table fields. Opens on Source node click.

import React from 'react';
import { X, Key, Hash, Type, Calendar, Database } from 'lucide-react';
import type { SourceDef, FieldDef } from '../../core/model/types';
import { usePlanStore } from '../../state/planStore';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  'cds.Integer': <Hash size={11} color="#06b6d4" />,
  'cds.Decimal': <Hash size={11} color="#8b5cf6" />,
  'cds.String': <Type size={11} color="#10b981" />,
  'cds.Date': <Calendar size={11} color="#f59e0b" />,
};

function FieldRow({ field }: { field: FieldDef }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors">
      <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
        {TYPE_ICONS[field.type] ?? <Database size={11} color="#64748b" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono font-medium truncate" style={{ color: '#e2e8f0' }}>{field.name}</span>
          {field.key && (
            <span className="badge" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontSize: 9 }}>
              <Key size={8} /> KEY
            </span>
          )}
        </div>
        <div className="text-[10px] flex gap-2" style={{ color: '#64748b' }}>
          <span>{field.type.replace('cds.', '')}</span>
          {field.length !== undefined && <span>({field.length})</span>}
          {field.precision !== undefined && <span>({field.precision},{field.scale})</span>}
        </div>
      </div>
    </div>
  );
}

interface Props {
  sources: SourceDef[];
}

export const SourceDrawer: React.FC<Props> = ({ sources }) => {
  const drawerSourceId = usePlanStore(s => s.drawerSourceId);
  const closeDrawer = usePlanStore(s => s.closeDrawer);

  const source = sources.find(s => s.id === drawerSourceId);

  if (!source) return null;

  return (
    <div
      className="absolute right-0 top-0 h-full z-30 animate-slide-in flex flex-col"
      style={{
        width: 320,
        background: 'var(--bg-card)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
      }}
      id="source-drawer"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <div className="flex items-center gap-2">
            <Database size={14} color="#3b82f6" />
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#3b82f6' }}>Source Table</span>
          </div>
          <div className="text-sm font-semibold mt-0.5" style={{ color: '#e2e8f0' }}>{source.label}</div>
          <div className="text-xs font-mono" style={{ color: '#64748b' }}>{source.technicalName}</div>
        </div>
        <button
          onClick={closeDrawer}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
          id="close-drawer"
          aria-label="Close drawer"
        >
          <X size={15} color="#94a3b8" />
        </button>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest px-2 mb-1.5" style={{ color: '#64748b' }}>
          {source.fields.length} Fields
        </div>
        {source.fields.map(f => (
          <FieldRow key={f.name} field={f} />
        ))}
      </div>
    </div>
  );
};

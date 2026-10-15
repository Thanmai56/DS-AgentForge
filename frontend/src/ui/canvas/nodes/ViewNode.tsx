// src/ui/canvas/nodes/ViewNode.tsx
// Node for intermediate and dimension views. Click drill-downs into the view.

import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Layers, ChevronRight } from 'lucide-react';

export interface ViewNodeData {
  label: string;
  technicalName: string;
  viewId: string;
  kind: 'dimension' | 'intermediate' | 'fact';
  onDrillDown: (viewId: string) => void;
}

const KIND_CONFIG = {
  dimension: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', label: 'Dimension View' },
  intermediate: { color: '#06b6d4', bg: 'rgba(6,182,212,0.1)', label: 'Intermediate View' },
  fact: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'Fact View' },
};

export const ViewNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as unknown as ViewNodeData;
  const cfg = KIND_CONFIG[d.kind] ?? KIND_CONFIG.intermediate;

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ background: '#334155', border: 'none', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: '#334155', border: 'none', width: 8, height: 8 }} />
      <div
        className="group cursor-pointer select-none"
        onClick={() => d.onDrillDown(d.viewId)}
        title={`Click to explore ${d.technicalName}`}
        id={`node-view-${d.technicalName}`}
      >
        <div
          className="flex flex-col gap-1.5 px-4 py-3 rounded-xl border transition-all duration-200 min-w-[200px]"
          style={{
            background: `linear-gradient(135deg, ${cfg.bg} 0%, #0f172a 100%)`,
            borderColor: cfg.color + '40',
            boxShadow: `0 2px 16px rgba(0,0,0,0.5), 0 0 0 1px ${cfg.color}20`,
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: cfg.bg }}>
                <Layers size={13} color={cfg.color} />
              </div>
              <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: cfg.color }}>{cfg.label}</span>
            </div>
            <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: cfg.color }} />
          </div>
          <div className="text-xs font-semibold leading-tight" style={{ color: '#e2e8f0' }}>{d.label}</div>
          <div className="text-[10px] font-mono" style={{ color: '#64748b' }}>{d.technicalName}</div>
        </div>
      </div>
    </>
  );
};

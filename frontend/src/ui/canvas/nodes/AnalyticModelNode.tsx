// src/ui/canvas/nodes/AnalyticModelNode.tsx
// Node for the Analytic Model. Clickable to drill-down.

import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { BarChart3, ChevronRight } from 'lucide-react';

export interface AnalyticModelNodeData {
  label: string;
  technicalName: string;
  onDrillDown: (id: string) => void;
}

export const AnalyticModelNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as unknown as AnalyticModelNodeData;

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ background: '#334155', border: 'none', width: 8, height: 8 }} />
      <div
        className="group cursor-pointer select-none"
        onClick={() => d.onDrillDown(d.technicalName)}
        title="Click to explore Analytic Model"
        id={`node-am-${d.technicalName}`}
      >
        <div
          className="flex flex-col gap-1.5 px-4 py-3 rounded-xl border transition-all duration-200 min-w-[220px]"
          style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, #0f172a 100%)',
            borderColor: 'rgba(16,185,129,0.4)',
            boxShadow: '0 2px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(16,185,129,0.15)',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.15)' }}>
                <BarChart3 size={13} color="#10b981" />
              </div>
              <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: '#10b981' }}>Analytic Model</span>
            </div>
            <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#10b981' }} />
          </div>
          <div className="text-xs font-semibold leading-tight" style={{ color: '#e2e8f0' }}>{d.label}</div>
          <div className="text-[10px] font-mono" style={{ color: '#64748b' }}>{d.technicalName}</div>
        </div>
      </div>
    </>
  );
};

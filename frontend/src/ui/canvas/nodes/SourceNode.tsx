// src/ui/canvas/nodes/SourceNode.tsx
// Node for raw source tables. Click opens SourceDrawer.

import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Database } from 'lucide-react';

export interface SourceNodeData {
  label: string;
  technicalName: string;
  sourceId: string;
  onOpenDrawer: (id: string) => void;
}

export const SourceNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as unknown as SourceNodeData;
  return (
    <>
      <Handle type="source" position={Position.Right} style={{ background: '#334155', border: 'none', width: 8, height: 8 }} />
      <div
        className="group cursor-pointer select-none"
        onClick={() => d.onOpenDrawer(d.sourceId)}
        title={`Source: ${d.technicalName}`}
        id={`node-source-${d.technicalName}`}
      >
        <div
          className="flex flex-col gap-1.5 px-4 py-3 rounded-xl border transition-all duration-200 min-w-[160px]"
          style={{
            background: 'linear-gradient(135deg, #0f2647 0%, #0d1f3a 100%)',
            borderColor: '#1e3a5f',
            boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
          }}
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.15)' }}>
              <Database size={13} color="#3b82f6" />
            </div>
            <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: '#3b82f6' }}>Source</span>
          </div>
          <div className="text-xs font-semibold leading-tight" style={{ color: '#e2e8f0' }}>{d.label}</div>
          <div className="text-[10px] font-mono" style={{ color: '#64748b' }}>{d.technicalName}</div>
        </div>
      </div>
    </>
  );
};

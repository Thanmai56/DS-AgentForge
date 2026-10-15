// src/ui/panels/Breadcrumb.tsx
// Breadcrumb navigation derived from the navigation stack.
// Each crumb is clickable to pop back.

import React from 'react';
import { ChevronRight, Home } from 'lucide-react';
import { useNavigationStore } from '../../state/navigationStore';
import type { LineageGraph, NavFrame } from '../../core/model/types';

interface Props {
  graph: LineageGraph;
}

function frameName(frame: NavFrame, graph: LineageGraph): string {
  if (frame.type === 'main') return 'Main Lineage Map';
  const view = graph.views.find(v => v.id === frame.id);
  if (view) return view.label;
  if (frame.id === graph.analyticModelId) return graph.analyticModelLabel;
  return frame.id;
}

export const Breadcrumb: React.FC<Props> = ({ graph }) => {
  const stack = useNavigationStore(s => s.stack);
  const popTo = useNavigationStore(s => s.popTo);

  return (
    <div
      className="flex items-center gap-1 px-4 py-2 border-b text-sm animate-fade-in"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
      id="breadcrumb"
    >
      <Home size={13} style={{ color: 'var(--text-muted)' }} className="mr-1" />
      {stack.map((frame, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <ChevronRight size={13} style={{ color: 'var(--text-muted)' }} />}
          <button
            onClick={() => popTo(idx)}
            disabled={idx === stack.length - 1}
            className={`px-1 py-0.5 rounded transition-colors ${
              idx === stack.length - 1
                ? 'cursor-default font-semibold'
                : 'hover:underline cursor-pointer'
            }`}
            style={{
              color: idx === stack.length - 1 ? 'var(--text-primary)' : 'var(--accent-blue)',
              background: 'transparent',
              border: 'none',
              fontSize: '13px',
            }}
            id={`crumb-${idx}`}
          >
            {frameName(frame, graph)}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

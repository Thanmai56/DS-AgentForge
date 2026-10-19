// frontend/src/features/plan/PlanLanesCanvas.tsx
// Visual multi-lane pipeline laying out modeling views from Left to Right (L0 -> L4)

import React, { useMemo } from 'react';
import { Database, Filter, Layers, Box, Sigma, ArrowRight } from 'lucide-react';
import { Plan, PlanNode } from './types';
import { StepCard } from './StepCard';

interface PlanLanesCanvasProps {
  plan: Plan;
  selectedNode: PlanNode | null;
  onSelectNode: (node: PlanNode) => void;
}

interface LaneConfig {
  id: string;
  layer: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  headerBg: string;
}

const LANES: LaneConfig[] = [
  {
    id: 'L0',
    layer: 'L0',
    title: 'Sources',
    subtitle: 'Raw Tables & Local Extracts',
    icon: Database,
    headerBg: 'bg-slate-100 text-slate-800 border-slate-300',
  },
  {
    id: 'L1',
    layer: 'L1',
    title: 'Projections & Filters',
    subtitle: 'Staging, Cleaning & Ingestion',
    icon: Filter,
    headerBg: 'bg-amber-50 text-amber-900 border-amber-200',
  },
  {
    id: 'L2',
    layer: 'L2',
    title: 'Intermediate Views',
    subtitle: 'Existing CDS Views & Dimensions',
    icon: Box,
    headerBg: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  },
  {
    id: 'L3',
    layer: 'L3',
    title: 'Fact View',
    subtitle: 'Joins & Calculated Columns',
    icon: Layers,
    headerBg: 'bg-blue-50 text-blue-900 border-blue-200',
  },
  {
    id: 'L4',
    layer: 'L4',
    title: 'Analytic Model',
    subtitle: 'KPIs & Consumption Layer',
    icon: Sigma,
    headerBg: 'bg-purple-50 text-purple-900 border-purple-200',
  },
];

export const PlanLanesCanvas: React.FC<PlanLanesCanvasProps> = ({
  plan,
  selectedNode,
  onSelectNode,
}) => {
  // Classify each plan node into its appropriate lane
  const laneNodes = useMemo(() => {
    const buckets: Record<string, PlanNode[]> = {
      L0: [],
      L1: [],
      L2: [],
      L3: [],
      L4: [],
    };

    plan.nodes.forEach((node) => {
      let targetLane = 'L2';

      if (node.layer && buckets[node.layer]) {
        targetLane = node.layer;
      } else {
        const op = node.operation.toLowerCase();
        const id = node.id.toUpperCase();

        if (op === 'source' || id.includes('SRC') || id.includes('TABLE')) {
          targetLane = 'L0';
        } else if (op === 'projection' || op === 'filter') {
          // If it's an existing view in the metadata, place in L2
          targetLane = node.is_existing ? 'L2' : 'L1';
        } else if (op === 'association' || id.startsWith('E_') || id.startsWith('V_')) {
          targetLane = 'L2';
        } else if (op === 'join' || op === 'calculated_column' || id.startsWith('F_')) {
          targetLane = 'L3';
        } else if (op === 'analytic_model' || id.startsWith('AM_')) {
          targetLane = 'L4';
        }
      }

      buckets[targetLane].push(node);
    });

    return buckets;
  }, [plan]);

  let stepCounter = 1;

  return (
    <div className="w-full h-full overflow-x-auto p-6 bg-[#F5F7FA]">
      {/* 5-Lane Grid Container */}
      <div className="min-w-[1280px] grid grid-cols-5 gap-4">
        {LANES.map((lane, laneIdx) => {
          const LaneIcon = lane.icon;
          const nodesInLane = laneNodes[lane.id] || [];

          return (
            <div
              key={lane.id}
              className="flex flex-col bg-slate-50/70 border border-slate-200/80 rounded-2xl p-3 shadow-2xs min-h-[560px]"
            >
              {/* Lane Header */}
              <div className={`p-3 rounded-xl border mb-3 flex items-center justify-between ${lane.headerBg}`}>
                <div className="flex items-center space-x-2">
                  <div className="p-1.5 rounded-lg bg-white/80 shadow-2xs">
                    <LaneIcon className="w-4 h-4 text-slate-800" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                        {lane.layer}
                      </span>
                      <h3 className="text-xs font-bold text-slate-900 tracking-tight">{lane.title}</h3>
                    </div>
                    <p className="text-[10px] text-slate-500 truncate max-w-[170px]">{lane.subtitle}</p>
                  </div>
                </div>

                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-white/90 text-slate-700 shadow-2xs">
                  {nodesInLane.length}
                </span>
              </div>

              {/* Lane Body: Step Cards */}
              <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                {nodesInLane.length > 0 ? (
                  nodesInLane.map((node) => {
                    const currentStepNumber = stepCounter++;
                    return (
                      <StepCard
                        key={node.id}
                        node={node}
                        stepNumber={currentStepNumber}
                        isSelected={selectedNode?.id === node.id}
                        onSelect={onSelectNode}
                      />
                    );
                  })
                ) : (
                  <div className="h-44 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center p-4 text-center text-slate-400">
                    <LaneIcon className="w-6 h-6 mb-1 opacity-40" />
                    <span className="text-xs font-medium">No {lane.title.toLowerCase()} in this model</span>
                    <span className="text-[10px] opacity-75 mt-0.5">Direct downstream flow</span>
                  </div>
                )}
              </div>

              {/* Lane Footer Arrow Indicator */}
              {laneIdx < LANES.length - 1 && (
                <div className="pt-2 flex justify-center text-slate-300">
                  <ArrowRight className="w-4 h-4" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

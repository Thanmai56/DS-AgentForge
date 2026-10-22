import React, { useMemo } from 'react';
import {
  ArrowRight,
  Database,
  Layers,
  Sigma,
} from 'lucide-react';
import { Plan, PlanNode } from './types';
import { PlanGraphNodeData, buildPlanFlowGraph } from './planGraph';
import { StepCard } from './StepCard';

interface PlanLanesCanvasProps {
  plan: Plan;
  selectedNode: PlanNode | null;
  selectedSource: string | null;
  onSelectNode: (node: PlanNode) => void;
  onSelectSource: (sourceName: string) => void;
}

interface LaneConfig {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  headerBg: string;
}

const LANES: LaneConfig[] = [
  {
    id: 'L0',
    title: 'Sources',
    subtitle: 'Raw tables & local extracts',
    icon: Database,
    headerBg: 'bg-slate-100 text-slate-800 border-slate-300',
  },
  {
    id: 'L1',
    title: 'Wrapper Datasets',
    subtitle: 'Relational Dataset over each source',
    icon: Database,
    headerBg: 'bg-amber-50 text-amber-900 border-amber-200',
  },
  {
    id: 'L3',
    title: 'Graphical Views',
    subtitle: 'Joins, calculations & KPIs',
    icon: Layers,
    headerBg: 'bg-blue-50 text-blue-900 border-blue-200',
  },
  {
    id: 'L4',
    title: 'Analytic Model',
    subtitle: 'KPIs & consumption layer',
    icon: Sigma,
    headerBg: 'bg-purple-50 text-purple-900 border-purple-200',
  },
];

export const PlanLanesCanvas: React.FC<PlanLanesCanvasProps> = ({
  plan,
  selectedNode,
  selectedSource,
  onSelectNode,
  onSelectSource,
}) => {
  const graph = useMemo(() => buildPlanFlowGraph(plan), [plan]);
  const laneSteps = useMemo(() => {
    const grouped: Record<string, Array<Extract<PlanGraphNodeData, { kind: 'step' }>>> = {
      L1: [],
      L3: [],
      L4: [],
    };
    graph.nodes.forEach((item) => {
      if (item.data.kind === 'step' && grouped[item.data.layer]) {
        grouped[item.data.layer].push(item.data);
      }
    });
    return grouped;
  }, [graph]);
  const sourceNodes = graph.nodes.filter(
    (item): item is typeof item & { data: Extract<PlanGraphNodeData, { kind: 'source' }> } =>
      item.data.kind === 'source',
  );
  let stepCounter = 1;

  return (
    <div className="h-full w-full overflow-auto bg-[#F5F7FA] p-4">
      <div className="grid h-full min-h-[560px] min-w-[1024px] grid-cols-4 gap-3">
        {LANES.map((lane, laneIndex) => {
          const LaneIcon = lane.icon;
          const steps = laneSteps[lane.id] || [];
          const count = lane.id === 'L0' ? sourceNodes.length : steps.length;

          return (
            <section
              key={lane.id}
              className="flex min-h-0 flex-col rounded-2xl border border-slate-200/80 bg-slate-50/80 p-2.5 shadow-sm"
            >
              <header className={`mb-3 flex min-h-[66px] items-center justify-between gap-2 rounded-xl border px-3 py-2 ${lane.headerBg}`}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="rounded-lg bg-white/80 p-1.5 shadow-sm">
                    <LaneIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-extrabold uppercase tracking-widest opacity-70">{lane.id}</span>
                      <h2 className="truncate text-xs font-bold">{lane.title}</h2>
                    </div>
                    <p className="truncate text-[10px] opacity-75">{lane.subtitle}</p>
                  </div>
                </div>
                <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-slate-700 shadow-sm">
                  {count}
                </span>
              </header>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {lane.id === 'L0' ? (
                  sourceNodes.length ? sourceNodes.map(({ id, data }) => (
                    <button
                      type="button"
                      key={id}
                      onClick={() => onSelectSource(data.sourceName)}
                      className={`w-full rounded-xl border bg-white p-3 text-left shadow-sm transition-colors ${
                        selectedSource === data.sourceName
                          ? 'border-[#0070F2] ring-2 ring-blue-100'
                          : 'border-slate-200 hover:border-blue-300'
                      }`}
                    >
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Source input</div>
                      <div className="truncate font-mono text-xs font-bold text-slate-900">{data.sourceName}</div>
                      <div className="mt-1 text-[10px] text-slate-500">Referenced by the modeling plan</div>
                    </button>
                  )) : (
                    <EmptyLane icon={LaneIcon} title="No source inputs" />
                  )
                ) : steps.length ? steps.map((step) => {
                  const currentStepNumber = stepCounter++;
                  return (
                    <StepCard
                      key={step.planNode.id}
                      node={step.planNode}
                      stepNumber={step.stepNumber || currentStepNumber}
                      isSelected={selectedNode?.id === step.planNode.id}
                      onSelect={onSelectNode}
                    />
                  );
                }) : (
                  <EmptyLane icon={LaneIcon} title={`No ${lane.title.toLowerCase()} in this plan`} />
                )}
              </div>

              {laneIndex < LANES.length - 1 && (
                <div className="flex justify-center pt-2 text-slate-300">
                  <ArrowRight className="h-4 w-4" />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};

const EmptyLane: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}> = ({ icon: Icon, title }) => (
  <div className="flex h-44 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 p-4 text-center text-slate-400">
    <Icon className="mb-1 h-6 w-6 opacity-40" />
    <span className="text-xs font-medium">{title}</span>
    <span className="mt-0.5 text-[10px] opacity-75">No step assigned to this level</span>
  </div>
);

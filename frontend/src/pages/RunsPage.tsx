import React, { useEffect, useState } from 'react';
import { History, Play, CheckCircle2, XCircle, Clock, ArrowRight, ExternalLink } from 'lucide-react';
import { api } from '../api/client';
import { Run } from '../types';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';

export const RunsPage: React.FC = () => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const { setActiveRun } = useStore();
  const navigate = useNavigate();

  const loadRuns = async () => {
    try {
      setLoading(true);
      const data = await api.listRuns();
      setRuns(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRuns();
  }, []);

  const handleSelectRun = (run: Run) => {
    setActiveRun(run);
    navigate('/canvas');
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6 text-[#1D2D3E]">
      <div>
        <h1 className="text-2xl font-bold text-[#1D2D3E] tracking-tight">Agent Execution Runs</h1>
        <p className="text-sm text-[#556B82] mt-1">
          Review previous semantic modeling sessions, inspect intermediate validation results, and resume checkpoints.
        </p>
      </div>

      <div className="border border-[#D9DDE3] rounded-xl overflow-hidden bg-white shadow-sm">
        <div className="grid grid-cols-12 px-6 py-3 bg-[#FAFBFD] font-semibold text-xs text-[#556B82] border-b border-[#E5E9F0]">
          <div className="col-span-5">Requirement Intent</div>
          <div className="col-span-3">Status / Gate</div>
          <div className="col-span-2">Generated Views</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        <div className="divide-y divide-[#EDF1F7] text-xs">
          {runs.map((r) => {
            const runState = r.state ?? r.status ?? 'idle';
            const requirementText = r.requirement_text ?? r.requirement_prompt ?? 'No requirement provided';

            return (
              <div key={r.id} className="grid grid-cols-12 px-6 py-4 items-center hover:bg-[#F8FAFC] transition-colors">
                <div className="col-span-5 pr-4">
                  <div className="font-semibold text-[#1D2D3E] line-clamp-1">{requirementText}</div>
                  <div className="text-[11px] text-[#738496] font-mono mt-0.5">{r.id.slice(0, 16)}...</div>
                </div>

                <div className="col-span-3">
                  <span
                    className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                      runState === 'completed' || runState === 'EXPORT_COMPLETE'
                        ? 'bg-[#EAF7EE] text-[#107E3E] border-[#A7E6BC]'
                        : String(runState).includes('WAITING') || String(runState).includes('waiting')
                        ? 'bg-[#FFF5ED] text-[#E76500] border-[#FCD5B5] animate-pulse'
                        : runState === 'failed' || runState === 'REJECTED'
                        ? 'bg-[#FDF2F2] text-[#E53935] border-[#F87171]'
                        : 'bg-[#EBF3FF] text-[#0070F2] border-[#BBD7FD]'
                    }`}
                  >
                    <span className="capitalize">{String(runState).replace(/_/g, ' ')}</span>
                  </span>
                </div>

                <div className="col-span-2 text-[#324558] font-mono">
                  {r.views?.length || 0} views
                </div>

                <div className="col-span-2 flex items-center justify-end space-x-2">
                  <button
                    onClick={() => handleSelectRun(r)}
                    className="px-3 py-1.5 rounded-lg bg-[#EBF3FF] hover:bg-[#DCEBFF] text-[#0070F2] border border-[#BBD7FD] font-semibold flex items-center space-x-1 transition-colors cursor-pointer"
                  >
                    <span>Open</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}

          {runs.length === 0 && !loading && (
            <div className="p-8 text-center text-[#738496]">
              No runs recorded yet. Start a requirement in the AI Modeler tab.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

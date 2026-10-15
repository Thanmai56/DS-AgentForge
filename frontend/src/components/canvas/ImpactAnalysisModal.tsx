import React, { useEffect, useState } from 'react';
import { AlertOctagon, X, ArrowRight, ShieldCheck, Layers } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { api } from '../../api/client';
import { ImpactResult } from '../../types';

export const ImpactAnalysisModal: React.FC = () => {
  const { impactModal, closeImpactModal, activeRun } = useStore();
  const [loading, setLoading] = useState(false);
  const [impactData, setImpactData] = useState<ImpactResult | null>(null);

  useEffect(() => {
    if (impactModal.isOpen && impactModal.objectName && activeRun) {
      setLoading(true);
      api.getImpactAnalysis(activeRun.id, impactModal.objectName)
        .then((res) => setImpactData(res))
        .catch((err) => console.error(err))
        .finally(() => setLoading(false));
    }
  }, [impactModal.isOpen, impactModal.objectName, activeRun]);

  if (!impactModal.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl bg-white border border-[#D9DDE3] rounded-xl shadow-2xl flex flex-col overflow-hidden text-[#1D2D3E]">
        <div className="px-6 py-4 border-b border-[#E5E9F0] flex items-center justify-between bg-[#FAFBFD]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-[#FDF2F2] border border-[#F87171] text-[#E53935]">
              <AlertOctagon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[#1D2D3E] text-base">Impact Analysis</h3>
              <p className="text-xs text-[#556B82]">
                Reverse lineage dependency tracing
              </p>
            </div>
          </div>
          <button onClick={closeImpactModal} className="text-[#738496] hover:text-[#1D2D3E] p-1 rounded-md hover:bg-[#F5F7FA] cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="p-3 bg-[#FAFBFD] border border-[#E5E9F0] rounded-lg text-xs space-y-1">
            <span className="text-[#556B82]">Target Object:</span>
            <div className="font-mono text-sm text-[#0070F2] font-bold">{impactModal.objectName}</div>
          </div>

          {loading ? (
            <div className="py-8 text-center text-xs text-[#556B82]">Analyzing dependency graph...</div>
          ) : impactData && impactData.impacted_views.length > 0 ? (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-[#1D2D3E] uppercase tracking-wider">
                Downstream Objects Impacted ({impactData.impacted_views.length})
              </div>
              <div className="space-y-2">
                {impactData.impacted_views.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-[#FAFBFD] border border-[#E5E9F0] flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-semibold text-[#1D2D3E]">{item.object_name}</span>
                      <span className="text-[#738496] text-[11px]">({item.layer || 'L2'})</span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#FFF5ED] text-[#E76500] border border-[#FCD5B5]">
                      Direct Dependent
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-[#556B82] space-y-1">
              <ShieldCheck className="w-8 h-8 text-[#107E3E] mx-auto" />
              <p>No downstream dependencies affected by modifying this object.</p>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-[#E5E9F0] bg-[#FAFBFD] flex justify-end">
          <button
            onClick={closeImpactModal}
            className="px-4 py-1.5 rounded-lg bg-white border border-[#D9DDE3] hover:bg-[#F5F7FA] text-xs font-medium text-[#324558] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

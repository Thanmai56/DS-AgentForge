import React, { useState } from 'react';
import { Check, X, ShieldAlert, FileText, CheckCircle2, Layers, AlertCircle } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { api } from '../../api/client';
import { ConfidenceBadge } from './ConfidenceBadge';

export const GateApprovalModal: React.FC = () => {
  const { pendingGate, closeGateModal, updateRunState } = useStore();
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);

  if (!pendingGate.isOpen || !pendingGate.runId || !pendingGate.gateType) {
    return null;
  }

  const { runId, gateType, data } = pendingGate;
  const normalizedGate = gateType === 'source_confirm' ? 'sources'
    : gateType === 'plan_confirm' ? 'plan'
    : gateType === 'artifact_approve' ? 'artifacts'
    : gateType;

  const handleApprove = async () => {
    try {
      setIsSubmitting(true);
      const payload: any = { approved: true };
      if (normalizedGate === 'sources') {
        const candidateTables = selectedTables.length > 0
          ? selectedTables
          : Array.isArray(data?.candidate_tables)
            ? data.candidate_tables.map((table: any) => table.object_name ?? table.name ?? table)
            : [];
        if (candidateTables.length > 0) {
          payload.candidate_tables = candidateTables;
        }
      }
      const updatedRun = await api.approveGate(runId, normalizedGate, payload);
      updateRunState(updatedRun);
      closeGateModal();
    } catch (err: any) {
      alert(`Approval error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!feedback.trim()) {
      alert('Please provide feedback explaining the revision needed.');
      return;
    }
    try {
      setIsSubmitting(true);
      const updatedRun = await api.rejectGate(runId, normalizedGate, feedback);
      updateRunState(updatedRun);
      closeGateModal();
    } catch (err: any) {
      alert(`Rejection error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl bg-white border border-[#D9DDE3] rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-[#1D2D3E]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E5E9F0] flex items-center justify-between bg-[#FAFBFD]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-[#EBF3FF] border border-[#BBD7FD] text-[#0070F2]">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[#1D2D3E] text-base">
                Human Review Gate: {normalizedGate.toUpperCase()}
              </h3>
              <p className="text-xs text-[#556B82]">
                LangGraph paused execution pending human authorization
              </p>
            </div>
          </div>
          <button
            onClick={closeGateModal}
            className="text-[#738496] hover:text-[#1D2D3E] p-1 rounded-md hover:bg-[#F5F7FA] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {normalizedGate === 'sources' && (
            <div className="space-y-3">
              <p className="text-sm text-[#324558]">
                The agent identified the following candidate Datasphere tables for your requirement.
                Confirm or uncheck tables to include in view modeling:
              </p>
              <div className="border border-[#E5E9F0] rounded-lg divide-y divide-[#EDF1F7] bg-white">
                {data?.candidate_tables?.map((table: any, idx: number) => (
                  <div key={idx} className="p-3 flex items-center justify-between hover:bg-[#F8FAFC]">
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        defaultChecked
                        className="rounded border-[#D9DDE3] text-[#0070F2] focus:ring-[#0070F2]"
                        onChange={(e) => {
                          const name = table.object_name;
                          if (e.target.checked) {
                            setSelectedTables((prev) => [...prev, name]);
                          } else {
                            setSelectedTables((prev) => prev.filter((t) => t !== name));
                          }
                        }}
                      />
                      <div>
                        <div className="font-semibold text-sm text-[#1D2D3E] font-mono">{table.object_name}</div>
                        <div className="text-xs text-[#556B82]">{table.description || table.business_name || 'SAP Standard Table'}</div>
                      </div>
                    </div>
                    <ConfidenceBadge score={table.confidence || 0.9} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {normalizedGate === 'plan' && (
            <div className="space-y-3">
              <p className="text-sm text-[#324558]">
                The agent has constructed the semantic model blueprint. Review the proposed view chain:
              </p>
              <div className="bg-[#FAFBFD] border border-[#E5E9F0] rounded-lg p-4 font-mono text-xs text-[#1D2D3E] whitespace-pre-wrap max-h-60 overflow-y-auto">
                {typeof data?.model_plan === 'string'
                  ? data.model_plan
                  : JSON.stringify(data?.model_plan, null, 2)}
              </div>
            </div>
          )}

          {normalizedGate === 'artifacts' && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2 text-[#107E3E] text-sm font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                <span>Deterministic Validation (V-01..V-08) Finished</span>
              </div>
              {data?.validation_report?.warnings?.length > 0 && (
                <div className="p-3 bg-[#FFF5ED] border border-[#FCD5B5] rounded-lg text-xs text-[#E76500] space-y-1">
                  <div className="font-semibold flex items-center space-x-1">
                    <AlertCircle className="w-4 h-4" />
                    <span>Non-blocking Warnings:</span>
                  </div>
                  <ul className="list-disc pl-5">
                    {data.validation_report.warnings.map((w: any, idx: number) => (
                      <li key={idx}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-[#556B82]">
                Approving this stage finalizes the ViewSpec and compiles Datasphere native JSON for direct export.
              </p>
            </div>
          )}

          {/* Feedback input for rejection / iteration */}
          <div className="pt-2">
            <label className="block text-xs font-semibold text-[#556B82] mb-1">
              Feedback / Revision Instructions (Required if requesting rework):
            </label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="e.g. 'Exclude VBRP and use billing view instead' or 'Add association to customer entity'"
              className="w-full h-20 px-3 py-2 text-sm bg-[#FAFBFD] border border-[#D9DDE3] rounded-lg text-[#1D2D3E] placeholder-[#8996A5] focus:outline-none focus:border-[#0070F2]"
            />
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 bg-[#FAFBFD] border-t border-[#E5E9F0] flex items-center justify-between">
          <button
            disabled={isSubmitting}
            onClick={handleReject}
            className="flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold text-[#E53935] hover:bg-[#FDF2F2] border border-[#F87171] disabled:opacity-50 transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span>Request Changes (Rework)</span>
          </button>

          <button
            disabled={isSubmitting}
            onClick={handleApprove}
            className="flex items-center space-x-2 px-5 py-2 rounded-lg text-xs font-semibold text-white bg-[#0070F2] hover:bg-[#0058C6] shadow-sm disabled:opacity-50 transition-all cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>{isSubmitting ? 'Resuming Agent...' : 'Approve & Continue'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

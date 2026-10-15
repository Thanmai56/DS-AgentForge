import React, { useState } from 'react';
import {
  MessageSquare,
  Sparkles,
  Send,
  Code2,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Layers,
  X,
  Copy,
  Check,
} from 'lucide-react';
import { api } from '../../api/client';
import { useStore } from '../../store/useStore';
import { ViewSpec } from '../../types';

interface ChatModificationPanelProps {
  onClose?: () => void;
  onViewUpdated?: (updatedView: ViewSpec) => void;
}

export const ChatModificationPanel: React.FC<ChatModificationPanelProps> = ({
  onClose,
  onViewUpdated,
}) => {
  const { activeRun, selectedView, setSelectedView } = useStore();
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [codePreview, setCodePreview] = useState<string | null>(null);
  const [lastExplanation, setLastExplanation] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);

  const targetViewName = selectedView?.objectId || selectedView?.view_name || 'Active Run Context';

  const quickPrompts = [
    { label: 'Filter: Exclude Cancelled', text: 'Add a filter to exclude cancelled orders where ABGRU is null' },
    { label: 'Filter: Company Code 1000', text: 'Add a filter for company code BUKRS = "1000"' },
    { label: 'Convert to SQL View', text: 'Convert this view to an SQL view with grouped revenue and order count' },
    { label: 'Add Calculated Column', text: 'Add a calculated column for DISCOUNT_PCT = (DISCOUNT / NULLIF(NETWR,0)) * 100' },
    { label: 'Make Dimension Entity', text: 'Convert this to a dimension Business Entity with key attributes' },
  ];

  const handleSend = async (messageToSend?: string) => {
    const text = messageToSend || inputMessage;
    if (!text.trim() || !activeRun) return;

    try {
      setLoading(true);
      const res = await api.chatModifyView(
        activeRun.id,
        text,
        selectedView?.id || selectedView?.objectId || selectedView?.view_name
      );

      setLastExplanation(res.message);
      setCodePreview(res.code_preview || null);
      setValidationIssues(res.validation_warnings || []);

      if (res.updated_view) {
        setSelectedView(res.updated_view);
        if (onViewUpdated) {
          onViewUpdated(res.updated_view);
        }
      }
      setInputMessage('');
    } catch (err: any) {
      alert(`Modification failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (!codePreview) return;
    navigator.clipboard.writeText(codePreview);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-96 bg-white border-l border-[#D9DDE3] flex flex-col h-full text-xs shadow-xl z-20 text-[#1D2D3E]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#E5E9F0] flex items-center justify-between bg-[#FAFBFD]">
        <div className="flex items-center space-x-2">
          <div className="p-1 rounded bg-[#FFF5ED] border border-[#FCD5B5] text-[#E76500]">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-[#1D2D3E] text-xs">AI Data Modeler</h3>
            <p className="text-[10px] text-[#556B82] truncate max-w-[190px]">
              Editing: <span className="font-mono text-[#0070F2] font-semibold">{targetViewName}</span>
            </p>
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="text-[#738496] hover:text-[#1D2D3E] p-1 rounded hover:bg-[#F5F7FA] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Body scroll area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        <div className="p-3 rounded-lg bg-[#FAFBFD] border border-[#E5E9F0] text-[11px] text-[#556B82] leading-relaxed">
          State changes in plain English. The agent recompiles your view, applies filter rules, and updates the canvas live.
        </div>

        {/* Quick suggestions */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#738496]">
            Quick Modification Prompts:
          </span>
          <div className="flex flex-wrap gap-1">
            {quickPrompts.map((qp, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(qp.text)}
                className="px-2 py-1 text-[10px] rounded bg-white hover:bg-[#F5F7FA] text-[#0070F2] border border-[#D9DDE3] transition-colors cursor-pointer"
              >
                {qp.label}
              </button>
            ))}
          </div>
        </div>

        {/* Explanation response from agent */}
        {lastExplanation && (
          <div className="p-3 rounded-lg bg-[#EAF7EE] border border-[#A7E6BC] space-y-1.5">
            <div className="flex items-center space-x-1.5 text-[#107E3E] font-semibold text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Canvas Updated</span>
            </div>
            <p className="text-[11px] text-[#1D2D3E] leading-relaxed">{lastExplanation}</p>
          </div>
        )}

        {/* Code Preview */}
        {codePreview && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-[#1D2D3E] flex items-center space-x-1.5">
                <Code2 className="w-3.5 h-3.5 text-[#0070F2]" />
                <span>Datasphere Code Preview</span>
              </span>
              <button
                onClick={handleCopyCode}
                className="flex items-center space-x-1 text-[#556B82] hover:text-[#0070F2] transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-[#107E3E]" /> : <Copy className="w-3 h-3" />}
                <span className="text-[10px]">{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="p-2.5 rounded-lg bg-[#FAFBFD] border border-[#E5E9F0] font-mono text-[11px] text-[#0070F2] max-h-48 overflow-y-auto overflow-x-auto">
              <pre className="whitespace-pre-wrap">{codePreview}</pre>
            </div>
          </div>
        )}

        {/* Validation warnings */}
        {validationIssues.length > 0 && (
          <div className="p-3 rounded-lg bg-[#FFF5ED] border border-[#FCD5B5] space-y-1.5">
            <div className="flex items-center space-x-1.5 text-[#E76500] font-semibold">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Datasphere Validation Report</span>
            </div>
            {validationIssues.map((v, idx) => (
              <div key={idx} className="text-[10px] text-[#E76500] pl-5">
                • {v.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer input form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="p-3 border-t border-[#E5E9F0] bg-[#FAFBFD] space-y-2"
      >
        <div className="relative">
          <textarea
            rows={3}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type modification in plain English... (e.g. 'Add a filter for ORDER_DATE >= 2024-01-01', 'Convert to SQL view with sum of revenue')"
            className="w-full bg-white border border-[#D9DDE3] rounded-lg p-2.5 pr-8 text-[#1D2D3E] placeholder-[#8996A5] focus:outline-none focus:border-[#0070F2] text-xs resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button
            type="submit"
            disabled={loading || !inputMessage.trim()}
            className="absolute right-2.5 bottom-3.5 p-1.5 rounded-md bg-[#0070F2] hover:bg-[#0058C6] disabled:opacity-40 text-white transition-colors cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="text-[10px] text-[#738496] text-center">
          Press <kbd className="px-1 py-0.5 rounded bg-white border border-[#D9DDE3] text-[#556B82] font-mono">Enter</kbd> to apply change directly to canvas
        </div>
      </form>
    </div>
  );
};

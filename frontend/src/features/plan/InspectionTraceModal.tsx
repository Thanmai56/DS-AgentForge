// frontend/src/features/plan/InspectionTraceModal.tsx
// Comprehensive Inspection & Introspection Modal for DS-AgentForge
// Inspects: Uploaded File -> Python Parser -> Extracted Metadata -> Compact Context -> Exact LLM Input -> LLM Response -> Validated Plan

import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Terminal,
  FileCode,
  Layers,
  Database,
  Cpu,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Table,
  CheckCircle2,
  FileText
} from 'lucide-react';
import { InspectionTrace } from './types';
import { fetchInspectionTraceApi } from './planApi';

interface InspectionTraceModalProps {
  isOpen: boolean;
  onClose: () => void;
  planId: string;
}

export const InspectionTraceModal: React.FC<InspectionTraceModalProps> = ({
  isOpen,
  onClose,
  planId,
}) => {
  const [activeTab, setActiveTab] = useState<'pipeline' | 'json' | 'text'>('pipeline');
  const [trace, setTrace] = useState<InspectionTrace | null>(null);
  const [textLog, setTextLog] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Expanded sections state inside pipeline tab
  const [expandedSection, setExpandedSection] = useState<{
    metadata: boolean;
    compaction: boolean;
    samples: boolean;
    llm: boolean;
    prompts: boolean;
  }>({
    metadata: true,
    compaction: true,
    samples: true,
    llm: true,
    prompts: false,
  });

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchInspectionTraceApi(planId, 'json').catch((err) => {
        throw new Error(`JSON Trace: ${err.message}`);
      }),
      fetchInspectionTraceApi(planId, 'text').catch(() => ''),
    ])
      .then(([jsonData, textData]) => {
        if (!isMounted) return;
        setTrace(jsonData);
        setTextLog(textData);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || 'No inspection trace recorded for this plan ID yet.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, planId]);

  if (!isOpen) return null;

  const copyToClipboard = (content: string) => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden text-[#1D2D3E]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-bold tracking-tight">Requirement AI Pipeline Inspection</h2>
                {trace?.request_id && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                    req: {trace.request_id}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                End-to-end trace from source metadata to LLM prompt, response, and verified plan.
              </p>
            </div>
          </div>

          {/* Tab Selector & Close */}
          <div className="flex items-center space-x-3">
            <div className="bg-slate-800 p-0.5 rounded-lg flex items-center space-x-1 border border-slate-700 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('pipeline')}
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  activeTab === 'pipeline'
                    ? 'bg-[#0070F2] text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Pipeline Flow
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('json')}
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  activeTab === 'json'
                    ? 'bg-[#0070F2] text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Raw JSON
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('text')}
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  activeTab === 'text'
                    ? 'bg-[#0070F2] text-white shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Text Report
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {loading && (
            <div className="h-full flex flex-col items-center justify-center space-y-3 text-slate-500 py-16">
              <RefreshCw className="w-8 h-8 animate-spin text-[#0070F2]" />
              <p className="text-xs font-semibold">Retrieving inspection pipeline trace...</p>
            </div>
          )}

          {!loading && error && (
            <div className="p-6 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-amber-900">
              <div className="flex items-center space-x-2 font-bold text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Inspection Notice</span>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed">{error}</p>
              <p className="text-[11px] text-amber-700">
                Note: Inspection traces are stored in memory for plans generated in the current backend server session.
              </p>
            </div>
          )}

          {!loading && !error && trace && (
            <>
              {/* TAB 1: Structured Pipeline Flow */}
              {activeTab === 'pipeline' && (
                <div className="space-y-5">
                  {/* Stage 1: Metadata Extraction */}
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                    <div
                      onClick={() =>
                        setExpandedSection((p) => ({ ...p, metadata: !p.metadata }))
                      }
                      className="px-5 py-3 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between cursor-pointer select-none hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center space-x-2.5">
                        <span className="w-6 h-6 rounded-lg bg-blue-100 text-[#0070F2] flex items-center justify-center font-bold text-xs">
                          1
                        </span>
                        <div>
                          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                            Source File & Python Parser
                          </h3>
                          <span className="text-[11px] text-slate-500">
                            File: <code className="font-mono text-slate-700">{trace.stage_metadata.filename}</code> · Discovered {trace.stage_metadata.total_objects_discovered} Object(s)
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        {trace.stage_metadata.parsing_warnings.length > 0 && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            {trace.stage_metadata.parsing_warnings.length} Warning(s)
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          {trace.stage_metadata.parsing_status.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    {expandedSection.metadata && (
                      <div className="p-5 space-y-4">
                        {/* Discovered Entities Table */}
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                              <tr>
                                <th className="py-1.5 px-3">Entity Name</th>
                                <th className="py-1.5 px-3">Type</th>
                                <th className="py-1.5 px-3">Columns</th>
                                <th className="py-1.5 px-3">Keys</th>
                                <th className="py-1.5 px-3">Joins</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                              {trace.stage_metadata.discovered_objects.map((obj, i) => (
                                <tr key={i} className="hover:bg-slate-50/80">
                                  <td className="py-1.5 px-3 font-semibold text-slate-900">{obj.name}</td>
                                  <td className="py-1.5 px-3 text-slate-600">{obj.object_type}</td>
                                  <td className="py-1.5 px-3 text-slate-700">{obj.column_count}</td>
                                  <td className="py-1.5 px-3 text-amber-700">{obj.keys.join(', ') || '—'}</td>
                                  <td className="py-1.5 px-3 text-slate-600">{obj.joins_count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Warnings if any */}
                        {trace.stage_metadata.parsing_warnings.length > 0 && (
                          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800 space-y-1">
                            <div className="font-bold flex items-center space-x-1 text-amber-900">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                              <span>Parser Warnings</span>
                            </div>
                            <ul className="list-disc list-inside space-y-0.5">
                              {trace.stage_metadata.parsing_warnings.map((w, i) => (
                                <li key={i}>{w}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Stage 2: Compaction */}
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                    <div
                      onClick={() =>
                        setExpandedSection((p) => ({ ...p, compaction: !p.compaction }))
                      }
                      className="px-5 py-3 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between cursor-pointer select-none hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center space-x-2.5">
                        <span className="w-6 h-6 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs">
                          2
                        </span>
                        <div>
                          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                            Compact Context Reduction
                          </h3>
                          <span className="text-[11px] text-slate-500">
                            Sent to LLM: {trace.stage_compaction.compact_text_chars} chars · Retained {trace.stage_compaction.retained_objects.length} tables
                          </span>
                        </div>
                      </div>

                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                        COMPACTED
                      </span>
                    </div>

                    {expandedSection.compaction && (
                      <div className="p-5 space-y-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-slate-600 font-semibold">Retained in Context:</span>
                          {trace.stage_compaction.retained_objects.map((tbl, i) => (
                            <span key={i} className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[11px] text-slate-800 font-semibold">
                              {tbl}
                            </span>
                          ))}
                        </div>

                        {trace.stage_compaction.omitted_attributes.length > 0 && (
                          <div className="text-[11px] text-slate-500">
                            <span className="font-semibold text-slate-600">Omitted Raw Technical Attributes:</span> {trace.stage_compaction.omitted_attributes.join(', ')}
                          </div>
                        )}

                        <div className="p-3 bg-slate-900 text-slate-200 rounded-lg font-mono text-[11px] max-h-40 overflow-y-auto leading-relaxed border border-slate-800">
                          <pre>{trace.stage_compaction.compact_text_preview}</pre>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stage 3: Sample Row Mapping */}
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                    <div
                      onClick={() =>
                        setExpandedSection((p) => ({ ...p, samples: !p.samples }))
                      }
                      className="px-5 py-3 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between cursor-pointer select-none hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center space-x-2.5">
                        <span className="w-6 h-6 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center font-bold text-xs">
                          3
                        </span>
                        <div>
                          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                            Sample Data Mapping
                          </h3>
                          <span className="text-[11px] text-slate-500">
                            {trace.stage_sample_mapping.has_samples
                              ? `Mapped ${trace.stage_sample_mapping.mapped_tables.length} table(s), retained ${trace.stage_sample_mapping.total_rows_retained} rows`
                              : 'No sample rows provided (Planner operated on metadata alone)'}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          trace.stage_sample_mapping.has_samples
                            ? 'bg-teal-100 text-teal-800 border-teal-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {trace.stage_sample_mapping.has_samples ? 'SAMPLES ALIGNED' : 'METADATA ONLY'}
                      </span>
                    </div>

                    {expandedSection.samples && trace.stage_sample_mapping.has_samples && (
                      <div className="p-5 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                            <span className="text-[10px] text-slate-500 uppercase font-semibold block">Mapped Tables</span>
                            <span className="text-sm font-bold text-slate-800 font-mono">
                              {trace.stage_sample_mapping.mapped_tables.join(', ') || 'None'}
                            </span>
                          </div>
                          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                            <span className="text-[10px] text-slate-500 uppercase font-semibold block">Rows Parsed / Retained</span>
                            <span className="text-sm font-bold text-slate-800 font-mono">
                              {trace.stage_sample_mapping.total_rows_parsed} / {trace.stage_sample_mapping.total_rows_retained}
                            </span>
                          </div>
                          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                            <span className="text-[10px] text-slate-500 uppercase font-semibold block">Ambiguous Blocks</span>
                            <span className={`text-sm font-bold font-mono ${trace.stage_sample_mapping.ambiguous_blocks_count > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
                              {trace.stage_sample_mapping.ambiguous_blocks_count}
                            </span>
                          </div>
                          <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                            <span className="text-[10px] text-slate-500 uppercase font-semibold block">Malformed Rows</span>
                            <span className={`text-sm font-bold font-mono ${trace.stage_sample_mapping.malformed_rows_count > 0 ? 'text-red-600' : 'text-slate-800'}`}>
                              {trace.stage_sample_mapping.malformed_rows_count}
                            </span>
                          </div>
                        </div>

                        {/* Unknown columns flagged */}
                        {Object.keys(trace.stage_sample_mapping.unknown_columns).length > 0 && (
                          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-900 space-y-1">
                            <span className="font-bold flex items-center space-x-1">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                              <span>Unknown Columns Reported</span>
                            </span>
                            {Object.entries(trace.stage_sample_mapping.unknown_columns).map(([tbl, cols], i) => (
                              <div key={i} className="text-[11px]">
                                <span className="font-mono font-bold text-slate-800">{tbl}:</span>{' '}
                                <span className="font-mono text-amber-800">{cols.join(', ')}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Compact sample preview */}
                        {trace.stage_sample_mapping.compact_sample_preview && (
                          <div>
                            <span className="text-[10px] text-slate-500 uppercase font-semibold mb-1 block">
                              Compact Sample Section sent to Planner
                            </span>
                            <div className="p-3 bg-slate-900 text-slate-200 rounded-lg font-mono text-[11px] max-h-36 overflow-y-auto leading-relaxed border border-slate-800">
                              <pre>{trace.stage_sample_mapping.compact_sample_preview}</pre>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Stage 4: LLM Prompts & Response */}
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                    <div
                      onClick={() =>
                        setExpandedSection((p) => ({ ...p, llm: !p.llm }))
                      }
                      className="px-5 py-3 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between cursor-pointer select-none hover:bg-slate-100 transition-colors"
                    >
                      <div className="flex items-center space-x-2.5">
                        <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                          4
                        </span>
                        <div>
                          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                            LLM Execution & Plan Verification
                          </h3>
                          <span className="text-[11px] text-slate-500">
                            Model: <code className="font-mono text-slate-700 font-semibold">{trace.stage_llm.model}</code> ({trace.stage_llm.provider}) · Attempts: {trace.stage_llm.total_attempts}
                          </span>
                        </div>
                      </div>

                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        {trace.stage_llm.final_status.toUpperCase()}
                      </span>
                    </div>

                    {expandedSection.llm && (
                      <div className="p-5 space-y-4">
                        {/* Verification checklist */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>JSON Parse Valid</span>
                          </span>
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Pydantic Schema Valid</span>
                          </span>
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Deterministic Rules Checker Passed</span>
                          </span>
                        </div>

                        {/* Prompts Inspection Accordion */}
                        {trace.stage_llm.attempts.length > 0 && (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                                Exact LLM Prompt & Attempt Record
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedSection((p) => ({ ...p, prompts: !p.prompts }))
                                }
                                className="text-xs text-[#0070F2] hover:underline font-semibold cursor-pointer"
                              >
                                {expandedSection.prompts ? 'Hide Full Prompts' : 'View Exact Prompts & Raw Response'}
                              </button>
                            </div>

                            {expandedSection.prompts && (
                              <div className="space-y-3 text-xs">
                                <div>
                                  <span className="font-semibold text-slate-700 block mb-1">
                                    System Prompt:
                                  </span>
                                  <div className="p-3 bg-slate-900 text-slate-200 rounded-lg font-mono text-[11px] max-h-48 overflow-y-auto leading-relaxed border border-slate-800">
                                    <pre className="whitespace-pre-wrap">{trace.stage_llm.system_prompt}</pre>
                                  </div>
                                </div>

                                <div>
                                  <span className="font-semibold text-slate-700 block mb-1">
                                    User Prompt Sent (REQUIREMENT, SOURCE METADATA, SAMPLE DATA):
                                  </span>
                                  <div className="p-3 bg-slate-900 text-slate-200 rounded-lg font-mono text-[11px] max-h-60 overflow-y-auto leading-relaxed border border-slate-800">
                                    <pre className="whitespace-pre-wrap">
                                      {trace.stage_llm.attempts[0]?.user_prompt_sent || ''}
                                    </pre>
                                  </div>
                                </div>

                                <div>
                                  <span className="font-semibold text-slate-700 block mb-1">
                                    Raw LLM Model Output:
                                  </span>
                                  <div className="p-3 bg-slate-900 text-emerald-300 rounded-lg font-mono text-[11px] max-h-60 overflow-y-auto leading-relaxed border border-slate-800">
                                    <pre className="whitespace-pre-wrap">
                                      {trace.stage_llm.attempts[0]?.raw_response || ''}
                                    </pre>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: Raw JSON View */}
              {activeTab === 'json' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600 font-medium">
                      Full untruncated JSON inspection trace with secret redaction:
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(JSON.stringify(trace, null, 2))}
                      className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-600" />}
                      <span>{copied ? 'Copied!' : 'Copy JSON'}</span>
                    </button>
                  </div>
                  <div className="p-4 bg-slate-900 text-slate-200 rounded-xl font-mono text-[11px] max-h-[62vh] overflow-y-auto leading-relaxed border border-slate-800 shadow-inner">
                    <pre className="whitespace-pre-wrap">{JSON.stringify(trace, null, 2)}</pre>
                  </div>
                </div>
              )}

              {/* TAB 3: Text Report View */}
              {activeTab === 'text' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-600 font-medium">
                      Human-readable inspection summary:
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(textLog)}
                      className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-600" />}
                      <span>{copied ? 'Copied!' : 'Copy Text'}</span>
                    </button>
                  </div>
                  <div className="p-4 bg-slate-900 text-slate-200 rounded-xl font-mono text-[11px] max-h-[62vh] overflow-y-auto leading-relaxed border border-slate-800 shadow-inner">
                    <pre className="whitespace-pre-wrap">{textLog}</pre>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-white border-t border-slate-200 flex items-center justify-between shrink-0 text-xs text-slate-500">
          <div>
            Requirement AI Verification · Secret Redaction Active (<code className="font-mono text-[11px]">sk-*, AQ.*, Bearer</code> redacted)
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

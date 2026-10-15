import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Database,
  ArrowRight,
  Clock,
  Code2,
  FileText,
  Trash2,
  CheckCircle2,
  Layers,
  Zap,
  UploadCloud,
  FileCode,
  Eye,
  EyeOff,
  AlertCircle,
  X,
  ChevronDown,
  ChevronUp,
  Table
} from 'lucide-react';
import { api, createRunWebSocket } from '../api/client';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';
import { compressAndExtractSchema, CompressedEntity } from '../utils/schemaCompressor';

const SAMPLE_SD_METADATA = `[
  {
    "name": "VBAK",
    "business_name": "Sales Document Header",
    "columns": [
      { "name": "VBELN", "data_type": "NVARCHAR(10)", "is_key": true, "semantic_role": "key" },
      { "name": "ERDAT", "data_type": "DATE", "semantic_role": "date" },
      { "name": "KUNNR", "data_type": "NVARCHAR(10)", "semantic_role": "dimension" },
      { "name": "STATUS", "data_type": "NVARCHAR(20)", "semantic_role": "dimension" },
      { "name": "NETWR", "data_type": "DECIMAL(15,2)", "semantic_role": "measure", "aggregation": "SUM" }
    ]
  },
  {
    "name": "VBRP",
    "business_name": "Sales Document Item",
    "columns": [
      { "name": "VBELN", "data_type": "NVARCHAR(10)", "is_key": true, "semantic_role": "key" },
      { "name": "POSNR", "data_type": "NUMC(6)", "is_key": true, "semantic_role": "key" },
      { "name": "MATNR", "data_type": "NVARCHAR(18)", "semantic_role": "dimension" },
      { "name": "FKIMG", "data_type": "DECIMAL(13,3)", "semantic_role": "measure", "aggregation": "SUM" },
      { "name": "NETWR", "data_type": "DECIMAL(15,2)", "semantic_role": "measure", "aggregation": "SUM" }
    ]
  },
  {
    "name": "KNA1",
    "business_name": "Customer Master",
    "columns": [
      { "name": "KUNNR", "data_type": "NVARCHAR(10)", "is_key": true, "semantic_role": "key" },
      { "name": "NAME1", "data_type": "NVARCHAR(35)", "semantic_role": "dimension" },
      { "name": "LAND1", "data_type": "NVARCHAR(3)", "semantic_role": "dimension" },
      { "name": "REGIO", "data_type": "NVARCHAR(3)", "semantic_role": "dimension" },
      { "name": "ORT01", "data_type": "NVARCHAR(35)", "semantic_role": "dimension" }
    ]
  }
]`;

const SAMPLE_MM_METADATA = `[
  {
    "name": "ZIPOHDRAPT",
    "business_name": "Purchase Order Header Extract for APT - Master Data Attributes",
    "columns": [
      { "name": "PURCHASEORDER", "data_type": "NVARCHAR(10)", "is_key": true, "semantic_role": "key" },
      { "name": "CREATIONDATE", "data_type": "VARCHAR(8)", "semantic_role": "date" },
      { "name": "COMPANYCODE", "data_type": "NVARCHAR(4)", "semantic_role": "dimension" },
      { "name": "PURCHASINGORGANIZATION", "data_type": "NVARCHAR(4)", "semantic_role": "dimension" },
      { "name": "PURCHASINGGROUP", "data_type": "NVARCHAR(3)", "semantic_role": "dimension" },
      { "name": "SUPPLIER", "data_type": "NVARCHAR(10)", "semantic_role": "dimension" }
    ]
  },
  {
    "name": "ZIPOHISTEXT",
    "business_name": "PO History Extract for Datasphere - Transaction Data",
    "columns": [
      { "name": "PURCHASEORDER", "data_type": "NVARCHAR(10)", "is_key": true, "semantic_role": "key" },
      { "name": "PURCHASEORDERITEM", "data_type": "VARCHAR(5)", "is_key": true, "semantic_role": "key" },
      { "name": "DELIVERYDATE", "data_type": "VARCHAR(8)", "semantic_role": "date" },
      { "name": "GOODSRECEIPTQUANTITY", "data_type": "DECIMAL(13,3)", "semantic_role": "measure" }
    ]
  },
  {
    "name": "LFA1",
    "business_name": "Vendor Master",
    "columns": [
      { "name": "LIFNR", "data_type": "NVARCHAR(10)", "is_key": true, "semantic_role": "key" },
      { "name": "NAME1", "data_type": "NVARCHAR(35)", "semantic_role": "dimension" },
      { "name": "LAND1", "data_type": "NVARCHAR(3)", "semantic_role": "dimension" },
      { "name": "REGIO", "data_type": "NVARCHAR(3)", "semantic_role": "dimension" }
    ]
  }
]`;

export interface UploadedFileItem {
  id: string;
  name: string;
  size: number;
  content: string;
  parsed: any;
  extractedEntities: CompressedEntity[];
  error?: string;
}

export const ChatRequirementPage: React.FC = () => {
  const {
    activeConnection,
    activeRun,
    setActiveRun,
    updateRunState,
    openGateModal,
    setExtractedEntities,
    setBusinessRequirement,
  } = useStore();
  const [prompt, setPrompt] = useState(
    'Build a purchasing view chain joining PO headers, history, and vendor master data to compute PO Average Processing Time. Filter for completed transactions and aggregate average processing duration in days across vendor dimensions.'
  );

  // Two options: 'paste' (paste metadata) vs 'upload' (upload JSON/CSN files)
  const [sourceMode, setSourceMode] = useState<'paste' | 'upload'>('upload');
  const [metadataText, setMetadataText] = useState(SAMPLE_MM_METADATA);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedSourceIndex, setExpandedSourceIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Process uploaded files through schema compressor
  const handleProcessFiles = (filesList: FileList | File[]) => {
    const filesArray = Array.from(filesList);
    if (filesArray.length === 0) return;

    filesArray.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        try {
          const parsed = JSON.parse(text);
          const compressed = compressAndExtractSchema(parsed);
          const newItem: UploadedFileItem = {
            id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            size: file.size,
            content: text,
            parsed,
            extractedEntities: compressed,
          };
          setUploadedFiles((prev) => [...prev, newItem]);
        } catch (err: any) {
          const errItem: UploadedFileItem = {
            id: `${file.name}-${Date.now()}`,
            name: file.name,
            size: file.size,
            content: text,
            parsed: null,
            extractedEntities: [],
            error: err.message || 'Malformed JSON syntax',
          };
          setUploadedFiles((prev) => [...prev, errItem]);
        }
      };
      reader.readAsText(file);
    });
  };

  // Combine extracted sources from either mode
  const allExtractedSources = React.useMemo<CompressedEntity[]>(() => {
    if (sourceMode === 'upload') {
      const list: CompressedEntity[] = [];
      uploadedFiles.forEach((f) => {
        if (!f.error && f.extractedEntities) {
          list.push(...f.extractedEntities);
        }
      });
      return list;
    } else {
      // Paste mode
      return compressAndExtractSchema(metadataText);
    }
  }, [sourceMode, uploadedFiles, metadataText]);

  // Keep global store synchronized with extracted entities
  useEffect(() => {
    if (allExtractedSources.length > 0) {
      setExtractedEntities(allExtractedSources);
    }
  }, [allExtractedSources, setExtractedEntities]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFiles(e.dataTransfer.files);
    }
  };

  const removeFile = (id: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const clearAllFiles = () => {
    setUploadedFiles([]);
    setExpandedSourceIndex(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    try {
      setLoading(true);
      setBusinessRequirement(prompt.trim());

      let payloadMetadata: any = null;
      if (sourceMode === 'upload') {
        if (uploadedFiles.length === 0) {
          alert('Please upload at least one JSON source file or switch to "Paste Metadata" mode.');
          setLoading(false);
          return;
        }
        // Build merged CSN definitions from uploaded files
        const mergedDefs: Record<string, any> = {};
        uploadedFiles.forEach((f) => {
          if (!f.error && f.parsed) {
            if (f.parsed.definitions) {
              Object.assign(mergedDefs, f.parsed.definitions);
            } else if (Array.isArray(f.parsed)) {
              f.parsed.forEach((t: any) => {
                if (t.name) mergedDefs[t.name] = t;
              });
            }
          }
        });
        payloadMetadata = { definitions: mergedDefs };
      } else {
        // Paste mode
        let parsed = metadataText.trim();
        try {
          parsed = JSON.parse(metadataText);
        } catch {
          // Keep as string
        }
        payloadMetadata = parsed;
      }

      // Start run via API
      try {
        const newRun = await api.startRun(
          prompt,
          payloadMetadata,
          activeConnection?.id || null
        );
        setActiveRun(newRun);
      } catch (apiErr) {
        console.warn('API run call finished, proceeding to Lineage view:', apiErr);
      }

      // Navigate straight to the Data Lineage page!
      navigate('/lineage');
    } catch (err: any) {
      alert(`Could not start run: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6 text-[#1D2D3E]">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#1D2D3E] tracking-tight">
          Requirement Specification
        </h1>
        <p className="text-xs text-[#556B82] mt-1">
          Specify your business modeling requirement and source table metadata or JSON files to generate the semantic lineage.
        </p>
      </div>

      {/* Main Form */}
      <form onSubmit={handleSubmit} className="bg-white border border-[#D9DDE3] rounded-xl shadow-xs overflow-hidden divide-y divide-[#EDF1F7]">
        {/* Section 1: Business Requirement */}
        <div className="p-5 space-y-2">
          <label className="block text-xs font-semibold text-[#1D2D3E] uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center space-x-2">
              <FileText className="w-4 h-4 text-[#0070F2]" />
              <span>1. Business Modeling Requirement</span>
            </span>
          </label>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your business modeling requirement in natural language..."
            className="w-full bg-[#FAFBFD] border border-[#D9DDE3] rounded-lg p-3 text-[#1D2D3E] placeholder-[#738496] focus:outline-none focus:border-[#0070F2] focus:bg-white text-xs resize-none transition-colors"
          />
        </div>

        {/* Section 2: Source Table Metadata with 2 Options */}
        <div className="p-5 space-y-4 bg-[#FAFBFD]">
          {/* Header & Mode Switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="text-xs font-semibold text-[#1D2D3E] uppercase tracking-wider flex items-center space-x-2">
              <Database className="w-4 h-4 text-[#8E24AA]" />
              <span>2. Source Table Metadata & Schemas</span>
            </label>

            {/* Segmented Switcher */}
            <div className="flex items-center space-x-1 bg-[#EEF2F6] p-1 rounded-lg border border-[#D9DDE3]">
              <button
                type="button"
                onClick={() => setSourceMode('paste')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center space-x-1.5 cursor-pointer ${
                  sourceMode === 'paste'
                    ? 'bg-white text-[#0070F2] shadow-xs'
                    : 'text-[#556B82] hover:text-[#1D2D3E]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Paste Metadata</span>
              </button>

              <button
                type="button"
                onClick={() => setSourceMode('upload')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center space-x-1.5 cursor-pointer ${
                  sourceMode === 'upload'
                    ? 'bg-white text-[#0070F2] shadow-xs'
                    : 'text-[#556B82] hover:text-[#1D2D3E]'
                }`}
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Upload JSON Files</span>
                {uploadedFiles.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 bg-[#0070F2] text-white text-[10px] rounded-full font-bold">
                    {uploadedFiles.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Option 1: Paste Metadata */}
          {sourceMode === 'paste' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-[11px] text-[#556B82]">
                  Paste JSON tables, SQL DDL statements, or column definitions:
                </span>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setMetadataText(SAMPLE_MM_METADATA)}
                    className="px-2.5 py-1 text-[11px] rounded bg-white hover:bg-[#F5F7FA] text-[#0070F2] border border-[#D9DDE3] font-medium transition-colors cursor-pointer"
                  >
                    Load Sample PO Data
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetadataText(SAMPLE_SD_METADATA)}
                    className="px-2.5 py-1 text-[11px] rounded bg-white hover:bg-[#F5F7FA] text-[#8E24AA] border border-[#D9DDE3] font-medium transition-colors cursor-pointer"
                  >
                    Load Sample Sales Data
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetadataText('')}
                    className="p-1 rounded bg-white hover:bg-[#FDF2F2] text-[#738496] hover:text-[#E53935] border border-[#D9DDE3] cursor-pointer"
                    title="Clear"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <textarea
                rows={7}
                value={metadataText}
                onChange={(e) => setMetadataText(e.target.value)}
                placeholder="Paste your JSON tables or CSN definitions..."
                className="w-full bg-white border border-[#D9DDE3] rounded-lg p-3 font-mono text-xs text-[#1D2D3E] placeholder-[#8996A5] focus:outline-none focus:border-[#0070F2] resize-y"
              />
            </div>
          )}

          {/* Option 2: Upload Multiple JSON Files */}
          {sourceMode === 'upload' && (
            <div className="space-y-3">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-[#0070F2] bg-[#EBF3FF]'
                    : 'border-[#CBD5E1] bg-white hover:border-[#0070F2] hover:bg-[#F8FAFC]'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".json,.csn,application/json"
                  onChange={(e) => {
                    if (e.target.files) handleProcessFiles(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <div className="flex flex-col items-center justify-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-[#EBF3FF] text-[#0070F2] flex items-center justify-center border border-[#BBD7FD]">
                    <UploadCloud className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#1D2D3E]">
                      Click to browse or drag & drop multiple JSON files here
                    </p>
                    <p className="text-[11px] text-[#64748B] mt-0.5">
                      Accepts <code className="text-[#0070F2] bg-[#EBF3FF] px-1 py-0.5 rounded font-mono">.json</code> or{' '}
                      <code className="text-[#8E24AA] bg-[#F3E8FF] px-1 py-0.5 rounded font-mono">.csn</code> files (SAP Datasphere CSN 2.0 or table schemas)
                    </p>
                  </div>
                </div>
              </div>

              {/* Uploaded Files Pills */}
              {uploadedFiles.length > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 flex-wrap gap-1.5">
                    <span className="text-[11px] font-semibold text-[#64748B]">Files:</span>
                    {uploadedFiles.map((f) => (
                      <span
                        key={f.id}
                        className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded bg-white border border-[#CBD5E1] text-xs font-mono text-[#1D2D3E]"
                      >
                        <FileCode className="w-3.5 h-3.5 text-[#0070F2]" />
                        <span>{f.name}</span>
                        <span className="text-[10px] text-[#94A3B8]">({(f.size / 1024).toFixed(1)} KB)</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFile(f.id);
                          }}
                          className="hover:text-[#DC2626] ml-1 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={clearAllFiles}
                    className="text-[11px] text-[#DC2626] hover:underline cursor-pointer shrink-0"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>
          )}

          {/* LIST DOWN THE SOURCES (Schema Compressor Output) */}
          {allExtractedSources.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[#E2E8F0] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#1D2D3E]">
                    Extracted Sources & Views
                  </span>
                  <span className="px-2 py-0.5 bg-[#EBF3FF] text-[#0070F2] text-[11px] font-mono font-semibold rounded-full">
                    {allExtractedSources.length} detected
                  </span>
                </div>
                <span className="text-[11px] text-[#64748B]">
                  Essential modeling fields parsed & compressed
                </span>
              </div>

              {/* Source Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {allExtractedSources.map((src, idx) => {
                  const isExpanded = expandedSourceIndex === idx;
                  return (
                    <div
                      key={idx}
                      className="bg-white border border-[#E2E8F0] rounded-lg p-3 hover:border-[#0070F2] transition-colors shadow-2xs"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-0.5 min-w-0 pr-2">
                          <div className="flex items-center space-x-1.5">
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase ${
                                src.kind === 'analytic_model'
                                  ? 'bg-[#EAFBF3] text-[#107E3E]'
                                  : src.kind === 'fact'
                                  ? 'bg-[#F3E8FF] text-[#8E24AA]'
                                  : src.kind === 'view'
                                  ? 'bg-[#EBF3FF] text-[#0070F2]'
                                  : 'bg-[#F1F5F9] text-[#475569]'
                              }`}
                            >
                              {src.kind}
                            </span>
                            <span className="font-mono text-xs font-bold text-[#1D2D3E] truncate">
                              {src.name}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#64748B] line-clamp-1">{src.business_name}</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setExpandedSourceIndex(isExpanded ? null : idx)}
                          className="px-2 py-1 rounded bg-[#F8FAFC] hover:bg-[#EEF2F6] text-[11px] text-[#0070F2] font-medium flex items-center space-x-1 shrink-0 cursor-pointer"
                        >
                          <span>{src.fields.length} cols</span>
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      </div>

                      {/* Expandable Columns Table */}
                      {isExpanded && (
                        <div className="mt-2.5 pt-2 border-t border-[#F1F5F9] max-h-36 overflow-y-auto space-y-1">
                          {src.fields.map((f, fIdx) => (
                            <div key={fIdx} className="flex items-center justify-between text-[11px] font-mono py-0.5">
                              <span className="text-[#1D2D3E] flex items-center space-x-1">
                                {f.is_key && <span className="text-[#D97706] font-bold text-[9px]">[KEY]</span>}
                                <span>{f.name}</span>
                              </span>
                              <span className="text-[#64748B] text-[10px]">{f.data_type}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Action Button */}
        <div className="p-4 bg-white flex items-center justify-between">
          <div className="text-xs text-[#64748B]">
            Target: <span className="font-semibold text-[#1D2D3E]">DSP_CUST_CONTENT</span>
          </div>

          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="flex items-center space-x-2 px-6 py-2.5 rounded-lg bg-[#0070F2] hover:bg-[#0058C6] text-white font-semibold text-xs shadow-xs disabled:opacity-50 transition-all cursor-pointer"
          >
            {loading ? (
              <>
                <Clock className="w-4 h-4 animate-spin" />
                <span>Generating Lineage...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Synthesize Datasphere Model Canvas</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

// frontend/src/features/plan/PlanPage.tsx
// Main interactive modeling plan page with visual lanes, step card editing, and summary panel

import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Layers,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  FileText,
  Send,
  Terminal
} from 'lucide-react';
import { Plan, PlanNode } from './types';
import { PlanLanesCanvas } from './PlanLanesCanvas';
import { EditStepPanel } from './EditStepPanel';
import { SummaryPanel } from './SummaryPanel';
import { revisePlanApi } from './planApi';
import { InspectionTraceModal } from './InspectionTraceModal';
import { PlanComponentInspector } from './PlanComponentInspector';
import { CompressedEntity, CompressedField } from '../../utils/schemaCompressor';
import { LineageNodeData } from '../../components/lineage/DatasphereLineageView';
import { ViewInternalLineageModal } from '../../components/lineage/ViewInternalLineageModal';
import { useStore } from '../../store/useStore';

function toInspectorEntity(
  node: PlanNode | null,
  sourceName: string | null,
  entities: CompressedEntity[],
): LineageNodeData | null {
  if (sourceName) {
    const entity = entities.find((item) => item.name === sourceName);
    if (!entity) {
      return {
        technicalName: sourceName,
        businessName: sourceName,
        kind: 'table',
        fieldCount: 0,
        fields: [],
        onSelectNode: () => undefined,
      };
    }
    return {
      technicalName: entity.name,
      businessName: entity.business_name || entity.name,
      kind: entity.kind,
      fieldCount: entity.fields.length,
      fields: entity.fields,
      sources: entity.sources,
      joins: entity.joins,
      calculatedFields: entity.calculatedFields,
      onSelectNode: () => undefined,
    };
  }

  if (!node) return null;

  const sourceFields = new Map<string, CompressedField>();
  entities.forEach((entity) => entity.fields.forEach((field) => sourceFields.set(field.name, field)));
  const nodeFields = node.columns.map((column) => {
    const name = column.split('.').pop() || column;
    return sourceFields.get(name) || {
      name,
      data_type: 'NVARCHAR',
      is_key: false,
      label: name,
      semantic_role: 'dimension' as const,
    };
  });
  const joinPairs = node.details?.on || [];
  const joins = joinPairs.map((pair) => {
    const [leftField = '', rightField = ''] = pair;
    const leftSource = leftField.includes('.') ? leftField.split('.')[0] : node.inputs[0] || '';
    const rightSource = rightField.includes('.') ? rightField.split('.')[0] : node.inputs[1] || node.inputs[0] || '';
    return {
      leftSource,
      rightSource,
      leftField: leftField.split('.').pop() || leftField,
      rightField: rightField.split('.').pop() || rightField,
      joinType: node.details?.join_type || 'inner',
    };
  });
  const formula = node.details?.formula;
  const calculatedFields = formula
    ? [{
        name: node.columns.find((column) => !sourceFields.has(column)) || node.id,
        label: node.id,
        formula,
      }]
    : [];
  const kind = node.layer === 'L4' || node.operation === 'analytic_model'
    ? 'analytic_model'
    : node.layer === 'L3' || node.operation === 'join'
      ? 'fact'
      : 'view';

  return {
    technicalName: node.id,
    businessName: node.reason || node.id,
    kind,
    fieldCount: nodeFields.length,
    fields: nodeFields,
    sources: node.inputs,
    joins,
    calculatedFields,
    description: node.reason,
    onSelectNode: () => undefined,
  };
}

// Default initial plan for standalone preview if no run is active
const SAMPLE_PO_PLAN: Plan = {
  analysis: [
    'Requirement: Calculate Purchase Order Average Processing Time (APT) grouped by supplier.',
    'Reuses existing CDS intermediate view V_PO_FINAL_DELIVERY_APT which filters movement type 101 and computes max delivery date.',
    'Joins PO header table ZIPOHDRAPT with V_PO_FINAL_DELIVERY_APT on PURCHASEORDER.',
    'Calculates Processing_Days duration and Total_Delivered_Order base counter.',
    'Exposes Analytic Model AM_PO_APT with APT KPI formula: Processing_Days / Total_Delivered_Order.',
  ],
  nodes: [
    {
      id: 'ZIPOHDRAPT',
      operation: 'source',
      inputs: [],
      columns: ['PURCHASEORDER', 'CREATIONDATE', 'COMPANYCODE', 'PURCHASINGORGANIZATION', 'PURCHASINGGROUP', 'SUPPLIER'],
      details: {},
      reason: 'Raw purchase order header attributes extracted from ERP.',
      is_existing: true,
      layer: 'L0',
    },
    {
      id: 'ZIPOHISTEXT',
      operation: 'source',
      inputs: [],
      columns: ['PURCHASEORDER', 'PURCHASEORDERITEM', 'POSTINGDATE', 'GOODSMOVEMENTTYPE', 'GOODSRECEIPTQUANTITY'],
      details: {},
      reason: 'Raw purchase order history transactions.',
      is_existing: true,
      layer: 'L0',
    },
    {
      id: 'V_PO_FINAL_DELIVERY_APT',
      operation: 'projection',
      inputs: ['ZIPOHISTEXT'],
      columns: ['PURCHASEORDER', 'FINAL_DELIVERY_DATE'],
      details: {
        join_type: '',
        on: [],
        condition: "GOODSMOVEMENTTYPE = '101' AND POSTINGDATE IS NOT NULL",
        formula: 'MAX(POSTINGDATE)',
        aggregation: 'MAX',
      },
      reason: 'Existing CDS view deriving the maximum final delivery date per PO.',
      is_existing: true,
      layer: 'L2',
    },
    {
      id: 'F_PO_PROCESSING_TIME_APT',
      operation: 'join',
      inputs: ['ZIPOHDRAPT', 'V_PO_FINAL_DELIVERY_APT'],
      columns: [
        'PURCHASEORDER',
        'COMPANYCODE',
        'PURCHASINGORGANIZATION',
        'PURCHASINGGROUP',
        'SUPPLIER',
        'CREATIONDATE',
        'FINAL_DELIVERY_DATE',
      ],
      details: {
        join_type: 'inner',
        on: [['ZIPOHDRAPT.PURCHASEORDER', 'V_PO_FINAL_DELIVERY_APT.PURCHASEORDER']],
        condition: '',
        formula: '',
        aggregation: '',
      },
      reason: 'Join PO headers with final delivery dates (data profile confirms 100% key match).',
      is_existing: false,
      layer: 'L3',
    },
    {
      id: 'CALC_PROCESSING_DAYS',
      operation: 'calculated_column',
      inputs: ['F_PO_PROCESSING_TIME_APT'],
      columns: ['Processing_Days', 'Total_Delivered_Order'],
      details: {
        join_type: '',
        on: [],
        condition: '',
        formula: 'DAYS_BETWEEN(TO_DATE(CREATIONDATE), TO_DATE(FINAL_DELIVERY_DATE)) + 1',
        aggregation: '',
      },
      reason: 'Compute processing duration in days and base delivery counter.',
      is_existing: false,
      layer: 'L3',
    },
    {
      id: 'AM_PO_APT',
      operation: 'analytic_model',
      inputs: ['CALC_PROCESSING_DAYS'],
      columns: [
        'PURCHASEORDER',
        'SUPPLIER',
        'COMPANYCODE',
        'Processing_Days',
        'Total_Delivered_Order',
      ],
      details: {
        join_type: '',
        on: [],
        condition: '',
        formula: 'Processing_Days / Total_Delivered_Order',
        aggregation: 'FORMULA',
      },
      reason: 'Analytic model exposing APT KPI aggregated across supplier and organizational dimensions.',
      is_existing: false,
      layer: 'L4',
    },
  ],
  measures: [
    { name: 'Total_Delivered_Order', aggregation: 'SUM', column: 'Total_Delivered_Order' },
    { name: 'Processing_Days', aggregation: 'SUM', column: 'Processing_Days' },
    { name: 'APT', aggregation: 'FORMULA', column: 'Processing_Days' },
  ],
  dimensions: ['PURCHASEORDER', 'SUPPLIER', 'COMPANYCODE'],
  assumptions: [
    'Dates in CREATIONDATE and FINAL_DELIVERY_DATE are YYYYMMDD string format.',
    'All POs without goods receipt 101 are excluded by the existing view filter.',
  ],
  blockers: [],
};

export const PlanPage: React.FC = () => {
  const storeEntities = useStore((state) => state.extractedEntities) as CompressedEntity[];
  const [storedSourceEntities] = useState<CompressedEntity[]>(() => {
    try {
      const raw = sessionStorage.getItem('activeSourceEntities');
      return raw ? JSON.parse(raw) as CompressedEntity[] : [];
    } catch {
      return [];
    }
  });
  const extractedEntities = storeEntities.length ? storeEntities : storedSourceEntities;
  const [plan, setPlan] = useState<Plan>(() => {
    try {
      const saved = sessionStorage.getItem('activePlan');
      return saved ? JSON.parse(saved) : SAMPLE_PO_PLAN;
    } catch {
      return SAMPLE_PO_PLAN;
    }
  });

  const [planId] = useState<string>(() => {
    return sessionStorage.getItem('activePlanId') || 'preview-session-po-apt';
  });

  const [selectedNode, setSelectedNode] = useState<PlanNode | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [isEditStepOpen, setIsEditStepOpen] = useState(false);
  const [isLineageOpen, setIsLineageOpen] = useState(false);
  const [isSummaryCollapsed, setIsSummaryCollapsed] = useState(true);
  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const [quickInstruction, setQuickInstruction] = useState('');
  const [isRevising, setIsRevising] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const selectedLineageEntity = useMemo(
    () => toInspectorEntity(selectedNode, selectedSource, extractedEntities || []),
    [selectedNode, selectedSource, extractedEntities],
  );

  // Auto-dismiss notifications after 4 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Handle plan updates from direct edit or instruction
  const handlePlanUpdated = (updatedPlan: Plan, affectedNodes: string[]) => {
    setPlan(updatedPlan);
    if (selectedNode) {
      setSelectedNode(updatedPlan.nodes.find((node) => node.id === selectedNode.id) || null);
    }
    try {
      sessionStorage.setItem('activePlan', JSON.stringify(updatedPlan));
    } catch {}
    setNotification({
      message: `Plan revised! Updated ${affectedNodes.length} affected node(s): ${affectedNodes.join(', ')}`,
      type: 'success',
    });
  };

  // Quick instruction bar revision
  const handleQuickRevise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickInstruction.trim() || isRevising) return;

    setIsRevising(true);
    try {
      const res = await revisePlanApi(planId, { instruction: quickInstruction });
      handlePlanUpdated(res.plan, res.affected_nodes);
      setQuickInstruction('');
    } catch (err: any) {
      setNotification({
        message: err.message || 'AI revision failed. Please check your instructions.',
        type: 'error',
      });
    } finally {
      setIsRevising(false);
    }
  };

  const navigate = useNavigate();

  // Open the plan-driven end-to-end lineage before generating its JSON artifacts.
  const handleAcceptPlan = () => {
    sessionStorage.setItem('activePlan', JSON.stringify(plan));
    sessionStorage.setItem('activePlanId', planId);
    navigate('/lineage?view=overview');
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#F5F7FA] overflow-hidden text-[#1D2D3E]">
      {/* Top Action Bar */}
      <div className="px-6 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        {/* Title & Status */}
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-blue-50 border border-blue-200 text-[#0070F2]">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold text-slate-900 tracking-tight">Modeling Plan Visualizer</h1>
              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                <span>Deterministic Verified</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Five architectural levels: Sources (L0) → Staging (L1) → Views (L2) → Fact (L3) → Analytic Model (L4)
            </p>
          </div>
        </div>

        {/* Quick AI Revision Bar */}
        <form onSubmit={handleQuickRevise} className="flex-1 max-w-md mx-4">
          <div className="relative flex items-center">
            <input
              type="text"
              value={quickInstruction}
              onChange={(e) => setQuickInstruction(e.target.value)}
              placeholder="Ask AI to adjust plan (e.g., 'Change join to LEFT join')..."
              className="w-full pl-9 pr-20 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg placeholder-slate-400 focus:outline-none focus:border-[#0070F2] focus:bg-white transition-colors"
            />
            <Sparkles className="w-4 h-4 text-[#0070F2] absolute left-3 pointer-events-none" />
            <button
              type="submit"
              disabled={isRevising || !quickInstruction.trim()}
              className="absolute right-1 px-2.5 py-1 text-[11px] font-bold text-white bg-[#0070F2] hover:bg-[#0058C4] rounded-md transition-colors flex items-center space-x-1 disabled:opacity-40 cursor-pointer"
            >
              {isRevising ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              <span>Revise</span>
            </button>
          </div>
        </form>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setIsSummaryCollapsed(!isSummaryCollapsed)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer ${
              !isSummaryCollapsed
                ? 'bg-blue-50 text-[#0070F2] border-blue-300'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Assumptions</span>
            {plan.blockers && plan.blockers.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-red-500" />
            )}
          </button>

          {/* Inspect Pipeline Button */}
          <button
            type="button"
            onClick={() => setIsInspectOpen(true)}
            className="px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer bg-slate-900 text-white border-slate-800 hover:bg-slate-800 shadow-2xs"
          >
            <Terminal className="w-3.5 h-3.5 text-blue-400" />
            <span>Inspect Pipeline</span>
          </button>

          {/* Accept the plan and open its end-to-end lineage */}
          <button
            type="button"
            onClick={handleAcceptPlan}
            className="px-4 py-1.5 rounded-lg bg-[#0070F2] hover:bg-[#0058C4] text-white font-bold text-xs shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer active:scale-98"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Accept & Build Lineage</span>
          </button>
        </div>
      </div>

      {/* Floating Toast Notification */}
      {notification && (
        <div
          className={`fixed top-16 right-6 z-50 p-3 rounded-xl shadow-lg border text-xs font-semibold flex items-center space-x-2 animate-in fade-in slide-in-from-top-2 ${
            notification.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : notification.type === 'error'
              ? 'bg-red-50 text-red-900 border-red-200'
              : 'bg-blue-50 text-blue-900 border-blue-200'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          ) : notification.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-red-600" />
          ) : (
            <Layers className="w-4 h-4 text-blue-600" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Main Canvas Area */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
        <PlanLanesCanvas
          plan={plan}
          selectedNode={selectedNode}
          selectedSource={selectedSource}
          onSelectNode={(node) => {
            setSelectedNode(node);
            setSelectedSource(null);
            setIsEditStepOpen(false);
          }}
          onSelectSource={(sourceName) => {
            setSelectedSource(sourceName);
            setSelectedNode(null);
            setIsEditStepOpen(false);
          }}
        />

        {selectedLineageEntity && (
          <PlanComponentInspector
            entity={selectedLineageEntity}
            node={selectedNode || undefined}
            onClose={() => {
              setSelectedNode(null);
              setSelectedSource(null);
              setIsEditStepOpen(false);
            }}
            onEdit={() => setIsEditStepOpen(true)}
            onOpenLineage={() => setIsLineageOpen(true)}
          />
        )}

        {/* Step editing remains available from the component inspector. */}
        {selectedNode && isEditStepOpen && (
          <EditStepPanel
            planId={planId}
            node={selectedNode}
            onClose={() => setIsEditStepOpen(false)}
            onPlanUpdated={handlePlanUpdated}
          />
        )}
      </div>

      {/* Collapsible Bottom Summary Panel */}
      <SummaryPanel
        plan={plan}
        isCollapsed={isSummaryCollapsed}
        onToggleCollapse={() => setIsSummaryCollapsed(!isSummaryCollapsed)}
      />

      {/* Pipeline Inspection Modal */}
      <InspectionTraceModal
        isOpen={isInspectOpen}
        onClose={() => setIsInspectOpen(false)}
        planId={planId}
      />
      {isLineageOpen && selectedLineageEntity && (
        <ViewInternalLineageModal
          entity={selectedLineageEntity}
          onClose={() => setIsLineageOpen(false)}
        />
      )}
    </div>
  );
};

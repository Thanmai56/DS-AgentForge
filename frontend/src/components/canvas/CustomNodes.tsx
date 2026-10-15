import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import {
  Database,
  Eye,
  FileSpreadsheet,
  Box,
  BarChart3,
  Key,
  GitMerge,
  Filter,
  Columns,
  Link2,
  Network,
  Sigma,
  Code2,
  Layers,
  Sparkles,
  CheckCircle2,
  Table,
  Cpu,
  ChevronDown
} from 'lucide-react';
import { ConfidenceBadge } from '../common/ConfidenceBadge';

// ── Shared SAP Datasphere Horizon Handle Component ──────────────────────────
const HorizonHandle = ({
  type,
  position,
  color = '#0070F2',
  className = '',
}: {
  type: 'target' | 'source';
  position: Position;
  color?: string;
  className?: string;
}) => (
  <Handle
    type={type}
    position={position}
    className={`!w-3 !h-3 !border-2 !border-white !rounded-full shadow-md transition-transform hover:!scale-125 ${className}`}
    style={{ backgroundColor: color }}
  />
);

// ── 1. Table Source Node (SAP Datasphere Source Table Card) ──────────────────
export const TableSourceNode = memo(({ data, selected }: NodeProps) => {
  const cols = data.columns || [];
  const keyCols = cols.filter((c: any) => c.is_key || c.isKey);

  return (
    <div
      className={`w-72 bg-white rounded-lg border text-slate-800 transition-all duration-150 select-none ${
        selected
          ? 'border-[#0070F2] ring-2 ring-[#0070F2]/30 shadow-lg'
          : 'border-[#D9DDE3] hover:border-[#0070F2]/60 shadow-sm hover:shadow-md'
      }`}
    >
      {/* Horizon Header Bar */}
      <div className="px-3.5 py-2.5 bg-[#F5F7FA] border-b border-[#E5E9F0] rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#EBF3FF] border border-[#BBD7FD] flex items-center justify-center shrink-0">
            <Database className="w-4 h-4 text-[#0070F2]" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-xs text-[#1D2D3E] truncate">
              {data.label || data.object_name || data.objectName}
            </div>
            <div className="text-[10px] text-[#556B82] truncate">
              {data.business_name || 'SAP Source Table'}
            </div>
          </div>
        </div>
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#EBF3FF] text-[#0070F2] border border-[#BBD7FD] font-semibold shrink-0">
          TABLE
        </span>
      </div>

      {/* Schema Columns Preview */}
      <div className="p-3 space-y-2 bg-white rounded-b-lg text-xs">
        <div className="flex items-center justify-between text-[11px] text-[#556B82]">
          <span>Columns: <span className="font-mono text-[#1D2D3E] font-medium">{cols.length} cols</span></span>
          {data.row_count !== undefined && (
            <span className="font-mono text-[#556B82]">{data.row_count.toLocaleString()} rows</span>
          )}
        </div>

        {cols.length > 0 && (
          <div className="bg-[#FAFBFD] rounded border border-[#E5E9F0] p-1.5 space-y-1">
            {cols.slice(0, 3).map((c: any, i: number) => {
              const isKey = c.is_key || c.isKey;
              return (
                <div key={i} className="flex items-center justify-between text-[10px]">
                  <span className="flex items-center space-x-1 truncate">
                    {isKey && <Key className="w-2.5 h-2.5 text-[#E76500] shrink-0" />}
                    <span className={isKey ? 'text-[#1D2D3E] font-semibold' : 'text-[#324558]'}>
                      {c.name || c.column_name}
                    </span>
                  </span>
                  <span className="font-mono text-[#738496] text-[9px] shrink-0 ml-1">
                    {c.dataType || c.data_type || 'NVARCHAR'}
                  </span>
                </div>
              );
            })}
            {cols.length > 3 && (
              <div className="text-[9px] text-[#738496] text-center pt-0.5 border-t border-[#EDF1F7]">
                +{cols.length - 3} more columns
              </div>
            )}
          </div>
        )}
      </div>

      <HorizonHandle type="source" position={Position.Right} color="#0070F2" />
    </div>
  );
});

// ── 2. View Source Node (Input View in Datasphere) ───────────────────────────
export const ViewSourceNode = memo(({ data, selected }: NodeProps) => {
  return (
    <div
      className={`w-68 bg-white rounded-lg border text-slate-800 transition-all duration-150 select-none ${
        selected
          ? 'border-[#0070F2] ring-2 ring-[#0070F2]/30 shadow-lg'
          : 'border-[#D9DDE3] hover:border-[#0070F2]/60 shadow-sm hover:shadow-md'
      }`}
    >
      <div className="px-3.5 py-2.5 bg-[#F5F7FA] border-b border-[#E5E9F0] rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#EBF3FF] border border-[#BBD7FD] flex items-center justify-center shrink-0">
            <Eye className="w-4 h-4 text-[#0070F2]" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-xs text-[#1D2D3E] truncate">
              {data.label || data.objectName}
            </div>
            <div className="text-[10px] text-[#556B82] truncate">Source View</div>
          </div>
        </div>
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#EBF3FF] text-[#0070F2] border border-[#BBD7FD] font-semibold shrink-0">
          INPUT VIEW
        </span>
      </div>

      <div className="p-3 bg-white rounded-b-lg">
        <div className="text-[11px] text-[#556B82]">
          View Ref: <span className="font-mono text-[#0070F2] font-semibold">{data.objectName}</span>
        </div>
      </div>

      <HorizonHandle type="source" position={Position.Right} color="#0070F2" />
    </div>
  );
});

// ── 3. Circular Operator Helper Component (Exact Datasphere Visual) ─────────
interface CircularOperatorProps {
  id?: string;
  label: string;
  subLabel?: string;
  badge?: string;
  bgColor: string;
  iconColor: string;
  borderColor: string;
  ringColor?: string;
  icon: React.ReactNode;
  selected?: boolean;
  hasInput?: boolean;
  hasOutput?: boolean;
}

const CircularDatasphereOperator: React.FC<CircularOperatorProps> = ({
  label,
  subLabel,
  badge,
  bgColor,
  iconColor,
  borderColor,
  icon,
  selected,
  hasInput = true,
  hasOutput = true,
}) => {
  return (
    <div className="flex flex-col items-center justify-center select-none group cursor-pointer">
      {hasInput && (
        <HorizonHandle type="target" position={Position.Left} color={iconColor} className="-ml-1" />
      )}

      {/* Circle Icon Badge */}
      <div className="relative">
        <div
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-150 ${
            selected
              ? 'ring-4 ring-[#0070F2]/40 shadow-xl scale-105 border-2 border-[#0070F2]'
              : 'border-2 shadow-md hover:shadow-lg hover:scale-105'
          }`}
          style={{
            backgroundColor: bgColor,
            borderColor: selected ? '#0070F2' : borderColor,
          }}
        >
          {icon}
        </div>

        {/* Small Operator Badge (e.g. 'LEFT', 'f(x)', '1:N') */}
        {badge && (
          <span
            className="absolute -top-1.5 -right-2 px-1.5 py-0.2 rounded-full text-[8.5px] font-mono font-bold tracking-tight shadow-sm border border-white text-white"
            style={{ backgroundColor: iconColor }}
          >
            {badge}
          </span>
        )}
      </div>

      {/* Label and Subtext underneath (Exact SAP Datasphere style) */}
      <div className="mt-2 text-center max-w-[130px]">
        <div className="font-semibold text-xs text-[#1D2D3E] truncate leading-tight group-hover:text-[#0070F2] transition-colors">
          {label}
        </div>
        {subLabel && (
          <div className="text-[10px] text-[#556B82] truncate mt-0.5 font-medium">
            {subLabel}
          </div>
        )}
      </div>

      {hasOutput && (
        <HorizonHandle type="source" position={Position.Right} color={iconColor} className="-mr-1" />
      )}
    </div>
  );
};

// ── 4. Join Operator Node (Datasphere Circular Join Operator) ────────────────
export const JoinOperatorNode = memo(({ data, selected }: NodeProps) => {
  const joinType = (data.joinType || data.join_type || data.type || 'LEFT').toUpperCase();

  return (
    <CircularDatasphereOperator
      label={data.label || data.name || 'Join 1'}
      subLabel={`${joinType} Join`}
      badge={joinType}
      bgColor="#FFF5ED"
      borderColor="#F5A623"
      iconColor="#E76500"
      selected={selected}
      icon={<GitMerge className="w-6 h-6 text-[#E76500]" />}
    />
  );
});

// ── 5. Projection Operator Node (Datasphere Circular Projection Operator) ────
export const ProjectionOperatorNode = memo(({ data, selected }: NodeProps) => {
  const cols = data.columns || [];
  const calcCols = cols.filter((c: any) => c.isCalculated || c.is_calculated || c.expression);
  const badge = calcCols.length > 0 ? `f(x) ${calcCols.length}` : `${cols.length}c`;

  return (
    <CircularDatasphereOperator
      label={data.label || data.name || 'Projection 1'}
      subLabel="Column Selection"
      badge={badge}
      bgColor="#EBF8FB"
      borderColor="#46B3C8"
      iconColor="#00A3C4"
      selected={selected}
      icon={<Columns className="w-6 h-6 text-[#00A3C4]" />}
    />
  );
});

// ── 6. Filter Operator Node (Datasphere Circular Filter Operator) ────────────
export const FilterOperatorNode = memo(({ data, selected }: NodeProps) => {
  return (
    <CircularDatasphereOperator
      label={data.label || data.name || 'Filter 1'}
      subLabel="Filter Rows"
      badge="SQL"
      bgColor="#FDF2F2"
      borderColor="#F87171"
      iconColor="#E53935"
      selected={selected}
      icon={<Filter className="w-6 h-6 text-[#E53935]" />}
    />
  );
});

// ── 7. Aggregation Operator Node (Datasphere Circular Aggregation Operator) ──
export const AggregationOperatorNode = memo(({ data, selected }: NodeProps) => {
  const measures = data.measures || [];

  return (
    <CircularDatasphereOperator
      label={data.label || data.name || 'Aggregation 1'}
      subLabel="Rollup & Measures"
      badge={measures.length > 0 ? `${measures.length} KPI` : 'Σ'}
      bgColor="#EDF4FD"
      borderColor="#60A5FA"
      iconColor="#1E88E5"
      selected={selected}
      icon={<Sigma className="w-6 h-6 text-[#1E88E5]" />}
    />
  );
});

// ── 8. Hierarchy Operator Node (Datasphere Hierarchy Operator) ───────────────
export const HierarchyOperatorNode = memo(({ data, selected }: NodeProps) => {
  const hType = (data.hierarchyType || data.hierarchy_type || data.type || 'LEVEL').toUpperCase();

  return (
    <CircularDatasphereOperator
      label={data.label || data.name || 'Hierarchy 1'}
      subLabel={hType.includes('PARENT') ? 'Parent-Child' : 'Level Path'}
      badge="TREE"
      bgColor="#ECFDF5"
      borderColor="#34D399"
      iconColor="#10B981"
      selected={selected}
      icon={<Network className="w-6 h-6 text-[#10B981]" />}
    />
  );
});

// ── 9. Association Operator Node (Datasphere Association Operator) ───────────
export const AssociationOperatorNode = memo(({ data, selected }: NodeProps) => {
  const cardinality = data.cardinality || 'n..1';

  return (
    <CircularDatasphereOperator
      label={data.label || data.name || 'Association 1'}
      subLabel="Semantic Link"
      badge={cardinality}
      bgColor="#F5EEFB"
      borderColor="#C084FC"
      iconColor="#8E24AA"
      selected={selected}
      icon={<Link2 className="w-6 h-6 text-[#8E24AA]" />}
    />
  );
});

// ── 10. View Output Terminal Box (SAP Datasphere Final View 1 Node) ──────────
export const OutputNode = memo(({ data, selected }: NodeProps) => {
  return (
    <div
      className={`w-72 bg-white rounded-lg border-2 text-slate-800 transition-all duration-150 select-none shadow-md ${
        selected
          ? 'border-[#0070F2] ring-3 ring-[#0070F2]/30 shadow-xl'
          : 'border-[#0284C7] hover:border-[#0070F2] hover:shadow-lg'
      }`}
    >
      <HorizonHandle type="target" position={Position.Left} color="#0284C7" />

      {/* Header */}
      <div className="px-3.5 py-2.5 bg-[#F0F8FF] border-b border-[#BAE0FD] rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#0284C7] flex items-center justify-center shrink-0 shadow-sm">
            <Eye className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-xs text-[#0F2942] truncate">
              {data.label || data.objectId || 'View 1'}
            </div>
            <div className="text-[10px] text-[#3A6B97]">Output View</div>
          </div>
        </div>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#E0F2FE] text-[#0284C7] border border-[#BAE6FD] font-mono shrink-0">
          OUTPUT
        </span>
      </div>

      {/* Content */}
      <div className="p-3 bg-white rounded-b-lg space-y-2 text-xs">
        <div className="flex items-center justify-between text-[11px] text-[#556B82]">
          <span>Artifact:</span>
          <span className="font-mono text-[#0070F2] font-semibold truncate max-w-[150px]">
            {data.objectId || data.label}
          </span>
        </div>
        <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-[#EDF1F7]">
          <span className="text-[#107E3E] font-semibold flex items-center space-x-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#107E3E]" />
            <span>Exposed for Consumption</span>
          </span>
          <span className="font-mono text-[#738496] font-semibold">CSN 2.0</span>
        </div>
      </div>
    </div>
  );
});

// ── 11. Measure Source Node (Analytic Model Fact Source Input) ───────────────
export const MeasureSourceNode = memo(({ data, selected }: NodeProps) => {
  const measures = data.measures || [];

  return (
    <div
      className={`w-72 bg-white rounded-lg border text-slate-800 transition-all duration-150 select-none ${
        selected
          ? 'border-[#107E3E] ring-2 ring-[#107E3E]/30 shadow-lg'
          : 'border-[#D9DDE3] hover:border-[#107E3E]/60 shadow-sm hover:shadow-md'
      }`}
    >
      <div className="px-3.5 py-2.5 bg-[#F2FBF5] border-b border-[#C6F0D4] rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#E3F8EB] border border-[#9DE7B7] flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-4 h-4 text-[#107E3E]" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-xs text-[#1D2D3E] truncate">
              {data.label || data.objectName}
            </div>
            <div className="text-[10px] text-[#556B82]">Fact Source</div>
          </div>
        </div>
        <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-[#E3F8EB] text-[#107E3E] border border-[#9DE7B7] font-bold shrink-0">
          FACT
        </span>
      </div>

      <div className="p-3 bg-white rounded-b-lg space-y-1.5 text-xs">
        <div className="text-[11px] text-[#556B82]">
          Supplying: <span className="font-mono text-[#107E3E] font-semibold">{measures.length} KPI measures</span>
        </div>
        {measures.length > 0 && (
          <div className="bg-[#FAFBFD] rounded border border-[#E5E9F0] p-1.5 text-[10px] font-mono text-[#107E3E] truncate">
            {measures.join(', ')}
          </div>
        )}
      </div>

      <HorizonHandle type="source" position={Position.Right} color="#107E3E" />
    </div>
  );
});

// ── 12. Dimension Source Node (Analytic Model Dimension Input) ───────────────
export const DimensionSourceNode = memo(({ data, selected }: NodeProps) => {
  const fkMappings = data.foreignKeyMappings || data.foreign_key_mappings || [];

  return (
    <div
      className={`w-72 bg-white rounded-lg border text-slate-800 transition-all duration-150 select-none ${
        selected
          ? 'border-[#8E24AA] ring-2 ring-[#8E24AA]/30 shadow-lg'
          : 'border-[#D9DDE3] hover:border-[#8E24AA]/60 shadow-sm hover:shadow-md'
      }`}
    >
      <div className="px-3.5 py-2.5 bg-[#FAF4FD] border-b border-[#ECD6FB] rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#F4E6FC] border border-[#DDB6F8] flex items-center justify-center shrink-0">
            <Box className="w-4 h-4 text-[#8E24AA]" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-xs text-[#1D2D3E] truncate">
              {data.label || data.objectName}
            </div>
            <div className="text-[10px] text-[#556B82]">Associated Dimension</div>
          </div>
        </div>
        <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-[#F4E6FC] text-[#8E24AA] border border-[#DDB6F8] font-bold shrink-0">
          {data.cardinality || 'n..1'} ASSOC
        </span>
      </div>

      <div className="p-3 bg-white rounded-b-lg space-y-1.5 text-xs">
        <div className="text-[11px] text-[#556B82]">
          Dimension: <span className="font-mono text-[#8E24AA] font-semibold">{data.objectName}</span>
        </div>
        {fkMappings.length > 0 && (
          <div className="bg-[#FAFBFD] rounded border border-[#E5E9F0] p-1.5 text-[10px] font-mono text-[#8E24AA] truncate">
            {fkMappings[0].local_column || fkMappings[0].left} → {fkMappings[0].foreign_column || fkMappings[0].right}
          </div>
        )}
      </div>

      <HorizonHandle type="source" position={Position.Right} color="#8E24AA" />
    </div>
  );
});

// ── 13. Analytic Model Node (SAC Ready Endpoint) ─────────────────────────────
export const AnalyticModelNode = memo(({ data, selected }: NodeProps) => {
  return (
    <div
      className={`w-80 bg-white rounded-lg border-2 text-slate-800 transition-all duration-150 select-none shadow-md ${
        selected
          ? 'border-[#107E3E] ring-3 ring-[#107E3E]/30 shadow-xl'
          : 'border-[#107E3E] hover:shadow-lg'
      }`}
    >
      <HorizonHandle type="target" position={Position.Left} color="#107E3E" />

      <div className="px-3.5 py-2.5 bg-[#EAF7EE] border-b border-[#B9E9C6] rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#107E3E] flex items-center justify-center shrink-0 shadow-sm">
            <BarChart3 className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-xs text-[#0C4E26] truncate">
              {data.label || data.view_name}
            </div>
            <div className="text-[10px] text-[#227442]">Analytic Model (SAC)</div>
          </div>
        </div>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#D1F2DC] text-[#107E3E] border border-[#A7E6BC] font-mono shrink-0">
          ANALYTIC MODEL
        </span>
      </div>

      <div className="p-3 bg-white rounded-b-lg space-y-2 text-xs">
        <div className="text-xs text-[#1D2D3E] font-medium">{data.business_name}</div>
        <div className="pt-2 border-t border-[#EDF1F7] flex items-center justify-between text-[11px] text-[#556B82]">
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-[#0070F2] inline-block" />
            <span>Dims: {data.dimensionCount || 8}</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-[#107E3E] inline-block" />
            <span className="font-semibold text-[#107E3E]">Measures: {data.measureCount || 2}</span>
          </span>
        </div>
      </div>
    </div>
  );
});

// ── 14. Dimension Node ───────────────────────────────────────────────────────
export const DimensionNode = memo(({ data, selected }: NodeProps) => {
  return (
    <div
      className={`w-72 bg-white rounded-lg border text-slate-800 transition-all duration-150 select-none ${
        selected
          ? 'border-[#8E24AA] ring-2 ring-[#8E24AA]/30 shadow-lg'
          : 'border-[#D9DDE3] hover:border-[#8E24AA]/60 shadow-sm hover:shadow-md'
      }`}
    >
      <HorizonHandle type="target" position={Position.Left} color="#8E24AA" />

      <div className="px-3.5 py-2.5 bg-[#FAF4FD] border-b border-[#ECD6FB] rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#F4E6FC] border border-[#DDB6F8] flex items-center justify-center shrink-0">
            <Box className="w-4 h-4 text-[#8E24AA]" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-xs text-[#1D2D3E] truncate">
              {data.label || data.view_name}
            </div>
            <div className="text-[10px] text-[#556B82]">Business Entity</div>
          </div>
        </div>
        <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-[#F4E6FC] text-[#8E24AA] border border-[#DDB6F8] font-bold shrink-0">
          DIMENSION
        </span>
      </div>

      <div className="p-3 bg-white rounded-b-lg">
        <div className="text-[11px] text-[#324558] font-medium truncate">
          {data.business_name || 'Customer Dimension'}
        </div>
      </div>

      <HorizonHandle type="source" position={Position.Right} color="#8E24AA" />
    </div>
  );
});

// ── 15. Fact Node ────────────────────────────────────────────────────────────
export const FactNode = memo(({ data, selected }: NodeProps) => {
  return (
    <div
      className={`w-72 bg-white rounded-lg border text-slate-800 transition-all duration-150 select-none ${
        selected
          ? 'border-[#E76500] ring-2 ring-[#E76500]/30 shadow-lg'
          : 'border-[#D9DDE3] hover:border-[#E76500]/60 shadow-sm hover:shadow-md'
      }`}
    >
      <HorizonHandle type="target" position={Position.Left} color="#E76500" />

      <div className="px-3.5 py-2.5 bg-[#FFF7F0] border-b border-[#FED7AA] rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#FFEDD5] border border-[#FDBA74] flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-4 h-4 text-[#E76500]" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-xs text-[#1D2D3E] truncate">
              {data.label || data.view_name}
            </div>
            <div className="text-[10px] text-[#556B82]">Fact View</div>
          </div>
        </div>
        <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-[#FFEDD5] text-[#E76500] border border-[#FDBA74] font-bold shrink-0">
          FACT
        </span>
      </div>

      <div className="p-3 bg-white rounded-b-lg">
        <div className="text-[11px] text-[#324558] font-medium truncate">
          {data.business_name || 'Fact Dataset'}
        </div>
      </div>

      <HorizonHandle type="source" position={Position.Right} color="#E76500" />
    </div>
  );
});

// ── 16. Graphical View Node ──────────────────────────────────────────────────
export const GraphicalViewNode = memo(({ data, selected }: NodeProps) => {
  return (
    <div
      className={`w-72 bg-white rounded-lg border text-slate-800 transition-all duration-150 select-none ${
        selected
          ? 'border-[#0070F2] ring-2 ring-[#0070F2]/30 shadow-lg'
          : 'border-[#D9DDE3] hover:border-[#0070F2]/60 shadow-sm hover:shadow-md'
      }`}
    >
      <HorizonHandle type="target" position={Position.Left} color="#0070F2" />

      <div className="px-3.5 py-2.5 bg-[#F5F7FA] border-b border-[#E5E9F0] rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#EBF3FF] border border-[#BBD7FD] flex items-center justify-center shrink-0">
            <Eye className="w-4 h-4 text-[#0070F2]" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-xs text-[#1D2D3E] truncate">
              {data.label || data.view_name}
            </div>
            <div className="text-[10px] text-[#556B82]">Graphical View</div>
          </div>
        </div>
        <ConfidenceBadge score={data.confidence_score || 0.95} />
      </div>

      <div className="p-3 bg-white rounded-b-lg">
        <div className="text-[11px] text-[#324558] font-medium truncate">
          {data.business_name}
        </div>
      </div>

      <HorizonHandle type="source" position={Position.Right} color="#0070F2" />
    </div>
  );
});

// ── 17. SQL View Node ────────────────────────────────────────────────────────
export const SQLViewNode = memo(({ data, selected }: NodeProps) => {
  return (
    <div
      className={`w-72 bg-white rounded-lg border text-slate-800 transition-all duration-150 select-none ${
        selected
          ? 'border-[#5C6BC0] ring-2 ring-[#5C6BC0]/30 shadow-lg'
          : 'border-[#D9DDE3] hover:border-[#5C6BC0]/60 shadow-sm hover:shadow-md'
      }`}
    >
      <HorizonHandle type="target" position={Position.Left} color="#5C6BC0" />

      <div className="px-3.5 py-2.5 bg-[#F4F5FB] border-b border-[#D5D9F2] rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#E8EAF6] border border-[#C5CAE9] flex items-center justify-center shrink-0">
            <Code2 className="w-4 h-4 text-[#5C6BC0]" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-xs text-[#1D2D3E] truncate">
              {data.label || data.view_name}
            </div>
            <div className="text-[10px] text-[#556B82]">SQL View</div>
          </div>
        </div>
        <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-[#E8EAF6] text-[#5C6BC0] border border-[#C5CAE9] font-bold shrink-0">
          SQL
        </span>
      </div>

      <div className="p-3 bg-white rounded-b-lg space-y-1.5 text-xs">
        <div className="text-[11px] text-[#324558] font-medium truncate">
          {data.business_name || 'Calculated SQL View'}
        </div>
        <div className="bg-[#FAFBFD] rounded border border-[#E5E9F0] p-1.5 text-[10px] font-mono text-[#5C6BC0] max-h-16 overflow-y-auto">
          <pre className="whitespace-pre-wrap">{data.sqlQuery || data.sql || 'SELECT * FROM source'}</pre>
        </div>
      </div>

      <HorizonHandle type="source" position={Position.Right} color="#5C6BC0" />
    </div>
  );
});

// ── 18. Remote Table Node ────────────────────────────────────────────────────
export const RemoteTableNode = memo(({ data, selected }: NodeProps) => {
  return (
    <div
      className={`w-72 bg-white rounded-lg border text-slate-800 transition-all duration-150 select-none ${
        selected
          ? 'border-[#0070F2] ring-2 ring-[#0070F2]/30 shadow-lg'
          : 'border-[#D9DDE3] hover:border-[#0070F2]/60 shadow-sm hover:shadow-md'
      }`}
    >
      <div className="px-3.5 py-2.5 bg-[#F5F7FA] border-b border-[#E5E9F0] rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#EBF3FF] border border-[#BBD7FD] flex items-center justify-center shrink-0">
            <Database className="w-4 h-4 text-[#0070F2]" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-xs text-[#1D2D3E] truncate">
              {data.label || data.object_name}
            </div>
            <div className="text-[10px] text-[#556B82]">{data.remote_source || 'S/4HANA ABAP'}</div>
          </div>
        </div>
        <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-[#EBF3FF] text-[#0070F2] border border-[#BBD7FD] font-bold shrink-0">
          REMOTE
        </span>
      </div>

      <div className="p-3 bg-white rounded-b-lg">
        <div className="text-[11px] text-[#556B82]">
          Status: <span className="font-mono text-[#107E3E] font-semibold">{data.is_replicated ? 'Replicated' : 'Federated'}</span>
        </div>
      </div>

      <HorizonHandle type="source" position={Position.Right} color="#0070F2" />
    </div>
  );
});

// ── 19. Replication Config Node ──────────────────────────────────────────────
export const ReplicationNode = memo(({ data, selected }: NodeProps) => {
  return (
    <div
      className={`w-72 bg-white rounded-lg border text-slate-800 transition-all duration-150 select-none ${
        selected
          ? 'border-[#00A3C4] ring-2 ring-[#00A3C4]/30 shadow-lg'
          : 'border-[#D9DDE3] hover:border-[#00A3C4]/60 shadow-sm hover:shadow-md'
      }`}
    >
      <HorizonHandle type="target" position={Position.Left} color="#00A3C4" />

      <div className="px-3.5 py-2.5 bg-[#EBF8FB] border-b border-[#BCE8F1] rounded-t-lg flex items-center justify-between">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-7 h-7 rounded bg-[#D3F2F8] border border-[#96E0EE] flex items-center justify-center shrink-0">
            <Cpu className="w-4 h-4 text-[#00A3C4]" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-xs text-[#1D2D3E] truncate">
              {data.label || data.objectId}
            </div>
            <div className="text-[10px] text-[#556B82]">Replication Flow</div>
          </div>
        </div>
        <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-[#D3F2F8] text-[#00A3C4] border border-[#96E0EE] font-bold shrink-0">
          REPLICATION
        </span>
      </div>

      <div className="p-3 bg-white rounded-b-lg">
        <div className="text-[11px] text-[#556B82]">
          Mode: <span className="font-mono text-[#00A3C4] font-semibold">{data.replication_mode || 'SCHEDULED'}</span>
        </div>
      </div>

      <HorizonHandle type="source" position={Position.Right} color="#00A3C4" />
    </div>
  );
});

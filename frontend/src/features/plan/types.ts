// frontend/src/features/plan/types.ts
// TypeScript interfaces matching backend Plan models

export type OperationType =
  | 'source'
  | 'projection'
  | 'filter'
  | 'join'
  | 'association'
  | 'calculated_column'
  | 'measure'
  | 'analytic_model';

export type JoinType = 'inner' | 'left' | 'right' | 'full' | '';

export interface NodeDetails {
  join_type?: string;
  on?: string[][];
  condition?: string;
  formula?: string;
  aggregation?: string;
}

export interface PlanNode {
  id: string;
  operation: OperationType | string;
  inputs: string[];
  columns: string[];
  details: NodeDetails;
  reason: string;
  is_existing?: boolean;
  layer?: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | string;
}

export interface PlanMeasure {
  name: string;
  aggregation: string;
  column: string;
}

export interface Plan {
  analysis: string[];
  nodes: PlanNode[];
  measures: PlanMeasure[];
  dimensions: string[];
  assumptions: string[];
  blockers: string[];
}

export interface GeneratePlanResponse {
  plan_id: string;
  request_id: string;
  plan: Plan;
  metadata_summary: string;
  profile_summary: string;
  sample_data_summary?: string;
  warnings?: string[];
  created_at: string;
}

export interface InspectionTrace {
  request_id: string;
  plan_id?: string;
  timestamp: string;
  requirement: string;
  stage_metadata: {
    filename: string;
    parsing_status: string;
    total_objects_discovered: number;
    discovered_objects: Array<{
      name: string;
      object_type: string;
      column_count: number;
      keys: string[];
      joins_count: number;
    }>;
    parsing_warnings: string[];
    unsupported_structures: string[];
    structured_summary: string;
  };
  stage_compaction: {
    retained_objects: string[];
    omitted_attributes: string[];
    compact_text_chars: number;
    compact_text_preview: string;
  };
  stage_sample_mapping: {
    has_samples: boolean;
    mapped_tables: string[];
    total_rows_parsed: number;
    total_rows_retained: number;
    unknown_columns: Record<string, string[]>;
    ambiguous_blocks_count: number;
    malformed_rows_count: number;
    warnings: string[];
  };
  stage_llm: {
    provider: string;
    model: string;
    system_prompt: string;
    total_attempts: number;
    final_status: string;
    attempts: Array<{
      attempt_number: number;
      timestamp: string;
      prompt_chars: number;
      user_prompt_sent: string;
      raw_response: string;
      json_parse_status: string;
      pydantic_status: string;
      plan_checker_status: string;
      errors: string[];
    }>;
  };
  final_plan_node_count: number;
}

export interface RevisePlanResponse {
  plan_id: string;
  plan: Plan;
  affected_nodes: string[];
  updated_at: string;
}

export interface GetPlanResponse {
  plan_id: string;
  plan: Plan;
  requirement: string;
  metadata_summary: string;
  profile_summary: string;
  created_at: string;
  updated_at: string;
}

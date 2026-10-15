export type Connection = {
  id: string;
  name: string;
  tenant_host: string;
  space: string;
  ds_release: string | null;
  is_active: boolean;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  last_tested_at: string | null;
  created_at: string;
};

export type CatalogColumn = {
  id: string;
  table_id: string;
  column_name: string;
  data_type: string | null;
  length: number | null;
  scale: number | null;
  is_nullable: boolean;
  is_key: boolean;
  position: number | null;
  semantic_role: 'key' | 'measure' | 'dimension' | 'text' | 'date' | 'unit' | null;
  business_name: string | null;
  description: string | null;
  classification_confidence: number | null;
  classification_source: string | null;
  is_pii: boolean;
};

export type CatalogTable = {
  id: string;
  connection_id: string;
  space: string;
  object_name: string;
  object_type: string;
  business_name: string | null;
  description: string | null;
  row_count: number | null;
  column_count: number;
  is_pii: boolean;
  is_remote?: boolean;
  remote_source?: string | null;
  remote_object_name?: string | null;
  is_replicated?: boolean;
  replication_status?: string | null;
  replication_mode?: string | null;
  existing_associations?: any[];
  profile_status: string;
  profiled_at: string | null;
  discovered_at: string;
  columns?: CatalogColumn[];
};

export type ViewSpecColumn = {
  column_name: string;
  business_name?: string;
  data_type?: string;
  semantic_role?: 'key' | 'measure' | 'dimension' | 'text' | 'date' | 'unit';
  aggregation?: 'SUM' | 'MIN' | 'MAX' | 'COUNT' | 'NONE';
  is_key?: boolean;
  source_column?: string;
  source_alias?: string;
  expression?: string;
};

export type ViewSpecSource = {
  alias: string;
  object_name: string;
  space?: string;
  object_type?: string;
};

export type ViewSpecJoin = {
  left_source: string;
  right_source: string;
  join_type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  conditions: Array<{ left_column: string; right_column: string }>;
  cardinality?: '1:1' | '1:N' | 'N:1' | 'N:M';
};

export type ViewSpecAssociation = {
  name: string;
  target_view: string;
  cardinality: '1:1' | '1:N' | 'N:1' | 'N:M';
  foreign_key_mappings: Array<{ local_column: string; foreign_column: string }>;
};

export type ViewSpecOperator = {
  id: string;
  name: string;
  type: 'PROJECTION' | 'FILTER' | 'JOIN' | 'ASSOCIATION' | 'HIERARCHY' | 'UNION' | 'AGGREGATION' | 'SOURCE';
  description?: string;
  sources?: string[];
  condition?: string;
  filter_expression?: string;
  join_type?: string;
  join_condition?: string;
  join_mappings?: Array<{ left: string; right: string; left_table?: string; right_table?: string }>;
  cardinality?: string;
  columns?: Array<{
    name: string;
    expression?: string;
    data_type?: string;
    is_key?: boolean;
    aggregation?: string;
    source_column?: string;
  }>;
  hierarchy_type?: string;
  parent_attribute?: string;
  child_attribute?: string;
  levels?: string[];
  target_entity?: string;
  foreign_keys?: Record<string, string>;
  measures?: Array<{ name: string; aggregation: string }>;
  dimensions?: string[];
};

export type ViewSpecHierarchy = {
  name: string;
  hierarchy_type: 'PARENT_CHILD' | 'LEVEL_BASED';
  parent_column?: string;
  child_column?: string;
  root_condition?: string;
  levels?: string[];
};

export type ViewSpec = {
  id?: string;
  objectId?: string;
  view_name: string;
  layer?: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  kind: 'graphical_view' | 'sql_view' | 'business_entity' | 'analytic_model' | 'replication_config';
  business_name: string;
  description?: string;
  space?: string;
  sources: ViewSpecSource[];
  columns: ViewSpecColumn[];
  joins?: ViewSpecJoin[];
  associations?: ViewSpecAssociation[];
  hierarchies?: ViewSpecHierarchy[];
  filters?: string[];
  sql?: string;
  sqlQuery?: string;
  operators?: ViewSpecOperator[];
  confidence_score?: number;
  confidence_reasons?: string[];
  status?: 'draft' | 'approved' | 'rejected';
  rendered_artifact?: Record<string, any>;
};

export type ChatResponse = {
  message: string;
  actions_taken: Array<Record<string, any>>;
  modified_views: string[];
  validation_warnings: any[];
  code_preview: string;
  view_spec?: Record<string, any>;
};

export type ValidationIssue = {
  rule_id: string;
  severity: 'BLOCKER' | 'WARNING' | 'INFO';
  view_name: string;
  message: string;
  details?: Record<string, any>;
};

export type ValidationReport = {
  passed: boolean;
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
  fixed_views?: ViewSpec[];
  total_issues: number;
};

export type RunGate = 'sources' | 'plan' | 'artifacts';

export type RunStatus =
  | 'idle'
  | 'parsing'
  | 'waiting_source_confirm'
  | 'planning'
  | 'waiting_plan_confirm'
  | 'building'
  | 'validating'
  | 'waiting_artifact_approve'
  | 'completed'
  | 'failed'
  | 'INTAKE'
  | 'PARSE_REQUIREMENT'
  | 'SELECT_SOURCES'
  | 'PROFILE'
  | 'PLAN_VIEW_CHAIN'
  | 'BUILD_VIEWS'
  | 'VALIDATE'
  | 'EXPORT'
  | 'REJECTED';

export type Run = {
  id: string;
  connection_id?: string | null;
  requirement_text?: string;
  requirement_prompt?: string;
  state?: string;
  status?: RunStatus | string;
  current_node?: string | null;
  candidate_tables?: any[];
  model_plan?: any;
  views?: ViewSpec[];
  user_metadata?: any;
  validation_report?: ValidationReport;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
};

export type ImpactResult = {
  source_object: string;
  impacted_views: Array<{
    view_name: string;
    kind: string;
    impact_type: 'direct_source' | 'join_dependency' | 'association_target';
    distance: number;
  }>;
};

export type OperatorIconMeta = {
  icon: string;
  label: string;
  tooltip: string;
  color: string;
  shape?: string;
};

export type CanvasOperatorNode = {
  id: string;
  type: string;
  label?: string;
  position: { x: number; y: number };
  iconMeta?: OperatorIconMeta;
  data: Record<string, any>;
};

export type CanvasEdge = {
  id?: string;
  from?: string;
  to?: string;
  source?: string;
  target?: string;
  label?: string;
  edgeType?: string;
  dashed?: boolean;
};

export type CanvasView = {
  sequence: number;
  view_spec_id: string;
  object_id: string;
  layer: string;
  layer_meta?: {
    label: string;
    description: string;
    color: string;
    icon?: string;
  };
  kind: string;
  kind_meta?: {
    label: string;
    icon?: string;
    tooltip?: string;
    color?: string;
  };
  business_name: string;
  description?: string;
  approval_state?: string;
  version?: number;
  confidence_score?: number;
  canvas: {
    nodes: CanvasOperatorNode[];
    edges: CanvasEdge[];
  };
  columns?: any[];
  associations?: any[];
  ds_json: Record<string, any>;
  sources?: any[];
};

export type SequentialCanvasResponse = {
  run_id: string;
  run_name?: string;
  run_state?: string;
  total_views: number;
  layer_summary?: Record<string, number>;
  source_tables?: any[];
  views: CanvasView[];
  icon_registry?: Record<string, OperatorIconMeta>;
  layer_meta?: Record<string, any>;
  kind_meta?: Record<string, any>;
  _note?: string;
};


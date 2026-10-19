// src/features/lineage/viewGraphTypes.ts
// TypeScript models mirroring backend Pydantic models for ViewGraph.

export type NodeType =
  | 'SOURCE'
  | 'JOIN'
  | 'PROJECTION'
  | 'CALCULATION'
  | 'FILTER'
  | 'UNION'
  | 'OUTPUT';

export type JoinType = 'inner' | 'left' | 'right' | 'full';

export type OperationType =
  | 'add_node'
  | 'remove_node'
  | 'update_node'
  | 'add_edge'
  | 'remove_edge'
  | 'set_join'
  | 'set_filter'
  | 'set_calculation'
  | 'include_column'
  | 'exclude_column'
  | 'rename';

export interface NodeDetails {
  // Join
  join_type?: JoinType | string;
  key_pairs?: string[][]; // [["LEFT_COL", "RIGHT_COL"]]

  // Projection
  included_columns?: string[];
  excluded_columns?: string[];
  renamed_columns?: Record<string, string>;

  // Calculation
  calculation_name?: string;
  expression?: string;
  data_type?: string;

  // Filter
  filter_expression?: string;

  // Union
  union_all?: boolean;

  // Output
  output_name?: string;
}

export interface ViewGraphNode {
  id: string;
  name: string;
  node_type: NodeType;
  is_existing?: boolean;
  columns?: string[];
  details: NodeDetails;
  position: { x: number; y: number };
  errors?: string[];

  // Ephemeral diff status for AI diff preview
  diffStatus?: 'added' | 'removed' | 'modified' | null;
}

export interface ViewGraphEdge {
  id: string;
  source: string;
  target: string;
  source_handle?: string | null;
  target_handle?: string | null;
  diffStatus?: 'added' | 'removed' | null;
}

export interface ViewGraph {
  view_id: string;
  view_name: string;
  nodes: ViewGraphNode[];
  edges: ViewGraphEdge[];
  version: number;
}

export interface Operation {
  op: OperationType;
  node_id?: string;
  edge_id?: string;
  payload?: Record<string, any>;
}

export interface AIRevisionResult {
  valid: boolean;
  operations: Operation[];
  rejected_operations: Array<{ op: string; node_id?: string; reason: string }>;
  diff: {
    added_nodes: string[];
    removed_nodes: string[];
    modified_nodes: string[];
  };
  preview_graph?: ViewGraph | null;
  message: string;
}

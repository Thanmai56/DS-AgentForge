// frontend/src/features/plan/planApi.ts
// Client API service for Phase 1 Plan generation and revision

import { GeneratePlanResponse, RevisePlanResponse, GetPlanResponse, PlanNode } from './types';

const BASE_URL = '/api';

export async function generatePlanApi(
  requirement: string,
  metadata: any,
  options?: {
    mockData?: Record<string, string>;
    sampleData?: string | Record<string, string>;
    rowLimit?: number;
    filename?: string;
  }
): Promise<GeneratePlanResponse> {
  const response = await fetch(`${BASE_URL}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requirement,
      metadata,
      mock_data: options?.mockData || null,
      sample_data: options?.sampleData || null,
      row_limit: options?.rowLimit || 5,
      filename: options?.filename || 'uploaded_metadata.json',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Server error: ${response.status}`);
  }

  return response.json();
}

export async function revisePlanApi(
  planId: string,
  options: { instruction?: string; editedNode?: PlanNode }
): Promise<RevisePlanResponse> {
  const response = await fetch(`${BASE_URL}/plan/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan_id: planId,
      instruction: options.instruction || null,
      edited_node: options.editedNode || null,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Revision failed: ${response.status}`);
  }

  return response.json();
}

export async function getPlanApi(planId: string): Promise<GetPlanResponse> {
  const response = await fetch(`${BASE_URL}/plan/${planId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to fetch plan: ${response.status}`);
  }

  return response.json();
}

export async function fetchInspectionTraceApi(id: string, format: 'json' | 'text' = 'json'): Promise<any> {
  const response = await fetch(`${BASE_URL}/plan/${id}/inspect?format=${format}`, {
    method: 'GET',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to fetch inspection trace: ${response.status}`);
  }

  if (format === 'text') {
    return response.text();
  }

  return response.json();
}

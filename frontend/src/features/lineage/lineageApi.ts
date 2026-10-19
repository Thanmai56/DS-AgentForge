// src/features/lineage/lineageApi.ts
// Frontend API client for ViewGraph operations, synthesis, and AI revision.

import { ViewGraph, Operation, AIRevisionResult } from './viewGraphTypes';

const API_BASE = '/api';

export async function synthesizeLineageApi(
  planId?: string,
  plan?: any
): Promise<Record<string, ViewGraph>> {
  const res = await fetch(`${API_BASE}/lineage/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_id: planId || null, plan: plan || null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to synthesize lineage: ${res.status}`);
  }
  return res.json();
}

export async function getAllViewGraphsApi(
  planId: string
): Promise<Record<string, ViewGraph>> {
  const res = await fetch(`${API_BASE}/lineage/${planId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to fetch view graphs: ${res.status}`);
  }
  return res.json();
}

export async function getViewGraphApi(
  planId: string,
  viewId: string
): Promise<ViewGraph> {
  const res = await fetch(`${API_BASE}/lineage/${planId}/${viewId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to fetch view graph: ${res.status}`);
  }
  return res.json();
}

export interface OperationResponse {
  graph: ViewGraph;
  errors: string[];
  can_undo: boolean;
  can_redo: boolean;
  message: string;
}

export async function applyOperationApi(
  planId: string,
  viewId: string,
  op: Operation
): Promise<OperationResponse> {
  const res = await fetch(`${API_BASE}/lineage/${planId}/${viewId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: op }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to apply operation: ${res.status}`);
  }
  return res.json();
}

export async function undoOperationApi(
  planId: string,
  viewId: string
): Promise<OperationResponse> {
  const res = await fetch(`${API_BASE}/lineage/${planId}/${viewId}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to undo: ${res.status}`);
  }
  return res.json();
}

export async function redoOperationApi(
  planId: string,
  viewId: string
): Promise<OperationResponse> {
  const res = await fetch(`${API_BASE}/lineage/${planId}/${viewId}/redo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to redo: ${res.status}`);
  }
  return res.json();
}

export async function aiReviseViewApi(
  planId: string,
  viewId: string,
  instruction: string
): Promise<AIRevisionResult> {
  const res = await fetch(`${API_BASE}/lineage/${planId}/${viewId}/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `AI revision failed: ${res.status}`);
  }
  return res.json();
}

export async function validateViewApi(
  planId: string,
  viewId: string
): Promise<{ valid: boolean; blockers: string[]; nodes_with_errors: string[] }> {
  const res = await fetch(`${API_BASE}/lineage/${planId}/${viewId}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Validation call failed: ${res.status}`);
  }
  return res.json();
}

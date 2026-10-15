import { Connection, CatalogTable, Run, ViewSpec, ValidationReport, ImpactResult, SequentialCanvasResponse, CanvasView } from '../types';

const API_BASE = '/api/v1';

class ApiClient {
  private token: string | null = localStorage.getItem('token');

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        errorMsg = errorData.detail || errorData.message || errorMsg;
      } catch {
        // use default error message
      }
      throw new Error(errorMsg);
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return undefined as T;
    }

    return response.json();
  }

  // Connections
  async getConnections(): Promise<Connection[]> {
    return this.request<Connection[]>('/connections');
  }

  async createConnection(data: Partial<Connection> & { client_secret: string }): Promise<Connection> {
    return this.request<Connection>('/connections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async testConnection(id: string, clientSecret: string): Promise<{ ok: boolean; message: string; ds_release?: string }> {
    return this.request(`/connections/${id}/test`, {
      method: 'POST',
      body: JSON.stringify({ client_secret: clientSecret }),
    });
  }

  async deleteConnection(id: string): Promise<{ ok: boolean }> {
    return this.request(`/connections/${id}`, {
      method: 'DELETE',
    });
  }

  // Catalog
  async getCatalogTables(params?: { connection_id?: string; space?: string; search?: string }): Promise<{ items: CatalogTable[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params?.connection_id) searchParams.append('connection_id', params.connection_id);
    if (params?.space) searchParams.append('space', params.space);
    if (params?.search) searchParams.append('search', params.search);
    return this.request(`/catalog/tables?${searchParams.toString()}`);
  }

  async getCatalogTable(id: string): Promise<CatalogTable> {
    return this.request<CatalogTable>(`/catalog/tables/${id}`);
  }

  async scanCatalog(connectionId: string, clientSecret: string): Promise<{ status: string; scanned_count: number }> {
    return this.request('/catalog/scan', {
      method: 'POST',
      body: JSON.stringify({ connection_id: connectionId, client_secret: clientSecret }),
    });
  }

  // Runs & LangGraph
  async startRun(
    firstArg: string,
    secondArg?: any,
    thirdArg?: any
  ): Promise<Run> {
    // Flexible signature:
    // startRun(requirement, user_metadata, connectionId) OR startRun(connectionId, requirement, user_metadata)
    let connectionId: string | null = null;
    let requirement = '';
    let userMetadata: any = null;

    // Check if first argument is a UUID / connectionId (has dashes / hex format of a UUID)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(firstArg);
    if (isUuid && typeof secondArg === 'string') {
      connectionId = firstArg;
      requirement = secondArg;
      userMetadata = thirdArg || null;
    } else {
      requirement = firstArg;
      userMetadata = secondArg || null;
      connectionId = thirdArg || null;
    }

    return this.request<Run>('/runs', {
      method: 'POST',
      body: JSON.stringify({
        connection_id: connectionId,
        requirement: requirement,
        requirement_text: requirement,
        requirement_prompt: requirement,
        user_metadata: userMetadata,
        metadata: userMetadata,
      }),
    });
  }

  async pushToSpace(runId: string, connectionId?: string, space?: string): Promise<any> {
    return this.request(`/runs/${runId}/push-to-space`, {
      method: 'POST',
      body: JSON.stringify({ connection_id: connectionId, space }),
    });
  }

  async deploy(runId: string, connectionId?: string, space?: string): Promise<any> {
    return this.request(`/runs/${runId}/deploy`, {
      method: 'POST',
      body: JSON.stringify({ connection_id: connectionId, space }),
    });
  }

  async getRun(id: string): Promise<Run> {
    return this.request<Run>(`/runs/${id}`);
  }

  async listRuns(): Promise<Run[]> {
    return this.request<Run[]>('/runs');
  }

  async approveGate(runId: string, gate: string, payload?: any): Promise<Run> {
    return this.request<Run>(`/runs/${runId}/approve/${gate}`, {
      method: 'POST',
      body: JSON.stringify(payload || { approved: true }),
    });
  }

  async rejectGate(runId: string, gate: string, feedback: string): Promise<Run> {
    return this.request<Run>(`/runs/${runId}/approve/${gate}`, {
      method: 'POST',
      body: JSON.stringify({ approved: false, feedback }),
    });
  }

  // Views & Lineage
  async updateView(specId: string, updates: Partial<ViewSpec>): Promise<ViewSpec> {
    return this.request<ViewSpec>(`/views/${specId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async chatModifyView(runId: string, message: string, targetViewId?: string): Promise<any> {
    return this.request(`/runs/${runId}/chat`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        target_view_id: targetViewId,
      }),
    });
  }

  async getImpactAnalysis(runId: string, objectName: string): Promise<ImpactResult> {
    return this.request<ImpactResult>(`/views/impact?run_id=${runId}&object_name=${encodeURIComponent(objectName)}`);
  }

  // Sequential Model Canvas (Datasphere Data Builder)
  async getSequentialCanvas(runId: string): Promise<SequentialCanvasResponse> {
    return this.request<SequentialCanvasResponse>(`/runs/${runId}/canvas`);
  }

  async getMockCanvas(): Promise<SequentialCanvasResponse> {
    return this.request<SequentialCanvasResponse>('/runs/mock/canvas');
  }

  async getSingleViewCanvas(runId: string, viewSpecId: string): Promise<any> {
    return this.request(`/runs/${runId}/canvas/${viewSpecId}`);
  }

  async getViewDsJson(specId: string): Promise<{ spec_id: string; object_id: string; kind: string; layer: string; ds_json: any }> {
    return this.request(`/views/${specId}/ds-json`);
  }

  // Export
  getExportUrl(runId: string): string {
    return `${API_BASE}/export/bundle/${runId}`;
  }

  async compressJson(data: any, optimizeSchema: boolean = true): Promise<{ compressed_json: string; compressed_schema: string; stats: any }> {
    return this.request('/runs/compress-json', {
      method: 'POST',
      body: JSON.stringify({ data, optimize_schema: optimizeSchema }),
    });
  }

  async getExportManifest(runId: string): Promise<any> {
    return this.request(`/export/manifest/${runId}`);
  }
}

export const api = new ApiClient();

// WebSocket connection helper
export function createRunWebSocket(runId: string, onMessage: (data: any) => void) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/runs/${runId}`;
  const socket = new WebSocket(wsUrl);

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (err) {
      console.error('Failed to parse WebSocket message', err);
    }
  };

  return socket;
}

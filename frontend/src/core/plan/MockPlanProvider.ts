// src/core/plan/MockPlanProvider.ts
// Returns the PO Processing Time fixture. No network calls.

import type { PlanProvider } from './PlanProvider';
import type { LineageGraph } from '../model/types';
import { PO_PROCESSING_TIME_GRAPH } from '../../../fixtures/po-processing-time';

export class MockPlanProvider implements PlanProvider {
  async generatePlan(_requirement: string): Promise<LineageGraph> {
    // Simulate async latency
    await new Promise(resolve => setTimeout(resolve, 300));
    // Deep-clone so each call is independent
    return JSON.parse(JSON.stringify(PO_PROCESSING_TIME_GRAPH)) as LineageGraph;
  }
}

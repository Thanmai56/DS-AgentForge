// src/core/plan/PlanProvider.ts
// Interface + Mock for the planning layer.

import type { LineageGraph } from '../model/types';

export interface PlanProvider {
  /** Given a natural-language KPI requirement, returns an initial LineageGraph. */
  generatePlan(requirement: string): Promise<LineageGraph>;
}

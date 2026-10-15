// src/core/csn/topoExporter.ts
// Topological sort of LineageGraph -> ordered CsnFile[] ready for Page 2.
// No React imports.

import type { LineageGraph, CsnFile, FieldDef, CsnToken } from '../model/types';
import { formulaToCsn } from './formulaConverter';
import { buildJoinView, buildSimpleView } from './templates.verified';
import { buildFactView, buildAnalyticModel } from './templates.experimental';

// ── Topological sort ───────────────────────────────────────────────────────────
function topoSort(graph: LineageGraph): string[] {
  // Build adjacency: each view depends on its sources
  const deps = new Map<string, string[]>();
  for (const v of graph.views) {
    deps.set(v.technicalName, v.sources);
  }
  // Source tables have no deps
  for (const s of graph.sources) {
    deps.set(s.technicalName, []);
  }
  deps.set(graph.analyticModelId, [graph.views[graph.views.length - 1]?.technicalName ?? '']);

  const order: string[] = [];
  const visited = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of deps.get(id) ?? []) visit(dep);
    order.push(id);
  }

  for (const [id] of deps) visit(id);
  return order;
}

// ── Main export ────────────────────────────────────────────────────────────────
export function exportCsnFiles(graph: LineageGraph): CsnFile[] {
  const order = topoSort(graph);
  const files: CsnFile[] = [];
  let orderIdx = 1;

  // We only emit CSN for views (not raw source tables, which are assumed to exist in Datasphere)
  const viewMap = new Map(graph.views.map(v => [v.technicalName, v]));

  for (const id of order) {
    // Skip raw source tables
    if (graph.sources.find(s => s.technicalName === id)) continue;

    // Analytic model
    if (id === graph.analyticModelId) {
      const kpiCsnFields = graph.kpis.map(k => ({
        name: k.name,
        label: k.label,
        xpr: k.csnXpr ?? formulaToCsn(k.formula),
      }));

      // Collect dimension and measure fields from fact view
      const factView = graph.views.find(v => v.kind === 'fact');
      const dimFields = factView?.projectedFields.filter(f => !f.isMeasure) ?? [];
      const measureFields = factView?.projectedFields.filter(f => f.isMeasure) ?? [];

      const content = buildAnalyticModel({
        technicalName: graph.analyticModelId,
        label: graph.analyticModelLabel,
        factViewRef: factView?.technicalName ?? '',
        factViewAlias: factView?.technicalName ?? 'FACT',
        dimensionFields: dimFields,
        measureFields,
        kpiFields: kpiCsnFields,
      });

      files.push({
        technicalName: graph.analyticModelId,
        label: graph.analyticModelLabel,
        templateKind: 'experimental',
        order: orderIdx++,
        content,
      });
      continue;
    }

    const view = viewMap.get(id);
    if (!view) continue;

    if (view.kind === 'fact') {
      const kpiCsnFields = graph.kpis.map(k => ({
        name: k.name,
        label: k.label,
        xpr: k.csnXpr ?? formulaToCsn(k.formula),
      }));
      const measureFields = view.projectedFields.filter(f => f.isMeasure);
      const dimFields = view.projectedFields.filter(f => !f.isMeasure);

      const content = buildFactView({
        technicalName: view.technicalName,
        label: view.label,
        description: view.description,
        purpose: view.purpose,
        fields: dimFields,
        measureFields,
        kpiFields: kpiCsnFields,
      });

      files.push({
        technicalName: view.technicalName,
        label: view.label,
        templateKind: 'experimental',
        order: orderIdx++,
        content,
      });
    } else {
      // Dimension / intermediate view
      let content: Record<string, unknown>;

      if (view.joins.length > 0) {
        const join = view.joins[0];
        const calcColumns = view.calculatedFields.map(cf => ({
          name: cf.name,
          xpr: cf.csnXpr ?? formulaToCsn(cf.formula),
          field: {
            name: cf.name,
            label: cf.label,
            type: cf.type,
          } as FieldDef,
        }));

        content = buildJoinView({
          technicalName: view.technicalName,
          label: view.label,
          description: view.description,
          purpose: view.purpose,
          tags: view.tags,
          joinType: join.joinType,
          leftRef: join.leftSource,
          leftAlias: join.leftSource,
          rightRef: join.rightSource,
          rightAlias: join.rightSource,
          onLeft: [join.leftSource, join.leftField],
          onRight: [join.rightSource, join.rightField],
          fields: view.projectedFields,
          calcColumns,
        });
      } else {
        const src = view.sources[0] ?? '';
        content = buildSimpleView({
          technicalName: view.technicalName,
          label: view.label,
          description: view.description,
          purpose: view.purpose,
          tags: view.tags,
          sourceTable: src,
          sourceAlias: src,
          fields: view.projectedFields,
        });
      }

      files.push({
        technicalName: view.technicalName,
        label: view.label,
        templateKind: 'verified',
        order: orderIdx++,
        content,
      });
    }
  }

  return files.sort((a, b) => a.order - b.order);
}

// ── Deep-clone + patch existing CSN ───────────────────────────────────────────
/**
 * Takes an existing CSN JSON object (from a real Datasphere export),
 * deep-clones it, then adds the new KPI element and measure to the first entity.
 * Returns {patched, diff} where diff lists only the added keys.
 */
export function patchExistingCsn(
  original: Record<string, unknown>,
  technicalName: string,
  newElements: Record<string, unknown>,
): { patched: Record<string, unknown>; addedKeys: string[] } {
  const patched = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
  const defs = patched['definitions'] as Record<string, unknown>;
  const entity = defs[technicalName] as Record<string, unknown>;
  const elements = entity['elements'] as Record<string, unknown>;

  const addedKeys: string[] = [];
  for (const [k, v] of Object.entries(newElements)) {
    if (!(k in elements)) {
      elements[k] = v;
      addedKeys.push(k);
    }
  }

  return { patched, addedKeys };
}

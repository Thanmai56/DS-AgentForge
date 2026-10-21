import { CompressedEntity, CompressedField } from '../../utils/schemaCompressor';
import { Plan, PlanNode } from './types';

const validLayers = ['L0', 'L1', 'L2', 'L3', 'L4'];

function nodeLayer(node: PlanNode): string {
  if (node.layer && validLayers.includes(node.layer)) return node.layer;
  if (node.operation === 'analytic_model') return 'L4';
  if (node.operation === 'join' || node.operation === 'calculated_column') return 'L3';
  if (node.operation === 'projection' || node.operation === 'filter') {
    return node.is_existing ? 'L2' : 'L1';
  }
  return 'L2';
}

function cleanColumnName(reference: string): string {
  return reference.split('.').pop() || reference;
}

export function buildPlanExportEntities(
  plan: Plan,
  sourceEntities: CompressedEntity[],
): CompressedEntity[] {
  const sourceByName = new Map(sourceEntities.map((entity) => [entity.name, entity]));
  const planNodeIds = new Set(plan.nodes.map((node) => node.id));
  const referencedSources = Array.from(new Set(plan.nodes.flatMap((node) =>
    node.inputs.filter((input) => !planNodeIds.has(input)),
  )));
  const result = referencedSources
    .map((name) => sourceByName.get(name))
    .filter((entity): entity is CompressedEntity => Boolean(entity))
    .map((entity) => ({ ...entity, fields: [...entity.fields], sources: [...entity.sources] }));
  const fieldsByNode = new Map<string, Map<string, CompressedField>>();
  const planNodesById = new Map(plan.nodes.map((node) => [node.id, node]));

  sourceEntities.forEach((entity) => {
    fieldsByNode.set(entity.name, new Map(entity.fields.map((field) => [field.name, field])));
  });

  for (const node of plan.nodes) {
    if (node.operation.toLowerCase() === 'source') {
      const existing = sourceByName.get(node.id);
      const sourceEntity: CompressedEntity = existing
        ? { ...existing, fields: [...existing.fields], sources: [...existing.sources] }
        : {
            name: node.id,
            business_name: node.reason || node.id,
            kind: 'table',
            sources: [],
            fields: node.columns.map((column) => ({
              name: cleanColumnName(column),
              data_type: 'NVARCHAR',
              is_key: false,
              label: cleanColumnName(column),
              semantic_role: 'dimension',
            })),
          };
      if (!result.some((entity) => entity.name === sourceEntity.name)) result.push(sourceEntity);
      fieldsByNode.set(node.id, new Map(sourceEntity.fields.map((field) => [field.name, field])));
      continue;
    }

    if (node.is_existing && sourceByName.has(node.id)) {
      const existing = sourceByName.get(node.id)!;
      if (!result.some((entity) => entity.name === existing.name)) {
        result.push({ ...existing, fields: [...existing.fields], sources: [...existing.sources] });
      }
      fieldsByNode.set(node.id, new Map(existing.fields.map((field) => [field.name, field])));
      continue;
    }

    const upstreamFields = new Map<string, CompressedField>();
    node.inputs.forEach((input) => {
      fieldsByNode.get(input)?.forEach((field, name) => upstreamFields.set(name, field));
    });

    const outputFields = node.columns.map((reference) => {
      const name = cleanColumnName(reference);
      const upstreamField = upstreamFields.get(name);
      const sourceInput = node.inputs.find((input) => fieldsByNode.get(input)?.has(name));
      const measure = plan.measures.find((item) => item.name === name || item.column === name);
      if (upstreamField) {
        return {
          ...upstreamField,
          name,
          source: reference.includes('.')
            ? reference.split('.')[0]
            : sourceInput && planNodesById.has(sourceInput)
              ? sourceInput
              : upstreamField.source || sourceInput,
          semantic_role: measure ? 'measure' : upstreamField.semantic_role,
          aggregation: measure?.aggregation || upstreamField.aggregation,
        };
      }
      return {
        name,
        data_type: 'cds.String',
        is_key: false,
        label: name,
        semantic_role: measure ? 'measure' as const : 'dimension' as const,
        aggregation: measure?.aggregation,
        source: reference.includes('.') ? reference.split('.')[0] : undefined,
      };
    });
    const layer = nodeLayer(node);
    if (layer === 'L4') {
      plan.measures.forEach((measure) => {
        if (!outputFields.some((field) => field.name === measure.name)) {
          outputFields.push({
            name: measure.name,
            data_type: 'cds.Decimal(15,2)',
            is_key: false,
            label: measure.name,
            semantic_role: 'measure',
            aggregation: measure.aggregation,
          });
        }
      });
    }

    const joins = (node.details?.on || []).map((pair) => {
      const leftRef = pair[0] || '';
      const rightRef = pair[1] || '';
      return {
        leftSource: leftRef.includes('.') ? leftRef.split('.')[0] : node.inputs[0] || '',
        rightSource: rightRef.includes('.') ? rightRef.split('.')[0] : node.inputs[1] || '',
        leftField: cleanColumnName(leftRef),
        rightField: cleanColumnName(rightRef),
        joinType: node.details?.join_type || 'inner',
      };
    });

    let calculatedFields: CompressedEntity['calculatedFields'] = [];
    if (node.details?.formula) {
      const formulaMeasure = layer === 'L4'
        ? plan.measures.find((measure) => measure.aggregation.toUpperCase() === 'FORMULA')
        : undefined;
      const calculatedColumn = formulaMeasure?.name
        || node.columns.find((column) => !upstreamFields.has(cleanColumnName(column)));
      if (calculatedColumn) {
        calculatedFields = [{
          name: cleanColumnName(calculatedColumn),
          label: cleanColumnName(calculatedColumn),
          formula: node.details.formula,
        }];
      }
    }

    const kind: CompressedEntity['kind'] = layer === 'L3'
      ? 'fact'
      : layer === 'L4'
        ? 'analytic_model'
        : 'view';
    const output: CompressedEntity = {
      name: node.id,
      business_name: node.reason || node.id,
      kind,
      fields: outputFields,
      sources: [...node.inputs],
      joins,
      calculatedFields,
      filters: node.details?.condition ? [node.details.condition] : [],
      groupBy: kind === 'analytic_model' ? [...plan.dimensions] : [],
    };
    result.push(output);
    fieldsByNode.set(node.id, new Map(outputFields.map((field) => [field.name, field])));
  }

  return result;
}

import { CompressedEntity, isDeltaEntityName, isDeltaReference } from '../../utils/schemaCompressor';
import { Plan, PlanNode } from './types';

function safeNodeId(prefix: string, source: string): string {
  return `${prefix}_${source.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function planNodeLayer(node: PlanNode): string {
  if (node.layer) return node.layer.toUpperCase();
  const operation = node.operation.toLowerCase();
  if (operation === 'source') return 'L0';
  if (operation === 'analytic_model') return 'L4';
  if (operation === 'join' || operation === 'calculated_column') return 'L3';
  if (operation === 'projection' || operation === 'filter') {
    return node.is_existing ? 'L2' : 'L1';
  }
  return 'L2';
}

function isWrapperConfigurationNode(node: PlanNode): boolean {
  if (node.is_wrapper) return false;
  const layer = planNodeLayer(node);
  const operation = node.operation.toLowerCase();
  return (layer === 'L1' || layer === 'L2')
    && (operation === 'projection' || operation === 'filter')
    && node.inputs.length === 1;
}

function withWrapperLayer(plan: Plan, sourceEntities: CompressedEntity[]): Plan {
  const retainedPlanNodes = plan.nodes.filter((node) =>
    !isDeltaEntityName(node.id)
    && !(node.is_wrapper && node.inputs.some(isDeltaEntityName)),
  );
  const retainedEntities = sourceEntities.filter((entity) => !isDeltaEntityName(entity.name));
  const existingNodeIds = new Set(retainedPlanNodes.map((node) => node.id));
  const sourceNames = Array.from(new Set([
    ...retainedEntities.filter((entity) => entity.kind === 'table').map((entity) => entity.name),
    ...retainedPlanNodes.filter((node) => node.operation.toLowerCase() === 'source').map((node) => node.id),
    ...retainedPlanNodes.flatMap((node) => node.inputs.filter((input) =>
      !existingNodeIds.has(input) && !isDeltaEntityName(input),
    )),
  ]));
  const entityByName = new Map(retainedEntities.map((entity) => [entity.name, entity]));
  const existingWrappers = new Map<string, PlanNode>();
  retainedPlanNodes.filter((node) => node.is_wrapper).forEach((node) => {
    const source = node.inputs[0];
    if (source) existingWrappers.set(source, node);
  });
  const sourceColumns = new Map<string, string[]>(
    retainedPlanNodes
      .filter((node) => node.operation.toLowerCase() === 'source')
      .map((node) => [node.id, node.columns]),
  );
  const wrappers = new Map<string, PlanNode>();

  sourceNames.forEach((sourceName) => {
    const existingWrapper = existingWrappers.get(sourceName);
    const wrapperId = existingWrapper?.id || safeNodeId('WRAP', sourceName);
    const entity = entityByName.get(sourceName);
    const columns = entity?.fields.length
      ? entity.fields.map((field) => field.name)
      : sourceColumns.get(sourceName) || [];
    wrappers.set(sourceName, existingWrapper ? {
      ...existingWrapper,
      columns: existingWrapper.columns.length ? [...existingWrapper.columns] : [...columns],
      details: { ...existingWrapper.details },
      is_wrapper: true,
      is_projection_enabled: existingWrapper.is_projection_enabled || false,
      is_filter_enabled: existingWrapper.is_filter_enabled || Boolean(existingWrapper.details?.condition),
      layer: 'L1',
    } : {
      id: wrapperId,
      operation: 'projection',
      inputs: [sourceName],
      columns: [...columns],
      details: {},
      reason: `Relational Dataset wrapper over existing source ${sourceName}.`,
      is_existing: false,
      is_wrapper: true,
      is_projection_enabled: false,
      is_filter_enabled: false,
      layer: 'L1',
    });
  });

  const sourceNodeIds = new Set(
    retainedPlanNodes.filter((node) => node.operation.toLowerCase() === 'source').map((node) => node.id),
  );
  const sourceForInput = new Map<string, string>();
  sourceNames.forEach((sourceName) => {
    sourceForInput.set(sourceName, sourceName);
    const wrapperId = wrappers.get(sourceName)!.id;
    sourceForInput.set(wrapperId, sourceName);
  });

  const collapsedNodes = new Set<string>();
  const pendingConfigurationNodes = retainedPlanNodes.filter(isWrapperConfigurationNode);
  let madeProgress = true;
  while (pendingConfigurationNodes.length && madeProgress) {
    madeProgress = false;
    for (let index = pendingConfigurationNodes.length - 1; index >= 0; index -= 1) {
      const node = pendingConfigurationNodes[index];
      const sourceName = sourceForInput.get(node.inputs[0]);
      const wrapper = sourceName ? wrappers.get(sourceName) : undefined;
      if (!wrapper) continue;

      const operation = node.operation.toLowerCase();
      if (operation === 'projection') {
        const projected = new Set(node.columns.map((column) => column.split('.').pop() || column));
        if (projected.size) wrapper.columns = wrapper.columns.filter((column) => projected.has(column));
        wrapper.is_projection_enabled = true;
      } else {
        const condition = node.details?.condition?.trim();
        if (condition) {
          const previous = wrapper.details.condition?.trim();
          wrapper.details.condition = previous
            ? `(${previous}) AND (${condition})`
            : condition;
        }
        wrapper.is_filter_enabled = true;
      }

      wrapper.reason = `Relational Dataset wrapper over existing source ${sourceName}.`;
      collapsedNodes.add(node.id);
      sourceForInput.set(node.id, sourceName);
      pendingConfigurationNodes.splice(index, 1);
      madeProgress = true;
    }
  }

  const intermediateNodes = new Map(
    retainedPlanNodes
      .filter((node) =>
        !node.is_wrapper
        && !collapsedNodes.has(node.id)
        && node.operation.toLowerCase() !== 'source'
        && ['L1', 'L2'].includes(planNodeLayer(node)),
      )
      .map((node) => [node.id, node]),
  );
  const expandInput = (input: string, visited = new Set<string>()): string[] => {
    if (isDeltaEntityName(input)) return [];
    const wrapperId = resolveInputToWrapper(input);
    if (wrapperId) return [wrapperId];
    const intermediate = intermediateNodes.get(input);
    if (!intermediate || visited.has(input)) return [input];
    const nextVisited = new Set(visited).add(input);
    return intermediate.inputs.flatMap((upstream) => expandInput(upstream, nextVisited));
  };
  const resolveInputToWrapper = (input: string): string | undefined => {
    const sourceName = sourceForInput.get(input);
    return sourceName ? wrappers.get(sourceName)?.id : undefined;
  };
  const collectIntermediateJoins = (input: string, visited = new Set<string>()): string[][] => {
    const intermediate = intermediateNodes.get(input);
    if (!intermediate || visited.has(input)) return [];
    const nextVisited = new Set(visited).add(input);
    return [
      ...(intermediate.details?.on || []),
      ...intermediate.inputs.flatMap((upstream) => collectIntermediateJoins(upstream, nextVisited)),
    ];
  };
  const collectIntermediateJoinType = (input: string, visited = new Set<string>()): string | undefined => {
    const intermediate = intermediateNodes.get(input);
    if (!intermediate || visited.has(input)) return undefined;
    if (intermediate.operation.toLowerCase() === 'join' && intermediate.details?.join_type) {
      return intermediate.details.join_type;
    }
    const nextVisited = new Set(visited).add(input);
    for (const upstream of intermediate.inputs) {
      const joinType = collectIntermediateJoinType(upstream, nextVisited);
      if (joinType) return joinType;
    }
    return undefined;
  };

  const preserveQualifiedReferences = (expression?: string): void => {
    if (!expression) return;
    expression.replace(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g, (_match, qualifier: string, column: string) => {
      const sourceName = sourceForInput.get(qualifier);
      const wrapper = sourceName ? wrappers.get(sourceName) : undefined;
      if (wrapper && !wrapper.columns.includes(column)) wrapper.columns.push(column);
      return _match;
    });
  };
  retainedPlanNodes.forEach((node) => {
    node.details?.on?.forEach((pair) => pair.forEach((reference) => {
      const separator = reference.lastIndexOf('.');
      if (separator > 0) {
        const qualifier = reference.slice(0, separator);
        const column = reference.slice(separator + 1);
        const sourceName = sourceForInput.get(qualifier);
        const wrapper = sourceName ? wrappers.get(sourceName) : undefined;
        if (wrapper && !wrapper.columns.includes(column)) wrapper.columns.push(column);
      }
    }));
    preserveQualifiedReferences(node.details?.condition);
    preserveQualifiedReferences(node.details?.formula);
  });

  const resolveWrapperId = (id: string): string | undefined => {
    const sourceName = sourceForInput.get(id);
    return sourceName ? wrappers.get(sourceName)?.id : undefined;
  };
  const rewire = (reference: string): string => {
    const separator = reference.lastIndexOf('.');
    if (separator === -1) return resolveWrapperId(reference) || reference;
    const qualifier = reference.slice(0, separator);
    const wrapperId = resolveWrapperId(qualifier);
    if (wrapperId) {
      return `${wrapperId}.${reference.slice(separator + 1)}`;
    }
    return reference;
  };
  const rewireExpression = (expression?: string): string | undefined =>
    expression?.replace(
      /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g,
      (match, qualifier: string, column: string) =>
        `${resolveWrapperId(qualifier) || qualifier}.${column}`,
    );

  const nodes = retainedPlanNodes
    .filter((node) => {
      if (node.is_wrapper || collapsedNodes.has(node.id)) return false;
      return !['L1', 'L2'].includes(planNodeLayer(node));
    })
    .map((node) => {
      if (node.operation.toLowerCase() === 'source') {
        return { ...node, layer: 'L0' };
      }
      return {
        ...node,
        inputs: Array.from(new Set(node.inputs
          .filter((input) => !isDeltaEntityName(input))
          .flatMap((input) => expandInput(input)))),
        details: {
          ...node.details,
          join_type: node.details?.join_type
            || node.inputs.map((input) => collectIntermediateJoinType(input)).find(Boolean),
          on: [
            ...(node.details?.on || []),
            ...node.inputs.flatMap((input) => collectIntermediateJoins(input)),
          ]
            .filter((pair) => !pair.some(isDeltaReference))
            .map((pair) => pair.map(rewire)),
          condition: rewireExpression(node.details?.condition),
          formula: rewireExpression(node.details?.formula),
        },
      };
    });
  const sourceNodes = nodes.filter((node) => sourceNodeIds.has(node.id));
  const otherNodes = nodes.filter((node) => !sourceNodeIds.has(node.id));
  return { ...plan, nodes: [...sourceNodes, ...Array.from(wrappers.values()), ...otherNodes] };
}

export function preparePlanPipeline(plan: Plan, sourceEntities: CompressedEntity[]): Plan {
  return withWrapperLayer(plan, sourceEntities);
}

export function getNodeInputFields(
  node: PlanNode,
  plan: Plan,
  sourceEntities: CompressedEntity[],
): string[] {
  const input = node.inputs[0];
  if (!input) return [];
  const inputNode = plan.nodes.find((candidate) => candidate.id === input);
  if (inputNode) return inputNode.columns;
  return sourceEntities.find((entity) => entity.name === input)?.fields.map((field) => field.name) || [];
}

export function getRequiredNodeColumns(node: PlanNode, plan: Plan): string[] {
  const downstream = plan.nodes.filter((candidate) =>
    candidate.id !== node.id && candidate.inputs.includes(node.id),
  );
  const required = new Set<string>();
  downstream.forEach((candidate) => {
    if (candidate.operation.toLowerCase() !== 'filter') {
      candidate.columns.forEach((column) => {
        if (node.columns.includes(column)) required.add(column);
      });
    }
    const expressions = [candidate.details?.condition, candidate.details?.formula]
      .filter((expression): expression is string => Boolean(expression));
    expressions.forEach((expression) => {
      expression.match(/[A-Za-z_][A-Za-z0-9_]*/g)?.forEach((identifier) => {
        if (node.columns.includes(identifier)) required.add(identifier);
      });
    });
    candidate.details?.on?.forEach((pair) => {
      pair.forEach((reference) => {
        const [qualifier, column] = reference.split('.');
        if ((qualifier === node.id || candidate.inputs.includes(node.id)) && node.columns.includes(column)) {
          required.add(column);
        }
      });
    });
  });
  return Array.from(required);
}

export function addPlanTransform(
  plan: Plan,
  sourceNode: PlanNode,
  operation: 'projection' | 'filter',
): { plan: Plan; node: PlanNode } {
  if (!sourceNode.is_wrapper) {
    throw new Error('Projection and filter options are available on source wrapper datasets.');
  }

  const node: PlanNode = operation === 'projection'
    ? { ...sourceNode, is_projection_enabled: true }
    : { ...sourceNode, is_filter_enabled: true };
  const updatedPlan = {
    ...plan,
    nodes: plan.nodes.map((candidate) => candidate.id === sourceNode.id ? node : candidate),
  };
  return { plan: updatedPlan, node };
}

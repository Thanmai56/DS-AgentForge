import { CompressedEntity, isDeltaEntityName, isDeltaReference } from '../../utils/schemaCompressor';
import { getNodeConditions, getNodeFormulas, Plan, PlanNode } from './types';

function safeNodeId(prefix: string, source: string): string {
  return `${prefix}_${source.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function resolveUploadedSourceName(
  sourceName: string,
  sourceEntities: CompressedEntity[],
): string {
  const exactMatch = sourceEntities.find((entity) => entity.name === sourceName);
  if (exactMatch) return exactMatch.name;

  const layerSourceMatch = sourceName.match(/^L0_(.+)$/i);
  if (!layerSourceMatch) return sourceName;

  const sourceCandidate = layerSourceMatch[1];
  const exactCandidate = sourceEntities.find((entity) =>
    entity.name === sourceCandidate
    || entity.name.split('.').pop() === sourceCandidate,
  );
  if (exactCandidate) return exactCandidate.name;

  const normalize = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normalizedCandidate = normalize(sourceCandidate);
  const normalizedMatches = sourceEntities.filter((entity) =>
    normalize(entity.name) === normalizedCandidate
    || normalize(entity.name.split('.').pop() || entity.name) === normalizedCandidate,
  );
  return normalizedMatches.length === 1 ? normalizedMatches[0].name : sourceCandidate;
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

function withNormalizedRules(node: PlanNode): PlanNode {
  const conditions = getNodeConditions(node);
  const formulas = getNodeFormulas(node);
  return {
    ...node,
    details: {
      ...node.details,
      conditions,
      filters: conditions,
      formulas,
    },
  };
}

function retainOutputDependencies(nodes: PlanNode[]): PlanNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const consumers = new Set(nodes.flatMap((node) => node.inputs));
  const analyticModels = nodes.filter((node) => node.operation.toLowerCase() === 'analytic_model');
  const roots = analyticModels.length > 0
    ? analyticModels
    : nodes.filter((node) =>
        node.operation.toLowerCase() !== 'source' && !consumers.has(node.id),
      );
  if (roots.length === 0) return nodes;

  const requiredIds = new Set<string>();
  const visit = (node: PlanNode) => {
    if (requiredIds.has(node.id)) return;
    requiredIds.add(node.id);
    node.inputs.forEach((input) => {
      const dependency = nodeById.get(input);
      if (dependency) visit(dependency);
    });
  };
  roots.forEach(visit);
  return nodes.filter((node) => requiredIds.has(node.id));
}

function withWrapperLayer(plan: Plan, sourceEntities: CompressedEntity[]): Plan {
  const uploadedSources = sourceEntities.filter((entity) => entity.kind === 'table');
  const originalSourceNodeIds = new Set(
    plan.nodes
      .filter((node) => node.operation.toLowerCase() === 'source')
      .map((node) => node.id),
  );
  const sourceNameById = new Map<string, string>();
  originalSourceNodeIds.forEach((sourceId) => {
    sourceNameById.set(sourceId, resolveUploadedSourceName(sourceId, uploadedSources));
  });

  const resolveSourceReference = (reference: string): string => {
    const separator = reference.lastIndexOf('.');
    const qualifier = separator === -1 ? reference : reference.slice(0, separator);
    const field = separator === -1 ? '' : reference.slice(separator + 1);
    const sourceName = sourceNameById.get(qualifier)
      || resolveUploadedSourceName(qualifier, uploadedSources);
    return sourceName === qualifier
      ? reference
      : field ? `${sourceName}.${field}` : sourceName;
  };

  const normalizedNodes = plan.nodes.map((rawNode) => {
    const node = withNormalizedRules(rawNode);
    if (node.operation.toLowerCase() === 'source') {
      const sourceName = sourceNameById.get(node.id) || node.id;
      return { ...node, id: sourceName };
    }

    const inputs = node.inputs.map((input) => {
      if (originalSourceNodeIds.has(input)) return sourceNameById.get(input) || input;
      if (plan.nodes.some((candidate) => candidate.id === input)) return input;
      return resolveUploadedSourceName(input, uploadedSources);
    });
    return {
      ...node,
      inputs,
      details: {
        ...node.details,
        on: node.details?.on?.map((pair) => pair.map(resolveSourceReference)),
        condition: node.details?.condition?.replace(
          /([A-Za-z_][A-Za-z0-9_.]*)\.([A-Za-z_][A-Za-z0-9_]*)/g,
          (reference) => resolveSourceReference(reference),
        ),
        formula: node.details?.formula?.replace(
          /([A-Za-z_][A-Za-z0-9_.]*)\.([A-Za-z_][A-Za-z0-9_]*)/g,
          (reference) => resolveSourceReference(reference),
        ),
        conditions: getNodeConditions(node).map((condition) => condition.replace(
          /([A-Za-z_][A-Za-z0-9_.]*)\.([A-Za-z_][A-Za-z0-9_]*)/g,
          (reference) => resolveSourceReference(reference),
        )),
        filters: getNodeConditions(node).map((condition) => condition.replace(
          /([A-Za-z_][A-Za-z0-9_.]*)\.([A-Za-z_][A-Za-z0-9_]*)/g,
          (reference) => resolveSourceReference(reference),
        )),
        formulas: getNodeFormulas(node).map((formula) => formula.replace(
          /([A-Za-z_][A-Za-z0-9_.]*)\.([A-Za-z_][A-Za-z0-9_]*)/g,
          (reference) => resolveSourceReference(reference),
        )),
      },
    };
  });
  const normalizedSourceEntities = sourceEntities.map((entity) => ({
    ...entity,
    name: entity.kind === 'table'
      ? resolveUploadedSourceName(entity.name, uploadedSources)
      : entity.name,
  }));

  const retainedPlanNodes = retainOutputDependencies(normalizedNodes.filter((node) =>
    !isDeltaEntityName(node.id)
    && !(node.is_wrapper && node.inputs.some(isDeltaEntityName)),
  ));
  const retainedEntities = normalizedSourceEntities.filter((entity) => !isDeltaEntityName(entity.name));
  const existingNodeIds = new Set(retainedPlanNodes.map((node) => node.id));
  const sourceNames = Array.from(new Set([
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
      is_filter_enabled: existingWrapper.is_filter_enabled || getNodeConditions(existingWrapper).length > 0,
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
        const conditions = getNodeConditions(node);
        if (conditions.length) {
          const previous = getNodeConditions(wrapper);
          const combined = [...previous, ...conditions]
            .filter((condition, index, values) => values.indexOf(condition) === index);
          wrapper.details.condition = combined.join(' AND ');
          wrapper.details.conditions = combined;
          wrapper.details.filters = combined;
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

  const preserveSelectedSourceColumns = (node: PlanNode): void => {
    if (node.is_wrapper || isWrapperConfigurationNode(node)) return;

    for (const columnReference of node.columns) {
      const separator = columnReference.lastIndexOf('.');
      const qualifier = separator >= 0 ? columnReference.slice(0, separator) : undefined;
      const column = columnReference.split('.').pop() || columnReference;
      const qualifiedSource = qualifier ? sourceForInput.get(qualifier) : undefined;

      const candidateSources = qualifiedSource
        ? [qualifiedSource]
        : Array.from(new Set(node.inputs
            .map((input) => sourceForInput.get(input))
            .filter((sourceName): sourceName is string => Boolean(sourceName))))
            .filter((sourceName) =>
              entityByName.get(sourceName)?.fields.some((field) => field.name === column),
            );

      if (candidateSources.length !== 1) continue;

      const sourceName = candidateSources[0];
      const entity = entityByName.get(sourceName);
      const wrapper = wrappers.get(sourceName);
      if (
        entity?.fields.some((field) => field.name === column)
        && wrapper
        && !wrapper.columns.includes(column)
      ) {
        wrapper.columns.push(column);
      }
    }
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
    getNodeConditions(node).forEach(preserveQualifiedReferences);
    getNodeFormulas(node).forEach(preserveQualifiedReferences);
    node.calculated_fields?.forEach((field) => preserveQualifiedReferences(field.formula));
    preserveSelectedSourceColumns(node);
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
          condition: rewireExpression(getNodeConditions(node).join(' AND ')),
          conditions: getNodeConditions(node).map((condition) => rewireExpression(condition) || condition),
          filters: getNodeConditions(node).map((condition) => rewireExpression(condition) || condition),
          formula: rewireExpression(getNodeFormulas(node)[0]),
          formulas: getNodeFormulas(node).map((formula) => rewireExpression(formula) || formula),
        },
        calculated_fields: node.calculated_fields?.map((field) => ({
          ...field,
          formula: rewireExpression(field.formula) || field.formula,
        })),
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
  getNodeConditions(node).forEach((condition) => {
    condition.match(/[A-Za-z_][A-Za-z0-9_]*/g)?.forEach((identifier) => {
      if (node.columns.includes(identifier)) required.add(identifier);
    });
  });
  downstream.forEach((candidate) => {
    if (candidate.operation.toLowerCase() !== 'filter') {
      candidate.columns.forEach((column) => {
        if (node.columns.includes(column)) required.add(column);
      });
    }
    const expressions = [
      ...getNodeConditions(candidate),
      ...getNodeFormulas(candidate),
    ];
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

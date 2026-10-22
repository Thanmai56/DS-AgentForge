// src/utils/schemaCompressor.ts
// Intelligent schema parser and compressor for SAP Datasphere CSN 2.0 & JSON table schemas.
// Extracts only essential modeling fields, strips internal CDS annotations, and infers lineage dependencies.

export interface CompressedField {
  name: string;
  data_type: string;
  is_key: boolean;
  label: string;
  semantic_role: 'key' | 'dimension' | 'measure' | 'date';
  aggregation?: string;
  source?: string;
}

export interface CompressedEntity {
  name: string;
  business_name: string;
  kind: 'table' | 'view' | 'fact' | 'analytic_model';
  fields: CompressedField[];
  sources: string[];
  joins?: Array<{
    leftSource: string;
    rightSource: string;
    leftField: string;
    rightField: string;
    joinType?: string;
  }>;
  calculatedFields?: Array<{
    name: string;
    label: string;
    formula?: string;
  }>;
  filters?: string[];
  groupBy?: string[];
}

const isTestPlaceholder = (name: string) => name.trim().toUpperCase() === 'TEST';

export const isDeltaEntityName = (name: string): boolean =>
  /(?:^|[_-])DELTA$/i.test(name.trim().split('.').pop() || name.trim());

export const isDeltaReference = (reference: string): boolean => {
  const separator = reference.lastIndexOf('.');
  return isDeltaEntityName(separator >= 0 ? reference.slice(0, separator) : reference);
};

function declaredDeltaEntities(definitions: Record<string, any>): Set<string> {
  const deltaNames = new Set<string>();
  Object.values(definitions).forEach((value) => {
    if (!value || typeof value !== 'object') return;
    const delta = value['@DataWarehouse.delta'];
    const references = [
      ...(Array.isArray(delta?.deltaFromEntities) ? delta.deltaFromEntities : []),
      ...(typeof delta?.deltaFromEntities === 'string' ? [delta.deltaFromEntities] : []),
      ...(Array.isArray(value['@DataWarehouse.delta.deltaFromEntities'])
        ? value['@DataWarehouse.delta.deltaFromEntities']
        : []),
      ...(typeof value['@DataWarehouse.delta.deltaFromEntities'] === 'string'
        ? [value['@DataWarehouse.delta.deltaFromEntities']]
        : []),
    ];
    references.forEach((reference) => {
      if (typeof reference === 'string') {
        deltaNames.add(reference.split('.').pop()!.toLowerCase());
      }
    });
  });
  return deltaNames;
}

export function compressAndExtractSchema(rawInput: any): CompressedEntity[] {
  if (!rawInput) return [];

  let data = rawInput;
  if (typeof rawInput === 'string') {
    try {
      data = JSON.parse(rawInput);
    } catch {
      return [];
    }
  }

  const results: CompressedEntity[] = [];

  // Helper to extract fields from CDS elements or standard columns
  const extractFields = (elements: any): CompressedField[] => {
    if (!elements) return [];
    const fields: CompressedField[] = [];

    if (Array.isArray(elements)) {
      for (const col of elements) {
        if (!col || typeof col !== 'object') continue;
        const name = col.name || col.column_name || 'COL';
        if (isTestPlaceholder(name)) continue;
        const dt = col.data_type || col.type || 'NVARCHAR(255)';
        const isKey = Boolean(col.is_key || col.key || name.toUpperCase().endsWith('_ID'));
        const label = col.label || col.business_name || col['@EndUserText.label'] || name;
        const role = col.semantic_role || (isKey ? 'key' : dt.toUpperCase().includes('DECIMAL') || dt.toUpperCase().includes('INT') ? 'measure' : dt.toUpperCase().includes('DATE') ? 'date' : 'dimension');

        fields.push({
          name,
          data_type: dt,
          is_key: isKey,
          label,
          semantic_role: role,
          aggregation: col.aggregation,
          source: col.source,
        });
      }
      return fields;
    }

    if (typeof elements === 'object') {
      for (const [colName, colDef] of Object.entries(elements)) {
        if (!colDef || typeof colDef !== 'object') continue;
        const def = colDef as any;
        if (isTestPlaceholder(colName)) continue;

        const nativeType = def['@DataWarehouse.native.dataType'] || def.type || 'cds.String';
        let dt = nativeType;
        if (def.length) dt = `${nativeType}(${def.length})`;
        else if (def.precision && def.scale) dt = `${nativeType}(${def.precision},${def.scale})`;

        const isKey = Boolean(def.key);
        const label = def['@EndUserText.label'] || colName;
        const isMeasure = Boolean(def['@Analytics.measure'] || def.aggregation || dt.toUpperCase().includes('DECIMAL'));
        const isDate = dt.toUpperCase().includes('DATE') || dt.toUpperCase().includes('TIME');
        const role = isKey ? 'key' : isMeasure ? 'measure' : isDate ? 'date' : 'dimension';

        fields.push({
          name: colName,
          data_type: dt,
          is_key: isKey,
          label,
          semantic_role: role,
          aggregation: def['@Aggregation.default']?.['#'] || def.aggregation,
          source: def.source,
        });
      }
    }

    return fields;
  };

  // Helper to extract upstream sources from CSN query
  const extractSourcesFromQuery = (query: any): string[] => {
    if (!query) return [];
    const sources: Set<string> = new Set();

    const recurseFrom = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.ref)) {
        const sourceName = String(node.ref[0] || '');
        if (!isDeltaEntityName(sourceName)) sources.add(sourceName);
      }
      if (node.from) recurseFrom(node.from);
      if (Array.isArray(node.args)) {
        node.args.forEach((a: any) => recurseFrom(a));
      }
      if (node.SELECT) recurseFrom(node.SELECT);
    };

    recurseFrom(query);
    return Array.from(sources);
  };

  // Case 1: CSN format with "definitions"
  if (data.definitions && typeof data.definitions === 'object') {
    const deltaNames = declaredDeltaEntities(data.definitions);
    for (const [entName, entDef] of Object.entries(data.definitions)) {
      if (!entDef || typeof entDef !== 'object') continue;
      if (
        isDeltaEntityName(entName)
        || deltaNames.has(entName.split('.').pop()!.toLowerCase())
      ) continue;
      const def = entDef as any;
      const label = def['@EndUserText.label'] || def.label || entName;
      const fields = extractFields(def.elements);
      const querySources = extractSourcesFromQuery(def.query);

      let kind: 'table' | 'view' | 'fact' | 'analytic_model' = 'view';
      if (entName.startsWith('AM_') || def.kind === 'analyticModel') {
        kind = 'analytic_model';
      } else if (entName.startsWith('F_') || def['@ObjectModel.modelingPattern']?.['#'] === 'FACT') {
        kind = 'fact';
      } else if (!def.query) {
        kind = 'table';
      }

      results.push({
        name: entName,
        business_name: label,
        kind,
        fields,
        sources: querySources,
      });
    }
    return results;
  }

  // Case 2: Array of table definitions
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const name = item.name || item.table_name || 'TABLE';
      if (isDeltaEntityName(name)) continue;
      const label = item.business_name || item.label || name;
      const fields = extractFields(item.columns || item.elements || item.fields);
      results.push({
        name,
        business_name: label,
        kind: 'table',
        fields,
        sources: [],
      });
    }
    return results;
  }

  // Case 3: Object with "tables" array
  if (data.tables && Array.isArray(data.tables)) {
    return compressAndExtractSchema(data.tables);
  }

  // Case 4: Single table object
  if (data.name && (data.columns || data.elements || data.fields)) {
    return compressAndExtractSchema([data]);
  }

  // Case 5: Map/Dictionary of tables (e.g. { "ORDERS": { "columns": [...] }, "CUSTOMERS": { ... } })
  if (typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data);
    const tableEntries = entries.filter(([name, value]: [string, any]) =>
      !isDeltaEntityName(name) && value && typeof value === 'object'
      && (value.columns || value.elements || value.fields),
    );
    if (tableEntries.length > 0) {
      for (const [tName, tDef] of tableEntries) {
        const def = tDef as any;
        results.push({
          name: tName,
          business_name: def.business_name || def.label || tName,
          kind: 'table',
          fields: extractFields(def.columns || def.elements || def.fields),
          sources: [],
        });
      }
      return results;
    }
  }

  return results;
}

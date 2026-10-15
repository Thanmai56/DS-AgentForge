export interface CsnDataType {
  type: string;
  length?: number;
  precision?: number;
  scale?: number;
  nativeDataType?: string;
}

const DEFAULT_STRING_LENGTH = 255;
const DEFAULT_DECIMAL_PRECISION = 31;
const DEFAULT_DECIMAL_SCALE = 10;

const CSN_TYPES: Record<string, string> = {
  string: 'cds.String',
  decimal: 'cds.Decimal',
  double: 'cds.Double',
  integer: 'cds.Integer',
  integer64: 'cds.Integer64',
  boolean: 'cds.Boolean',
  date: 'cds.Date',
  time: 'cds.Time',
  timestamp: 'cds.Timestamp',
  largestring: 'cds.LargeString',
  binary: 'cds.Binary',
  largebinary: 'cds.LargeBinary',
};

const STRING_TYPES = new Set(['NVARCHAR', 'VARCHAR', 'NCHAR', 'CHAR', 'ALPHANUM', 'NUMC']);
const BINARY_TYPES = new Set(['BINARY', 'VARBINARY']);

export function mapSourceDataType(dataType: string): CsnDataType {
  const match = dataType.trim().match(/^(cds\.)?([a-z]+)(?:\(\s*(\d+)(?:\s*,\s*(\d+))?\s*\))?$/i);
  if (!match) {
    throw new Error(`Unsupported source data type "${dataType}".`);
  }

  const [, cdsPrefix, rawName, firstParameter, secondParameter] = match;
  const name = rawName.toUpperCase();
  const isCdsType = Boolean(cdsPrefix);
  let type: string;
  let nativeDataType: string | undefined;

  if (!isCdsType && STRING_TYPES.has(name)) {
    type = 'cds.String';
    nativeDataType = name;
  } else if (!isCdsType && BINARY_TYPES.has(name)) {
    type = 'cds.Binary';
    nativeDataType = name;
  } else if (!isCdsType && (name === 'DECIMAL' || name === 'NUMERIC')) {
    type = 'cds.Decimal';
    nativeDataType = name === 'NUMERIC' ? 'DECIMAL' : name;
  } else if (!isCdsType && ['DOUBLE', 'FLOAT', 'REAL'].includes(name)) {
    type = 'cds.Double';
    nativeDataType = name;
  } else if (!isCdsType && ['INT', 'INTEGER', 'SMALLINT', 'TINYINT'].includes(name)) {
    type = 'cds.Integer';
    nativeDataType = name;
  } else if (!isCdsType && name === 'BIGINT') {
    type = 'cds.Integer64';
    nativeDataType = name;
  } else if (!isCdsType && ['DATE', 'TIME', 'TIMESTAMP', 'BOOLEAN'].includes(name)) {
    type = `cds.${name[0]}${name.slice(1).toLowerCase()}`;
    nativeDataType = name;
  } else {
    const cdsType = CSN_TYPES[name.toLowerCase()];
    if (!cdsType) {
      throw new Error(`Unsupported source data type "${dataType}".`);
    }
    type = cdsType;
  }

  const mapped: CsnDataType = { type };
  if (nativeDataType) mapped.nativeDataType = nativeDataType;

  if (firstParameter) {
    const firstValue = Number(firstParameter);
    if (type === 'cds.String' || type === 'cds.Binary') {
      mapped.length = firstValue;
    } else if (type === 'cds.Decimal') {
      mapped.precision = firstValue;
      if (secondParameter) mapped.scale = Number(secondParameter);
    }
  } else if (type === 'cds.String' || type === 'cds.Binary') {
    mapped.length = DEFAULT_STRING_LENGTH;
  } else if (type === 'cds.Decimal') {
    mapped.precision = DEFAULT_DECIMAL_PRECISION;
    mapped.scale = DEFAULT_DECIMAL_SCALE;
  }

  return mapped;
}

import { describe, expect, it } from 'vitest';
import { mapSourceDataType } from '../sourceDataType';

describe('mapSourceDataType', () => {
  it.each([
    ['NVARCHAR(3)', { type: 'cds.String', length: 3, nativeDataType: 'NVARCHAR' }],
    ['VARCHAR(40)', { type: 'cds.String', length: 40, nativeDataType: 'VARCHAR' }],
    ['NUMC(6)', { type: 'cds.String', length: 6, nativeDataType: 'NUMC' }],
    ['VARBINARY(16)', { type: 'cds.Binary', length: 16, nativeDataType: 'VARBINARY' }],
    ['BINARY(8)', { type: 'cds.Binary', length: 8, nativeDataType: 'BINARY' }],
    ['DECIMAL(13,3)', { type: 'cds.Decimal', precision: 13, scale: 3, nativeDataType: 'DECIMAL' }],
    ['DECIMAL(13,2)', { type: 'cds.Decimal', precision: 13, scale: 2, nativeDataType: 'DECIMAL' }],
    ['DECIMAL', { type: 'cds.Decimal', precision: 31, scale: 10, nativeDataType: 'DECIMAL' }],
    ['DOUBLE', { type: 'cds.Double', nativeDataType: 'DOUBLE' }],
    ['cds.Decimal(15,2)', { type: 'cds.Decimal', precision: 15, scale: 2 }],
    ['cds.Decimal', { type: 'cds.Decimal', precision: 31, scale: 10 }],
    ['cds.String', { type: 'cds.String', length: 255 }],
    ['cds.Integer', { type: 'cds.Integer' }],
  ])('maps %s to CSN type metadata', (sourceType, expected) => {
    expect(mapSourceDataType(sourceType)).toEqual(expected);
  });

  it('rejects unsupported types rather than exporting them as invalid CSN references', () => {
    expect(() => mapSourceDataType('UNKNOWN(5)')).toThrow('Unsupported source data type');
  });
});

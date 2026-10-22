import { describe, expect, it } from 'vitest';
import { CompressedEntity } from '../../../utils/schemaCompressor';
import {
  csnSourceAlias,
  quoteCsnSqlSource,
  resolveCsnSourceName,
} from '../sourceReference';

const supplier: CompressedEntity = {
  name: 'I_SUPPLIER',
  business_name: 'Supplier',
  kind: 'table',
  sources: [],
  fields: [],
};

describe('CSN source references', () => {
  it('qualifies a known source table immediately when a shared space is provided', () => {
    expect(resolveCsnSourceName('I_SUPPLIER', [supplier])).toBe('I_SUPPLIER');
    expect(resolveCsnSourceName('I_SUPPLIER', [supplier], 'RAD_S3P'))
      .toBe('RAD_S3P.I_SUPPLIER');
    expect(resolveCsnSourceName('I_SUPPLIER', [supplier], ' RAD_S3P '))
      .toBe('RAD_S3P.I_SUPPLIER');
  });

  it('does not qualify generated or unknown objects as shared source tables', () => {
    expect(resolveCsnSourceName('WRAP_I_SUPPLIER', [supplier], 'RAD_S3P'))
      .toBe('WRAP_I_SUPPLIER');
    expect(resolveCsnSourceName('OTHER_SOURCE', [supplier], 'RAD_S3P'))
      .toBe('OTHER_SOURCE');
  });

  it('preserves an existing qualified source name', () => {
    const qualifiedSupplier = { ...supplier, name: 'RAD_S3P.I_SUPPLIER' };
    expect(resolveCsnSourceName('I_SUPPLIER', [qualifiedSupplier], 'OTHER_SPACE'))
      .toBe('RAD_S3P.I_SUPPLIER');
  });

  it('uses the object leaf as the CSN alias and quotes qualified SQL identifiers separately', () => {
    expect(csnSourceAlias('RAD_S3P.I_SUPPLIER')).toBe('I_SUPPLIER');
    expect(quoteCsnSqlSource('RAD_S3P.I_SUPPLIER')).toBe('"RAD_S3P"."I_SUPPLIER"');
  });
});

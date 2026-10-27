import { describe, expect, it } from 'vitest';
import type { CsnToken } from '../../model/types';
import { CompressedEntity } from '../../../utils/schemaCompressor';
import {
  csnSourceAlias,
  quoteCsnSqlSource,
  resolveCsnFormulaReferences,
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

  it('resolves layer-qualified formula references to the actual source view aliases', () => {
    const formula: CsnToken[] = [{
      xpr: [
        'case',
        'when',
        { ref: ['L1_ZI_EKESS', 'Eindt'] },
        '<=',
        { ref: ['L1_C_PURCHASEORDERITEMDEX', 'OrderQuantity'] },
        'then',
        { val: 1 },
        'else',
        { val: 0 },
        'end',
      ],
    }];

    expect(resolveCsnFormulaReferences([...formula], [
      'WRAP_ZI_EKESS',
      'WRAP_C_PURCHASEORDERITEMDEX',
    ])).toEqual([{
      xpr: [
        'case',
        'when',
        { ref: ['WRAP_ZI_EKESS', 'Eindt'] },
        '<=',
        { ref: ['WRAP_C_PURCHASEORDERITEMDEX', 'OrderQuantity'] },
        'then',
        { val: 1 },
        'else',
        { val: 0 },
        'end',
      ],
    }]);
  });

  it('does not guess a source alias when normalized layer names are ambiguous', () => {
    const formula: CsnToken[] = [{ ref: ['L1_SOURCE', 'ID'] }];

    expect(resolveCsnFormulaReferences([...formula], ['WRAP_SOURCE', 'SOURCE']))
      .toEqual(formula);
  });
});

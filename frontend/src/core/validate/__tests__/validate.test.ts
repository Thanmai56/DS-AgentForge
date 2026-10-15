// src/core/validate/__tests__/validate.test.ts
// 25+ Vitest cases for the validation pipeline.

import { describe, it, expect } from 'vitest';
import { validateFormula } from '../index';

const FIELDS = ['Processing_Days', 'Total_Delivered_Order', 'Order_Creation_Date', 'Order_Delivery_Date', 'PURCHASEORDER', 'SUPPLIER'];
const FIELD_TYPES = new Map([
  ['PROCESSING_DAYS', 'cds.Integer'],
  ['TOTAL_DELIVERED_ORDER', 'cds.Integer'],
  ['ORDER_CREATION_DATE', 'cds.Date'],
  ['ORDER_DELIVERY_Date', 'cds.Date'],
  ['PURCHASEORDER', 'cds.String'],
  ['SUPPLIER', 'cds.String'],
]);

// ── Syntax errors ──────────────────────────────────────────────────────────────
describe('Syntax – unbalanced parentheses', () => {
  it('reports unclosed LPAREN', () => {
    const r = validateFormula('SUM(Processing_Days', { availableFields: FIELDS });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes('Unmatched opening parenthesis'))).toBe(true);
  });

  it('reports extra RPAREN', () => {
    const r = validateFormula('Processing_Days)', { availableFields: FIELDS });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes('Unmatched closing parenthesis'))).toBe(true);
  });

  it('nested parens balanced', () => {
    const r = validateFormula('ABS(ROUND(Processing_Days, 2))', { availableFields: FIELDS });
    expect(r.issues.filter(i => i.message.includes('parenthesis'))).toHaveLength(0);
  });

  it('double unbalanced', () => {
    const r = validateFormula('SUM(SUM(Processing_Days)', { availableFields: FIELDS });
    expect(r.ok).toBe(false);
  });
});

describe('Syntax – string literals', () => {
  it('detects unclosed string', () => {
    const r = validateFormula("CONCAT(PURCHASEORDER, 'abc", { availableFields: FIELDS });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes('Unclosed string'))).toBe(true);
  });

  it('closed string is fine', () => {
    const r = validateFormula("CONCAT(PURCHASEORDER, 'abc')", { availableFields: FIELDS });
    // No string-literal error
    expect(r.issues.filter(i => i.message.includes('Unclosed string'))).toHaveLength(0);
  });
});

describe('Syntax – dangling operators', () => {
  it('dangling plus at end', () => {
    const r = validateFormula('Processing_Days +', { availableFields: FIELDS });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes('Dangling operator'))).toBe(true);
  });

  it('dangling plus at start', () => {
    const r = validateFormula('+ Processing_Days', { availableFields: FIELDS });
    expect(r.ok).toBe(false);
  });

  it('unary minus is allowed', () => {
    const r = validateFormula('-Processing_Days', { availableFields: FIELDS });
    const dangles = r.issues.filter(i => i.message.includes('Dangling operator'));
    expect(dangles).toHaveLength(0);
  });

  it('consecutive operators', () => {
    const r = validateFormula('Processing_Days + + Total_Delivered_Order', { availableFields: FIELDS });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes('Consecutive operators'))).toBe(true);
  });

  it('empty function arg comma', () => {
    const r = validateFormula('ROUND(Processing_Days, , 2)', { availableFields: FIELDS });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes('Empty function argument'))).toBe(true);
  });
});

// ── Semantic checks ────────────────────────────────────────────────────────────
describe('Semantic – field resolution', () => {
  it('unknown field produces error', () => {
    const r = validateFormula('Unknown_Field / Total_Delivered_Order', { availableFields: FIELDS });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes("Unknown field 'Unknown_Field'"))).toBe(true);
  });

  it('suggests nearest match', () => {
    // Typo: Processing_Day -> Processing_Days
    const r = validateFormula('Processing_Day / Total_Delivered_Order', { availableFields: FIELDS });
    expect(r.ok).toBe(false);
    const issue = r.issues.find(i => i.message.includes('Processing_Day'));
    expect(issue?.message).toContain('Processing_Days');
  });

  it('known fields pass', () => {
    const r = validateFormula('Processing_Days / Total_Delivered_Order', { availableFields: FIELDS });
    expect(r.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    expect(r.ok).toBe(true);
  });

  it('function arg field is resolved', () => {
    const r = validateFormula('DAYS_BETWEEN(Order_Creation_Date, Order_Delivery_Date)', { availableFields: FIELDS });
    expect(r.ok).toBe(true);
  });
});

// ── Function allow-list ────────────────────────────────────────────────────────
describe('Functions – allow-list', () => {
  it('unknown function is rejected', () => {
    const r = validateFormula('MY_CUSTOM_FUNC(Processing_Days)', { availableFields: FIELDS });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes("Unknown function 'MY_CUSTOM_FUNC'"))).toBe(true);
  });

  it('allowed function passes', () => {
    const r = validateFormula('ROUND(Processing_Days, 2)', { availableFields: FIELDS });
    expect(r.issues.filter(i => i.severity === 'error' && i.message.includes('Unknown function'))).toHaveLength(0);
  });

  it('CASE is allowed as keyword', () => {
    const r = validateFormula(
      'CASE WHEN Processing_Days > 0 THEN Processing_Days ELSE 0 END',
      { availableFields: [...FIELDS, '0'] }
    );
    expect(r.issues.filter(i => i.message.includes("Unknown function 'CASE'"))).toHaveLength(0);
  });

  it('nested CASE passes', () => {
    const formula = `CASE WHEN Processing_Days > 0 THEN CASE WHEN Total_Delivered_Order > 0 THEN Processing_Days ELSE 0 END ELSE 0 END`;
    const r = validateFormula(formula, { availableFields: [...FIELDS] });
    expect(r.issues.filter(i => i.message.includes("Unknown function 'CASE'"))).toHaveLength(0);
  });

  it('COALESCE passes', () => {
    const r = validateFormula('COALESCE(Processing_Days, 0)', { availableFields: FIELDS });
    expect(r.ok).toBe(true);
  });

  it('DAYS_BETWEEN passes', () => {
    const r = validateFormula('DAYS_BETWEEN(Order_Creation_Date, Order_Delivery_Date)', { availableFields: FIELDS });
    expect(r.ok).toBe(true);
  });

  it('SUBSTRING passes', () => {
    const r = validateFormula('SUBSTRING(PURCHASEORDER, 1, 4)', { availableFields: FIELDS });
    expect(r.ok).toBe(true);
  });

  it('chained calls pass', () => {
    const r = validateFormula(
      "CONCAT(UPPER(PURCHASEORDER), '-', LOWER(SUPPLIER))",
      { availableFields: FIELDS }
    );
    expect(r.ok).toBe(true);
  });
});

// ── Type sanity ────────────────────────────────────────────────────────────────
describe('Type sanity – warnings', () => {
  it('date minus string produces warning', () => {
    const r = validateFormula(
      'Order_Creation_Date - PURCHASEORDER',
      { availableFields: FIELDS, fieldTypes: FIELD_TYPES }
    );
    expect(r.issues.some(i => i.severity === 'warning' && i.message.includes('type mismatch'))).toBe(true);
  });

  it('integer + integer produces no warning', () => {
    const r = validateFormula(
      'Processing_Days + Total_Delivered_Order',
      { availableFields: FIELDS, fieldTypes: FIELD_TYPES }
    );
    expect(r.issues.filter(i => i.severity === 'warning')).toHaveLength(0);
  });
});

// ── Valid complex formulas ─────────────────────────────────────────────────────
describe('Valid formulas', () => {
  it('APT formula is valid', () => {
    const r = validateFormula('Processing_Days / Total_Delivered_Order', { availableFields: FIELDS });
    expect(r.ok).toBe(true);
    expect(r.issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('DAYS_BETWEEN + 1 is valid', () => {
    const r = validateFormula('DAYS_BETWEEN(Order_Creation_Date, Order_Delivery_Date) + 1', { availableFields: FIELDS });
    expect(r.ok).toBe(true);
  });

  it('empty formula has no crash', () => {
    const r = validateFormula('', { availableFields: FIELDS });
    // Empty formula – no tokens, no errors from our layers
    expect(Array.isArray(r.issues)).toBe(true);
  });

  it('CAST expression', () => {
    const r = validateFormula('CAST(Processing_Days AS DECIMAL)', { availableFields: FIELDS });
    // CAST is in the allow-list; AS/DECIMAL are idents with no field check issue if fields empty
    expect(r.issues.filter(i => i.message.includes("Unknown function 'CAST'"))).toHaveLength(0);
  });
});

// src/core/validate/functions.config.ts
// Allow-list of Datasphere SQL functions.
// To add a function: just add its uppercase name here.

export const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  // Conditional
  'CASE',
  'COALESCE',
  'IFNULL',
  'NULLIF',
  // Math
  'ABS',
  'ROUND',
  'CEIL',
  'FLOOR',
  // Aggregates
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COUNT',
  // Date
  'DAYS_BETWEEN',
  'SECONDS_BETWEEN',
  'ADD_DAYS',
  'TO_DATE',
  // String
  'CONCAT',
  'SUBSTRING',
  'UPPER',
  'LOWER',
  // Conversion
  'TO_DECIMAL',
  'CAST',
]);

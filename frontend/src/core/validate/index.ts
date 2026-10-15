// src/core/validate/index.ts
// Main validation pipeline. No React imports.

import { tokenize } from './tokenizer';
import { ALLOWED_FUNCTIONS } from './functions.config';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  message: string;
  /** 1-based */
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function nearestMatch(name: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  let best = candidates[0], bestDist = levenshtein(name.toUpperCase(), best.toUpperCase());
  for (const c of candidates.slice(1)) {
    const d = levenshtein(name.toUpperCase(), c.toUpperCase());
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return bestDist <= 3 ? best : null;
}

// ── Layer 1: Syntax ────────────────────────────────────────────────────────────
function syntaxCheck(formula: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tokens = tokenize(formula);

  // Paren balance
  let depth = 0;
  let lastOpen: { line: number; col: number } | null = null;
  for (const t of tokens) {
    if (t.kind === 'LPAREN') { depth++; lastOpen = { line: t.line, col: t.col }; }
    if (t.kind === 'RPAREN') {
      if (depth === 0) {
        issues.push({ severity: 'error', message: 'Unmatched closing parenthesis', startLine: t.line, startCol: t.col, endLine: t.line, endCol: t.col + 1 });
      } else {
        depth--;
        if (depth === 0) lastOpen = null;
      }
    }
  }
  if (depth > 0 && lastOpen) {
    issues.push({ severity: 'error', message: `Unmatched opening parenthesis (${depth} unclosed)`, startLine: lastOpen.line, startCol: lastOpen.col, endLine: lastOpen.line, endCol: lastOpen.col + 1 });
  }

  // Unclosed string literal
  const raw = formula;
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "'" && !inString) { inString = true; continue; }
    if (raw[i] === "'" && inString) {
      if (raw[i + 1] === "'") { i++; continue; } // escaped
      inString = false;
    }
  }
  if (inString) {
    issues.push({ severity: 'error', message: 'Unclosed string literal', startLine: 1, startCol: raw.lastIndexOf("'") + 1, endLine: 1, endCol: raw.length + 1 });
  }

  // Dangling operators: formula starts/ends with binary op, or consecutive operators
  const opsOnly = tokens.filter(t => t.kind !== 'EOF');
  for (let i = 0; i < opsOnly.length; i++) {
    const t = opsOnly[i];
    if (t.kind !== 'OPERATOR') continue;
    const isBinary = ['+', '-', '*', '/', '||', '=', '<>', '!=', '<', '>', '<=', '>='].includes(t.value);
    if (!isBinary) continue;
    const prev = opsOnly[i - 1];
    const next = opsOnly[i + 1];
    if (!prev || prev.kind === 'LPAREN' || prev.kind === 'COMMA') {
      // unary minus is OK
      if (t.value === '-') continue;
      issues.push({ severity: 'error', message: `Dangling operator '${t.value}' at start of expression`, startLine: t.line, startCol: t.col, endLine: t.line, endCol: t.col + t.value.length });
    }
    if (!next || next.kind === 'RPAREN' || next.kind === 'COMMA' || next.kind === 'EOF') {
      issues.push({ severity: 'error', message: `Dangling operator '${t.value}' at end of expression`, startLine: t.line, startCol: t.col, endLine: t.line, endCol: t.col + t.value.length });
    }
    // Two consecutive binary operators
    if (prev && prev.kind === 'OPERATOR' && isBinary) {
      issues.push({ severity: 'error', message: `Consecutive operators '${prev.value}' and '${t.value}'`, startLine: t.line, startCol: t.col, endLine: t.line, endCol: t.col + t.value.length });
    }
  }

  // Empty function args: FUNC(,), FUNC(a,,b)
  for (let i = 0; i < opsOnly.length - 1; i++) {
    const t = opsOnly[i];
    const next = opsOnly[i + 1];
    // (,  -> empty first arg
    if (t.kind === 'LPAREN' && next && next.kind === 'COMMA') {
      issues.push({ severity: 'error', message: 'Empty function argument', startLine: next.line, startCol: next.col, endLine: next.line, endCol: next.col + 1 });
    }
    // ,, -> empty middle arg
    if (t.kind === 'COMMA' && next && next.kind === 'COMMA') {
      issues.push({ severity: 'error', message: 'Empty function argument', startLine: next.line, startCol: next.col, endLine: next.line, endCol: next.col + 1 });
    }
  }

  return issues;
}

// ── Layer 2: Semantic (field resolution) ───────────────────────────────────────
function semanticCheck(formula: string, availableFields: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tokens = tokenize(formula);
  const upperFields = new Set(availableFields.map(f => f.toUpperCase()));
  const keywords = new Set([
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL',
    'AS', 'BETWEEN', 'LIKE', 'TRUE', 'FALSE',
  ]);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'IDENT') continue;
    const upper = t.value.toUpperCase();

    // Skip keywords
    if (keywords.has(upper)) continue;

    // Skip function names (followed by LPAREN)
    const next = tokens[i + 1];
    if (next && next.kind === 'LPAREN') continue;

    // Skip if preceded by DOT (qualified ref)
    const prev = tokens[i - 1];
    if (prev && prev.kind === 'DOT') continue;

    // Field resolution
    if (!upperFields.has(upper)) {
      const suggestion = nearestMatch(t.value, availableFields);
      const hint = suggestion ? ` Did you mean '${suggestion}'?` : '';
      issues.push({
        severity: 'error',
        message: `Unknown field '${t.value}'.${hint}`,
        startLine: t.line,
        startCol: t.col,
        endLine: t.line,
        endCol: t.col + t.value.length,
      });
    }
  }

  return issues;
}

// ── Layer 3: Function allow-list ───────────────────────────────────────────────
function functionCheck(formula: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tokens = tokenize(formula);

  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (t.kind !== 'IDENT') continue;
    if (!next || next.kind !== 'LPAREN') continue;

    const upper = t.value.toUpperCase();
    // CASE is handled as keyword, not a real function call
    if (upper === 'CASE') continue;

    if (!ALLOWED_FUNCTIONS.has(upper)) {
      issues.push({
        severity: 'error',
        message: `Unknown function '${t.value}'. Not in Datasphere allow-list.`,
        startLine: t.line,
        startCol: t.col,
        endLine: t.line,
        endCol: t.col + t.value.length,
      });
    }
  }

  return issues;
}

// ── Layer 4: Light type sanity ──────────────────────────────────────────────────
// Maps field name -> type where we know it. Warns on obvious date-string mismatches.
function typeSanityCheck(
  formula: string,
  fieldTypes: Map<string, string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tokens = tokenize(formula);

  for (let i = 0; i < tokens.length - 2; i++) {
    const a = tokens[i];
    const op = tokens[i + 1];
    const b = tokens[i + 2];

    if (op.kind !== 'OPERATOR' || !['+', '-', '*', '/'].includes(op.value)) continue;
    if (a.kind !== 'IDENT' || b.kind !== 'IDENT') continue;

    const typeA = fieldTypes.get(a.value.toUpperCase()) ?? '';
    const typeB = fieldTypes.get(b.value.toUpperCase()) ?? '';
    const dateTypes = new Set(['cds.Date', 'DATE']);
    const strTypes = new Set(['cds.String', 'STRING']);

    if (
      (dateTypes.has(typeA) && strTypes.has(typeB)) ||
      (strTypes.has(typeA) && dateTypes.has(typeB))
    ) {
      issues.push({
        severity: 'warning',
        message: `Possible type mismatch: '${a.value}' (${typeA}) ${op.value} '${b.value}' (${typeB})`,
        startLine: op.line,
        startCol: op.col,
        endLine: op.line,
        endCol: op.col + 1,
      });
    }
  }

  return issues;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface ValidateOptions {
  /** Available field names for semantic resolution */
  availableFields?: string[];
  /** Map of fieldName(uppercase) -> cdsType for type sanity */
  fieldTypes?: Map<string, string>;
}

export function validateFormula(
  formula: string,
  opts: ValidateOptions = {},
): ValidationResult {
  const { availableFields = [], fieldTypes = new Map() } = opts;
  const issues: ValidationIssue[] = [
    ...syntaxCheck(formula),
    ...functionCheck(formula),
    ...semanticCheck(formula, availableFields),
    ...typeSanityCheck(formula, fieldTypes),
  ];

  return {
    ok: issues.every(i => i.severity !== 'error'),
    issues,
  };
}

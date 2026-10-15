// src/core/validate/tokenizer.ts
// Tokenizes SQL formula strings into a flat token list.

export type TokenKind =
  | 'IDENT'         // field name or keyword
  | 'NUMBER'
  | 'STRING'        // single-quoted literal
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'OPERATOR'      // +  -  *  /  =  <>  !=  <  >  <=  >=  ||
  | 'DOT'
  | 'EOF';

export interface Token {
  kind: TokenKind;
  value: string;
  /** 1-based line number */
  line: number;
  /** 1-based column number */
  col: number;
}

const OPERATOR_CHARS = new Set(['+', '-', '*', '/', '=', '<', '>', '!', '|']);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const col = () => i - lineStart + 1;
  const tok = (kind: TokenKind, value: string, startLine: number, startCol: number): Token =>
    ({ kind, value, line: startLine, col: startCol });

  while (i < input.length) {
    const ch = input[i];
    const startLine = line;
    const startCol = col();

    // Whitespace + newlines
    if (ch === '\n') {
      line++;
      lineStart = i + 1;
      i++;
      continue;
    }
    if (/\s/.test(ch)) { i++; continue; }

    // Single-line comment -- ... (skip to EOL)
    if (ch === '-' && input[i + 1] === '-') {
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }

    // String literal
    if (ch === "'") {
      let val = "'";
      i++;
      while (i < input.length) {
        if (input[i] === "'" && input[i + 1] === "'") { val += "''"; i += 2; continue; }
        if (input[i] === "'") { val += "'"; i++; break; }
        if (input[i] === '\n') { line++; lineStart = i + 1; }
        val += input[i++];
      }
      tokens.push(tok('STRING', val, startLine, startCol));
      continue;
    }

    // Number
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(input[i + 1] ?? ''))) {
      let val = '';
      while (i < input.length && /[\d.]/.test(input[i])) val += input[i++];
      tokens.push(tok('NUMBER', val, startLine, startCol));
      continue;
    }

    // Identifier / keyword
    if (/[A-Za-z_$]/.test(ch)) {
      let val = '';
      while (i < input.length && /[\w$]/.test(input[i])) val += input[i++];
      tokens.push(tok('IDENT', val, startLine, startCol));
      continue;
    }

    // Parentheses + special single chars
    if (ch === '(') { tokens.push(tok('LPAREN', '(', startLine, startCol)); i++; continue; }
    if (ch === ')') { tokens.push(tok('RPAREN', ')', startLine, startCol)); i++; continue; }
    if (ch === ',') { tokens.push(tok('COMMA', ',', startLine, startCol)); i++; continue; }
    if (ch === '.') { tokens.push(tok('DOT', '.', startLine, startCol)); i++; continue; }

    // Operators (including || for concat)
    if (OPERATOR_CHARS.has(ch)) {
      let val = ch;
      i++;
      // Two-char ops: <>, !=, <=, >=, ||
      if (i < input.length) {
        const two = val + input[i];
        if (['<>', '!=', '<=', '>=', '||'].includes(two)) { val = two; i++; }
      }
      tokens.push(tok('OPERATOR', val, startLine, startCol));
      continue;
    }

    // Unknown char – emit as IDENT to let higher layers report the error
    tokens.push(tok('IDENT', ch, startLine, startCol));
    i++;
  }

  tokens.push({ kind: 'EOF', value: '', line, col: col() });
  return tokens;
}

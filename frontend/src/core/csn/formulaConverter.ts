// src/core/csn/formulaConverter.ts
// Converts a validated SQL formula string -> CSN xpr/ref/func/val token array.
// No React imports.

import { tokenize, type Token, type TokenKind } from '../validate/tokenizer';
import type { CsnToken } from '../model/types';

type Ctx = { tokens: Token[]; pos: number };

function peek(ctx: Ctx): Token { return ctx.tokens[ctx.pos]; }
function consume(ctx: Ctx): Token { return ctx.tokens[ctx.pos++]; }
function atEnd(ctx: Ctx): boolean { return peek(ctx).kind === 'EOF'; }

// ── Top-level ──────────────────────────────────────────────────────────────────
export function formulaToCsn(formula: string): CsnToken[] {
  const tokens = tokenize(formula);
  const ctx: Ctx = { tokens, pos: 0 };
  const result = parseExpr(ctx);
  return result;
}

// ── Expression parser (handles binary operators at top level) ──────────────────
function parseExpr(ctx: Ctx): CsnToken[] {
  const left = parsePrimary(ctx);
  const t = peek(ctx);
  if (t.kind === 'OPERATOR' || (t.kind === 'IDENT' && ['AND', 'OR', 'NOT'].includes(t.value.toUpperCase()))) {
    const op = consume(ctx).value;
    const right = parseExpr(ctx);
    // Flatten xpr if already an xpr array
    const leftFlat = left.length === 1 ? left : [{ xpr: left } as CsnToken];
    const rightFlat = right.length === 1 ? right : [{ xpr: right } as CsnToken];
    return [...leftFlat, op, ...rightFlat];
  }
  return left;
}

// ── Primary expression ─────────────────────────────────────────────────────────
function parsePrimary(ctx: Ctx): CsnToken[] {
  const t = peek(ctx);

  // Parenthesised expression
  if (t.kind === 'LPAREN') {
    consume(ctx); // (
    const inner = parseExpr(ctx);
    consume(ctx); // )
    return [{ xpr: inner }];
  }

  // String literal
  if (t.kind === 'STRING') {
    consume(ctx);
    const stripped = t.value.slice(1, -1).replace(/''/g, "'");
    return [{ val: stripped }];
  }

  // Number literal
  if (t.kind === 'NUMBER') {
    consume(ctx);
    return [{ val: Number(t.value) }];
  }

  // Identifier – could be: keyword CASE, function call, or field reference
  if (t.kind === 'IDENT') {
    const upper = t.value.toUpperCase();

    // CASE WHEN ... THEN ... [ELSE ...] END
    if (upper === 'CASE') {
      return parseCase(ctx);
    }

    // Unary minus handled above in parseExpr via OPERATOR branch, but guard here
    // Function call: IDENT followed by LPAREN
    const next = ctx.tokens[ctx.pos + 1];
    if (next && next.kind === 'LPAREN') {
      return parseFunction(ctx);
    }

    // Field reference (possibly qualified: ALIAS.FIELD)
    consume(ctx);
    if (peek(ctx).kind === 'DOT') {
      consume(ctx); // dot
      const field = consume(ctx);
      return [{ ref: [t.value, field.value] }];
    }
    return [{ ref: [t.value] }];
  }

  // Unary minus
  if (t.kind === 'OPERATOR' && t.value === '-') {
    consume(ctx);
    const operand = parsePrimary(ctx);
    return ['-', ...operand];
  }

  // Fallback – emit as string operator token
  consume(ctx);
  return [t.value];
}

// ── Function call ──────────────────────────────────────────────────────────────
function parseFunction(ctx: Ctx): CsnToken[] {
  const name = consume(ctx).value.toUpperCase(); // function name
  consume(ctx); // LPAREN
  const args: CsnToken[] = [];

  while (!atEnd(ctx) && peek(ctx).kind !== 'RPAREN') {
    if (peek(ctx).kind === 'COMMA') { consume(ctx); continue; }
    const argTokens = parseExpr(ctx);
    // Wrap multi-token args in xpr
    if (argTokens.length === 1) {
      args.push(argTokens[0]);
    } else {
      args.push({ xpr: argTokens });
    }
  }
  if (!atEnd(ctx)) consume(ctx); // RPAREN

  return [{ func: name, args }];
}

// ── CASE expression ────────────────────────────────────────────────────────────
function parseCase(ctx: Ctx): CsnToken[] {
  consume(ctx); // CASE
  const xpr: CsnToken[] = ['case'];

  while (!atEnd(ctx)) {
    const t = peek(ctx);
    if (t.kind === 'IDENT' && t.value.toUpperCase() === 'WHEN') {
      consume(ctx);
      xpr.push('when');
      const cond = parseExpr(ctx);
      xpr.push(...cond);
      // THEN
      if (peek(ctx).kind === 'IDENT') { consume(ctx); }
      xpr.push('then');
      const thenVal = parseExpr(ctx);
      xpr.push(...thenVal);
    } else if (t.kind === 'IDENT' && t.value.toUpperCase() === 'ELSE') {
      consume(ctx);
      xpr.push('else');
      const elseVal = parseExpr(ctx);
      xpr.push(...elseVal);
    } else if (t.kind === 'IDENT' && t.value.toUpperCase() === 'END') {
      consume(ctx);
      xpr.push('end');
      break;
    } else {
      break;
    }
  }

  return [{ xpr }];
}

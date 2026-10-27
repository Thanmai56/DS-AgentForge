// src/core/csn/formulaConverter.ts
// Converts a validated SQL formula string into CSN xpr/ref/func/val tokens.
// Preserves the formula's operators and business logic.
// No React imports.

import { tokenize, type Token } from '../validate/tokenizer';
import type { CsnToken } from '../model/types';

type Ctx = {
  tokens: Token[];
  pos: number;
};

function peek(ctx: Ctx): Token {
  return ctx.tokens[ctx.pos];
}

function consume(ctx: Ctx): Token {
  return ctx.tokens[ctx.pos++];
}

function atEnd(ctx: Ctx): boolean {
  return peek(ctx).kind === 'EOF';
}

function isKeyword(token: Token, ...keywords: string[]): boolean {
  return (
    token.kind === 'IDENT' &&
    keywords.includes(token.value.toUpperCase())
  );
}

function isComparisonOperator(token: Token): boolean {
  return (
    token.kind === 'OPERATOR' ||
    isKeyword(token, 'IS', 'IN', 'LIKE', 'BETWEEN')
  );
}

function precedence(operator: string): number {
  switch (operator.toUpperCase()) {
    case 'OR':
      return 1;

    case 'AND':
      return 2;

    case '=':
    case '<>':
    case '!=':
    case '<':
    case '>':
    case '<=':
    case '>=':
    case 'IS':
    case 'IS NOT':
    case 'IN':
    case 'NOT IN':
    case 'LIKE':
    case 'NOT LIKE':
    case 'BETWEEN':
      return 3;

    case '||':
      return 4;

    case '+':
    case '-':
      return 5;

    case '*':
    case '/':
    case '%':
      return 6;

    default:
      return -1;
  }
}

// ── Top-level ────────────────────────────────────────────────────────────────

export function formulaToCsn(formula: string): CsnToken[] {
  const tokens = tokenize(formula);
  const ctx: Ctx = { tokens, pos: 0 };

  const result = parseExpr(ctx, 0);

  if (!atEnd(ctx)) {
    throw new Error(
      `Invalid formula "${formula}": unexpected token "${peek(ctx).value}".`,
    );
  }

  validateTokens(result, formula);

  return result;
}

// ── Expression parser ────────────────────────────────────────────────────────
// Uses precedence climbing so AND/OR and arithmetic expressions are grouped
// according to their operators instead of consuming the entire right side.

function parseExpr(ctx: Ctx, minPrecedence: number): CsnToken[] {
  let left = parsePrimary(ctx);

  while (!atEnd(ctx)) {
    const operatorInfo = readOperator(ctx);

    if (!operatorInfo) {
      break;
    }

    const { operator, precedence: operatorPrecedence, tokenCount } =
      operatorInfo;

    if (operatorPrecedence < minPrecedence) {
      break;
    }

    for (let i = 0; i < tokenCount; i++) {
      consume(ctx);
    }

    // IS [NOT] NULL is treated as a complete comparison.
    if (
      (operator === 'IS' || operator === 'IS NOT') &&
      isKeyword(peek(ctx), 'NULL')
    ) {
      const nullToken = consume(ctx);

      left = [
        ...wrapExpression(left),
        operator.toLowerCase(),
        { val: nullToken.value.toUpperCase() === 'NULL' ? null : null },
      ];

      continue;
    }

    const right = parseExpr(ctx, operatorPrecedence + 1);

    left = [
      ...wrapExpression(left),
      operator.toLowerCase(),
      ...wrapExpression(right),
    ];
  }

  return left;
}

type OperatorInfo = {
  operator: string;
  precedence: number;
  tokenCount: number;
};

function readOperator(ctx: Ctx): OperatorInfo | null {
  const current = peek(ctx);
  const next = ctx.tokens[ctx.pos + 1];

  if (current.kind === 'OPERATOR') {
    const op = current.value.toUpperCase();
    const p = precedence(op);

    if (p >= 0) {
      return {
        operator: op,
        precedence: p,
        tokenCount: 1,
      };
    }
  }

  if (isKeyword(current, 'AND', 'OR', 'IS', 'IN', 'LIKE', 'BETWEEN')) {
    const word = current.value.toUpperCase();

    if (
      word === 'IS' &&
      next &&
      isKeyword(next, 'NOT')
    ) {
      return {
        operator: 'IS NOT',
        precedence: precedence('IS NOT'),
        tokenCount: 2,
      };
    }

    if (
      word === 'NOT' &&
      next &&
      isKeyword(next, 'IN', 'LIKE')
    ) {
      const secondWord = next.value.toUpperCase();
      const combined = `NOT ${secondWord}`;

      return {
        operator: combined,
        precedence: precedence(combined),
        tokenCount: 2,
      };
    }

    return {
      operator: word,
      precedence: precedence(word),
      tokenCount: 1,
    };
  }

  return null;
}

function wrapExpression(tokens: CsnToken[]): CsnToken[] {
  if (tokens.length === 1) {
    return tokens;
  }

  return [{ xpr: tokens } as CsnToken];
}

// ── Primary expressions ──────────────────────────────────────────────────────

function parsePrimary(ctx: Ctx): CsnToken[] {
  const token = peek(ctx);

  // Parenthesized expression.
  if (token.kind === 'LPAREN') {
    consume(ctx);

    const inner = parseExpr(ctx, 0);

    if (peek(ctx).kind !== 'RPAREN') {
      throw new Error('Invalid formula: missing closing parenthesis.');
    }

    consume(ctx);

    return [{ xpr: inner }];
  }

  // String literal.
  if (token.kind === 'STRING') {
    consume(ctx);

    const stripped = token.value
      .slice(1, -1)
      .replace(/''/g, "'");

    return [{ val: stripped }];
  }

  // Numeric literal.
  if (token.kind === 'NUMBER') {
    consume(ctx);

    return [{ val: Number(token.value) }];
  }

  // Identifier: NULL, CASE, function call, or field reference.
  if (token.kind === 'IDENT') {
    const upper = token.value.toUpperCase();

    if (upper === 'NULL') {
      consume(ctx);
      return [{ val: null }];
    }

    if (upper === 'CASE') {
      return parseCase(ctx);
    }

    // Unary NOT.
    if (upper === 'NOT') {
      consume(ctx);

      const operand = parseExpr(ctx, 3);

      return ['not', ...wrapExpression(operand)];
    }

    if (
      [
        'AND',
        'OR',
        'WHEN',
        'THEN',
        'ELSE',
        'END',
      ].includes(upper)
    ) {
      throw new Error(
        `Invalid formula: "${token.value}" cannot be used as a value.`,
      );
    }

    // Function call.
    const next = ctx.tokens[ctx.pos + 1];

    if (next && next.kind === 'LPAREN') {
      return parseFunction(ctx);
    }

    // Field reference.
    consume(ctx);

    if (peek(ctx).kind === 'DOT') {
      consume(ctx);

      const field = consume(ctx);

      if (field.kind !== 'IDENT') {
        throw new Error(
          `Invalid formula: expected a field name after "${token.value}".`,
        );
      }

      return [{ ref: [token.value, field.value] }];
    }

    return [{ ref: [token.value] }];
  }

  // Unary minus.
  if (token.kind === 'OPERATOR' && token.value === '-') {
    consume(ctx);

    const operand = parsePrimary(ctx);

    return ['-', ...wrapExpression(operand)];
  }

  // Unary plus.
  if (token.kind === 'OPERATOR' && token.value === '+') {
    consume(ctx);

    return parsePrimary(ctx);
  }

  throw new Error(
    `Invalid formula: unexpected token "${token.value}".`,
  );
}

// ── Function calls ───────────────────────────────────────────────────────────

function parseFunction(ctx: Ctx): CsnToken[] {
  const name = consume(ctx).value.toUpperCase();

  consume(ctx); // Opening parenthesis.

  if (name === 'CAST') {
    return parseCast(ctx);
  }

  const args: CsnToken[] = [];

  while (!atEnd(ctx) && peek(ctx).kind !== 'RPAREN') {
    if (peek(ctx).kind === 'COMMA') {
      consume(ctx);
      continue;
    }

    const argument = parseExpr(ctx, 0);

    if (argument.length === 1) {
      args.push(argument[0]);
    } else {
      args.push({ xpr: argument } as CsnToken);
    }

    if (peek(ctx).kind === 'COMMA') {
      consume(ctx);
    } else if (peek(ctx).kind !== 'RPAREN') {
      throw new Error(
        `Invalid ${name} call: expected a comma or closing parenthesis.`,
      );
    }
  }

  if (peek(ctx).kind !== 'RPAREN') {
    throw new Error(
      `Invalid ${name} call: missing closing parenthesis.`,
    );
  }

  consume(ctx);

  return [{ func: name, args }];
}

// ── CAST ─────────────────────────────────────────────────────────────────────

function parseCast(ctx: Ctx): CsnToken[] {
  const value = parseExpr(ctx, 0);

  if (!isKeyword(peek(ctx), 'AS')) {
    throw new Error(
      'Invalid CAST expression: expected AS before the target type.',
    );
  }

  consume(ctx);

  const typeToken = peek(ctx);

  if (typeToken.kind !== 'IDENT') {
    throw new Error(
      'Invalid CAST expression: expected a target type after AS.',
    );
  }

  const typeName = consume(ctx).value.toUpperCase();
  const typeArgs: CsnToken[] = [];

  if (peek(ctx).kind === 'LPAREN') {
    consume(ctx);

    while (!atEnd(ctx) && peek(ctx).kind !== 'RPAREN') {
      if (peek(ctx).kind === 'COMMA') {
        consume(ctx);
        continue;
      }

      typeArgs.push(...parsePrimary(ctx));
    }

    if (peek(ctx).kind !== 'RPAREN') {
      throw new Error(
        'Invalid CAST expression: missing closing parenthesis in target type.',
      );
    }

    consume(ctx);
  }

  if (peek(ctx).kind !== 'RPAREN') {
    throw new Error(
      'Invalid CAST expression: missing closing parenthesis.',
    );
  }

  consume(ctx);

  const castValue =
    value.length === 1
      ? value[0]
      : ({ xpr: value } as CsnToken);

  return [
    {
      func: 'CAST',
      args: [
        castValue,
        {
          func: typeName,
          args: typeArgs,
        } as CsnToken,
      ],
    },
  ];
}

// ── CASE expressions ─────────────────────────────────────────────────────────

function parseCase(ctx: Ctx): CsnToken[] {
  consume(ctx); // CASE.

  const expression: CsnToken[] = ['case'];
  let closed = false;

  while (!atEnd(ctx)) {
    const token = peek(ctx);

    if (isKeyword(token, 'WHEN')) {
      consume(ctx);
      expression.push('when');

      const condition = parseExpr(ctx, 0);
      expression.push(...condition);

      if (!isKeyword(peek(ctx), 'THEN')) {
        throw new Error(
          'Invalid CASE expression: expected THEN after the condition.',
        );
      }

      consume(ctx);
      expression.push('then');

      const result = parseExpr(ctx, 0);
      expression.push(...result);

      continue;
    }

    if (isKeyword(token, 'ELSE')) {
      consume(ctx);
      expression.push('else');

      const result = parseExpr(ctx, 0);
      expression.push(...result);

      continue;
    }

    if (isKeyword(token, 'END')) {
      consume(ctx);
      expression.push('end');
      closed = true;
      break;
    }

    break;
  }

  if (!closed) {
    throw new Error('Invalid CASE expression: expected END.');
  }

  return expression;
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateTokens(
  tokens: CsnToken[],
  formula: string,
): void {
  for (const token of tokens) {
    if (typeof token === 'string') {
      continue;
    }

    if (
      'ref' in token &&
      token.ref.some(
        (part) => part.toUpperCase() === 'AS',
      )
    ) {
      throw new Error(
        `Invalid formula "${formula}": AS cannot be a column reference.`,
      );
    }

    if ('xpr' in token) {
      validateTokens(token.xpr, formula);
    }

    if ('args' in token) {
      token.args.forEach((argument) => {
        validateTokens([argument], formula);
      });
    }
  }
}
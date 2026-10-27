import { CsnToken } from '../model/types';
import { CompressedEntity } from '../../utils/schemaCompressor';

export function resolveCsnSourceName(
  sourceName: string,
  sourceEntities: CompressedEntity[],
  sharedSourceSpace = '',
): string {
  if (!sharedSourceSpace.trim()) return sourceName;

  const sourceEntity = sourceEntities.find((entity) =>
    entity.kind === 'table'
    && (entity.name === sourceName || entity.name.split('.').pop() === sourceName),
  );
  if (!sourceEntity) return sourceName;
  if (sourceEntity.name.includes('.')) return sourceEntity.name;

  return `${sharedSourceSpace.trim()}.${sourceEntity.name}`;
}

export function csnSourceAlias(sourceName: string): string {
  return sourceName.split('.').pop() || sourceName;
}

function normalizeCsnSourceAlias(sourceName: string): string {
  let normalized = csnSourceAlias(sourceName);
  let previous = '';
  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized
      .replace(/^(?:L[0-4]_)+/i, '')
      .replace(/^WRAP_/i, '');
  }
  return normalized.toUpperCase();
}

export function resolveCsnFormulaReferences(
  tokens: CsnToken[],
  sources: string[],
): CsnToken[] {
  const aliasesByName = new Map<string, string>();
  const aliasesByNormalizedName = new Map<string, Set<string>>();

  for (const source of sources) {
    const alias = csnSourceAlias(source);
    aliasesByName.set(source.toUpperCase(), alias);
    aliasesByName.set(alias.toUpperCase(), alias);

    const normalized = normalizeCsnSourceAlias(alias);
    const aliases = aliasesByNormalizedName.get(normalized) || new Set<string>();
    aliases.add(alias);
    aliasesByNormalizedName.set(normalized, aliases);
  }

  const resolveToken = (token: CsnToken): CsnToken => {
    if (typeof token === 'string') return token;

    if ('ref' in token) {
      if (token.ref.some((part) => ['AS', 'NOT', 'WHEN', 'THEN', 'ELSE', 'END']
        .includes(part.toUpperCase()))) {
        throw new Error(
          `Invalid CSN expression reference "${token.ref.join('.')}": SQL keyword cannot be a column reference.`,
        );
      }
      const [source, ...path] = token.ref;
      if (!source || path.length === 0) return token;

      const directAlias = aliasesByName.get(source.toUpperCase());
      const normalizedAliases = aliasesByNormalizedName.get(normalizeCsnSourceAlias(source));
      const resolvedAlias = directAlias
        || (normalizedAliases?.size === 1 ? Array.from(normalizedAliases)[0] : undefined);
      return resolvedAlias ? { ...token, ref: [resolvedAlias, ...path] } : token;
    }

    if ('xpr' in token) return { ...token, xpr: token.xpr.map(resolveToken) };
    if ('args' in token) return { ...token, args: token.args.map(resolveToken) };
    return token;
  };

  return tokens.map(resolveToken);
}

export function quoteCsnSqlSource(sourceName: string): string {
  return sourceName
    .split('.')
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join('.');
}

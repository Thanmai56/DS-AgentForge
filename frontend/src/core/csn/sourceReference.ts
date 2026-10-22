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

export function quoteCsnSqlSource(sourceName: string): string {
  return sourceName
    .split('.')
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join('.');
}

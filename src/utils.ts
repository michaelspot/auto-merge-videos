import type { BulkCombination, MediaItem, TextItem } from './types';

export function errorMessage(error: unknown, fallback = 'Une erreur est survenue.') {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function sanitizeFilename(name: string) {
  const sanitized = name
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 180);

  return sanitized || `file_${Date.now()}`;
}

export function safeOutputName(name: string) {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return cleaned.slice(0, 96) || `scaylit-${Date.now()}`;
}

export function mediaId(item: MediaItem) {
  return item.public_id;
}

export function textId(item: TextItem, index: number) {
  return `${index}:${item.text}`;
}

export function itemTags(item: MediaItem | TextItem) {
  return Array.isArray(item.tags) ? item.tags : [];
}

export function uniqueTags(items: Array<MediaItem | TextItem>) {
  return [...new Set(items.flatMap(itemTags))].sort((a, b) => a.localeCompare(b));
}

export function filterByTags<T extends MediaItem | TextItem>(items: T[], filters: Set<string>) {
  if (filters.size === 0) return items;
  return items.filter((item) => itemTags(item).some((tag) => filters.has(tag)));
}

export function shuffled<T>(items: T[], random: () => number = Math.random) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const current = output[index];
    const other = output[target];
    if (current !== undefined && other !== undefined) {
      output[index] = other;
      output[target] = current;
    }
  }
  return output;
}

function randomItem<T>(items: T[], random: () => number) {
  if (items.length === 0) return null;
  return items[Math.floor(random() * items.length)] ?? null;
}

export function buildBulkCombinations(
  hooks: MediaItem[],
  captures: MediaItem[],
  musiques: MediaItem[],
  textes: TextItem[],
  count: number,
  random: () => number = Math.random,
): BulkCombination[] {
  const pairs = hooks.flatMap((hook) => captures.map((capture) => ({ hook, capture })));
  const safeCount = Math.max(0, Math.min(Math.floor(count), pairs.length));

  return shuffled(pairs, random)
    .slice(0, safeCount)
    .map((pair) => ({
      ...pair,
      musique: randomItem(musiques, random),
      texte: randomItem(textes, random),
    }));
}

export function selectedMedia(items: MediaItem[], selectedIds: Set<string>, emptyMeansAll: boolean) {
  if (selectedIds.size === 0) return emptyMeansAll ? [...items] : [];
  return items.filter((item) => selectedIds.has(mediaId(item)));
}

export function selectedTexts(items: TextItem[], selectedIds: Set<string>) {
  if (selectedIds.size === 0) return [];
  return items.filter((item, index) => selectedIds.has(textId(item, index)));
}

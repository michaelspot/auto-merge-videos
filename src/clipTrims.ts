import { File, Paths } from 'expo-file-system';

import { getApiBaseUrl } from './config';
import type { ClipTrim, MediaItem } from './types';

export type ClipTrims = Record<string, ClipTrim>;

const trimsFile = () => new File(Paths.document, 'scaylit-clip-trims-v1.json');

export function clipTrimKey(item: MediaItem) {
  return JSON.stringify([getApiBaseUrl(), item.public_id, item.lastModified, item.size]);
}

export function readClipTrims(): ClipTrims {
  try {
    const file = trimsFile();
    if (!file.exists) return {};
    const stored: unknown = JSON.parse(file.textSync());
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([, trim]) =>
      trim && typeof trim.start === 'number' && typeof trim.end === 'number'
      && Number.isFinite(trim.start) && Number.isFinite(trim.end)
      && trim.start >= 0 && trim.end > trim.start,
    ));
  } catch {
    return {};
  }
}

export function writeClipTrims(trims: ClipTrims) {
  const pending = new File(Paths.document, 'scaylit-clip-trims-v1.pending.json');
  pending.create({ intermediates: true, overwrite: true });
  pending.write(JSON.stringify(trims));
  pending.moveSync(trimsFile(), { overwrite: true });
}

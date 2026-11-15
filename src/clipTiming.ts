import type { ClipTrim } from './types';

export const MIN_CLIP_DURATION = 0.3;
export type ClipEditTarget = 'start' | 'end' | 'selection';

export function clipRange(trim: ClipTrim | undefined, duration: number): ClipTrim {
  if (!Number.isFinite(duration) || duration <= 0) return { start: 0, end: 0 };
  const minimum = Math.min(MIN_CLIP_DURATION, duration);
  const start = Math.max(0, Math.min(trim?.start ?? 0, duration - minimum));
  return { start, end: Math.max(start + minimum, Math.min(trim?.end ?? duration, duration)) };
}

export function moveClipBoundary(
  range: ClipTrim,
  boundary: 'start' | 'end',
  time: number,
  duration: number,
): ClipTrim {
  const minimum = Math.min(MIN_CLIP_DURATION, duration);
  const rounded = time >= duration ? duration : Math.round(time * 100) / 100;
  return boundary === 'start'
    ? { start: Math.max(0, Math.min(rounded, range.end - minimum)), end: range.end }
    : { start: range.start, end: Math.min(duration, Math.max(rounded, range.start + minimum)) };
}

export function moveClipSelection(range: ClipTrim, offset: number, duration: number): ClipTrim {
  const shift = Math.max(-range.start, Math.min(Math.round(offset * 100) / 100, duration - range.end));
  return { start: range.start + shift, end: range.end + shift };
}

export function clipCutPreviewTime(range: ClipTrim, target: ClipEditTarget, frameRate = 30) {
  if (target !== 'end') return range.start;
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  // The end is exclusive: show the last retained frame, including at the source's end.
  return Math.max(range.start, (Math.ceil(range.end * fps - 0.000001) - 1) / fps);
}

export function clipTime(time: number) {
  const tenths = Math.round(Math.max(0, time) * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')},${tenths % 10}`;
}

export function appendClipTrim(query: URLSearchParams, prefix: 'hook' | 'capture', trim?: ClipTrim) {
  if (!trim) return;
  query.set(`${prefix}Start`, String(trim.start));
  query.set(`${prefix}End`, String(trim.end));
}

export const DEFAULT_HIGGSFIELD_PROMPT =
  'Reproduis la vidéo de référence en remplaçant la personne principale par la personne de la photo Influ. ' +
  'Conserve les mouvements, les expressions, le cadrage, le décor, la lumière et le rythme de la vidéo. ' +
  'Respecte fidèlement le visage et l’apparence de la personne sur la photo, avec un rendu naturel et réaliste.';

// Choices for preparing a draft. Account access and prices must be checked with
// Higgsfield before enabling generation; the screenshot is not a price catalog.
export const HIGGSFIELD_MODELS = [
  { id: 'seedance_2_5', name: 'Seedance 2.5', detail: 'Références photo et vidéo' },
  { id: 'seedance_2_0', name: 'Seedance 2.0', detail: 'Références photo et vidéo' },
  { id: 'seedance_2_0_fast', name: 'Seedance 2.0 Fast', detail: 'Références photo et vidéo · 720p' },
  { id: 'seedance_2_0_mini', name: 'Seedance 2.0 Mini', detail: 'Références photo et vidéo · 720p' },
] as const;

export const HIGGSFIELD_FORMATS = [
  { id: '9:16', name: '9:16', detail: 'Vertical · Reels, TikTok, Shorts' },
  { id: '16:9', name: '16:9', detail: 'Horizontal' },
  { id: '1:1', name: '1:1', detail: 'Carré' },
  { id: '4:3', name: '4:3', detail: 'Paysage' },
  { id: '3:4', name: '3:4', detail: 'Portrait' },
  { id: '21:9', name: '21:9', detail: 'Cinéma' },
] as const;

export const HIGGSFIELD_DURATIONS = [5, 7, 10, 15] as const;

export type HiggsfieldModelId = string;
export type HiggsfieldFormat = typeof HIGGSFIELD_FORMATS[number]['id'];

export interface HiggsfieldParameter {
  name: string;
  type: string;
  required?: string;
  default?: string | number | boolean;
  options?: Array<string | number>;
  min?: number;
  max?: number;
}

export interface HiggsfieldCatalogModel {
  id: string;
  name: string;
  output_type: string;
  parameters: HiggsfieldParameter[];
  medias: Array<{ roles?: string[] }>;
  aspect_ratios: string[];
  durations?: number[];
  duration_range?: { min: number; max: number };
}

export interface HiggsfieldVideoModel {
  id: string;
  sourceId: string;
  name: string;
  detail: string;
  formats: string[];
  durations: number[];
  defaults: Record<string, unknown>;
}

export interface HiggsfieldVideoParams extends Record<string, unknown> {
  model: string;
  prompt: string;
  duration: number;
  aspect_ratio: string;
  count: 1;
  use_unlim: false;
  medias: Array<{ value: string; role: 'image_references' | 'video_references' }>;
}

export interface HiggsfieldGeneration {
  id: string;
  type: string;
  status: string;
  model: string;
  params?: { prompt?: string; duration?: number; aspect_ratio?: string };
  results?: { rawUrl?: string; thumbnailUrl?: string };
  createdAt?: number;
}

export interface HiggsfieldWorkspace {
  id: string;
  name: string | null;
  type: 'private' | 'shared';
  is_selected: boolean;
  credits: number;
}

export interface HiggsfieldReply {
  error?: string;
  request_id?: string;
  adjustments?: Record<string, { requested: unknown; used: unknown; reason: string }>;
  cost?: { credits: number; credits_exact: number };
  results?: HiggsfieldGeneration[];
}

export function checkHiggsfieldReply<T extends { error?: string; request_id?: string }>(reply: T): T {
  if (reply.error) throw new Error(`${reply.error}${reply.request_id ? ` (réf. ${reply.request_id})` : ''}`);
  return reply;
}

export function videoModelsFromCatalog(items: HiggsfieldCatalogModel[]): HiggsfieldVideoModel[] {
  const models: HiggsfieldVideoModel[] = [];
  for (const model of items) {
    const roles = model.medias?.flatMap(media => media.roles ?? []) ?? [];
    if (model.output_type !== 'video' || model.id === 'ad_multiplier' ||
        !roles.includes('image_references') || !roles.includes('video_references')) continue;
    const duration = model.parameters.find(parameter => parameter.name === 'duration');
    const range = model.duration_range ?? (duration?.min != null && duration.max != null ? { min: duration.min, max: duration.max } : null);
    const durations = (model.durations ?? duration?.options?.filter((option): option is number => typeof option === 'number') ??
      (range ? Array.from({ length: Math.max(0, Math.min(120, Math.floor(range.max) - Math.ceil(range.min) + 1)) }, (_, index) => Math.ceil(range.min) + index) : []))
      .filter(seconds => Number.isInteger(seconds) && seconds > 0);
    const formats = model.aspect_ratios?.filter(format => HIGGSFIELD_FORMATS.some(item => item.id === format)) ?? [];
    if (!durations.length || !formats.length) continue;
    const defaults: Record<string, unknown> = {};
    for (const parameter of model.parameters) {
      if (parameter.name !== 'duration' && parameter.default !== undefined) defaults[parameter.name] = parameter.default;
    }
    const mode = model.parameters.find(parameter => parameter.name === 'mode');
    if (mode?.options?.includes('omni_reference')) defaults.mode = 'omni_reference';
    const resolution = model.parameters.find(parameter => parameter.name === 'resolution' || parameter.name === 'quality');
    if (resolution?.options?.includes('1080p')) defaults[resolution.name] = '1080p';
    if (model.parameters.some(parameter => parameter.name === 'generate_audio')) defaults.generate_audio = false;
    if (model.parameters.find(parameter => parameter.name === 'bitrate_mode')?.options?.includes('high')) defaults.bitrate_mode = 'high';
    // Never submit a provider-side batch in addition to the single MCP output.
    if ('batch_size' in defaults) defaults.batch_size = 1;
    const detail = `${String(defaults.resolution ?? defaults.quality ?? '')}${'generate_audio' in defaults ? ' · sans audio' : ''}`;
    models.push({ id: model.id, sourceId: model.id, name: model.name, detail, formats, durations, defaults });
    if (model.id === 'seedance_2_0' && mode?.options?.includes('fast')) {
      models.push({ id: 'seedance_2_0_fast', sourceId: model.id, name: 'Seedance 2.0 Fast', detail: '720p · sans audio',
        formats, durations, defaults: { ...defaults, mode: 'fast', resolution: '720p' } });
    }
  }
  const preferred = ['seedance_2_5', 'seedance_2_0', 'seedance_2_0_fast', 'seedance_2_0_mini'];
  return models.sort((a, b) => {
    const rank = (id: string) => preferred.includes(id) ? preferred.indexOf(id) : preferred.length;
    return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name);
  });
}

export function makeHiggsfieldVideoParams(model: HiggsfieldVideoModel, prompt: string, format: string, duration: number,
  videoId: string, imageId: string): HiggsfieldVideoParams {
  if (!prompt.trim()) throw new Error('Saisis un prompt.');
  if (!model.formats.includes(format) || !model.durations.includes(duration)) throw new Error('Ce format ou cette durée n’est pas disponible pour ce modèle.');
  if (!videoId || !imageId) throw new Error('Importe une vidéo et sélectionne une Influ.');
  return { ...model.defaults, model: model.sourceId, prompt: prompt.trim(), duration, aspect_ratio: format,
    count: 1, use_unlim: false, medias: [
      { value: videoId, role: 'video_references' },
      { value: imageId, role: 'image_references' },
    ] };
}

export function exactHiggsfieldCost(reply: HiggsfieldReply): number {
  checkHiggsfieldReply(reply);
  if (reply.adjustments && Object.keys(reply.adjustments).length) {
    const changes = Object.entries(reply.adjustments).map(([name, change]) => `${name.replace(/^params\./, '')} : ${String(change.used)}`).join(', ');
    throw new Error(`Higgsfield demande de modifier les réglages (${changes}). Aucun crédit dépensé.`);
  }
  const credits = reply.cost?.credits_exact;
  if (typeof credits !== 'number' || !Number.isFinite(credits) || credits < 0) throw new Error('Higgsfield n’a pas confirmé le coût.');
  return credits;
}

export function higgsfieldJobPending(job: HiggsfieldGeneration | null) {
  return !!job && !['completed', 'failed', 'canceled', 'nsfw', 'ip_detected'].includes(job.status);
}

export function higgsfieldCreditLabel(credits: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Math.ceil(credits * 100) / 100);
}

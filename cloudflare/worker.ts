import { Container, ContainerProxy, getContainer } from '@cloudflare/containers';
import { AwsClient } from 'aws4fetch';
import { handleScrap, type ScrapEnv } from './scrap';

export { ContainerProxy };

interface Env extends ScrapEnv {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
  SCAYLIT_CONTAINER: DurableObjectNamespace<ScaylitContainer>;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_ENDPOINT: string;
}

interface TextEntry {
  text: string;
  tag?: string;
  tags?: string[];
}

const MAX_TAG_LENGTH = 64;
const MAX_TEXT_LENGTH = 500;
const MAX_PUBLIC_ID_LENGTH = 180;
const UPLOAD_FOLDERS = new Set(['hooks', 'screenrecordings', 'musics', 'influs']);
const HOOK_PREFIXES = ['hooks/', 'hooks-face-reaction/', 'hooks-shocked-face/', 'hooks-surprised-face/'];
const DELETABLE_PREFIXES = [...HOOK_PREFIXES, 'screenrecordings/', 'musics/', 'influs/'];
const CONTAINER_READ_PREFIXES = [...HOOK_PREFIXES, 'screenrecordings/', 'musics/'];
const CONTAINER_WRITE_PREFIXES = ['montages/', 'posters/'];
const POSTER_CONTAINERS = 2;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function error(message: string, status = 400) {
  return json({ error: message }, status);
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= MAX_TEXT_LENGTH ? normalized : null;
}

function normalizeTag(value: unknown) {
  if (value === undefined || value === null || value === '') return { valid: true, value: undefined };
  if (typeof value !== 'string') return { valid: false, value: undefined };
  const normalized = value.trim();
  if (!normalized) return { valid: true, value: undefined };
  return { valid: normalized.length <= MAX_TAG_LENGTH, value: normalized };
}

function sanitizePublicId(value: unknown) {
  if (typeof value !== 'string') return null;
  const sanitized = value
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX_PUBLIC_ID_LENGTH);
  return sanitized || null;
}

function safeExtension(filename: unknown, contentType: unknown, folder: string) {
  if (typeof filename === 'string') {
    const match = filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
    if (match?.[1]) return match[1];
  }
  if (folder === 'musics') {
    if (contentType === 'audio/mpeg') return 'mp3';
    if (contentType === 'audio/mp4') return 'm4a';
  }
  if (folder === 'influs') {
    if (contentType === 'image/png') return 'png';
    if (contentType === 'image/webp') return 'webp';
    if (contentType === 'image/heic') return 'heic';
    return 'jpg';
  }
  return 'mp4';
}

function encodeKey(key: string) {
  return key.split('/').map(encodeURIComponent).join('/');
}

function decodeKey(pathname: string, prefix: string) {
  if (!pathname.startsWith(prefix)) return null;
  try {
    const key = pathname
      .slice(prefix.length)
      .split('/')
      .map(segment => decodeURIComponent(segment))
      .join('/');
    if (!key || key.startsWith('/') || key.includes('..') || /[\u0000-\u001f\u007f]/.test(key)) return null;
    return key;
  } catch {
    return null;
  }
}

function mediaUrl(origin: string, key: string) {
  return `${origin}/media/${encodeKey(key)}`;
}

function posterKeyFor(key: string) {
  const [folder, ...rest] = key.split('/');
  if (!folder || rest.length === 0) return null;
  return `posters/${folder}/${rest.join('/')}.jpg`;
}

// Marker written when a file cannot produce a poster, so the library does not restart a container for it.
function posterFailureKeyFor(key: string) {
  const posterKey = posterKeyFor(key);
  return posterKey ? `${posterKey}.failed` : null;
}

// The version changes whenever the video is re-uploaded, so the poster URL can be cached forever.
function posterUrl(origin: string, object: R2Object) {
  const query = new URLSearchParams({ publicId: object.key, v: String(object.uploaded.getTime()) });
  return `${origin}/api/poster?${query.toString()}`;
}

function tagsFor(object: R2Object) {
  const metadataTags = object.customMetadata?.tags
    ?.split(',')
    .map(tag => tag.trim())
    .filter(Boolean) ?? [];
  if (metadataTags.length > 0) return metadataTags;

  const folder = object.key.split('/')[0] ?? '';
  if (folder.startsWith('hooks-')) return [folder.slice('hooks-'.length).replace(/-/g, ' ')];
  return [];
}

async function listPrefix(bucket: R2Bucket, prefix: string, withMetadata = true) {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix,
      cursor,
      limit: 1000,
      ...(withMetadata ? { include: ['customMetadata' as const] } : {}),
    });
    objects.push(...page.objects.filter(object => object.key !== prefix && !object.key.endsWith('/')));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

async function listLibrary(request: Request, env: Env) {
  const origin = new URL(request.url).origin;
  // posters/ is no longer listed on every call: /api/poster serves the stored poster
  // (or generates it once) and its versioned URL lets the app cache it.
  const [hookGroups, captures, musiques, textObjects, influs] = await Promise.all([
    Promise.all(HOOK_PREFIXES.map(prefix => listPrefix(env.MEDIA, prefix))),
    listPrefix(env.MEDIA, 'screenrecordings/'),
    listPrefix(env.MEDIA, 'musics/'),
    listPrefix(env.MEDIA, 'textes/', false),
    listPrefix(env.MEDIA, 'influs/'),
  ]);

  const mapVideo = (object: R2Object) => {
    return {
      name: object.key.split('/').pop() ?? object.key,
      url: mediaUrl(origin, object.key),
      posterUrl: posterUrl(origin, object),
      size: object.size,
      lastModified: object.uploaded.toISOString(),
      public_id: object.key,
      tags: tagsFor(object),
      resource_type: 'video',
    };
  };

  let textes: Array<{ text: string; tags: string[] }> = [];
  const textObject = textObjects.find(object => object.key.endsWith('.json'));
  if (textObject) {
    const body = await env.MEDIA.get(textObject.key);
    if (body?.body) {
      try {
        const parsed = JSON.parse(await body.text()) as Array<string | TextEntry>;
        if (Array.isArray(parsed)) {
          textes = parsed.flatMap(entry => {
            if (typeof entry === 'string') return [{ text: entry, tags: [] }];
            if (!entry || typeof entry.text !== 'string') return [];
            return [{
              text: entry.text,
              tags: Array.isArray(entry.tags) ? entry.tags : entry.tag ? [entry.tag] : [],
            }];
          });
        }
      } catch {
        textes = [];
      }
    }
  }

  const newestFirst = <T extends { lastModified: string }>(a: T, b: T) =>
    b.lastModified.localeCompare(a.lastModified);

  return json({
    hooks: hookGroups.flat().map(mapVideo).sort(newestFirst),
    captures: captures.map(mapVideo).sort(newestFirst),
    musiques: musiques.map(object => ({ ...mapVideo(object), posterUrl: undefined })).sort(newestFirst),
    influs: influs.map(object => ({
      ...mapVideo(object),
      posterUrl: mediaUrl(origin, object.key),
      resource_type: 'image',
    })).sort(newestFirst),
    textes,
  });
}

async function signUpload(request: Request, env: Env) {
  if (request.method !== 'POST') return error('Méthode non autorisée.', 405);
  let body: Record<string, unknown>;
  try {
    body = await request.json<Record<string, unknown>>();
  } catch {
    return error('Corps de requête invalide.');
  }

  const folder = typeof body.folder === 'string' ? body.folder : '';
  const publicId = sanitizePublicId(body.public_id);
  const tag = normalizeTag(body.tags);
  if (!UPLOAD_FOLDERS.has(folder)) return error('Dossier d’upload invalide.');
  if (!publicId) return error('Nom de fichier invalide.');
  if (!tag.valid) return error(`Le tag ne peut pas dépasser ${MAX_TAG_LENGTH} caractères.`);

  // Every file type is accepted. The type is only checked to be a valid header value; when the
  // picker gives none (or a generic one), it is inferred from the extension (.MOV -> video/quicktime).
  const requestedType = typeof body.contentType === 'string' ? body.contentType.trim() : '';
  const fallbackType = folder === 'influs' ? 'image/jpeg' : folder === 'musics' ? 'audio/mpeg' : 'video/mp4';
  const extension = safeExtension(body.fileName, requestedType || fallbackType, folder);
  const contentType = requestedType.length <= 100 && CONTENT_TYPE_PATTERN.test(requestedType)
    && requestedType !== 'application/octet-stream'
    ? requestedType
    : CONTENT_TYPES_BY_EXTENSION[extension] ?? (requestedType ? 'application/octet-stream' : fallbackType);
  let key = `${folder}/${publicId}.${extension}`;
  // Two different files with the same name (IMG_0001.MOV…) must not silently overwrite each other.
  if (await env.MEDIA.head(key)) key = `${folder}/${publicId}-${crypto.randomUUID().slice(0, 6)}.${extension}`;
  const headers: Record<string, string> = {
    'Content-Type': contentType,
  };
  if (tag.value) headers['x-amz-meta-tags'] = tag.value;

  const client = new AwsClient({
    service: 's3',
    region: 'auto',
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });
  const endpoint = env.R2_ENDPOINT.replace(/\/$/, '');
  const target = `${endpoint}/${encodeURIComponent(env.R2_BUCKET_NAME)}/${encodeKey(key)}?X-Amz-Expires=900`;
  const signed = await client.sign(new Request(target, { method: 'PUT', headers }), {
    aws: { signQuery: true },
  });

  return json({ uploadUrl: signed.url, key, headers });
}

async function deleteMedia(request: Request, env: Env) {
  if (request.method !== 'DELETE') return error('Méthode non autorisée.', 405);
  const url = new URL(request.url);
  const key = url.searchParams.get('publicId') ?? url.searchParams.get('public_id');
  if (!key || key.length > 512 || !DELETABLE_PREFIXES.some(prefix => key.startsWith(prefix))) {
    return error('Fichier invalide ou non supprimable.', 403);
  }
  const object = await env.MEDIA.head(key);
  if (!object) return error('Fichier introuvable.', 404);
  const posterKey = posterKeyFor(key);
  const failureKey = posterFailureKeyFor(key);
  await env.MEDIA.delete(posterKey && failureKey ? [key, posterKey, failureKey] : [key]);
  return json({ message: 'Fichier supprimé', publicId: key });
}

async function addText(request: Request, env: Env) {
  if (request.method !== 'POST') return error('Méthode non autorisée.', 405);
  let body: Record<string, unknown>;
  try {
    body = await request.json<Record<string, unknown>>();
  } catch {
    return error('Corps de requête invalide.');
  }
  const text = normalizeText(body.text);
  const tag = normalizeTag(body.tag);
  if (!text) return error(`Le texte doit contenir entre 1 et ${MAX_TEXT_LENGTH} caractères.`);
  if (!tag.valid) return error(`Le tag ne peut pas dépasser ${MAX_TAG_LENGTH} caractères.`);

  const existing = await listPrefix(env.MEDIA, 'textes/');
  const key = existing.find(object => object.key.endsWith('.json'))?.key ?? 'textes/textes.json';
  let entries: TextEntry[] = [];
  const object = await env.MEDIA.get(key);
  if (object?.body) {
    try {
      const parsed = JSON.parse(await object.text()) as Array<string | TextEntry>;
      if (Array.isArray(parsed)) {
        entries = parsed.flatMap(entry => typeof entry === 'string' ? [{ text: entry }] : entry?.text ? [entry] : []);
      }
    } catch {
      entries = [];
    }
  }
  entries.push({ text, ...(tag.value ? { tag: tag.value } : {}) });
  await env.MEDIA.put(key, JSON.stringify(entries, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return json({ message: 'Texte ajouté', count: entries.length });
}

function isAllowedInputKey(key: string | null, prefixes: string[]) {
  return Boolean(key && key.length <= 512 && prefixes.some(prefix => key.startsWith(prefix)));
}

function hashKey(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
}

function containerUnavailable(caught: unknown) {
  console.error('[container] indisponible', caught);
  return error('Le serveur vidéo n’a pas pu démarrer. Réessaie dans quelques secondes.', 503);
}

// Always answers { error } in French, even when the failure is a plain-text one from the container runtime.
function containerFailure(status: number, responseText: string) {
  try {
    const message = (JSON.parse(responseText) as { error?: unknown }).error;
    if (typeof message === 'string' && message) return error(message, status);
  } catch {}
  return containerUnavailable(`${status} ${responseText.slice(0, 300)}`);
}

async function servePoster(request: Request, env: Env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('publicId');
  if (!key || !isAllowedInputKey(key, [...HOOK_PREFIXES, 'screenrecordings/'])) {
    return error('Fichier vidéo invalide.', 400);
  }
  const posterKey = posterKeyFor(key);
  const failureKey = posterFailureKeyFor(key);
  if (!posterKey || !failureKey) return error('Fichier vidéo invalide.', 400);
  // Versioned URLs (from /api/list) never change content; plain ones (right after upload) must revalidate.
  const cacheControl = url.searchParams.has('v') ? IMMUTABLE : 'public, max-age=60';

  const [video, poster] = await Promise.all([env.MEDIA.head(key), env.MEDIA.head(posterKey)]);
  if (!video) return error('Fichier introuvable.', 404);
  // A poster older than the video belongs to a previous upload with the same name.
  if (poster && poster.uploaded >= video.uploaded) return serveR2Object(request, env, posterKey, cacheControl);

  const failure = await env.MEDIA.head(failureKey);
  if (failure && failure.uploaded >= video.uploaded) {
    return error(failure.customMetadata?.message || 'Aperçu indisponible pour ce fichier.', 422);
  }

  // A small fixed pool of warm instances (instead of one cold container per poster) keeps a
  // library with many new videos under max_instances; the container dedupes identical requests.
  const container = getContainer(env.SCAYLIT_CONTAINER, `poster-${hashKey(key) % POSTER_CONTAINERS}`);
  const target = new URL('http://container/poster');
  target.search = new URLSearchParams({ publicId: key }).toString();
  let response: Response;
  try {
    response = await container.fetch(new Request(target, { method: 'GET' }));
  } catch (caught) {
    return containerUnavailable(caught);
  }
  const responseText = await response.text();
  if (!response.ok) {
    console.error('[poster] génération échouée', { key, status: response.status, responseText });
    const failed = containerFailure(response.status, responseText);
    if (response.status === 422) {
      const { error: message } = await failed.clone().json<{ error: string }>();
      await env.MEDIA.put(failureKey, '', { customMetadata: { message } });
    }
    return failed;
  }
  return serveR2Object(request, env, posterKey, cacheControl);
}

async function forwardContainer(request: Request, env: Env, route: 'merge' | 'bulk-merge') {
  const incoming = new URL(request.url);
  const params = new URLSearchParams(incoming.searchParams);
  const hookKey = params.get('hookKey');
  const captureKey = params.get('captureKey');
  const musicKey = params.get('musiqueKey');

  if (!isAllowedInputKey(hookKey, HOOK_PREFIXES) || !isAllowedInputKey(captureKey, ['screenrecordings/'])) {
    return error('Il manque le hook ou la capture.', 400);
  }
  if (musicKey && !isAllowedInputKey(musicKey, ['musics/'])) return error('Musique invalide.', 400);
  for (const prefix of ['hook', 'capture']) {
    const start = params.get(`${prefix}Start`);
    const end = params.get(`${prefix}End`);
    if (start === null && end === null) continue;
    if (!start?.trim() || !end?.trim() || !Number.isFinite(Number(start)) || !Number.isFinite(Number(end))
      || Number(start) < 0 || Number(end) <= Number(start)) {
      return error('Les limites de l’extrait sont invalides.', 400);
    }
  }
  if (route === 'bulk-merge' && params.has('texte')) {
    const text = normalizeText(params.get('texte'));
    if (!text) return error(`Le texte doit contenir entre 1 et ${MAX_TEXT_LENGTH} caractères.`);
    params.set('texte', text);
    const textY = Number(params.get('textY') ?? 50);
    if (!Number.isFinite(textY) || textY < 0 || textY > 100) return error('Position du texte invalide.');
    params.set('textY', String(textY));
  }

  const container = getContainer(env.SCAYLIT_CONTAINER, crypto.randomUUID());
  const target = new URL(`http://container/${route}`);
  target.search = params.toString();
  console.log('[container] traitement démarré', { route });

  try {
    let response: Response;
    try {
      response = await container.fetch(new Request(target, { method: 'GET' }));
    } catch (caught) {
      return containerUnavailable(caught);
    }
    const responseText = await response.text();

    if (!response.ok) {
      console.error('[container] traitement échoué', { route, status: response.status, responseText });
      return containerFailure(response.status, responseText);
    }

    const data = JSON.parse(responseText) as { key?: string; error?: string };
    console.log('[container] traitement terminé', { route });

    if (!data.key) return error('La vidéo générée est introuvable.', 500);
    return json({ message: 'Vidéo générée !', key: data.key, url: mediaUrl(incoming.origin, data.key) });
  } finally {
    await container.destroy().catch((destroyError: unknown) => {
      console.error('[container] nettoyage impossible', destroyError);
    });
  }
}

// undefined = whole object, null = unsatisfiable (416). Malformed or multi-range headers are
// ignored (RFC 9110) and answered with the whole object instead of an error.
function parseRangeHeader(value: string | null, size: number) {
  if (!value) return undefined;
  const match = value.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return undefined;
  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';
  if (!rawStart && !rawEnd) return undefined;

  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }

  const offset = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isInteger(offset) || !Number.isInteger(requestedEnd) || offset < 0 || offset >= size || requestedEnd < offset) {
    return null;
  }
  const end = Math.min(requestedEnd, size - 1);
  return { offset, length: end - offset + 1 };
}

function cacheControlFor(key: string) {
  if (key.startsWith('scrap/')) return 'private, no-store';
  // Montage keys are unique (timestamp + random) and never rewritten.
  if (key.startsWith('montages/')) return 'private, max-age=31536000, immutable';
  // Library files can be replaced by a re-upload: short cache, then cheap ETag revalidation.
  return 'public, max-age=3600';
}

async function serveR2Object(request: Request, env: Env, explicitKey?: string, cacheControl?: string) {
  const key = explicitKey ?? decodeKey(new URL(request.url).pathname, '/media/');
  if (!key) return error('Fichier invalide.', 400);
  const head = await env.MEDIA.head(key);
  if (!head) return error('Fichier introuvable.', 404);
  if (key.startsWith('scrap/') && (!key.startsWith('scrap/results/') ||
      !head.customMetadata?.expiresat || !Number.isFinite(Number(head.customMetadata.expiresat)) ||
      Number(head.customMetadata.expiresat) <= Date.now() / 1000)) {
    return error('Cette vidéo a expiré. Relance le lien dans Scrap.', 410);
  }
  const ifNoneMatch = request.headers.get('if-none-match');
  const notModified = Boolean(ifNoneMatch && ifNoneMatch.split(',').some(tag => tag.trim().replace(/^W\//, '') === head.httpEtag));
  const range = notModified ? undefined : parseRangeHeader(request.headers.get('range'), head.size);
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${head.size}`, 'Access-Control-Allow-Origin': '*' },
    });
  }

  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set('ETag', head.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', cacheControl ?? cacheControlFor(key));
  if (notModified) return new Response(null, { status: 304, headers });
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(head.size));
    return new Response(null, { status: 200, headers });
  }

  const object = await env.MEDIA.get(key, range ? { range } : undefined);
  if (!object?.body) return error('Fichier introuvable.', 404);
  if (range) {
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
    headers.set('Content-Length', String(range.length));
    return new Response(object.body, { status: 206, headers });
  } else {
    headers.set('Content-Length', String(head.size));
    return new Response(object.body, { status: 200, headers });
  }
}

async function proxyMedia(request: Request, env: Env) {
  const source = new URL(request.url).searchParams.get('url');
  if (!source) return error('URL manquante.');
  try {
    const sourceUrl = new URL(source);
    const incoming = new URL(request.url);
    if (sourceUrl.origin !== incoming.origin) return error('URL non autorisée.', 403);
    const key = decodeKey(sourceUrl.pathname, '/media/');
    if (!key) return error('URL non autorisée.', 403);
    return serveR2Object(request, env, key);
  } catch {
    return error('URL non autorisée.', 403);
  }
}

export class ScaylitContainer extends Container<Env> {
  defaultPort = 8080;
  // Merge containers are destroyed right after their request; this only stops idle poster workers.
  sleepAfter = '3m';
  enableInternet = false;
}

ScaylitContainer.outboundByHost = {
  'scaylit.r2': async (request: Request, env: Env) => {
    const key = decodeKey(new URL(request.url).pathname, '/');
    if (!key) return new Response('Bad key', { status: 400 });
    if (request.method === 'GET') {
      if (![...CONTAINER_READ_PREFIXES, ...CONTAINER_WRITE_PREFIXES].some(prefix => key.startsWith(prefix))) {
        return new Response('Forbidden', { status: 403 });
      }
      // Range support lets FFmpeg read only what it needs (index + first frame for posters).
      const rangeHeader = request.headers.get('range');
      const head = rangeHeader ? await env.MEDIA.head(key) : null;
      const range = head ? parseRangeHeader(rangeHeader, head.size) : undefined;
      if (head && range === null) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${head.size}` } });
      }
      const object = await env.MEDIA.get(key, range ? { range } : undefined);
      if (!object?.body) return new Response('Not found', { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('Accept-Ranges', 'bytes');
      if (range) {
        headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
        headers.set('Content-Length', String(range.length));
        return new Response(object.body, { status: 206, headers });
      }
      headers.set('Content-Length', String(object.size));
      return new Response(object.body, { headers });
    }
    if (request.method === 'PUT') {
      if (!CONTAINER_WRITE_PREFIXES.some(prefix => key.startsWith(prefix)) || !request.body) {
        return new Response('Forbidden', { status: 403 });
      }
      await env.MEDIA.put(key, request.body, {
        httpMetadata: { contentType: request.headers.get('content-type') ?? 'application/octet-stream' },
      });
      return new Response(null, { status: 201 });
    }
    return new Response('Method not allowed', { status: 405 });
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Range',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/list') return request.method === 'GET' ? listLibrary(request, env) : error('Méthode non autorisée.', 405);
      if (url.pathname === '/api/scrap') return handleScrap(request, env);
      if (url.pathname === '/api/sign-upload') return signUpload(request, env);
      if (url.pathname === '/api/delete') return deleteMedia(request, env);
      if (url.pathname === '/api/add-text') return addText(request, env);
      if (url.pathname === '/api/merge') return request.method === 'GET' ? forwardContainer(request, env, 'merge') : error('Méthode non autorisée.', 405);
      if (url.pathname === '/api/bulk-merge') return request.method === 'GET' ? forwardContainer(request, env, 'bulk-merge') : error('Méthode non autorisée.', 405);
      if (url.pathname === '/api/poster') return request.method === 'GET' || request.method === 'HEAD' ? servePoster(request, env) : error('Méthode non autorisée.', 405);
      if (url.pathname === '/api/proxy') return request.method === 'GET' ? proxyMedia(request, env) : error('Méthode non autorisée.', 405);
      if (url.pathname.startsWith('/media/')) return request.method === 'GET' || request.method === 'HEAD' ? serveR2Object(request, env) : error('Méthode non autorisée.', 405);
      if (url.pathname.startsWith('/api/')) return error('Route introuvable.', 404);
      return env.ASSETS.fetch(request);
    } catch (caught) {
      console.error('Scaylit Worker error', caught);
      return error('Une erreur interne est survenue.', 500);
    }
  },
};

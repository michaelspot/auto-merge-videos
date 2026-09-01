import { Container, ContainerProxy, getContainer } from '@cloudflare/containers';
import { AwsClient } from 'aws4fetch';

export { ContainerProxy };

interface Env {
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
const UPLOAD_FOLDERS = new Set(['hooks', 'screenrecordings', 'musics']);
const HOOK_PREFIXES = ['hooks/', 'hooks-face-reaction/', 'hooks-shocked-face/', 'hooks-surprised-face/'];
const DELETABLE_PREFIXES = [...HOOK_PREFIXES, 'screenrecordings/', 'musics/'];
const CONTAINER_READ_PREFIXES = [...HOOK_PREFIXES, 'screenrecordings/', 'musics/'];
const CONTAINER_WRITE_PREFIXES = ['montages/', 'posters/'];

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

async function listPrefix(bucket: R2Bucket, prefix: string) {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix,
      cursor,
      limit: 1000,
      include: ['customMetadata', 'httpMetadata'],
    });
    objects.push(...page.objects.filter(object => object.key !== prefix && !object.key.endsWith('/')));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

async function listLibrary(request: Request, env: Env) {
  const origin = new URL(request.url).origin;
  const [hookGroups, captures, musiques, posters, textObjects] = await Promise.all([
    Promise.all(HOOK_PREFIXES.map(prefix => listPrefix(env.MEDIA, prefix))),
    listPrefix(env.MEDIA, 'screenrecordings/'),
    listPrefix(env.MEDIA, 'musics/'),
    listPrefix(env.MEDIA, 'posters/'),
    listPrefix(env.MEDIA, 'textes/'),
  ]);
  const posterSet = new Set(posters.map(object => object.key));

  const mapVideo = (object: R2Object) => {
    const posterKey = posterKeyFor(object.key);
    return {
      name: object.key.split('/').pop() ?? object.key,
      url: mediaUrl(origin, object.key),
      posterUrl: posterKey && posterSet.has(posterKey)
        ? mediaUrl(origin, posterKey)
        : `${origin}/api/poster?publicId=${encodeURIComponent(object.key)}`,
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

  const contentType = typeof body.contentType === 'string' && body.contentType.length <= 100
    ? body.contentType
    : folder === 'musics' ? 'audio/mpeg' : 'video/mp4';
  const extension = safeExtension(body.fileName, contentType, folder);
  const key = `${folder}/${publicId}.${extension}`;
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
  await env.MEDIA.delete(posterKey ? [key, posterKey] : [key]);
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

async function forwardContainer(request: Request, env: Env, route: 'merge' | 'bulk-merge' | 'poster') {
  const incoming = new URL(request.url);
  const params = new URLSearchParams(incoming.searchParams);
  const hookKey = params.get('hookKey');
  const captureKey = params.get('captureKey');
  const musicKey = params.get('musiqueKey');
  const posterKey = params.get('publicId');

  if (route === 'poster') {
    if (!isAllowedInputKey(posterKey, [...HOOK_PREFIXES, 'screenrecordings/'])) {
      return error('Fichier vidéo invalide.', 400);
    }
  } else {
    if (!isAllowedInputKey(hookKey, HOOK_PREFIXES) || !isAllowedInputKey(captureKey, ['screenrecordings/'])) {
      return error('Il manque le hook ou la capture.', 400);
    }
    if (musicKey && !isAllowedInputKey(musicKey, ['musics/'])) return error('Musique invalide.', 400);
    if (route === 'bulk-merge' && params.has('texte')) {
      const text = normalizeText(params.get('texte'));
      if (!text) return error(`Le texte doit contenir entre 1 et ${MAX_TEXT_LENGTH} caractères.`);
      params.set('texte', text);
      const textY = Number(params.get('textY') ?? 50);
      if (!Number.isFinite(textY) || textY < 0 || textY > 100) return error('Position du texte invalide.');
      params.set('textY', String(textY));
    }
  }

  const container = getContainer(env.SCAYLIT_CONTAINER, crypto.randomUUID());
  const target = new URL(`http://container/${route}`);
  target.search = params.toString();
  const response = await container.fetch(new Request(target, { method: 'GET' }));

  if (!response.ok) {
    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const data = await response.json<{ key?: string; posterKey?: string; error?: string }>();
  if (route === 'poster') {
    const outputKey = data.posterKey;
    if (!outputKey) return error('Aperçu non généré.', 500);
    return serveR2Object(request, env, outputKey);
  }
  if (!data.key) return error('La vidéo générée est introuvable.', 500);
  return json({ message: 'Vidéo générée !', key: data.key, url: mediaUrl(incoming.origin, data.key) });
}

function parseRangeHeader(value: string | null, size: number) {
  if (!value) return undefined;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';
  if (!rawStart && !rawEnd) return null;

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

async function serveR2Object(request: Request, env: Env, explicitKey?: string) {
  const key = explicitKey ?? decodeKey(new URL(request.url).pathname, '/media/');
  if (!key) return error('Fichier invalide.', 400);
  const head = await env.MEDIA.head(key);
  if (!head) return error('Fichier introuvable.', 404);
  const range = parseRangeHeader(request.headers.get('range'), head.size);
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
  headers.set('Cache-Control', key.startsWith('montages/') ? 'private, max-age=3600' : 'public, max-age=3600');
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
  sleepAfter = '20s';
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
      const object = await env.MEDIA.get(key);
      if (!object?.body) return new Response('Not found', { status: 404 });
      const headers = new Headers();
      object.writeHttpMetadata(headers);
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
      if (url.pathname === '/api/sign-upload') return signUpload(request, env);
      if (url.pathname === '/api/delete') return deleteMedia(request, env);
      if (url.pathname === '/api/add-text') return addText(request, env);
      if (url.pathname === '/api/merge') return request.method === 'GET' ? forwardContainer(request, env, 'merge') : error('Méthode non autorisée.', 405);
      if (url.pathname === '/api/bulk-merge') return request.method === 'GET' ? forwardContainer(request, env, 'bulk-merge') : error('Méthode non autorisée.', 405);
      if (url.pathname === '/api/poster') return request.method === 'GET' ? forwardContainer(request, env, 'poster') : error('Méthode non autorisée.', 405);
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

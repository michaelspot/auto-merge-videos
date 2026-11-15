import { File, UploadType } from 'expo-file-system';
import { fetch } from 'expo/fetch';

import { apiUrl } from './config';
import { appendClipTrim } from './clipTiming';
import type {
  BulkCombination,
  ClipTrim,
  GeneratedVideo,
  MediaKind,
  MediaItem,
  MediaLibrary,
} from './types';
import { sanitizeFilename, safeOutputName } from './utils';

interface R2UploadSignature {
  uploadUrl: string;
  key: string;
  headers: Record<string, string>;
}

interface ApiErrorBody {
  error?: string | { message?: string };
  message?: string;
}

export interface UploadMediaAsset {
  uri: string;
  name: string;
  mimeType?: string | null;
}

export interface UploadMediaOptions {
  signal?: AbortSignal;
  onProgress?: (bytesSent: number, totalBytes: number) => void;
}

const LIBRARY_TIMEOUT_MS = 15_000;
const SIGN_TIMEOUT_MS = 15_000;
const GENERATION_TIMEOUT_MS = 5 * 60_000;

function newestMediaFirst(items: MediaItem[]) {
  return [...items].sort((first, second) => {
    const firstTimestamp = Date.parse(first.lastModified);
    const secondTimestamp = Date.parse(second.lastModified);

    if (Number.isFinite(firstTimestamp) && Number.isFinite(secondTimestamp)) {
      return secondTimestamp - firstTimestamp || second.public_id.localeCompare(first.public_id);
    }
    if (Number.isFinite(firstTimestamp)) return -1;
    if (Number.isFinite(secondTimestamp)) return 1;
    return second.lastModified.localeCompare(first.lastModified);
  });
}

async function fetchLibrary(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIBRARY_TIMEOUT_MS);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Le Worker Cloudflare ne répond pas.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGeneration(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("L’assemblage a dépassé 5 minutes. Réessaie avec des vidéos plus courtes.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: (T & ApiErrorBody) | undefined;

  if (text) {
    try {
      body = JSON.parse(text) as T & ApiErrorBody;
    } catch {
      if (!response.ok) throw new Error(`Erreur serveur (${response.status}).`);
    }
  }

  if (!response.ok) {
    const apiError = body?.error;
    const message =
      typeof apiError === 'string'
        ? apiError
        : apiError?.message || body?.message || `Erreur serveur (${response.status}).`;
    throw new Error(message);
  }

  if (body === undefined) throw new Error('Réponse vide du serveur.');
  return body;
}

export async function loadLibrary(): Promise<MediaLibrary> {
  const response = await fetchLibrary(apiUrl('/api/list'));
  const data = await parseResponse<MediaLibrary>(response);

  if (
    !Array.isArray(data.hooks) ||
    !Array.isArray(data.captures) ||
    !Array.isArray(data.musiques) ||
    !Array.isArray(data.textes)
  ) {
    throw new Error('Cette adresse ne correspond pas à un Worker Scaylit valide.');
  }

  return {
    hooks: newestMediaFirst(data.hooks),
    captures: newestMediaFirst(data.captures),
    musiques: newestMediaFirst(data.musiques),
    influs: newestMediaFirst(Array.isArray(data.influs) ? data.influs : []),
    textes: data.textes,
  };
}

export async function deleteMedia(publicId: string, resourceType = 'video') {
  const query = new URLSearchParams({ publicId, resourceType });
  const response = await fetch(apiUrl(`/api/delete?${query.toString()}`), {
    method: 'DELETE',
  });
  await parseResponse<{ message: string }>(response);
}

export async function addText(text: string, tag?: string) {
  const response = await fetch(apiUrl('/api/add-text'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, ...(tag ? { tag } : {}) }),
  });
  await parseResponse<{ message: string }>(response);
}

const uploadFolders: Record<MediaKind, string> = {
  hook: 'hooks',
  capture: 'screenrecordings',
  musique: 'musics',
  influ: 'influs',
};

const CANCELLED_MESSAGE = 'Import annulé.';

// Suffixe court et unique : deux fichiers au même nom (IMG_0001.MOV, ré-import…) ne s'écrasent plus
// dans R2 (la clé est `${folder}/${public_id}.${ext}`), et l'aperçu en cache reste juste.
function uniquePublicId(name: string) {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  return `${sanitizeFilename(name).slice(0, 120)}_${suffix}`;
}

async function requestUploadSignature(body: Record<string, unknown>, signal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIGN_TIMEOUT_MS);
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel);

  try {
    const response = await fetch(apiUrl('/api/sign-upload'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await parseResponse<R2UploadSignature>(response);
  } catch (error) {
    if (signal?.aborted) throw new Error(CANCELLED_MESSAGE);
    if (controller.signal.aborted) throw new Error('Le Worker Cloudflare ne répond pas.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function uploadMedia(
  asset: UploadMediaAsset,
  type: MediaKind,
  tag?: string,
  options: UploadMediaOptions = {},
) {
  const { signal, onProgress } = options;
  const folder = uploadFolders[type];
  const file = new File(asset.uri);

  try {
    if (!file.exists || !file.size) throw new Error('Le fichier sélectionné est vide ou introuvable.');
    if (signal?.aborted) throw new Error(CANCELLED_MESSAGE);

    const signature = await requestUploadSignature(
      {
        folder,
        public_id: uniquePublicId(asset.name),
        fileName: asset.name,
        contentType: asset.mimeType || (type === 'influ' ? 'image/jpeg' : type === 'musique' ? 'audio/mpeg' : 'video/mp4'),
        ...(tag ? { tags: tag } : {}),
      },
      signal,
    );
    if (signal?.aborted) throw new Error(CANCELLED_MESSAGE);

    let uploadResult;
    try {
      uploadResult = await file.upload(signature.uploadUrl, {
        httpMethod: 'PUT',
        headers: signature.headers,
        // Session background : l'envoi continue si l'utilisateur quitte l'app quelques instants.
        sessionType: 'background',
        uploadType: UploadType.BINARY_CONTENT,
        signal,
        onProgress: onProgress
          ? ({ bytesSent, totalBytes }) => onProgress(bytesSent, totalBytes)
          : undefined,
      });
    } catch (error) {
      if (signal?.aborted) throw new Error(CANCELLED_MESSAGE);
      throw new Error(`Envoi interrompu : ${error instanceof Error && error.message ? error.message : 'connexion perdue'}.`);
    }
    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      throw new Error(`Upload refusé par le stockage (${uploadResult.status}).`);
    }
    // L'aperçu n'est plus attendu ici : /api/list renvoie un posterUrl de repli vers /api/poster,
    // généré à la première demande d'affichage. Attendre bloquait l'import sur le démarrage du conteneur.
    return signature.key;
  } finally {
    if (file.exists) file.delete();
  }
}

export async function generateSingle(
  hookKey: string,
  captureKey: string,
  hookTrim?: ClipTrim,
  captureTrim?: ClipTrim,
): Promise<string> {
  const query = new URLSearchParams({ hookKey, captureKey });
  appendClipTrim(query, 'hook', hookTrim);
  appendClipTrim(query, 'capture', captureTrim);
  const response = await fetchGeneration(apiUrl(`/api/merge?${query.toString()}`));
  const data = await parseResponse<{ url: string }>(response);
  if (!data.url) throw new Error("La vidéo a été générée, mais son URL n'a pas été reçue.");
  return data.url;
}

export async function generateBulkVideo(
  combination: BulkCombination,
  textY: number,
): Promise<GeneratedVideo> {
  const query = new URLSearchParams({
    hookKey: combination.hook.public_id,
    captureKey: combination.capture.public_id,
  });

  appendClipTrim(query, 'hook', combination.hook.trim);
  appendClipTrim(query, 'capture', combination.capture.trim);
  if (combination.musique) query.set('musiqueKey', combination.musique.public_id);
  if (combination.texte) {
    query.set('texte', combination.texte.text);
    query.set('textY', String(Math.round(textY)));
  }

  const response = await fetchGeneration(apiUrl(`/api/bulk-merge?${query.toString()}`));
  const data = await parseResponse<{ url: string }>(response);
  if (!data.url) throw new Error("La vidéo a été générée, mais son URL n'a pas été reçue.");

  return {
    url: data.url,
    name: `${safeOutputName(combination.hook.name)}_${safeOutputName(combination.capture.name)}`,
  };
}

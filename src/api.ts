import type { DocumentPickerAsset } from 'expo-document-picker';
import { File, UploadType } from 'expo-file-system';
import { fetch } from 'expo/fetch';

import { apiUrl } from './config';
import type {
  BulkCombination,
  GeneratedVideo,
  MediaKind,
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
  const response = await fetch(apiUrl('/api/list'));
  const data = await parseResponse<MediaLibrary>(response);

  return {
    hooks: Array.isArray(data.hooks) ? data.hooks : [],
    captures: Array.isArray(data.captures) ? data.captures : [],
    musiques: Array.isArray(data.musiques) ? data.musiques : [],
    textes: Array.isArray(data.textes) ? data.textes : [],
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
};

export async function uploadMedia(asset: DocumentPickerAsset, type: MediaKind, tag?: string) {
  const folder = uploadFolders[type];
  const publicId = sanitizeFilename(asset.name);
  const file = new File(asset.uri);

  try {
    const signatureResponse = await fetch(apiUrl('/api/sign-upload'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder,
        public_id: publicId,
        fileName: asset.name,
        contentType: asset.mimeType || (type === 'musique' ? 'audio/mpeg' : 'video/mp4'),
        ...(tag ? { tags: tag } : {}),
      }),
    });
    const signature = await parseResponse<R2UploadSignature>(signatureResponse);
    const uploadResult = await file.upload(signature.uploadUrl, {
      httpMethod: 'PUT',
      headers: signature.headers,
      sessionType: 'background',
      uploadType: UploadType.BINARY_CONTENT,
    });
    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      throw new Error(`Upload impossible (${uploadResult.status}).`);
    }
    if (type !== 'musique') {
      const posterResponse = await fetch(
        apiUrl(`/api/poster?publicId=${encodeURIComponent(signature.key)}`),
      );
      if (!posterResponse.ok) console.warn('Aperçu vidéo non généré', posterResponse.status);
    }
  } finally {
    if (file.exists) file.delete();
  }
}

export async function generateSingle(hookKey: string, captureKey: string): Promise<string> {
  const query = new URLSearchParams({ hookKey, captureKey });
  const response = await fetch(apiUrl(`/api/merge?${query.toString()}`));
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

  if (combination.musique) query.set('musiqueKey', combination.musique.public_id);
  if (combination.texte) {
    query.set('texte', combination.texte.text);
    query.set('textY', String(Math.round(textY)));
  }

  const response = await fetch(apiUrl(`/api/bulk-merge?${query.toString()}`));
  const data = await parseResponse<{ url: string }>(response);
  if (!data.url) throw new Error("La vidéo a été générée, mais son URL n'a pas été reçue.");

  return {
    url: data.url,
    name: `${safeOutputName(combination.hook.name)}_${safeOutputName(combination.capture.name)}`,
  };
}

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

interface CloudinarySignature {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
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
        ...(tag ? { tags: tag } : {}),
      }),
    });
    const signature = await parseResponse<CloudinarySignature>(signatureResponse);
    const resourceType = type === 'musique' ? 'auto' : 'video';
    const uploadUrl = `https://api.cloudinary.com/v1_1/${signature.cloudName}/${resourceType}/upload`;
    const uploadResult = await file.upload(uploadUrl, {
      fieldName: 'file',
      httpMethod: 'POST',
      ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
      parameters: {
        api_key: signature.apiKey,
        timestamp: String(signature.timestamp),
        signature: signature.signature,
        folder,
        public_id: publicId,
        ...(tag ? { tags: tag } : {}),
      },
      sessionType: 'background',
      uploadType: UploadType.MULTIPART,
    });
    const uploadResponse = new Response(uploadResult.body, {
      status: uploadResult.status,
      headers: uploadResult.headers,
    });
    await parseResponse<{ secure_url: string }>(uploadResponse);
  } finally {
    if (file.exists) file.delete();
  }
}

export async function generateSingle(hookUrl: string, captureUrl: string): Promise<string> {
  const query = new URLSearchParams({ hookUrl, captureUrl });
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
    hookUrl: combination.hook.url,
    captureUrl: combination.capture.url,
  });

  if (combination.musique) query.set('musiqueUrl', combination.musique.url);
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

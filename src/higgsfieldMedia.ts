import { File, UploadType } from 'expo-file-system';
import { fetch } from 'expo/fetch';

import { checkHiggsfieldReply, type HiggsfieldGeneration } from './higgsfield';
import { getHiggsfieldToken } from './higgsfieldAuth';
import { HiggsfieldMcpClient } from './higgsfieldMcp';
import type { PickedVideo } from './mediaPicker';

export function createHiggsfieldClient() {
  return new HiggsfieldMcpClient(getHiggsfieldToken, fetch as typeof globalThis.fetch);
}

export async function uploadHiggsfieldVideo(client: HiggsfieldMcpClient, video: PickedVideo): Promise<string> {
  const file = new File(video.uri);
  if (!file.exists) throw new Error('La vidéo source n’est plus disponible. Importe-la à nouveau.');
  const reply = checkHiggsfieldReply(await client.call<{
    error?: string; uploads?: Array<{ upload_url: string; media_id: string; method: string; content_type: string }>;
  }>('media_upload', { filename: video.name, content_type: video.mimeType || 'video/mp4' }));
  const upload = reply.uploads?.[0];
  if (!upload || upload.method !== 'PUT' || !upload.upload_url.startsWith('https://') || !upload.media_id) {
    throw new Error('Higgsfield n’a pas préparé l’import vidéo.');
  }
  const result = await file.upload(upload.upload_url, { httpMethod: 'PUT',
    headers: { 'Content-Type': upload.content_type }, sessionType: 'background', uploadType: UploadType.BINARY_CONTENT });
  if (result.status !== 200) throw new Error(`L’import vidéo a échoué (${result.status}).`);
  const confirmed = checkHiggsfieldReply(await client.call<{
    error?: string; results?: Array<{ media_id: string; status: string }>;
  }>('media_confirm', { type: 'video', media_id: upload.media_id }));
  const media = confirmed.results?.find(item => item.media_id === upload.media_id);
  if (!media || ['failed', 'error'].includes(media.status)) throw new Error('Higgsfield n’a pas confirmé la vidéo importée.');
  return media.media_id;
}

export async function importHiggsfieldInflu(client: HiggsfieldMcpClient, url: string): Promise<string> {
  const reply = checkHiggsfieldReply(await client.call<{ media_id?: string; error?: string }>('media_import_url', { url, type: 'image' }));
  if (!reply.media_id) throw new Error('Higgsfield n’a pas confirmé la photo Influ.');
  return reply.media_id;
}

export function getHiggsfieldVideoResult(job: HiggsfieldGeneration | null) {
  const url = job?.status === 'completed' ? job.results?.rawUrl : undefined;
  if (!url?.startsWith('https://')) return null;
  return { url, name: `higgsfield-${job!.id}` };
}

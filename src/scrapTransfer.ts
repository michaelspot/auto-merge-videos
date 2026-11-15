import { File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';

import type { PickedVideo } from './mediaPicker';
import type { ScrapJob } from './scrap';
import { safeOutputName } from './utils';

export async function downloadScrapForHiggsfield(job: ScrapJob): Promise<PickedVideo> {
  if (job.status !== 'completed' || !job.url || !job.name) {
    throw new Error('Attends que la vidéo Scrap soit prête.');
  }
  if (job.expiresAt && job.expiresAt <= Date.now() / 1000) {
    throw new Error('Cette vidéo a expiré. Relance le lien dans Scrap pour la récupérer.');
  }

  const destination = new File(Paths.cache, `higgsfield-scrap-${randomUUID()}.mp4`);
  try {
    const file = await File.downloadFileAsync(job.url, destination);
    if (!file.exists || !file.size) throw new Error('La vidéo téléchargée est vide. Réessaie.');
    return { uri: file.uri, name: `${safeOutputName(job.name)}.mp4`, mimeType: 'video/mp4', durationSeconds: null };
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

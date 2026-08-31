import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { NO_COMPRESSION, zip } from 'react-native-zip-archive';

import type { GeneratedVideo } from './types';
import { errorMessage, safeOutputName } from './utils';

function cacheFile(name: string) {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  return file;
}

async function ensureSharing() {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Le partage n'est pas disponible sur cet appareil.");
  }
}

export async function shareVideo(url: string, name: string) {
  await ensureSharing();
  const destination = cacheFile(`${safeOutputName(name)}.mp4`);
  try {
    const file = await File.downloadFileAsync(url, destination, { idempotent: true });
    await Sharing.shareAsync(file.uri, {
      dialogTitle: 'Enregistrer ou partager la vidéo',
      mimeType: 'video/mp4',
      UTI: 'public.mpeg-4',
    });
  } finally {
    if (destination.exists) destination.delete();
  }
}

async function downloadWithRetry(url: string, destination: File) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await File.downloadFileAsync(url, destination, { idempotent: true });
    } catch (error) {
      lastError = error;
      if (destination.exists) destination.delete();
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Téléchargement impossible.');
}

export async function createAndShareBulkArchive(
  videos: GeneratedVideo[],
  onProgress: (current: number, total: number, label: string) => void,
) {
  await ensureSharing();
  const workDirectory = new Directory(Paths.cache, `scaylit-bulk-${Date.now()}`);
  const archive = cacheFile('scaylit-bulk.zip');
  let failures = 0;
  let downloaded = 0;
  let firstError: string | null = null;

  try {
    workDirectory.create({ intermediates: true });

    for (let index = 0; index < videos.length; index += 1) {
      const video = videos[index];
      if (!video) continue;
      onProgress(index + 1, videos.length, `Téléchargement ${index + 1}/${videos.length}`);
      const destination = new File(
        workDirectory,
        `${String(index + 1).padStart(3, '0')}-${safeOutputName(video.name)}.mp4`,
      );
      try {
        await downloadWithRetry(video.url, destination);
        downloaded += 1;
      } catch (error) {
        failures += 1;
        firstError ??= errorMessage(error, 'Téléchargement impossible.');
      }
    }

    if (downloaded === 0) {
      throw new Error(
        firstError
          ? `Aucune vidéo générée n’a pu être téléchargée. ${firstError}`
          : 'Aucune vidéo générée n’a pu être téléchargée.',
      );
    }

    const downloadedBytes = workDirectory.info().size ?? 0;
    const safetyMargin = 100 * 1024 * 1024;
    if (Paths.availableDiskSpace < downloadedBytes + safetyMargin) {
      throw new Error('Espace insuffisant pour créer le ZIP. Libère de la place puis réessaie.');
    }

    onProgress(videos.length, videos.length, 'Création du ZIP…');
    await zip(workDirectory.uri, archive.uri, NO_COMPRESSION);
    await Sharing.shareAsync(archive.uri, {
      dialogTitle: 'Enregistrer ou partager le lot Scaylit',
      mimeType: 'application/zip',
      UTI: 'com.pkware.zip-archive',
    });

    return { failures, firstError };
  } finally {
    if (workDirectory.exists) workDirectory.delete();
    if (archive.exists) archive.delete();
  }
}

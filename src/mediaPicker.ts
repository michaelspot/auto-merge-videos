import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import type { UploadMediaAsset } from './api';

export interface PickedVideo extends UploadMediaAsset {
  durationSeconds: number | null;
}

async function pickLibraryAssets(kind: 'image' | 'video', limit: number): Promise<PickedVideo[]> {
  // Le picker iOS (PHPicker) fonctionne sans accès à Photos ; l'accès active seulement la copie
  // directe et rapide de la ressource d'origine. Un refus ne doit donc pas bloquer l'import.
  await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => null);

  const selection = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: kind === 'image' ? ['images'] : ['videos'],
    allowsEditing: false,
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    orderedSelection: limit > 1,
    // Vidéo : fichier d'origine copié tel quel (pas de transcodage HEVC → H.264).
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    preferredAssetRepresentationMode: kind === 'image'
      ? ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible
      : ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    shouldDownloadFromNetwork: true,
  });
  if (selection.canceled) return [];

  return selection.assets.map((asset, index) => {
    const uriName = decodeURIComponent(asset.uri.split('/').pop() || '');
    return {
      uri: asset.uri,
      name: asset.fileName || uriName || `${kind}_${Date.now()}_${index}.${kind === 'image' ? 'jpg' : 'mov'}`,
      mimeType: asset.mimeType || (kind === 'image' ? 'image/jpeg' : 'video/quicktime'),
      durationSeconds: asset.duration && Number.isFinite(asset.duration) ? asset.duration / 1000 : null,
    };
  });
}

export async function pickLibraryMedia(kind: 'image' | 'video'): Promise<PickedVideo | null> {
  const [asset] = await pickLibraryAssets(kind, 1);
  return asset ?? null;
}

export function pickLibraryMediaList(kind: 'image' | 'video', limit: number) {
  return pickLibraryAssets(kind, Math.max(1, limit));
}

/** Supprime les copies locales créées par les pickers (cache) qui n'ont pas été envoyées. */
export function discardPickedMedia(assets: UploadMediaAsset[]) {
  for (const asset of assets) {
    try {
      const file = new File(asset.uri);
      if (file.exists) file.delete();
    } catch {
      // Fichier déjà supprimé ou hors du bac à sable : rien à faire.
    }
  }
}

import { File, Paths } from 'expo-file-system';

import {
  DEFAULT_API_BASE_URL,
  normalizeApiBaseUrl,
  setApiBaseUrl,
} from './config';

export interface AppSettings {
  apiBaseUrl: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
};

const SETTINGS_FILENAME = 'scaylit-settings-v1.json';

function settingsFile() {
  return new File(Paths.document, SETTINGS_FILENAME);
}

// Synchronous read: the file is tiny, so the first render can use the saved
// Worker URL immediately instead of showing a loading screen.
export function loadAppSettings(): AppSettings {
  let settings = DEFAULT_APP_SETTINGS;

  try {
    const file = settingsFile();
    if (file.exists) {
      const stored = JSON.parse(file.textSync()) as { apiBaseUrl?: unknown };
      if (typeof stored.apiBaseUrl === 'string') {
        settings = { apiBaseUrl: normalizeApiBaseUrl(stored.apiBaseUrl) };
      }
    }
  } catch {
    settings = DEFAULT_APP_SETTINGS;
  }

  setApiBaseUrl(settings.apiBaseUrl);
  return settings;
}

export async function saveAppSettings(value: AppSettings): Promise<AppSettings> {
  const settings = { apiBaseUrl: normalizeApiBaseUrl(value.apiBaseUrl) };
  const file = settingsFile();
  file.create({ intermediates: true, overwrite: true });
  file.write(JSON.stringify(settings));
  setApiBaseUrl(settings.apiBaseUrl);
  return settings;
}

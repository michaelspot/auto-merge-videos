import { useCallback, useState } from 'react';

import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
} from '../settings';

export function useAppSettings() {
  // Read once, synchronously, before any network call uses the Worker URL.
  const [settings, setSettings] = useState<AppSettings>(loadAppSettings);

  const saveApiBaseUrl = useCallback(async (apiBaseUrl: string) => {
    const saved = await saveAppSettings({ apiBaseUrl });
    setSettings(saved);
    return saved.apiBaseUrl;
  }, []);

  const resetApiBaseUrl = useCallback(async () => {
    const saved = await saveAppSettings(DEFAULT_APP_SETTINGS);
    setSettings(saved);
    return saved.apiBaseUrl;
  }, []);

  return {
    resetApiBaseUrl,
    saveApiBaseUrl,
    settings,
  };
}

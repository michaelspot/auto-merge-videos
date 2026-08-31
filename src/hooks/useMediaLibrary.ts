import { useCallback, useEffect, useRef, useState } from 'react';

import { loadLibrary } from '../api';
import { EMPTY_LIBRARY, type MediaLibrary } from '../types';
import { errorMessage } from '../utils';

export function useMediaLibrary() {
  const [library, setLibrary] = useState<MediaLibrary>(EMPTY_LIBRARY);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const refresh = useCallback(async (quiet = false) => {
    const requestId = ++latestRequest.current;
    if (quiet) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const nextLibrary = await loadLibrary();
      if (requestId !== latestRequest.current) return;
      setLibrary(nextLibrary);
      setLoadError(null);
    } catch (error) {
      if (requestId !== latestRequest.current) return;
      setLoadError(errorMessage(error, 'Impossible de charger la médiathèque.'));
    } finally {
      if (requestId === latestRequest.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      latestRequest.current += 1;
    };
  }, [refresh]);

  return {
    library,
    isLoading,
    isRefreshing,
    loadError,
    refresh,
  };
}

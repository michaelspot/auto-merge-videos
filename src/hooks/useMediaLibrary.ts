import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { loadLibrary } from '../api';
import { clipTrimKey, readClipTrims, writeClipTrims } from '../clipTrims';
import { EMPTY_LIBRARY, type ClipTrim, type MediaItem, type MediaLibrary } from '../types';
import { errorMessage } from '../utils';

function reuseIfSame<T>(next: T[], previous: T[] | undefined) {
  return previous && previous.length === next.length && next.every((item, index) => item === previous[index])
    ? previous
    : next;
}

export function useMediaLibrary(enabled = true) {
  const [library, setLibrary] = useState<MediaLibrary>(EMPTY_LIBRARY);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const [trims, setTrims] = useState(readClipTrims);
  const trimsRef = useRef(trims);

  const updateClipTrim = useCallback((item: MediaItem, trim: ClipTrim | null) => {
    const next = { ...trimsRef.current };
    const key = clipTrimKey(item);
    if (trim) next[key] = trim;
    else delete next[key];
    writeClipTrims(next);
    trimsRef.current = next;
    setTrims(next);
  }, []);

  // Structural sharing: a trim edit only replaces the edited item (and its list), so
  // unchanged items/lists keep their identity and memoized consumers skip re-rendering.
  const trimmedItems = useRef(new WeakMap<MediaItem, MediaItem>());
  const lastEdited = useRef<MediaLibrary | null>(null);
  const editedLibrary = useMemo(() => {
    const cache = trimmedItems.current;
    const applyTrim = (item: MediaItem) => {
      const trim = trims[clipTrimKey(item)];
      const cached = cache.get(item);
      if (cached && cached.trim === trim) return cached;
      const next = { ...item, trim };
      cache.set(item, next);
      return next;
    };
    const previous = lastEdited.current;
    const hooks = reuseIfSame(library.hooks.map(applyTrim), previous?.hooks);
    const captures = reuseIfSame(library.captures.map(applyTrim), previous?.captures);
    const next =
      previous
      && previous.hooks === hooks
      && previous.captures === captures
      && previous.musiques === library.musiques
      && previous.influs === library.influs
      && previous.textes === library.textes
        ? previous
        : { ...library, hooks, captures };
    lastEdited.current = next;
    return next;
  }, [library, trims]);

  const refresh = useCallback(async (quiet = false, discardCurrent = false) => {
    const requestId = ++latestRequest.current;
    if (discardCurrent) {
      setLibrary(EMPTY_LIBRARY);
      setLoadError(null);
    }
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
    if (!enabled) return undefined;
    void refresh();
    return () => {
      latestRequest.current += 1;
    };
  }, [enabled, refresh]);

  return {
    library: editedLibrary,
    updateClipTrim,
    isLoading,
    isRefreshing,
    loadError,
    refresh,
  };
}

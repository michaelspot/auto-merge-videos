export type MediaKind = 'hook' | 'capture' | 'musique' | 'influ';
export type LibraryKey = 'hooks' | 'captures' | 'musiques' | 'textes';
export type AppTab = 'montage' | 'higgsfield' | 'import' | 'scrap' | 'settings';

export interface ClipTrim {
  start: number;
  end: number;
}

export interface MediaItem {
  name: string;
  url: string;
  posterUrl?: string;
  size: number;
  lastModified: string;
  public_id: string;
  tags: string[];
  resource_type?: string;
  trim?: ClipTrim;
}

export interface TextItem {
  text: string;
  tags: string[];
}

export interface MediaLibrary {
  hooks: MediaItem[];
  captures: MediaItem[];
  musiques: MediaItem[];
  influs: MediaItem[];
  textes: TextItem[];
}

export interface GeneratedVideo {
  url: string;
  name: string;
}

export interface BulkCombination {
  hook: MediaItem;
  capture: MediaItem;
  musique: MediaItem | null;
  texte: TextItem | null;
}

export interface GenerationProgress {
  label: string;
  current: number;
  total: number;
  percent: number;
  elapsedSeconds: number;
}

export const EMPTY_LIBRARY: MediaLibrary = {
  hooks: [],
  captures: [],
  musiques: [],
  influs: [],
  textes: [],
};

export type MediaKind = 'hook' | 'capture' | 'musique';
export type LibraryKey = 'hooks' | 'captures' | 'musiques' | 'textes';
export type AppTab = 'montage' | 'import' | 'bulk';

export interface MediaItem {
  name: string;
  url: string;
  posterUrl?: string;
  size: number;
  lastModified: string;
  public_id: string;
  tags: string[];
  resource_type?: string;
}

export interface TextItem {
  text: string;
  tags: string[];
}

export interface MediaLibrary {
  hooks: MediaItem[];
  captures: MediaItem[];
  musiques: MediaItem[];
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
  textes: [],
};

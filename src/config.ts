const FALLBACK_API_URL = 'https://auto-edit-tiktok.vercel.app';

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL?.trim() || FALLBACK_API_URL
).replace(/\/$/, '');

export const apiUrl = (path: string) =>
  `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

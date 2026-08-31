export const ALLOWED_UPLOAD_FOLDERS = new Set([
  'hooks',
  'screenrecordings',
  'musics',
]);

export const ALLOWED_DELETE_FOLDERS = new Set(ALLOWED_UPLOAD_FOLDERS);
export const MAX_PUBLIC_ID_LENGTH = 255;
export const MAX_CLOUDINARY_PUBLIC_ID_LENGTH = 255;
export const MAX_TAG_LENGTH = 64;
export const MAX_TEXT_LENGTH = 500;

const MAX_MEDIA_URL_LENGTH = 2048;
const CLOUDINARY_HOSTNAME = 'res.cloudinary.com';
const R2_HOSTNAME = 'pub-f14155236ed54ea8847eb4db5d3c64c1.r2.dev';
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const UPLOAD_PUBLIC_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function allowMethod(req, res, method) {
  if (req.method === method) return true;

  res.setHeader('Allow', method);
  res.status(405).json({ error: 'Méthode non autorisée.' });
  return false;
}

export function isValidUploadPublicId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_PUBLIC_ID_LENGTH
    && UPLOAD_PUBLIC_ID.test(value);
}

export function isValidCloudinaryPublicId(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_CLOUDINARY_PUBLIC_ID_LENGTH
    && !CONTROL_CHARACTERS.test(value);
}

export function normalizeOptionalTag(value) {
  if (value === undefined || value === null || value === '') {
    return { valid: true, value: undefined };
  }

  if (typeof value !== 'string') return { valid: false, value: undefined };

  const normalized = value.trim();
  if (!normalized) return { valid: true, value: undefined };

  return {
    valid: normalized.length <= MAX_TAG_LENGTH,
    value: normalized,
  };
}

export function normalizeText(value) {
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_TEXT_LENGTH) return null;
  return normalized;
}

export function parseAllowedMediaUrl(value, cloudinaryResourceTypes = ['video']) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_MEDIA_URL_LENGTH) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.port
      || url.hash
    ) {
      return null;
    }

    if (url.hostname === R2_HOSTNAME) {
      return url.pathname !== '/' ? url : null;
    }

    if (url.hostname !== CLOUDINARY_HOSTNAME) return null;

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const segments = url.pathname.split('/').filter(Boolean);
    if (
      !cloudName
      || segments.length < 4
      || segments[0] !== cloudName
      || !cloudinaryResourceTypes.includes(segments[1])
      || segments[2] !== 'upload'
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

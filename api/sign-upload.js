import cloudinary from './_cloudinary.js';
import {
  ALLOWED_UPLOAD_FOLDERS,
  allowMethod,
  isValidUploadPublicId,
  MAX_TAG_LENGTH,
  normalizeOptionalTag,
} from './_validation.js';

export default function handler(req, res) {
  if (!allowMethod(req, res, 'POST')) return;

  const { folder, public_id, tags } = req.body || {};
  if (typeof folder !== 'string' || !ALLOWED_UPLOAD_FOLDERS.has(folder)) {
    return res.status(400).json({ error: 'Dossier d’upload invalide.' });
  }

  if (!isValidUploadPublicId(public_id)) {
    return res.status(400).json({ error: 'public_id invalide.' });
  }

  const normalizedTag = normalizeOptionalTag(tags);
  if (!normalizedTag.valid) {
    return res.status(400).json({ error: `Le tag ne peut pas dépasser ${MAX_TAG_LENGTH} caractères.` });
  }

  const timestamp = Math.round(Date.now() / 1000);

  const params = { timestamp, folder, public_id };
  if (normalizedTag.value) params.tags = normalizedTag.value;

  const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);

  res.status(200).json({
    signature,
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  });
}

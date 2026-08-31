import cloudinary from './_cloudinary.js';
import formidable from 'formidable';
import {
  allowMethod,
  isValidUploadPublicId,
  MAX_TAG_LENGTH,
  normalizeOptionalTag,
} from './_validation.js';

export const config = {
  api: { bodyParser: false },
};

const FOLDER_MAP = {
  hook: 'hooks',
  capture: 'screenrecordings',
  musique: 'musics',
};

export default async function handler(req, res) {
  if (!allowMethod(req, res, 'POST')) return;

  try {
    const form = formidable({ maxFileSize: 100 * 1024 * 1024 });
    const [fields, files] = await form.parse(req);

    const type = fields.type?.[0];
    const file = files.file?.[0];
    const normalizedTag = normalizeOptionalTag(fields.tag?.[0]);

    if (!file || !type) {
      return res.status(400).json({ error: 'Fichier ou type manquant.' });
    }

    const folder = FOLDER_MAP[type];
    if (!folder) {
      return res.status(400).json({ error: 'Type invalide.' });
    }

    if (!normalizedTag.valid) {
      return res.status(400).json({ error: `Le tag ne peut pas dépasser ${MAX_TAG_LENGTH} caractères.` });
    }

    const filename = file.originalFilename || 'file';
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/^[-_]+|[-_]+$/g, '')
      || `file_${Date.now()}`;

    if (!isValidUploadPublicId(nameWithoutExt)) {
      return res.status(400).json({ error: 'Nom de fichier invalide ou trop long.' });
    }

    const uploadOptions = {
      folder,
      resource_type: type === 'musique' ? 'auto' : 'video',
      public_id: nameWithoutExt,
      overwrite: true,
    };

    if (normalizedTag.value) {
      uploadOptions.tags = [normalizedTag.value];
    }

    const result = await cloudinary.uploader.upload(file.filepath, uploadOptions);

    res.status(200).json({
      message: 'Upload réussi',
      url: result.secure_url,
      filename,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
}

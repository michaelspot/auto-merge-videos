import cloudinary from './_cloudinary.js';
import {
  ALLOWED_DELETE_FOLDERS,
  allowMethod,
  isValidCloudinaryPublicId,
} from './_validation.js';

export default async function handler(req, res) {
  if (!allowMethod(req, res, 'DELETE')) return;

  try {
    const publicId = req.query.publicId ?? req.query.public_id;
    const { resourceType } = req.query;

    if (!isValidCloudinaryPublicId(publicId)) {
      return res.status(400).json({ error: 'Paramètre invalide : publicId requis.' });
    }

    if (resourceType !== undefined && resourceType !== 'video') {
      return res.status(400).json({ error: 'Type de ressource invalide.' });
    }

    const resource = await cloudinary.api.resource(publicId, { resource_type: 'video' });
    if (!ALLOWED_DELETE_FOLDERS.has(resource.asset_folder)) {
      return res.status(403).json({ error: 'Ce fichier ne peut pas être supprimé.' });
    }

    await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });

    res.status(200).json({
      message: 'Fichier supprimé',
      publicId,
    });
  } catch (error) {
    console.error('Delete error:', error);
    if (error?.http_code === 404) {
      return res.status(404).json({ error: 'Fichier introuvable.' });
    }
    res.status(500).json({ error: error.message });
  }
}

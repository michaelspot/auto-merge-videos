import cloudinary from './_cloudinary.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const { folder, public_id, tags } = req.body || {};
  const timestamp = Math.round(Date.now() / 1000);

  const params = { timestamp, folder, public_id };
  if (tags) params.tags = tags;

  const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);

  res.status(200).json({
    signature,
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  });
}

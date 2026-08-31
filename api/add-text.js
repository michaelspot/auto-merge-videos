import cloudinary from './_cloudinary.js';
import https from 'https';
import {
  allowMethod,
  MAX_TAG_LENGTH,
  MAX_TEXT_LENGTH,
  normalizeOptionalTag,
  normalizeText,
} from './_validation.js';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve([]); }
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

export default async function handler(req, res) {
  if (!allowMethod(req, res, 'POST')) return;

  try {
    const { text, tag } = req.body || {};
    const cleanText = normalizeText(text);

    if (cleanText === null) {
      return res.status(400).json({ error: `Le texte doit contenir entre 1 et ${MAX_TEXT_LENGTH} caractères.` });
    }

    const normalizedTag = normalizeOptionalTag(tag);
    if (!normalizedTag.valid) {
      return res.status(400).json({ error: `Le tag ne peut pas dépasser ${MAX_TAG_LENGTH} caractères.` });
    }

    // Récupérer le JSON existant
    let textes = [];
    try {
      const result = await cloudinary.search
        .expression('asset_folder="texts"')
        .sort_by('created_at', 'desc')
        .max_results(10)
        .execute();

      const jsonFile = (result.resources || []).find(r =>
        r.public_id.includes('.json') || r.format === 'json'
      );

      if (jsonFile) {
        textes = await fetchJson(jsonFile.secure_url);
      }
    } catch (e) {
      console.log('No existing texts file, creating new one');
    }

    // Ajouter le nouveau texte
    const newEntry = { text: cleanText };
    if (normalizedTag.value) {
      newEntry.tag = normalizedTag.value;
    }
    textes.push(newEntry);

    // Upload le JSON mis à jour
    const jsonStr = JSON.stringify(textes, null, 2);
    const dataUri = `data:application/json;base64,${Buffer.from(jsonStr).toString('base64')}`;

    await cloudinary.uploader.upload(dataUri, {
      folder: 'texts',
      resource_type: 'raw',
      public_id: 'textes.json',
      overwrite: true,
    });

    res.status(200).json({ message: 'Texte ajouté', count: textes.length });
  } catch (error) {
    console.error('Add text error:', error);
    res.status(500).json({ error: error.message });
  }
}

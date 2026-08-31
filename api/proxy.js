import https from "https";
import { allowMethod, parseAllowedMediaUrl } from './_validation.js';

export const config = {
  api: {
    responseLimit: false,
  },
};

export default async function handler(req, res) {
  if (!allowMethod(req, res, 'GET')) return;

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "URL manquante" });
  }

  const source = parseAllowedMediaUrl(url);
  if (!source) {
    return res.status(403).json({ error: "URL non autorisée" });
  }

  try {
    const chunks = [];

    await new Promise((resolve, reject) => {
      https.get(source, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Erreur serveur (code ${response.statusCode})`));
          return;
        }

        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve());
        response.on("error", reject);
      }).on("error", reject);
    });

    const buffer = Buffer.concat(chunks);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).send(buffer);
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).json({ error: `Erreur lors du téléchargement de la vidéo : ${error.message}` });
  }
}

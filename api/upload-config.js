export default function handler(req, res) {
  res.status(200).json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || 'tiktok_unsigned',
  });
}

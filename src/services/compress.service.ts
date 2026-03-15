import sharp from 'sharp';

export const compressImage = async (
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> => {
  // Hanya compress image
  if (!mimeType.startsWith('image/')) {
    return { buffer, mimeType };
  }

  // Skip gif (sharp tidak handle animasi gif dengan baik)
  if (mimeType === 'image/gif') {
    return { buffer, mimeType };
  }

  const image = sharp(buffer);
  const metadata = await image.metadata();

  // Resize kalau lebih dari 1920px
  const resized = metadata.width && metadata.width > 1920
    ? image.resize(1920, undefined, { withoutEnlargement: true })
    : image;

  // Compress ke webp untuk efisiensi, fallback ke jpeg
  const compressed = await resized
    .webp({ quality: 82, effort: 4 })
    .toBuffer();

  // Cek kalau compressed lebih kecil dari original
  if (compressed.length < buffer.length) {
    return { buffer: compressed, mimeType: 'image/webp' };
  }

  return { buffer, mimeType };
};
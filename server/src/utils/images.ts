import sharp from 'sharp';

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg']);

export function isImageMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType);
}

/**
 * Re-encodes an uploaded image so its metadata is dropped. EXIF routinely
 * carries GPS coordinates and device identifiers, which must not survive into
 * object storage attached to a CV. sharp omits metadata unless explicitly asked
 * to keep it, so re-encoding is the strip; `rotate()` bakes in the orientation
 * first so the picture does not end up sideways once the tag is gone.
 */
export async function stripImageMetadata(buffer: Buffer, mimeType: string): Promise<Buffer> {
  if (!isImageMimeType(mimeType)) return buffer;

  const pipeline = sharp(buffer).rotate();

  return mimeType === 'image/png'
    ? pipeline.png().toBuffer()
    : pipeline.jpeg({ quality: 90 }).toBuffer();
}

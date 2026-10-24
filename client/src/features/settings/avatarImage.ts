/** Image types the picker offers; the server accepts the same three. */
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

/** Twice the largest size it is drawn at (56 px), for sharp edges on HiDPI screens. */
const SIDE_PX = 128;

/**
 * Turns a picked image into the small square data URL stored as `avatarUrl`.
 *
 * The browser does the work: the centre square is cropped, scaled to 128 px and
 * re-encoded, which also drops EXIF (a phone photo's GPS position included) and
 * anything else riding in the file. A browser that cannot encode WebP answers
 * with PNG, which is larger but still well inside the server's cap.
 */
export async function toAvatarDataUrl(file: File): Promise<string> {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) {
    throw new Error('Choose a PNG, JPEG or WebP image.');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('Choose an image under 5 MB.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That image could not be read.');
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = SIDE_PX;
  canvas.height = SIDE_PX;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('This browser cannot resize images.');
  }

  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    SIDE_PX,
    SIDE_PX,
  );
  bitmap.close();

  return canvas.toDataURL('image/webp', 0.85);
}

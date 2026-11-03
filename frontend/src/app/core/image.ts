export type Decoded = ImageBitmap | HTMLImageElement;

/** The image of a file, turned the right way up (phones store photos sideways with a note). */
export async function decodeImage(file: Blob): Promise<Decoded> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export function sizeOf(image: Decoded): { width: number; height: number } {
  return image instanceof HTMLImageElement ? { width: image.naturalWidth, height: image.naturalHeight } : image;
}

/** The longest side of a picture that is sent, and of its small preview, in pixels. */
const FULL_SIDE = 1600;
const THUMB_SIDE = 320;
/** The backend takes at most 10 MB for an image. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** An image ready to send: the file, its small preview, and what the message tells about it. */
export interface PreparedImage {
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  name: string;
}

/**
 * Makes a chosen image ready to send, in the browser: it is scaled down to 1600 pixels and saved as a JPEG (a big phone
 * photo is never sent, and the position and other details stored in the photo are left behind), with a 320 pixel preview.
 * A GIF is sent as it is, so it keeps moving.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const source = await decodeImage(file);
  try {
    const { width, height } = sizeOf(source);
    const thumb = await scaled(source, THUMB_SIDE, 0.8);
    if (file.type === 'image/gif') return { blob: file, thumb: thumb.blob, width, height, name: file.name };
    const full = await scaled(source, FULL_SIDE, 0.85);
    return { blob: full.blob, thumb: thumb.blob, width: full.width, height: full.height, name: file.name.replace(/\.[^./\\]*$/, '') + '.jpg' };
  } finally {
    if (!(source instanceof HTMLImageElement)) source.close();
  }
}

async function scaled(source: Decoded, longestSide: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const size = sizeOf(source);
  const k = Math.min(1, longestSide / Math.max(size.width, size.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(size.width * k));
  canvas.height = Math.max(1, Math.round(size.height * k));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare images');
  context.fillStyle = '#ffffff'; // a transparent picture gets a white background
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('This image cannot be prepared');
  return { blob, width: canvas.width, height: canvas.height };
}

/** 1536 -> "1.5 KB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

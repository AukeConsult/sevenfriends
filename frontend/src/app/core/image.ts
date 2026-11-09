import { tr } from './i18n';
export type Decoded = ImageBitmap | HTMLImageElement;

/**
 * How big a picture is, read from its first bytes WITHOUT decoding it: `width` and `height` as it is shown (turned the right way up).
 * JPEG (also the position note, EXIF) and PNG; null for anything else.
 */
async function peek(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const view = new DataView(await file.slice(0, 512 * 1024).arrayBuffer());
    if (view.getUint32(0) === 0x89504e47 && view.byteLength >= 24) return { width: view.getUint32(16), height: view.getUint32(20) }; // PNG
    if (view.getUint16(0) !== 0xffd8) return null;
    let at = 2;
    let orientation = 1;
    while (at + 4 < view.byteLength) {
      if (view.getUint8(at) !== 0xff) { at++; continue; }
      const marker = view.getUint8(at + 1);
      if (marker === 0xff) { at++; continue; } // padding
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; } // no length
      const length = view.getUint16(at + 2);
      if (marker === 0xe1 && length >= 16 && view.getUint32(at + 4) === 0x45786966) orientation = exifOrientation(view, at + 10, at + 2 + length);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = view.getUint16(at + 5);
        const width = view.getUint16(at + 7);
        return orientation >= 5 ? { width: height, height: width } : { width, height }; // 5-8: stored sideways
      }
      at += 2 + length;
    }
  } catch {
    /* not readable: the picture is decoded in full */
  }
  return null;
}

/** The position note of a photo (1 = as stored; 5 to 8 = turned a quarter). */
function exifOrientation(view: DataView, tiff: number, end: number): number {
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (at: number) => view.getUint16(at, little);
  if (u16(tiff + 2) !== 0x2a) return 1;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return 1;
  for (let entry = 0, count = u16(ifd); entry < count; entry++) {
    const at = ifd + 2 + entry * 12;
    if (at + 12 > end) break;
    if (u16(at) === 0x0112) {
      const value = u16(at + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/**
 * The longest side a picture is decoded at. A phone photo can have 50 million pixels (200 MB when decoded, far more on a phone
 * that is short of memory): it is made small WHILE it is decoded, never decoded in full first.
 */
const DECODE_SIDE = 1600;

/** The image of a file, turned the right way up (phones store photos sideways with a note), at most `maxSide` pixels on its longest side. */
export async function decodeImage(file: Blob, maxSide = DECODE_SIDE): Promise<Decoded> {
  const size = await peek(file);
  const k = size ? Math.min(1, maxSide / Math.max(size.width, size.height)) : 1;
  const attempts: ImageBitmapOptions[] = [];
  if (size && k < 1) {
    // the smaller size first (little memory); in full only when the browser refuses to resize
    attempts.push({ imageOrientation: 'from-image', resizeWidth: Math.max(1, Math.round(size.width * k)), resizeHeight: Math.max(1, Math.round(size.height * k)), resizeQuality: 'medium' });
  }
  attempts.push({ imageOrientation: 'from-image' });
  for (const options of attempts) {
    try {
      return await createImageBitmap(file, options);
    } catch {
      /* try the next way */
    }
  }
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

export function sizeOf(image: Decoded | HTMLVideoElement | HTMLCanvasElement): { width: number; height: number } {
  if (image instanceof HTMLVideoElement) return { width: image.videoWidth, height: image.videoHeight };
  if (image instanceof HTMLCanvasElement) return { width: image.width, height: image.height };
  return image instanceof HTMLImageElement ? { width: image.naturalWidth, height: image.naturalHeight } : image;
}

/** The longest side of a picture that is sent, and of its small preview, in pixels. */
const FULL_SIDE = 1024;
const THUMB_SIDE = 320;
/** A picture that is sent is squeezed (lower JPEG quality) until it is no bigger than this, as long as the quality stays good enough. */
const TARGET_BYTES = 200 * 1024;
const BEST_QUALITY = 0.8;
const WORST_QUALITY = 0.5;
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
 * Makes a chosen image ready to send, in the browser: it is scaled down to 1024 pixels and saved as a JPEG of about 200 KB at most (a big phone
 * photo is never sent, and the position and other details stored in the photo are left behind), with a 320 pixel preview.
 * A GIF is sent as it is, so it keeps moving.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const source = await decodeImage(file, FULL_SIDE); // already small: see decodeImage
  const canvases: HTMLCanvasElement[] = [];
  try {
    if (file.type === 'image/gif') {
      const { width, height } = sizeOf(source);
      const thumb = await scaled(source, THUMB_SIDE, 0.8);
      return { blob: file, thumb: thumb.blob, width, height, name: file.name };
    }
    const full = drawn(source, FULL_SIDE);
    canvases.push(full);
    const fullBlob = await jpegUnder(full, TARGET_BYTES);
    const small = drawn(full, THUMB_SIDE); // the preview is made from the small picture, not from the big one again
    canvases.push(small);
    return { blob: fullBlob, thumb: await jpeg(small, 0.8), width: full.width, height: full.height, name: file.name.replace(/\.[^./\\]*$/, '') + '.jpg' };
  } finally {
    if (!(source instanceof HTMLImageElement)) source.close();
    canvases.forEach(release);
  }
}

/** The picture (or the frame of a video, or another canvas) scaled down to `longestSide` pixels, on a new canvas. */
function drawn(source: Decoded | HTMLVideoElement | HTMLCanvasElement, longestSide: number): HTMLCanvasElement {
  const size = sizeOf(source);
  const k = Math.min(1, longestSide / Math.max(size.width, size.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(size.width * k));
  canvas.height = Math.max(1, Math.round(size.height * k));
  const context = canvas.getContext('2d');
  if (!context) throw new Error(tr('core.thisBrowserCannotPrepare', 'This browser cannot prepare images'));
  context.fillStyle = '#ffffff'; // a transparent picture gets a white background
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function jpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error(tr('core.thisImageCannotBe', 'This image cannot be prepared'));
  return blob;
}

/** The picture as a JPEG: the best quality that fits `maxBytes`, but never worse than WORST_QUALITY (a busy picture may stay a bit bigger). */
async function jpegUnder(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob> {
  let blob = await jpeg(canvas, BEST_QUALITY);
  for (let quality = BEST_QUALITY - 0.09; blob.size > maxBytes && quality >= WORST_QUALITY; quality -= 0.09) blob = await jpeg(canvas, quality);
  return blob;
}

/** A canvas keeps its pixels in memory until it is collected: make it empty at once (a phone short of memory feels the difference). */
function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * The prepared image turned a quarter turn (clockwise or not), with its preview made again from the turned picture. A GIF is returned as it is
 * (it would stop moving). Each turn is made from the picture that is shown, so turning twice is a half turn.
 */
export async function rotateImage(image: PreparedImage, clockwise: boolean): Promise<PreparedImage> {
  if (image.blob.type === 'image/gif') return image;
  const source = await decodeImage(image.blob, FULL_SIDE);
  const canvases: HTMLCanvasElement[] = [];
  try {
    const { width, height } = sizeOf(source);
    const turned = document.createElement('canvas');
    canvases.push(turned);
    turned.width = height;
    turned.height = width;
    const context = turned.getContext('2d');
    if (!context) throw new Error(tr('core.thisBrowserCannotTurn', 'This browser cannot turn images'));
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, turned.width, turned.height);
    context.imageSmoothingQuality = 'high';
    if (clockwise) {
      context.translate(height, 0);
      context.rotate(Math.PI / 2);
    } else {
      context.translate(0, width);
      context.rotate(-Math.PI / 2);
    }
    context.drawImage(source, 0, 0);
    const blob = await jpegUnder(turned, TARGET_BYTES);
    const small = drawn(turned, THUMB_SIDE);
    canvases.push(small);
    return { blob, thumb: await jpeg(small, 0.8), width: height, height: width, name: image.name };
  } finally {
    if (!(source instanceof HTMLImageElement)) source.close();
    canvases.forEach(release);
  }
}

/** The picture (or the frame of a video on the screen) scaled down to `longestSide` pixels, as a JPEG. */
export async function scaled(source: Decoded | HTMLVideoElement, longestSide: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = drawn(source, longestSide);
  try {
    return { blob: await jpeg(canvas, quality), width: canvas.width, height: canvas.height };
  } finally {
    release(canvas);
  }
}

/** 1536 -> "1.5 KB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

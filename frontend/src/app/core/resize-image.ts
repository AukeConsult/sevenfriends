/**
 * A picture chosen by the person, cut to a square and made small enough to be a profile picture: a JPEG data URL of at most `maxBytes` bytes
 * (the backend refuses more). The quality goes down in steps until it fits.
 */
export async function squareJpeg(file: File, side = 256, maxBytes = 60 * 1024): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext('2d')!;
  const edge = Math.min(bitmap.width, bitmap.height);
  context.drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, side, side);
  bitmap.close();
  for (let quality = 0.85; quality > 0.3; quality -= 0.15) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length * 0.75 <= maxBytes) return url;
  }
  return canvas.toDataURL('image/jpeg', 0.3);
}

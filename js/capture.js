// Photo intake: open camera / photo library, decode with correct orientation, downscale.

/** Opens the native picker. capture=true → rear camera straight away on phones. */
export function pickPhoto({ capture = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    input.dataset.role = capture ? 'camera-input' : 'library-input';
    let settled = false;
    const finish = (f) => { if (settled) return; settled = true; input.remove(); resolve(f); };
    input.addEventListener('change', () => finish(input.files?.[0] || null));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
  });
}

/**
 * Decode an image File/Blob into a canvas, EXIF orientation applied, longest side ≤ maxSide.
 * <img> decoding honours EXIF orientation in Safari ≥13.1 / Chrome ≥81 (image-orientation: from-image).
 * iOS hands us JPEG even for HEIC library photos when accept="image/*".
 */
export async function fileToCanvas(file, maxSide = 1024) {
  let src = null, w = 0, h = 0, cleanup = () => {};
  try {
    const url = URL.createObjectURL(file);
    cleanup = () => URL.revokeObjectURL(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    src = img; w = img.naturalWidth; h = img.naturalHeight;
  } catch {
    cleanup();
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      src = bmp; w = bmp.width; h = bmp.height;
      cleanup = () => bmp.close?.();
    } catch {
      throw new Error('decode');
    }
  }
  const s = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, cw, ch);
  cleanup();
  return canvas;
}

export function scaledCanvas(src, maxSide) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export const canvasToBlob = (c, type = 'image/png', q) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), type, q));

export async function blobToCanvas(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

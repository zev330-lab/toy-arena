// Turn a photo + work-resolution mask into the stored cutout: a cropped RGBA image,
// its outline contour (for the 3D shape), a fattened outline (comic border) and stats seed.

import { featherAlpha, maskBBox, dilate, edgeColor, resizeBilinear } from './core/mask.js';
import { traceOutline } from './core/contour.js';
import { imageFeatures, hashBytes } from './core/stats.js';

export const CUT_SIDE = 512;

/** Crop a sub-rectangle of a float field and resample it. */
function cropResample(field, fw, fh, rx, ry, rw, rh, nw, nh) {
  const sub = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const sx = rx + x, sy = ry + y;
    sub[y * rw + x] = sx < 0 || sy < 0 || sx >= fw || sy >= fh ? 0 : field[sy * fw + sx];
  }
  return resizeBilinear(sub, rw, rh, nw, nh);
}

/**
 * @param photo HTMLCanvasElement (≤1024 px) the mask was computed from
 * @param mask  Uint8Array work mask (0/1), size w×h
 */
export function makeCutout(photo, mask, w, h) {
  const bb = maskBBox(mask, w, h);
  if (!bb) throw new Error('empty mask');
  const pad = Math.round(Math.max(bb.w, bb.h) * 0.04) + 2;
  const rx = bb.x - pad, ry = bb.y - pad, rw = bb.w + pad * 2, rh = bb.h + pad * 2;
  const sx = photo.width / w, sy = photo.height / h;
  const s = Math.min(CUT_SIDE / (rw * sx), CUT_SIDE / (rh * sy), 1.5);
  const cw = Math.max(8, Math.round(rw * sx * s)), ch = Math.max(8, Math.round(rh * sy * s));

  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(photo, rx * sx, ry * sy, rw * sx, rh * sy, 0, 0, cw, ch);

  // soft alpha from the work mask, upsampled to crop resolution
  const soft = featherAlpha(mask, w, h, 1);
  const alphaF = cropResample(soft, w, h, rx, ry, rw, rh, cw, ch);
  const alpha = new Uint8Array(cw * ch);
  for (let i = 0; i < alpha.length; i++) {
    const a = alphaF[i] / 255;
    const t = Math.min(1, Math.max(0, (a - 0.3) / 0.4)); // tighten: smoothstep 0.3..0.7
    alpha[i] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  const img = g.getImageData(0, 0, cw, ch);
  for (let i = 0; i < alpha.length; i++) img.data[i * 4 + 3] = alpha[i];
  g.putImageData(img, 0, 0);

  const bin = new Uint8Array(cw * ch);
  for (let i = 0; i < bin.length; i++) bin[i] = alpha[i] > 127 ? 1 : 0;
  const contour = traceOutline(alpha, cw, ch, { maxVerts: 300 });
  const r = Math.max(3, Math.round(Math.max(cw, ch) * 0.014));
  const fat = featherAlpha(dilate(bin, cw, ch, r), cw, ch, 1);
  const outline = traceOutline(fat, cw, ch, { maxVerts: 200, minHoleFrac: 0.01 });
  const ec = edgeColor(img.data, bin, cw, ch);
  const features = imageFeatures(img.data, cw, ch);
  const hash = hashBytes(img.data, 13);
  return {
    canvas, width: cw, height: ch, contour, outline,
    edgeColor: `#${ec.map(v => v.toString(16).padStart(2, '0')).join('')}`,
    features, hash, coverage: bin.reduce((a, b) => a + b, 0) / bin.length,
  };
}

/** Fit a back-photo cutout onto the front silhouette box, mirrored (viewer behind sees it flipped). */
export function fitBack(backCut, front) {
  const c = document.createElement('canvas');
  c.width = front.width; c.height = front.height;
  const g = c.getContext('2d');
  g.translate(c.width, 0);
  g.scale(-1, 1);
  g.drawImage(backCut.canvas, 0, 0, c.width, c.height);
  return c;
}

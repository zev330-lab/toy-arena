// Pure mask utilities (no DOM) — used by the cutout pipeline and unit tests.
// Masks are Uint8Array of 0/1, row-major, width w, height h.

export function thresholdMask(values, w, h, t = 0.5) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = values[i] > t ? 1 : 0;
  return out;
}

/** Connected components (8-connected for foreground). */
export function labelComponents(mask, w, h, conn8 = true) {
  const labels = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    const id = comps.length;
    const c = { id, area: 0, minX: w, minY: h, maxX: -1, maxY: -1, sumX: 0, sumY: 0, touchesEdge: false };
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p / w) | 0;
      c.area++; c.sumX += x; c.sumY += y;
      if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.touchesEdge = true;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (!conn8 && dx && dy) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && labels[q] === -1) { labels[q] = id; stack[sp++] = q; }
        }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/** Keep the largest component plus sizeable components near it (e.g. a detached claw). */
export function keepMainComponents(mask, w, h, { nearFrac = 0.02, nearDist = null } = {}) {
  const { labels, comps } = labelComponents(mask, w, h);
  const out = new Uint8Array(w * h);
  if (!comps.length) return out;
  let main = comps[0];
  for (const c of comps) if (c.area > main.area) main = c;
  const dist = nearDist ?? Math.max(4, Math.round(Math.max(main.maxX - main.minX, main.maxY - main.minY) * 0.08));
  const keep = new Uint8Array(comps.length);
  keep[main.id] = 1;
  for (const c of comps) {
    if (c === main || c.area < main.area * nearFrac) continue;
    const gx = Math.max(0, Math.max(main.minX - c.maxX, c.minX - main.maxX));
    const gy = Math.max(0, Math.max(main.minY - c.maxY, c.minY - main.maxY));
    if (gx <= dist && gy <= dist) keep[c.id] = 1;
  }
  for (let i = 0; i < out.length; i++) if (labels[i] >= 0 && keep[labels[i]]) out[i] = 1;
  return out;
}

/** Fill enclosed background regions smaller than maxHoleArea (big gaps, like arm/body, stay open). */
export function fillSmallHoles(mask, w, h, maxHoleArea) {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const { labels, comps } = labelComponents(inv, w, h, false);
  const out = mask.slice();
  const fill = new Uint8Array(comps.length);
  for (const c of comps) if (!c.touchesEdge && c.area <= maxHoleArea) fill[c.id] = 1;
  for (let i = 0; i < out.length; i++) if (labels[i] >= 0 && fill[labels[i]]) out[i] = 1;
  return out;
}

function morph(mask, w, h, r, isMax) {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  // horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = isMax ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        const s = xx < 0 || xx >= w ? 0 : mask[row + xx];
        if (isMax ? s : !s) { v = isMax ? 1 : 0; break; }
      }
      tmp[row + x] = v;
    }
  }
  // vertical pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = isMax ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        const s = yy < 0 || yy >= h ? 0 : tmp[yy * w + x];
        if (isMax ? s : !s) { v = isMax ? 1 : 0; break; }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}
export const dilate = (m, w, h, r = 1) => morph(m, w, h, r, true);
export const erode = (m, w, h, r = 1) => morph(m, w, h, r, false);
export const openMask = (m, w, h, r = 1) => dilate(erode(m, w, h, r), w, h, r);
export const closeMask = (m, w, h, r = 1) => erode(dilate(m, w, h, r), w, h, r);

export function maskArea(mask) {
  let a = 0;
  for (let i = 0; i < mask.length; i++) a += mask[i];
  return a;
}

export function maskBBox(mask, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function maskStats(mask, w, h) {
  const area = maskArea(mask);
  const bb = maskBBox(mask, w, h);
  const touches = { top: false, bottom: false, left: false, right: false };
  for (let x = 0; x < w; x++) {
    if (mask[x]) touches.top = true;
    if (mask[(h - 1) * w + x]) touches.bottom = true;
  }
  for (let y = 0; y < h; y++) {
    if (mask[y * w]) touches.left = true;
    if (mask[y * w + w - 1]) touches.right = true;
  }
  const touchCount = Object.values(touches).filter(Boolean).length;
  return { area, frac: area / (w * h), bbox: bb, touches, touchCount };
}

/**
 * Plausibility of a mask being "one toy in a photo": 5–85% of the frame,
 * not glued to every edge, reasonably solid inside its bounding box.
 * Returns a score (higher = better, <= 0 = implausible).
 */
export function scoreMask(mask, w, h) {
  const s = maskStats(mask, w, h);
  if (!s.bbox || s.frac < 0.02) return { score: 0, ...s };
  let score = 1;
  if (s.frac < 0.05) score *= s.frac / 0.05;
  if (s.frac > 0.85) score *= Math.max(0, (1 - s.frac) / 0.15);
  if (s.frac > 0.1 && s.frac < 0.6) score *= 1.25;
  score *= [1, 0.95, 0.7, 0.3, 0.05][s.touchCount];
  const fill = s.area / (s.bbox.w * s.bbox.h);
  if (fill < 0.12) score *= fill / 0.12;
  // prefer masks that cover the centre of the picture
  const cx = (s.bbox.x + s.bbox.w / 2) / w, cy = (s.bbox.y + s.bbox.h / 2) / h;
  score *= 1 - Math.min(0.4, Math.hypot(cx - 0.5, cy - 0.5) * 0.6);
  return { score, ...s };
}

/** Full cleanup: remove specks, keep toy (+ near parts), fill pinholes, smooth. */
export function cleanMask(mask, w, h, { holeFrac = 0.015 } = {}) {
  const r = Math.max(1, Math.round(Math.max(w, h) / 500));
  let m = openMask(mask, w, h, r);
  if (maskArea(m) === 0) m = mask.slice();
  m = keepMainComponents(m, w, h);
  m = closeMask(m, w, h, r);
  m = fillSmallHoles(m, w, h, Math.max(16, maskArea(m) * holeFrac));
  m = keepMainComponents(m, w, h);
  return m;
}

/** Box-blur the binary mask into a soft 0..255 alpha (feathered edge). */
export function featherAlpha(mask, w, h, r = 1) {
  const src = new Float32Array(w * h);
  for (let i = 0; i < src.length; i++) src[i] = mask[i] ? 255 : 0;
  const tmp = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); s += src[y * w + xx]; }
    tmp[y * w + x] = s / n;
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); s += tmp[yy * w + x]; }
    out[y * w + x] = Math.round(s / n);
  }
  return out;
}

// ---------- colour helpers for the fallback cutout ----------
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function fLab(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
export function rgbToLab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function boxBlurRGB(rgba, w, h, r) {
  const out = new Float32Array(w * h * 3);
  const tmp = new Float32Array(w * h * 3);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0, b = 0, c = 0;
    for (let k = -r; k <= r; k++) {
      const xx = Math.min(w - 1, Math.max(0, x + k)), p = (y * w + xx) * 4;
      a += rgba[p]; b += rgba[p + 1]; c += rgba[p + 2];
    }
    const o = (y * w + x) * 3; tmp[o] = a / n; tmp[o + 1] = b / n; tmp[o + 2] = c / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0, b = 0, c = 0;
    for (let k = -r; k <= r; k++) {
      const yy = Math.min(h - 1, Math.max(0, y + k)), p = (yy * w + x) * 3;
      a += tmp[p]; b += tmp[p + 1]; c += tmp[p + 2];
    }
    const o = (y * w + x) * 3; out[o] = a / n; out[o + 1] = b / n; out[o + 2] = c / n;
  }
  return out;
}

function kmeans(samples, k, iters = 10) {
  // samples: array of [L,a,b]; deterministic init spread across the list
  const cents = [];
  for (let i = 0; i < k; i++) cents.push(samples[Math.floor((i + 0.5) * samples.length / k)].slice());
  const assign = new Int32Array(samples.length);
  for (let it = 0; it < iters; it++) {
    const sums = cents.map(() => [0, 0, 0, 0]);
    samples.forEach((s, i) => {
      let best = 0, bd = Infinity;
      cents.forEach((c, j) => { const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      assign[i] = best;
      const t = sums[best]; t[0] += s[0]; t[1] += s[1]; t[2] += s[2]; t[3]++;
    });
    sums.forEach((t, j) => { if (t[3]) cents[j] = [t[0] / t[3], t[1] / t[3], t[2] / t[3]]; });
  }
  // spread + population per cluster
  const stat = cents.map(() => ({ sum: 0, n: 0 }));
  samples.forEach((s, i) => {
    const c = cents[assign[i]];
    stat[assign[i]].sum += Math.sqrt((s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2);
    stat[assign[i]].n++;
  });
  return cents.map((c, j) => ({ c, spread: stat[j].n ? stat[j].sum / stat[j].n : 0, n: stat[j].n }))
    .filter(x => x.n >= samples.length * 0.03);
}

/**
 * Fallback cutout: model the background from the photo border (k-means in Lab),
 * then flood-fill background inward from the border. Whatever is not reached is the toy.
 * Works well for a toy on a plain-ish table / wall.
 */
export function backgroundFloodMask(rgba, w, h, { tol = 14, blur = 2 } = {}) {
  const rgb = boxBlurRGB(rgba, w, h, blur);
  const lab = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const [L, A, B] = rgbToLab(rgb[i * 3] | 0, rgb[i * 3 + 1] | 0, rgb[i * 3 + 2] | 0);
    lab[i * 3] = L; lab[i * 3 + 1] = A; lab[i * 3 + 2] = B;
  }
  const samples = [];
  const step = Math.max(1, Math.round((w + h) / 400));
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.015));
  for (let b = 0; b < band; b++) {
    for (let x = 0; x < w; x += step) {
      for (const y of [b, h - 1 - b]) { const i = (y * w + x) * 3; samples.push([lab[i], lab[i + 1], lab[i + 2]]); }
    }
    for (let y = 0; y < h; y += step) {
      for (const x of [b, w - 1 - b]) { const i = (y * w + x) * 3; samples.push([lab[i], lab[i + 1], lab[i + 2]]); }
    }
  }
  const clusters = kmeans(samples, 4);
  const thr = clusters.map(c => Math.max(tol, Math.min(tol * 2.6, c.spread * 2.8)));
  const bgDist = (i) => {
    let best = Infinity;
    for (let j = 0; j < clusters.length; j++) {
      const c = clusters[j].c;
      const d = Math.sqrt((lab[i * 3] - c[0]) ** 2 + (lab[i * 3 + 1] - c[1]) ** 2 + (lab[i * 3 + 2] - c[2]) ** 2) / thr[j];
      if (d < best) best = d;
    }
    return best; // < 1 means "looks like background"
  };
  const near = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) near[i] = bgDist(i);

  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let qh = 0, qt = 0;
  const push = (i) => { bg[i] = 1; queue[qt++] = i; };
  for (let x = 0; x < w; x++) { for (const y of [0, h - 1]) { const i = y * w + x; if (!bg[i] && near[i] < 1.6) push(i); } }
  for (let y = 0; y < h; y++) { for (const x of [0, w - 1]) { const i = y * w + x; if (!bg[i] && near[i] < 1.6) push(i); } }
  const gradTol = tol * 0.35;
  while (qh < qt) {
    const p = queue[qh++];
    const x = p % w, y = (p / w) | 0;
    const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const q of nb) {
      if (q < 0 || bg[q]) continue;
      if (near[q] < 1) { push(q); continue; }
      // smooth lighting gradients: allow drifting a bit when the step is tiny
      const d = Math.sqrt((lab[p * 3] - lab[q * 3]) ** 2 + (lab[p * 3 + 1] - lab[q * 3 + 1]) ** 2 + (lab[p * 3 + 2] - lab[q * 3 + 2]) ** 2);
      if (d < gradTol && near[q] < 1.8) push(q);
    }
  }
  const fg = new Uint8Array(w * h);
  for (let i = 0; i < fg.length; i++) fg[i] = bg[i] ? 0 : 1;
  return fg;
}

/** Keep only the connected component under (or nearest to) a tap. */
export function componentAt(mask, w, h, tx, ty) {
  const { labels, comps } = labelComponents(mask, w, h);
  if (!comps.length) return mask.slice();
  let id = labels[Math.round(ty) * w + Math.round(tx)];
  if (id < 0) {
    let best = Infinity;
    for (const c of comps) {
      if (c.area < 20) continue;
      const cx = Math.max(c.minX, Math.min(tx, c.maxX)), cy = Math.max(c.minY, Math.min(ty, c.maxY));
      const d = Math.hypot(cx - tx, cy - ty);
      if (d < best) { best = d; id = c.id; }
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) if (labels[i] === id) out[i] = 1;
  return out;
}

/** Nearest-neighbour resample of a mask/alpha array. */
export function resizeNearest(src, w, h, nw, nh) {
  const out = new src.constructor(nw * nh);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor((y + 0.5) * h / nh));
    for (let x = 0; x < nw; x++) out[y * nw + x] = src[sy * w + Math.min(w - 1, Math.floor((x + 0.5) * w / nw))];
  }
  return out;
}

/** Bilinear resample of a float/uint8 field (used for model confidence masks). */
export function resizeBilinear(src, w, h, nw, nh) {
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const fy = Math.max(0, Math.min(h - 1, (y + 0.5) * h / nh - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < nw; x++) {
      const fx = Math.max(0, Math.min(w - 1, (x + 0.5) * w / nw - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const a = src[y0 * w + x0] * (1 - tx) + src[y0 * w + x1] * tx;
      const b = src[y1 * w + x0] * (1 - tx) + src[y1 * w + x1] * tx;
      out[y * nw + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/**
 * Push toy colours outward into transparent pixels so texture sampling at the
 * silhouette edge never picks up background colour. Mutates rgba (alpha untouched).
 */
export function edgeBleed(rgba, alpha, w, h, passes = 4) {
  let known = new Uint8Array(w * h);
  for (let i = 0; i < known.length; i++) known[i] = alpha[i] > 127 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = known.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!known[j]) continue;
        r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n++;
      }
      if (n) { rgba[i * 4] = r / n; rgba[i * 4 + 1] = g / n; rgba[i * 4 + 2] = b / n; next[i] = 1; }
    }
    known = next;
  }
  return rgba;
}

/** Average colour along the silhouette border (used for side walls / accents). */
export function edgeColor(rgba, mask, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!mask[i]) continue;
    if (mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w]) continue;
    r += rgba[i * 4]; g += rgba[i * 4 + 1]; b += rgba[i * 4 + 2]; n++;
  }
  if (!n) return [128, 128, 128];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  labelComponents, keepMainComponents, fillSmallHoles, cleanMask, maskArea, maskBBox,
  scoreMask, featherAlpha, backgroundFloodMask, componentAt, edgeBleed, dilate, erode, resizeBilinear,
} from '../../js/core/mask.js';

const W = 100, H = 120;
function blank(w = W, h = H) { return new Uint8Array(w * h); }
function rect(m, x0, y0, x1, y1, v = 1, w = W) { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = v; }

test('labelComponents counts separate blobs and their areas', () => {
  const m = blank();
  rect(m, 10, 10, 20, 20);
  rect(m, 50, 50, 60, 80);
  const { comps } = labelComponents(m, W, H);
  assert.equal(comps.length, 2);
  assert.deepEqual(comps.map(c => c.area).sort((a, b) => a - b), [100, 300]);
});

test('keepMainComponents keeps the body and a nearby claw, drops far specks', () => {
  const m = blank();
  rect(m, 30, 20, 70, 100);       // body
  rect(m, 72, 40, 80, 55);        // detached claw, 2px gap
  rect(m, 2, 2, 6, 6);            // far speck
  const out = keepMainComponents(m, W, H);
  assert.equal(out[45 * W + 75], 1, 'claw kept');
  assert.equal(out[3 * W + 3], 0, 'speck removed');
  assert.equal(maskArea(out), 40 * 80 + 8 * 15);
});

test('fillSmallHoles fills pinholes but keeps a big arm gap open', () => {
  const m = blank();
  rect(m, 20, 20, 80, 100);
  rect(m, 30, 30, 32, 32, 0);     // pinhole (4px)
  rect(m, 45, 40, 60, 80, 0);     // big gap (600px)
  const out = fillSmallHoles(m, W, H, 50);
  assert.equal(out[31 * W + 31], 1);
  assert.equal(out[60 * W + 50], 0);
});

test('cleanMask removes noise and returns one solid figure', () => {
  const m = blank();
  rect(m, 25, 15, 75, 110);
  for (let i = 0; i < 40; i++) m[((i * 37) % H) * W + ((i * 53) % 20)] = 1; // salt noise on the left strip
  m[60 * W + 50] = 0; m[61 * W + 50] = 0; // pepper inside
  const out = cleanMask(m, W, H);
  const bb = maskBBox(out, W, H);
  assert.deepEqual(bb, { x: 25, y: 15, w: 50, h: 95 });
  assert.equal(out[60 * W + 50], 1);
  assert.equal(labelComponents(out, W, H).comps.length, 1);
});

test('dilate/erode are inverse-ish on a rectangle', () => {
  const m = blank(); rect(m, 30, 30, 60, 60);
  assert.equal(maskArea(dilate(m, W, H, 1)), 32 * 32);
  assert.equal(maskArea(erode(m, W, H, 1)), 28 * 28);
});

test('scoreMask prefers a centred toy over the whole frame or a sliver', () => {
  const toy = blank(); rect(toy, 30, 20, 70, 100);
  const all = blank(); rect(all, 0, 0, W, H);
  const sliver = blank(); rect(sliver, 0, 0, 3, 3);
  const s1 = scoreMask(toy, W, H).score, s2 = scoreMask(all, W, H).score, s3 = scoreMask(sliver, W, H).score;
  assert.ok(s1 > 0.8, `toy score ${s1}`);
  assert.ok(s2 < 0.1, `full-frame score ${s2}`);
  assert.equal(s3, 0);
});

test('featherAlpha softens only the edge', () => {
  const m = blank(); rect(m, 30, 30, 60, 60);
  const a = featherAlpha(m, W, H, 1);
  assert.equal(a[45 * W + 45], 255);
  assert.equal(a[10 * W + 10], 0);
  assert.ok(a[45 * W + 30] > 0 && a[45 * W + 30] < 255);
});

// A synthetic "toy on a textured table in front of a wall" photo.
function syntheticPhoto(w = 160, h = 200) {
  const px = new Uint8ClampedArray(w * h * 4);
  const truth = new Uint8Array(w * h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const n = (rnd() - 0.5) * 18;
    if (y < h * 0.55) { px[i] = 225 + n; px[i + 1] = 222 + n; px[i + 2] = 210 + n; }           // wall
    else { const g = Math.sin(x * 0.35 + y * 0.05) * 10; px[i] = 170 + g + n; px[i + 1] = 118 + g + n; px[i + 2] = 70 + n; } // wood
    px[i + 3] = 255;
  }
  const inFigure = (x, y) => {
    const cx = w / 2;
    if (Math.hypot(x - cx, y - 45) < 16) return 1;                          // head
    if (x > cx - 20 && x < cx + 20 && y > 58 && y < 125) return 2;          // torso
    if (x > cx - 48 && x < cx - 28 && y > 62 && y < 115) return 1;          // left arm (gap between arm and body)
    if (x > cx + 28 && x < cx + 48 && y > 62 && y < 115) return 1;          // right arm
    if (x > cx - 18 && x < cx - 4 && y >= 125 && y < 175) return 2;         // legs
    if (x > cx + 4 && x < cx + 18 && y >= 125 && y < 175) return 2;
    for (let k = 0; k < 3; k++) if (Math.abs(x - (cx + 31 + k * 7)) < 1.6 && y >= 115 && y < 138) return 3; // claws
    return 0;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const f = inFigure(x, y);
    if (!f) continue;
    const i = (y * w + x) * 4;
    truth[y * w + x] = 1;
    const c = f === 1 ? [240, 200, 30] : f === 2 ? [30, 60, 190] : [200, 205, 215];
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  }
  return { px, truth, w, h };
}

function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) inter++; if (a[i] || b[i]) uni++; }
  return inter / uni;
}

test('fallback flood-fill cutout finds the toy on a two-tone textured background', () => {
  const { px, truth, w, h } = syntheticPhoto();
  const raw = backgroundFloodMask(px, w, h);
  const clean = cleanMask(raw, w, h);
  const score = iou(clean, truth);
  assert.ok(score > 0.85, `IoU ${score.toFixed(3)}`);
  // the gap between the arm and body must stay background
  assert.equal(clean[90 * w + (w / 2 - 24)], 0);
});

test('componentAt picks the blob under the tap', () => {
  const m = blank(); rect(m, 10, 10, 30, 30); rect(m, 60, 60, 90, 100);
  const out = componentAt(m, W, H, 15, 15);
  assert.equal(maskArea(out), 400);
  const near = componentAt(m, W, H, 58, 58); // tap just outside → nearest
  assert.equal(maskArea(near), 30 * 40);
});

test('edgeBleed pushes toy colour into transparent border pixels', () => {
  const w = 5, h = 1;
  const rgba = new Uint8ClampedArray([200, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const alpha = new Uint8Array([255, 0, 0, 0, 0]);
  edgeBleed(rgba, alpha, w, h, 2);
  assert.equal(rgba[4], 200); assert.equal(rgba[8], 200); assert.equal(rgba[12], 0);
});

test('resizeBilinear keeps constant fields constant', () => {
  const src = new Float32Array(16).fill(0.7);
  const out = resizeBilinear(src, 4, 4, 9, 7);
  assert.ok(out.every(v => Math.abs(v - 0.7) < 1e-6));
});

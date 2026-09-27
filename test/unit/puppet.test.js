import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triangulateAlpha, inflateGrid, buildPuppetMesh } from '../../js/core/puppet.js';
import { autoRig } from '../../js/core/rig.js';

function field(w, h, fn) { const f = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = fn(x, y) ? 255 : 0; return f; }
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
const circ = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
const or = (...fs) => (x, y) => fs.some(f => f(x, y));
const person = or(circ(150, 60, 40), rect(145, 95, 155, 110), rect(100, 110, 200, 270), rect(60, 115, 100, 125), rect(200, 115, 240, 125),
  rect(60, 115, 85, 280), rect(215, 115, 240, 280), rect(105, 270, 145, 480), rect(155, 270, 195, 480));

const triArea = (P, a, b, c) => ((P[b * 2] - P[a * 2]) * (P[c * 2 + 1] - P[a * 2 + 1]) - (P[c * 2] - P[a * 2]) * (P[b * 2 + 1] - P[a * 2 + 1])) / 2;

test('triangulation covers the shape, is consistently wound and watertight', () => {
  const w = 120, h = 100;
  const m = triangulateAlpha(field(w, h, rect(20, 20, 80, 70)), w, h, { step: 5 });
  let area = 0, neg = 0;
  for (let t = 0; t < m.tris.length; t += 3) {
    const a = triArea(m.pos, m.tris[t], m.tris[t + 1], m.tris[t + 2]);
    area += a;
    if (a < -1e-6) neg++;
  }
  assert.equal(neg, 0, 'all triangles wound the same way (clockwise in y-down)');
  assert.ok(Math.abs(area - 60 * 50) < 60 * 50 * 0.06, `area ${area}`);
  const edges = new Map();
  for (let t = 0; t < m.tris.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = m.tris[t + k], b = m.tris[t + (k + 1) % 3];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    edges.set(key, (edges.get(key) || 0) + 1);
  }
  for (const [key, n] of edges) {
    assert.ok(n <= 2, `edge ${key} used ${n}×`);
    if (n === 1) { const [a, b] = key.split(',').map(Number); assert.ok(m.boundary[a] && m.boundary[b], 'open edges only on the silhouette'); }
  }
});

test('gaps wider than the grid step stay open (legs are not glued together)', () => {
  const w = 100, h = 100;
  const m = triangulateAlpha(field(w, h, or(rect(10, 10, 45, 90), rect(55, 10, 90, 90))), w, h, { step: 4 });
  for (let t = 0; t < m.tris.length; t += 3) {
    const xs = [0, 1, 2].map(k => m.pos[m.tris[t + k] * 2]);
    assert.ok(!(Math.min(...xs) < 46 && Math.max(...xs) > 54), 'a triangle bridges the gap');
  }
});

test('Poisson inflation: rounded dome (√(2f) = √((r²−ρ²)/2) on a disk), highest in the middle, zero outside', () => {
  const w = 200, h = 200, r = 80;
  const m = triangulateAlpha(field(w, h, circ(100, 100, r)), w, h, { step: 4 });
  const H = inflateGrid(m.grid);
  const { nx } = m.grid;
  const centre = H[25 * nx + 25];
  assert.ok(Math.abs(centre - r / Math.SQRT2) < r * 0.06, `centre height ${centre}`);
  const half = H[25 * nx + 35]; // 40 px from the centre → √((80²−40²)/2) ≈ 49
  assert.ok(Math.abs(half - Math.sqrt((r * r - 40 * 40) / 2)) < r * 0.06, `half-way height ${half}`);
  assert.equal(H[0], 0);
});

test('skin weights: normalised; the arm follows the arm bones, the body beside it does not', () => {
  const w = 300, h = 500;
  const alpha = field(w, h, person);
  const rig = autoRig(alpha, w, h);
  const pm = buildPuppetMesh(alpha, w, h, rig);
  const nv = pm.boundary.length;
  assert.equal(pm.height.length, nv);
  const armBones = new Set(['shoulderL', 'elbowL'].map(b => pm.bones.indexOf(b)));
  const weightOn = (v, set) => { let s = 0; for (let c = 0; c < 4; c++) if (set.has(pm.skinIndex[v * 4 + c])) s += pm.skinWeight[v * 4 + c]; return s; };
  let armV = 0, armOk = 0, bodyV = 0, bodyBad = 0;
  for (let v = 0; v < nv; v++) {
    let sum = 0; for (let c = 0; c < 4; c++) sum += pm.skinWeight[v * 4 + c];
    assert.ok(Math.abs(sum - 1) < 1e-4, `weights sum to ${sum}`);
    const x = pm.pos[v * 2], y = pm.pos[v * 2 + 1];
    if (x > 62 && x < 83 && y > 170 && y < 270) { armV++; if (weightOn(v, armBones) > 0.9) armOk++; }
    if (x > 102 && x < 115 && y > 170 && y < 260) { bodyV++; if (weightOn(v, armBones) > 0.1) bodyBad++; }
  }
  assert.ok(armV > 10 && armOk / armV > 0.95, `arm vertices on arm bones ${armOk}/${armV}`);
  assert.ok(bodyV > 10 && bodyBad === 0, `body vertices dragged by the arm: ${bodyBad}/${bodyV}`);
  // the head is taller (rounder) than a thin arm
  let headMax = 0, armMax = 0;
  for (let v = 0; v < nv; v++) {
    const x = pm.pos[v * 2], y = pm.pos[v * 2 + 1];
    if (Math.hypot(x - 150, y - 60) < 20) headMax = Math.max(headMax, pm.height[v]);
    if (x > 62 && x < 83 && y > 170 && y < 270) armMax = Math.max(armMax, pm.height[v]);
  }
  assert.ok(headMax > armMax * 1.5, `head ${headMax} vs arm ${armMax}`);
});

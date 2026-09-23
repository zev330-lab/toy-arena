import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marchingSquares, signedArea, simplifyClosed, simplifyToCap, traceOutline, pointInPolygon } from '../../js/core/contour.js';
import { featherAlpha } from '../../js/core/mask.js';

function field(w, h, fn) { const f = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = fn(x, y) ? 255 : 0; return f; }

test('marching squares traces one closed loop around a square', () => {
  const f = field(20, 20, (x, y) => x >= 5 && x < 15 && y >= 5 && y < 15);
  const loops = marchingSquares(f, 20, 20);
  assert.equal(loops.length, 1);
  assert.ok(Math.abs(Math.abs(signedArea(loops[0])) - 100) < 3, `area ${signedArea(loops[0])}`);
});

test('a ring produces outer + hole with opposite winding', () => {
  const f = field(40, 40, (x, y) => { const d = Math.hypot(x - 20, y - 20); return d < 15 && d > 7; });
  const loops = marchingSquares(f, 40, 40);
  assert.equal(loops.length, 2);
  assert.equal(Math.sign(signedArea(loops[0])) * Math.sign(signedArea(loops[1])), -1);
});

test('saddle cells never produce open chains', () => {
  // checkerboard diagonal touch
  const f = field(6, 6, (x, y) => (x === 2 && y === 2) || (x === 3 && y === 3));
  const loops = marchingSquares(f, 6, 6);
  for (const l of loops) assert.ok(l.length >= 3);
});

test('Douglas–Peucker reduces a square outline to its 4 corners', () => {
  const pts = [];
  for (let i = 0; i < 10; i++) pts.push([i, 0]);
  for (let i = 0; i < 10; i++) pts.push([10, i]);
  for (let i = 10; i > 0; i--) pts.push([i, 10]);
  for (let i = 10; i > 0; i--) pts.push([0, i]);
  const s = simplifyClosed(pts, 0.5);
  assert.equal(s.length, 4);
});

test('simplifyToCap respects the vertex cap on a detailed circle', () => {
  const pts = [];
  for (let i = 0; i < 2000; i++) { const a = (i / 2000) * Math.PI * 2; pts.push([100 + Math.cos(a) * 90 + Math.sin(a * 40) * 3, 100 + Math.sin(a) * 90]); }
  const s = simplifyToCap(pts, 300);
  assert.ok(s.length <= 300 && s.length > 30, `${s.length}`);
});

test('traceOutline: figure with arm gap → outer CCW(y-up) + a hole, islands kept', () => {
  const w = 120, h = 160;
  const mask = field(w, h, (x, y) =>
    (x >= 30 && x < 90 && y >= 20 && y < 140 && !(x >= 50 && x < 70 && y >= 50 && y < 100)) || // body with gap
    (x >= 96 && x < 106 && y >= 60 && y < 80)); // detached claw
  const alpha = featherAlpha(mask.map(v => v ? 1 : 0), w, h, 1);
  const out = traceOutline(alpha, w, h, { maxVerts: 300 });
  assert.equal(out.shapes.length, 2);
  const main = out.shapes[0];
  assert.ok(signedArea(main.outer) < 0, 'outer is negative in y-down (CCW in y-up)');
  assert.equal(main.holes.length, 1);
  assert.ok(signedArea(main.holes[0]) > 0);
  assert.ok(pointInPolygon([60, 30], main.outer));
  const total = out.shapes.reduce((s, sh) => s + sh.outer.length + sh.holes.reduce((a, hl) => a + hl.length, 0), 0);
  assert.ok(total <= 330, `verts ${total}`);
});

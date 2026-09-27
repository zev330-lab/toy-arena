import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoRig, distanceTransform, thin, jointOrder, rigSegments, hasLegs, hasArm } from '../../js/core/rig.js';

function field(w, h, fn) { const f = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = fn(x, y) ? 255 : 0; return f; }
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
const circ = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
const or = (...fs) => (x, y) => fs.some(f => f(x, y));
// head, neck, torso, shoulders + hanging arms (gap to the body), two legs
const person = or(circ(150, 60, 40), rect(145, 95, 155, 110), rect(100, 110, 200, 270), rect(60, 115, 100, 125), rect(200, 115, 240, 125),
  rect(60, 115, 85, 280), rect(215, 115, 240, 280), rect(105, 270, 145, 480), rect(155, 270, 195, 480));

test('distance transform: centre of a 21px square is ~11px from the outside', () => {
  const m = new Uint8Array(25 * 25);
  for (let y = 2; y < 23; y++) for (let x = 2; x < 23; x++) m[y * 25 + x] = 1;
  const d = distanceTransform(m, 25, 25);
  assert.ok(Math.abs(d[12 * 25 + 12] - 11) < 0.01, `${d[12 * 25 + 12]}`);
  assert.equal(d[0], 0);
});

test('thinning a bar leaves a 1-px line along its middle', () => {
  const w = 40, h = 12, m = new Uint8Array(w * h);
  for (let y = 3; y < 9; y++) for (let x = 3; x < 37; x++) m[y * w + x] = 1;
  const s = thin(m, w, h);
  let n = 0; for (const v of s) n += v;
  assert.ok(n > 20 && n < 40, `${n} skeleton px`);
  for (let x = 8; x < 32; x++) { let c = 0; for (let y = 0; y < h; y++) c += s[y * w + x]; assert.ok(c <= 2, `column ${x} has ${c}`); }
});

test('person: humanoid with head above neck above chest above hips, arms and legs on the right sides', () => {
  const r = autoRig(field(300, 500, person), 300, 500);
  const J = r.joints;
  assert.equal(r.kind, 'humanoid');
  assert.ok(hasLegs(r) && hasArm(r, 'L') && hasArm(r, 'R'));
  assert.ok(J.head.y < J.neck.y && J.neck.y < J.chest.y && J.chest.y < J.hips.y, 'spine order');
  assert.ok(J.head.y < 60 && Math.abs(J.head.x - 150) < 12, `head ${J.head.x},${J.head.y}`);
  assert.ok(J.neck.y > 85 && J.neck.y < 125, `neck ${J.neck.y}`);
  assert.ok(J.handL.x < 90 && J.handR.x > 210, 'hands out on the sides');
  assert.ok(J.handL.y > 230 && J.handR.y > 230, 'hands hang low');
  assert.ok(J.shoulderL.x < 100 && J.shoulderR.x > 200, `shoulders at the arm tops ${J.shoulderL.x} ${J.shoulderR.x}`);
  assert.ok(J.footL.x < 150 && J.footR.x > 150 && J.footL.y > 430 && J.footR.y > 430, 'feet at the bottom');
  assert.ok(J.kneeL.y > J.hipL.y && J.kneeL.y < J.footL.y);
  for (const [k, j] of Object.entries(J)) if (k !== 'hips') assert.ok(J[j.parent], `${k} has a parent`);
});

test('legs merged in the photo → legs are split down the middle', () => {
  const merged = or(circ(150, 60, 40), rect(145, 95, 155, 110), rect(100, 110, 200, 270), rect(60, 115, 100, 125), rect(200, 115, 240, 125),
    rect(60, 115, 85, 280), rect(215, 115, 240, 280), rect(105, 270, 195, 480));
  const r = autoRig(field(300, 500, merged), 300, 500);
  assert.equal(r.kind, 'humanoid');
  assert.equal(r.legsMerged, true);
  assert.ok(r.joints.footL.x < 150 && r.joints.footR.x > 150);
  assert.ok(r.joints.hips.y > r.joints.chest.y + 100, 'hips well below the chest');
});

test('round blob → no legs, a vertical spine, still animatable', () => {
  const r = autoRig(field(300, 300, circ(150, 150, 120)), 300, 300);
  assert.equal(r.kind, 'blob');
  assert.ok(!hasLegs(r));
  const J = r.joints;
  assert.ok(J.head.y < J.neck.y && J.neck.y < J.chest.y && J.chest.y < J.hips.y);
});

test('robot antenna becomes a wiggly appendage on the head, not the head itself', () => {
  const robot = or(rect(146, 20, 154, 80), circ(150, 20, 12), rect(90, 80, 210, 170), rect(100, 170, 200, 330), rect(60, 180, 90, 320), rect(210, 180, 240, 320),
    rect(90, 180, 100, 200), rect(200, 180, 210, 200), rect(110, 330, 140, 500), rect(160, 330, 190, 500));
  const r = autoRig(field(300, 520, robot), 300, 520);
  assert.equal(r.kind, 'humanoid');
  assert.ok(r.joints.head.y > 70 && r.joints.head.y < 120, `head tip ${r.joints.head.y}`);
  const apps = Object.keys(r.joints).filter(k => k.startsWith('app'));
  assert.ok(apps.length === 3, `appendage joints ${apps}`);
  assert.equal(r.joints.app0_0.parent, 'head');
});

test('arms-up monster: arms point up, spine stays in the body', () => {
  const monster = or(circ(160, 220, 110), rect(40, 60, 70, 200), rect(250, 60, 280, 200), rect(70, 170, 100, 200), rect(220, 170, 250, 200), circ(110, 350, 40), circ(210, 350, 40));
  const r = autoRig(field(320, 400, monster), 320, 400);
  assert.ok(r.joints.handL.y < 110 && r.joints.handR.y < 110, 'hands up');
  assert.ok(Math.abs(r.joints.head.x - 160) < 15 && r.joints.head.y > 105, `head ${r.joints.head.x},${r.joints.head.y}`);
});

test('rig is deterministic and ordered parent-before-child with owned segments', () => {
  const a = autoRig(field(300, 500, person), 300, 500), b = autoRig(field(300, 500, person), 300, 500);
  assert.deepEqual(a, b);
  const order = jointOrder(a);
  assert.equal(order[0], 'hips');
  for (const k of order.slice(1)) assert.ok(order.indexOf(a.joints[k].parent) < order.indexOf(k));
  const segs = rigSegments(a);
  assert.equal(segs.length, order.length - 1);
  assert.ok(segs.some(s => s.owner === 'shoulderL') && segs.some(s => s.owner === 'kneeR'));
});

test('empty / tiny masks fall back to a template instead of throwing', () => {
  const r = autoRig(new Uint8Array(100 * 100), 100, 100);
  assert.ok(r.joints.hips && r.joints.head);
});

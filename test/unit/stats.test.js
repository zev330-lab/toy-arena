import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveStats, imageFeatures, hashBytes, randomName, makeRng, levelFromXp, starsForLevel, awardXp, POWERS, powerById } from '../../js/core/stats.js';

function img(w, h, rgb) { const a = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { a.set(rgb, i * 4); a[i * 4 + 3] = 255; } return a; }

test('stats are deterministic and within 35..95', () => {
  const px = img(40, 60, [220, 40, 30]);
  const f = imageFeatures(px, 40, 60);
  const h = hashBytes(px, 7);
  const a = deriveStats(f, h), b = deriveStats(f, h);
  assert.deepEqual(a, b);
  for (const v of Object.values(a)) assert.ok(v >= 35 && v <= 95);
});

test('red toys tend to hit harder than blue toys', () => {
  const red = deriveStats(imageFeatures(img(20, 20, [230, 40, 30]), 20, 20), 0x80808080);
  const blue = deriveStats(imageFeatures(img(20, 20, [30, 40, 230]), 20, 20), 0x80808080);
  assert.ok(red.power > blue.power);
  assert.ok(blue.defense > red.defense);
});

test('stats stay in range across many random images', () => {
  const rng = makeRng(42);
  for (let k = 0; k < 300; k++) {
    const px = img(8, 8, [rng() * 255, rng() * 255, rng() * 255]);
    for (let i = 3; i < px.length; i += 4) px[i] = rng() < 0.5 ? 0 : 255;
    const s = deriveStats(imageFeatures(px, 8, 8), (rng() * 2 ** 32) >>> 0);
    for (const v of Object.values(s)) assert.ok(v >= 35 && v <= 95 && Number.isInteger(v));
  }
});

test('random names are two-ish words and avoid repeats', () => {
  const rng = makeRng(1);
  for (let i = 0; i < 50; i++) {
    const n = randomName(rng, 'Captain Thunder');
    assert.ok(n.length >= 5 && n !== 'Captain Thunder');
  }
});

test('levels, stars and xp awards', () => {
  assert.equal(levelFromXp(0), 1);
  assert.equal(levelFromXp(99), 1);
  assert.equal(levelFromXp(100), 2);
  assert.equal(starsForLevel(9), 5);
  const r = awardXp({ xp: 90, wins: 2 }, true);
  assert.deepEqual(r, { xp: 130, level: 2, leveledUp: true, wins: 3, losses: 1 - 1 });
});

test('ten powers, lookup falls back safely', () => {
  assert.equal(POWERS.length, 10);
  assert.equal(powerById('fire').emoji, '🔥');
  assert.equal(powerById('nope').id, 'strength');
});

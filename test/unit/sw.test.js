import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('service worker precaches every app module, stylesheet and icon', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const block = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
  const shell = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
  const needed = [...walk('js'), ...walk('css'), ...walk('icons').filter(f => f.endsWith('.png')), 'index.html', 'manifest.webmanifest'];
  for (const f of needed) assert.ok(shell.includes(f), `sw.js SHELL is missing ${f}`);
  for (const f of shell.filter(s => s !== './')) assert.ok(fs.existsSync(path.join(ROOT, f)), `sw.js lists missing file ${f}`);
});

test('manifest is installable: standalone, portrait, 192 + 512 icons', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.orientation, 'portrait');
  const sizes = m.icons.map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(ROOT, i.src)));
});

test('no hard-coded child name in the app source', () => {
  const src = [...walk('js'), 'index.html'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  // The name is base64-encoded so it never appears in plain text in the public repo either.
  const name = Buffer.from('cGFya2Vy', 'base64').toString();
  assert.ok(!new RegExp(name, 'i').test(src), 'found a hard-coded name');
});

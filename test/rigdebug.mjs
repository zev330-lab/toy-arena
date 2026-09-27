// Dev helper: draw each toy's auto-rig + skin-weight regions over its cutout → PNGs.
// node test/rigdebug.mjs outDir [toyId,...]   (BASE=http://127.0.0.1:PORT/)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const OUT = process.argv[2] || 'test/screenshots/rig';
const IDS = process.argv[3] ? process.argv[3].split(',') : null;
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:8765/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.addInitScript(() => { window.AudioContext = undefined; localStorage.setItem('toyArena.settings.v1', JSON.stringify({ setupDone: true })); });
await page.goto(`${BASE}?nosw&mute=1`);
await page.waitForFunction(() => window.__toyArenaReady === true, null, { timeout: 60000 });
await page.evaluate(() => window.__toyArena.loadToys());
// photos (fixtures + git-ignored test/photos) go through the real cutout first
const HERE = path.dirname(new URL(import.meta.url).pathname);
const photoFiles = [
  ...fs.readdirSync(path.join(HERE, 'fixtures')).filter(f => /^figure_(front|busy)\.jpg$/.test(f)).map(f => `test/fixtures/${f}`),
  ...(fs.existsSync(path.join(HERE, 'photos')) ? fs.readdirSync(path.join(HERE, 'photos')).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).map(f => `test/photos/${f}`) : []),
];
await page.evaluate(async (files) => {
  const { fileToCanvas } = await import('./js/capture.js');
  const { autoCutout } = await import('./js/segment.js');
  const { makeCutout } = await import('./js/cutout.js');
  const { canvasToBlob } = await import('./js/capture.js');
  for (const f of files) {
    const blob = await (await fetch(f)).blob();
    const photo = await fileToCanvas(blob, 1024);
    const ses = await autoCutout(photo);
    const cut = makeCutout(ses.photo, ses.mask, ses.w, ses.h);
    await window.__toyArena.db.putToy({ id: `photo:${f}`, name: f.split('/').pop(), power: 'strength', stats: { power: 50, speed: 50, defense: 50 }, width: cut.width, height: cut.height, frontBlob: await canvasToBlob(cut.canvas), createdAt: Date.now(), method: ses.method });
  }
}, photoFiles);
const out = await page.evaluate(async (ids) => {
  const { autoRig, jointOrder } = await import('./js/core/rig.js');
  const { buildPuppetMesh } = await import('./js/core/puppet.js');
  const { blobToCanvas } = await import('./js/capture.js');
  const toys = (await window.__toyArena.db.allToys()).filter(t => !ids || ids.includes(t.id));
  const res = [];
  for (const t of toys) {
    const c = await blobToCanvas(t.frontBlob);
    const W = c.width, H = c.height;
    const px = c.getContext('2d').getImageData(0, 0, W, H).data;
    const alpha = new Uint8Array(W * H); for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
    const t0 = performance.now();
    const rig = autoRig(alpha, W, H);
    const t1 = performance.now();
    const pm = buildPuppetMesh(alpha, W, H, rig);
    const t2 = performance.now();
    const o = document.createElement('canvas'); o.width = W * 2; o.height = H;
    const g = o.getContext('2d');
    g.fillStyle = '#222'; g.fillRect(0, 0, W * 2, H);
    g.drawImage(c, 0, 0);
    // right half: dominant bone per vertex
    const cols = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'];
    for (let v = 0; v < pm.boundary.length; v++) {
      let bi = pm.skinIndex[v * 4], bw = pm.skinWeight[v * 4];
      g.fillStyle = cols[bi % cols.length]; g.globalAlpha = 0.35 + 0.65 * bw;
      g.fillRect(W + pm.pos[v * 2] - 2, pm.pos[v * 2 + 1] - 2, 4, 4);
    }
    g.globalAlpha = 1;
    for (const off of [0, W]) {
      g.lineWidth = 3; g.strokeStyle = '#fff';
      for (const [k, j] of Object.entries(rig.joints)) { if (!j.parent) continue; const p = rig.joints[j.parent]; g.beginPath(); g.moveTo(off + p.x, p.y); g.lineTo(off + j.x, j.y); g.stroke(); }
      for (const [k, j] of Object.entries(rig.joints)) { g.fillStyle = k.startsWith('app') ? '#0ff' : k.startsWith('torso') ? '#888' : '#f00'; g.beginPath(); g.arc(off + j.x, j.y, 5, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = '11px sans-serif'; g.fillText(k, off + j.x + 6, j.y - 4); }
    }
    const legend = jointOrder(rig).map((n, i) => `${i}:${n}`).join(' ');
    res.push({ id: t.id, name: t.name, kind: rig.kind, armsMerged: !!rig.armsMerged, legsMerged: !!rig.legsMerged, joints: Object.keys(rig.joints).length, png: o.toDataURL(), legend, ms: `rig ${(t1 - t0) | 0}ms mesh ${(t2 - t1) | 0}ms`, verts: pm.boundary.length, method: t.method });
  }
  return res;
}, IDS);
for (const r of out) {
  fs.writeFileSync(path.join(OUT, `${r.id.replace(/[^a-z0-9._-]+/gi, '_')}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(r.id, r.name, r.kind, `arms merged ${r.armsMerged} legs merged ${r.legsMerged} joints ${r.joints}`, r.ms, `${r.verts} verts`, r.method || '');
}
await browser.close();

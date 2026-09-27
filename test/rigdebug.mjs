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
    const rig = autoRig(alpha, W, H);
    const pm = buildPuppetMesh(alpha, W, H, rig);
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
    res.push({ id: t.id, name: t.name, kind: rig.kind, armsMerged: !!rig.armsMerged, legsMerged: !!rig.legsMerged, joints: Object.keys(rig.joints).length, png: o.toDataURL(), legend });
  }
  return res;
}, IDS);
for (const r of out) {
  fs.writeFileSync(path.join(OUT, `${r.id}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(r.id, r.name, r.kind, `arms merged ${r.armsMerged} legs merged ${r.legsMerged} joints ${r.joints}`);
}
await browser.close();

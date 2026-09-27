// Quick visual check of the 3D puppets (dev helper, not part of the E2E suite):
//   BASE=http://127.0.0.1:PORT/ node test/look.mjs outDir
// Freezes the game clock and steps animations by hand, so shots land on exact frames even on a slow box.
import { chromium, devices } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
const OUT = process.argv[2] || 'test/screenshots/look';
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:8765/';
const which = (process.env.WHICH || 'detail,battle,play').split(',');
const browser = await chromium.launch({ args: ['--mute-audio', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { window.AudioContext = undefined; window.webkitAudioContext = undefined; localStorage.setItem('toyArena.settings.v1', JSON.stringify({ setupDone: true, ownerName: '' })); });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror ' + e.message));
await page.goto(`${BASE}?nosw&mute=1`);
await page.waitForFunction(() => window.__toyArenaReady === true, null, { timeout: 120000 });
await page.evaluate(() => window.__toyArena.loadToys());
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
const settle = () => page.waitForTimeout(700); // let the (frozen) frame render
const until = async (fn, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return; await page.waitForTimeout(500); } throw new Error('timeout ' + fn); };
if (which.includes('detail')) {
  for (const id of ['builtin-megabot', 'builtin-kapow']) {
    await page.evaluate((i) => window.__toyArena.go('toy', { id: i }), id);
    await page.waitForTimeout(3500); await shot(`detail-${id.replace('builtin-', '')}`);
  }
}
if (which.includes('battle')) {
  await page.evaluate(() => window.__toyArena.go('battle', { ids: ['builtin-megabot', 'builtin-kapow'], players: '2p', stage: 'city' }));
  await until(() => document.querySelector('.screen.battle')?.dataset.state === 'fighting');
  const B = (code) => page.evaluate(`(() => { const b = document.querySelector('.screen.battle').__battle; ${code} })()`);
  await B('b.freeze(); b.advance(0.6);'); await settle(); await shot('battle-1-stance');
  await B("b.doAttack(0, 'punch'); b.advance(0.23);"); await settle(); await shot('battle-2-punch');
  await B('b.advance(1.2);');
  await B("b.doAttack(1, 'kick'); b.advance(0.33);"); await settle(); await shot('battle-3-kick');
  await B('b.advance(1.2);');
  await B("b.doBlock(0); b.advance(0.3);"); await settle(); await shot('battle-4-block');
  await B('b.advance(1.2);');
  await B("b.special(1); b.advance(0.9);"); await settle(); await shot('battle-5-special');
  await B('b.advance(1.5);');
  await B("b.F[1].st.hp = 1; b.F[0].st.busyUntil = 0; b.doAttack(0, 'kick'); b.advance(1.1);"); await settle(); await shot('battle-6-ko');
}
if (which.includes('play')) {
  await page.evaluate(() => window.__toyArena.go('play', { ids: ['builtin-megabot', 'builtin-kapow'], stage: 'jungle' }));
  await until(() => document.body.dataset.screen === 'play' && !!document.querySelector('.screen.play')?.__play);
  const P = (code) => page.evaluate(`(() => { const p = document.querySelector('.screen.play').__play; ${code} })()`);
  await P('p.freeze(); p.advance(2.5);'); await settle(); await shot('play-0');
  for (const [a, t] of [['highfive', 1.6], ['dance', 2.2], ['hug', 1.9], ['race', 3.2], ['jump', 0.55]]) {
    await P(`p.run('${a}', document.querySelector('[data-action="${a}"]')); p.advance(${t});`); await settle(); await shot(`play-${a}`);
    await P('p.advance(12);');
    await page.waitForTimeout(300);
  }
}
console.log('errors:', errs.length ? errs.slice(0, 10).join('\n') : 'none');
await browser.close();

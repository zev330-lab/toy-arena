// End-to-end check of the whole app in an emulated iPhone (390×844, touch, DPR 3).
// Usage:  python3 -m http.server 8765 &   then   node test/e2e.mjs
// Needs Playwright (`npm i -D @playwright/test && npx playwright install chromium`).
// Screenshots → test/screenshots/. Exit code 1 if any step fails or the page logs an error.

import { chromium, webkit, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:8765/';
const ENGINE = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium';
const SHOTS = path.join(HERE, 'screenshots', ENGINE === 'webkit' ? 'webkit' : '');
const FIX = path.join(HERE, 'fixtures');
const OUT = path.join(HERE, 'e2e-out');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const REAL_PHOTOS = fs.existsSync(path.join(HERE, 'photos'))
  ? fs.readdirSync(path.join(HERE, 'photos')).filter(f => /\.(jpe?g|png|heic|webp)$/i.test(f)).map(f => path.join(HERE, 'photos', f)) : [];

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const results = [];
const errors = [];
const warnings = [];
const facts = {};

const browser = ENGINE === 'webkit'
  ? await webkit.launch()
  : await chromium.launch({ args: ['--mute-audio', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
console.log(`engine: ${ENGINE} ${browser.version()}`);
browser.on('disconnected', () => console.log('   !!! browser disconnected'));
const phone = { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

function watch(page, label) {
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(`[${label}] ${t}`);
    else if (m.type() === 'warning') warnings.push(`[${label}] ${t.slice(0, 160)}`);
  });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('crash', () => { errors.push(`[${label}] PAGE CRASHED`); console.log('   !!! page crashed'); });
  page.on('requestfailed', (r) => { if (!r.url().includes('favicon')) warnings.push(`[${label}] request failed ${r.url()} ${r.failure()?.errorText}`); });
}

async function step(name, fn) {
  if (ONLY && !ONLY.some(o => name.startsWith(o))) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`✅ ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`❌ ${name}: ${e.message.split('\n')[0]}`);
  }
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const ready = (page) => page.waitForFunction(() => window.__toyArenaReady === true, null, { timeout: 30000 });
const screen = (page, name, timeout = 20000) => page.waitForFunction((n) => document.body.dataset.screen === n && !document.querySelector('.screen.leave'), name, { timeout });
const idle = (page) => page.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 90000 });
async function tapText(page, text) { await page.getByRole('button', { name: text, exact: false }).first().click({ force: true }); }
async function upload(page, buttonName, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), tapText(page, buttonName)]);
  await chooser.setFiles(file);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

/** IoU between the app's current work mask and a ground-truth PNG (in page). */
async function maskIoU(page, truthUrl) {
  return page.evaluate(async (url) => {
    const el = document.querySelector('.screen.add');
    const { session } = el.__cut;
    const { w, h, mask } = session;
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    let inter = 0, uni = 0, area = 0;
    for (let i = 0; i < w * h; i++) {
      const t = px[i * 4] > 127 ? 1 : 0;
      if (mask[i] && t) inter++;
      if (mask[i] || t) uni++;
      area += mask[i];
    }
    // visual diff for humans: white = match, red = extra, blue = missed
    const vis = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const t = px[i * 4] > 127, m = !!mask[i];
      const c = m && t ? [255, 255, 255] : m ? [255, 40, 40] : t ? [40, 90, 255] : [20, 20, 30];
      vis.data.set([...c, 255], i * 4);
    }
    g.putImageData(vis, 0, 0);
    window.__lastMaskDiff = c.toDataURL();
    return { iou: inter / uni, coverage: area / (w * h), method: session.method, w, h };
  }, truthUrl);
}

async function saveDiff(page, name) {
  const d = await page.evaluate(() => window.__lastMaskDiff);
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(d.split(',')[1], 'base64'));
}

async function addToyFlow(page, { photo, back = null, name, power, prefix, truth = true, useFix = false }) {
  await tapText(page, 'Add a Toy');
  await screen(page, 'add');
  if (prefix) await shot(page, `${prefix}-a-add-start`);
  await upload(page, 'Take a photo', photo);
  await page.waitForSelector('.starburst canvas.cut', { timeout: 90000 });
  await idle(page);
  await page.waitForTimeout(900);
  const m = truth ? await maskIoU(page, `${BASE}test/fixtures/truth_front.png`) : null;
  if (m && prefix) await saveDiff(page, `${prefix}-mask-diff`);
  if (prefix) await shot(page, `${prefix}-b-cutout-preview`);
  if (useFix) {
    await tapText(page, 'Fix');
    await page.waitForSelector('.fixwrap canvas');
    await page.waitForTimeout(500);
    if (prefix) await shot(page, `${prefix}-c-fix`);
    const box = await page.locator('.fixwrap').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.45);
    await page.waitForTimeout(1200);
    if (prefix) await shot(page, `${prefix}-d-fix-after-tap`);
    // grown-up brush: rub out the strip of table between the legs
    const areaBefore = await page.evaluate(() => document.querySelector('.screen.add').__cut.session.mask.reduce((a, b) => a + b, 0));
    await page.locator('[data-tool="erase"]').click({ force: true });
    const cx = box.x + box.width / 2;
    await page.mouse.move(cx, box.y + box.height * 0.62);
    await page.mouse.down();
    await page.mouse.move(cx, box.y + box.height * 0.76, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const areaAfter = await page.evaluate(() => document.querySelector('.screen.add').__cut.session.mask.reduce((a, b) => a + b, 0));
    facts.brushErase = { areaBefore, areaAfter };
    assert(areaAfter < areaBefore, 'erase brush did not change the mask');
    if (prefix) await shot(page, `${prefix}-d2-fix-erased`);
    await tapText(page, 'Done');
    await page.waitForSelector('.starburst canvas.cut');
  }
  await page.locator('#cut-yes').click({ force: true });
  await page.waitForSelector('text=Snap its back too?');
  await page.waitForTimeout(500);
  if (prefix) await shot(page, `${prefix}-e-back-question`);
  if (back) {
    await page.getByRole('button', { name: 'Yes!' }).click({ force: true });
    await page.waitForSelector('text=Turn your toy around!');
    await upload(page, 'Take a photo', back);
    await page.waitForSelector('.starburst canvas.cut', { timeout: 90000 });
    await idle(page);
    await page.waitForTimeout(700);
    if (prefix) await shot(page, `${prefix}-f-back-preview`);
    await page.locator('#cut-yes').click({ force: true });
  } else {
    await tapText(page, 'Skip');
  }
  await page.waitForSelector('input[aria-label="Toy name"]');
  await page.getByRole('button', { name: 'Random name' }).click({ force: true });
  await page.fill('input[aria-label="Toy name"]', name);
  if (prefix) await shot(page, `${prefix}-g-name`);
  await tapText(page, 'Next');
  await page.waitForSelector('.power-grid');
  await page.waitForTimeout(400);
  if (prefix) await shot(page, `${prefix}-h-power`);
  await page.locator(`.power-grid [data-power="${power}"]`).click({ force: true });
  await page.waitForSelector('text=NEW TOY!', { timeout: 60000 });
  await page.waitForTimeout(2200);
  if (prefix) await shot(page, `${prefix}-i-reveal`);
  return m;
}

// ======================================================================

// Tests are always silent: no AudioContext exists in the test page (headless WebKit plays through the Mac's speakers).
const SILENCE = () => { delete window.AudioContext; delete window.webkitAudioContext; window.AudioContext = undefined; window.webkitAudioContext = undefined; };
const ctx = await browser.newContext({ ...phone, acceptDownloads: true });
await ctx.addInitScript(SILENCE);
const page = await ctx.newPage();
watch(page, 'main');
await page.goto(`${BASE}?nosw`);
await ready(page);

await step('01 first launch: Toy Master setup', async () => {
  await screen(page, 'setup');
  await page.waitForTimeout(500);
  await shot(page, '01-setup');
  await page.fill('input[aria-label="Your name"]', 'Sam');
  await tapText(page, 'Let’s Go');
  await screen(page, 'home');
  await page.waitForSelector('.shelf img', { timeout: 30000 });
  await page.waitForTimeout(700);
  const title = await page.locator('.title').innerText();
  assert(/SAM'S/.test(title), `title was ${title}`);
  await shot(page, '02-home');
});

await step('02 add toy — smart cutout (MediaPipe) + EXIF-rotated photo + back photo', async () => {
  const m = await addToyFlow(page, { photo: path.join(FIX, 'figure_front_exif6.jpg'), back: path.join(FIX, 'figure_back.jpg'), name: 'Claw Crusher', power: 'claws', prefix: '03-ai', useFix: true });
  facts.aiCutout = m;
  console.log('   smart cutout:', JSON.stringify(m));
  assert(m.method === 'ai', `expected ai cutout, got ${m.method}`);
  assert(m.iou > 0.85, `mask IoU too low: ${m.iou}`);
  await tapText(page, 'My Toys');
  await screen(page, 'toys');
});

await step('03 add toy — fallback cutout (?cutout=simple)', async () => {
  await page.goto(`${BASE}?nosw&cutout=simple`);
  await ready(page);
  const m = await addToyFlow(page, { photo: path.join(FIX, 'figure_front.jpg'), name: 'Blaze Tiger', power: 'fire', prefix: '04-simple' });
  facts.simpleCutout = m;
  console.log('   simple cutout:', JSON.stringify(m));
  assert(m.method === 'simple', `expected simple cutout, got ${m.method}`);
  assert(m.iou > 0.8, `mask IoU too low: ${m.iou}`);
});

await step('04 smart cutout on a busy, cluttered background', async () => {
  await page.goto(`${BASE}?nosw`);
  await ready(page);
  await tapText(page, 'Add a Toy');
  await screen(page, 'add');
  await upload(page, 'Take a photo', path.join(FIX, 'figure_busy.jpg'));
  await page.waitForSelector('.starburst canvas.cut', { timeout: 90000 });
  await idle(page);
  await page.waitForTimeout(700);
  const m = await maskIoU(page, `${BASE}test/fixtures/truth_front.png`);
  facts.busyCutout = m;
  await saveDiff(page, '05-busy-mask-diff');
  console.log('   busy background:', JSON.stringify(m));
  await shot(page, '05-busy-background-cutout');
  assert(m.iou > 0.8, `busy-background IoU ${m.iou}`);
  await page.getByRole('button', { name: 'Back' }).first().click({ force: true });
  await page.getByRole('button', { name: 'Back' }).first().click({ force: true });
  await screen(page, 'home');
});

for (const [i, photo] of REAL_PHOTOS.entries()) {
  await step(`05 real toy photo ${path.basename(photo)}`, async () => {
    await page.goto(`${BASE}?nosw`);
    await ready(page);
    await addToyFlow(page, { photo, name: `Real Toy ${i + 1}`, power: 'strength', prefix: `06-real-${i + 1}`, truth: false });
  });
}

await step('06 collection persists across reload + detail turntable', async () => {
  await page.goto(`${BASE}?nosw`);
  await ready(page);
  await tapText(page, 'My Toys');
  await screen(page, 'toys');
  await page.waitForTimeout(600);
  const names = await page.locator('.toy-card .nm').allInnerTexts();
  assert(names.includes('Claw Crusher') && names.includes('Blaze Tiger'), `cards: ${names.join(', ')}`);
  facts.collection = names;
  await shot(page, '07-collection');
  await page.locator('.toy-card', { hasText: 'Claw Crusher' }).click({ force: true });
  await screen(page, 'toy');
  await page.waitForTimeout(1500);
  await shot(page, '08-toy-detail');
  // drag to spin
  const vp = await page.locator('.detail .viewport').boundingBox();
  await page.mouse.move(vp.x + vp.width * 0.3, vp.y + vp.height / 2);
  await page.mouse.down();
  await page.mouse.move(vp.x + vp.width * 0.8, vp.y + vp.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  await shot(page, '09-toy-detail-spun');
  await tapText(page, 'Name');
  await page.waitForSelector('.modal');
  await page.waitForTimeout(500);
  await shot(page, '10-rename-modal');
  await page.getByRole('button', { name: 'Cancel' }).click({ force: true });
  await tapText(page, 'Power');
  await page.waitForSelector('.modal .power-grid');
  await page.waitForTimeout(500);
  await shot(page, '11-change-power-modal');
  await page.getByRole('button', { name: 'Cancel' }).click({ force: true });
  // retake the photo of an existing toy: keeps name, stats and wins
  const pick = () => page.evaluate(async () => { const t = (await window.__toyArena.db.allToys()).find(x => x.name === 'Claw Crusher'); return { id: t.id, size: t.frontBlob.size, back: !!t.backBlob, wins: t.wins }; });
  const before = await pick();
  await page.getByRole('button', { name: 'Photo' }).click({ force: true });
  await screen(page, 'add');
  await upload(page, 'Take a photo', path.join(FIX, 'figure_front.jpg'));
  await page.waitForSelector('.starburst canvas.cut', { timeout: 90000 });
  await idle(page);
  await page.locator('#cut-yes').click({ force: true });
  await page.waitForSelector('text=Snap its back too?');
  await tapText(page, 'Skip');
  await screen(page, 'toy', 60000);
  const after = await pick();
  assert(after && after.id === before.id && after.size !== before.size && !after.back, 'retake did not replace the photo');
  await page.waitForTimeout(1200);
  await shot(page, '11b-after-retake');
});

async function runBattle(prefix, { players = '1p', stage = 'city', maxMs = 240000, fighters = ['Claw Crusher', 'Robo Buddy'] } = {}) {
  await page.goto(`${BASE}?nosw`);
  await ready(page);
  await tapText(page, 'Battle');
  await screen(page, 'pick');
  for (const f of fighters) await page.locator('.toy-grid .toy-card', { hasText: f }).click({ force: true });
  if (players === '2p') await page.getByRole('button', { name: '2 Players' }).click({ force: true });
  await page.waitForTimeout(400);
  await shot(page, `${prefix}-a-pick`);
  await page.locator('#pick-go').click({ force: true });
  await screen(page, 'stage');
  await page.waitForTimeout(400);
  await shot(page, `${prefix}-b-stage`);
  await page.locator(`.stage-card[data-stage="${stage}"]`).click({ force: true });
  await page.waitForSelector('.vs-splash .vs');
  await page.waitForTimeout(900);
  await shot(page, `${prefix}-c-vs`);
  await screen(page, 'battle', 30000);
  await page.waitForFunction(() => document.querySelector('.screen.battle')?.dataset.state === 'fighting', null, { timeout: 30000 });
  await page.waitForTimeout(300);
  await shot(page, `${prefix}-d-fight`);
}

await step('07 battle vs CPU runs to a winner (button taps)', async () => {
  await runBattle('12-battle', { stage: 'city' });
  const t0 = Date.now();
  let taps = 0, midShot = false, specialShot = false;
  const moves = ['punch', 'kick', 'punch', 'block', 'punch', 'kick'];
  while (Date.now() - t0 < 240000) {
    const st = await page.evaluate(() => document.querySelector('.screen.battle')?.dataset.state);
    if (st === 'over') break;
    if (st === 'fighting') {
      const ready = await page.evaluate(() => document.querySelector('.controls.p1 .special')?.classList.contains('ready'));
      const mv = ready ? 'special' : moves[taps % moves.length];
      await page.locator(`.controls.p1 [data-move="${mv}"]`).tap({ force: true });
      taps++;
      if (ready && !specialShot) { await page.waitForTimeout(650); await shot(page, '12-battle-e-special'); specialShot = true; }
      if (taps === 9 && !midShot) { await page.waitForTimeout(170); await shot(page, '12-battle-f-hit'); midShot = true; }
    }
    await page.waitForTimeout(220);
  }
  const st = await page.evaluate(() => document.querySelector('.screen.battle')?.dataset.state);
  assert(st === 'over', `battle did not finish (state ${st}) after ${taps} taps`);
  await page.waitForTimeout(1800);
  await shot(page, '12-battle-g-winner');
  const banner = await page.locator('.banner.small').last().innerText();
  facts.battle = { taps, banner, seconds: Math.round((Date.now() - t0) / 1000) };
  console.log('   battle:', JSON.stringify(facts.battle));
  assert(/WINS!/.test(banner), `winner banner: ${banner}`);
  const wins = await page.evaluate(async () => (await window.__toyArena.db.allToys()).map(t => `${t.name}:${t.wins}/${t.xp}`));
  facts.afterBattle = wins;
});

await step('08 two-player layout (P2 controls rotated) + pause/quit', async () => {
  await runBattle('13-2p', { players: '2p', stage: 'jungle', fighters: ['Blaze Tiger', 'Blobby Monster'] });
  const rot = await page.evaluate(() => getComputedStyle(document.querySelector('.controls.p2')).transform);
  assert(rot && rot !== 'none', 'P2 controls are not rotated');
  for (let k = 0; k < 6; k++) {
    await page.locator('.controls.p1 [data-move="punch"]').tap({ force: true });
    await page.locator('.controls.p2 [data-move="kick"]').tap({ force: true });
    await page.waitForTimeout(350);
  }
  await shot(page, '13-2p-e-mid-fight');
  await page.getByRole('button', { name: 'Pause' }).click({ force: true });
  await page.waitForSelector('.modal');
  await shot(page, '13-2p-f-paused');
  await page.getByRole('button', { name: 'Quit' }).click({ force: true });
  await screen(page, 'pick');
});

await step('09 other arenas render (space, volcano)', async () => {
  for (const stage of ['space', 'volcano']) {
    await runBattle(`14-${stage}`, { stage, fighters: ['Robo Buddy', 'Blobby Monster'] });
    await page.locator('.controls.p1 [data-move="kick"]').tap({ force: true });
    await page.waitForTimeout(260);
    await shot(page, `14-${stage}-e-kick`);
  }
});

await step('10 play mode with 4 toys: every action + drag', async () => {
  await page.goto(`${BASE}?nosw`);
  await ready(page);
  await tapText(page, 'Play');
  await screen(page, 'pick');
  for (const f of ['Claw Crusher', 'Blaze Tiger', 'Robo Buddy', 'Blobby Monster']) await page.locator('.toy-grid .toy-card', { hasText: f }).click({ force: true });
  await shot(page, '15-play-a-pick');
  await page.locator('#pick-go').click({ force: true });
  await screen(page, 'stage');
  await page.locator('.stage-card[data-stage="jungle"]').click({ force: true });
  await screen(page, 'play', 30000);
  await page.waitForTimeout(2200);
  await shot(page, '15-play-b-arena');
  const actions = ['highfive', 'dance', 'race', 'jump', 'hug', 'tickle', 'ball', 'spin'];
  for (const a of actions) {
    await page.locator(`.play-actions [data-action="${a}"]`).click({ force: true });
    const snapAt = { highfive: 1500, dance: 3000, race: 3600, jump: 700, hug: 1700, tickle: 1500, ball: 2000, spin: 700 }[a];
    await page.waitForTimeout(snapAt);
    await shot(page, `15-play-c-${a}`);
    await page.waitForFunction(() => !document.querySelector('.screen.play')?.dataset.busy, null, { timeout: 40000 });
  }
  const done = await page.evaluate(() => document.querySelector('.screen.play').dataset.done);
  assert(actions.every(a => done.includes(a)), `actions done: ${done}`);
  // drag the first toy across the arena
  const pos = await page.evaluate(() => {
    const s = document.querySelector('.screen.play');
    const f = s.__play.figs[0];
    const v = f.chestPos;
    return { x: f.root.position.x, z: f.root.position.z, v: [v.x, v.y, v.z] };
  });
  const vp = await page.locator('.screen.play .viewport').boundingBox();
  const sp = await page.evaluate(() => document.querySelector('.screen.play').__play.screenOf(0));
  const x0 = vp.x + sp.x, y0 = vp.y + sp.y;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(vp.x + vp.width * 0.55, vp.y + vp.height * 0.62, { steps: 12 });
  await page.waitForTimeout(1600);
  await page.mouse.up();
  const after = await page.evaluate(() => { const f = document.querySelector('.screen.play').__play.figs[0]; return { x: f.home.x, z: f.home.z }; });
  facts.drag = { before: { x: pos.x, z: pos.z }, after };
  console.log('   drag:', JSON.stringify(facts.drag));
  await shot(page, '15-play-d-dragged');
  assert(Math.hypot(after.x - pos.x, after.z - pos.z) > 0.4, 'drag did not move the toy');
});

await step('11 settings: backup export → delete → restore round-trip', async () => {
  await page.goto(`${BASE}?nosw`);
  await ready(page);
  await page.waitForTimeout(300);
  const gear = page.getByRole('button', { name: 'Grown-ups: hold for settings' });
  await gear.dispatchEvent('pointerdown');
  await page.waitForTimeout(1300);
  await page.waitForSelector('.modal .settings-list');
  await shot(page, '16-settings');
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Save' }).click({ force: true });
  // on touch devices with Web Share, a second tap opens the share sheet (headless falls back to a download)
  const shareBtn = page.locator('.modal:has-text("Backup ready") button:has-text("Share")');
  if (await shareBtn.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) { await shot(page, '16b-backup-ready'); await shareBtn.click({ force: true }); }
  const download = await dl;
  const file = path.join(OUT, 'backup.json');
  await download.saveAs(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(json.app === 'toy-arena' && json.toys.length >= 2, 'backup content');
  facts.backup = { toys: json.toys.length, bytes: fs.statSync(file).size };
  await page.getByRole('button', { name: 'Done' }).click({ force: true });
  // delete Blaze Tiger (hold-to-delete)
  await tapText(page, 'My Toys');
  await screen(page, 'toys');
  await page.locator('.toy-card', { hasText: 'Blaze Tiger' }).click({ force: true });
  await screen(page, 'toy');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Delete' }).first().click({ force: true });
  await page.waitForSelector('.modal');
  await shot(page, '17-delete-confirm');
  const del = page.locator('.modal .btn.red');
  await del.dispatchEvent('pointerdown');
  await page.waitForTimeout(1500);
  await screen(page, 'toys');
  let names = await page.locator('.toy-card .nm').allInnerTexts();
  assert(!names.includes('Blaze Tiger'), 'toy was not deleted');
  // restore
  await page.getByRole('button', { name: 'Back' }).first().click({ force: true });
  await screen(page, 'home');
  await gear.dispatchEvent('pointerdown');
  await page.waitForTimeout(1300);
  await page.waitForSelector('.modal .settings-list');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Restore' }).click({ force: true })]);
  await chooser.setFiles(file);
  await page.waitForSelector('.toast:has-text("restored")', { timeout: 20000 });
  await page.getByRole('button', { name: 'Done' }).click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  await tapText(page, 'My Toys');
  await screen(page, 'toys');
  names = await page.locator('.toy-card .nm').allInnerTexts();
  assert(names.includes('Blaze Tiger'), `restore failed: ${names.join(', ')}`);
  const bt = await page.evaluate(async () => { const t = (await window.__toyArena.db.allToys()).find(x => x.name === 'Blaze Tiger'); return { front: t.frontBlob?.size, thumb: t.thumbBlob?.size, type: t.frontBlob?.type }; });
  assert(bt.front > 1000 && bt.type === 'image/png', `restored images ${JSON.stringify(bt)}`);
  await shot(page, '18-after-restore');
});

await step('12 landscape layout', async () => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(`${BASE}?nosw`);
  await ready(page);
  await page.waitForTimeout(600);
  await shot(page, '19-landscape-home');
  await page.evaluate(() => window.__toyArena.go('battle', { ids: ['builtin-robo', 'builtin-blobby'], players: '1p', stage: 'volcano' }));
  await page.waitForFunction(() => document.querySelector('.screen.battle')?.dataset.state === 'fighting', null, { timeout: 30000 });
  await page.locator('.controls.p1 [data-move="punch"]').tap({ force: true });
  await page.waitForTimeout(250);
  await shot(page, '19-landscape-battle');
  await page.evaluate(() => window.__toyArena.go('home', {}, { reset: true }));
  await screen(page, 'home');
  await page.setViewportSize({ width: 390, height: 844 });
});

await ctx.close();

// ---------- service worker + offline ----------
await step('13 service worker registers, app + smart cutout work offline', async () => {
  const c2 = await browser.newContext({ ...phone });
  await c2.addInitScript(SILENCE);
  const p2 = await c2.newPage();
  watch(p2, 'sw');
  await p2.goto(BASE);
  await ready(p2);
  await p2.evaluate(() => navigator.serviceWorker.ready);
  await p2.reload();
  await ready(p2);
  const controlled = await p2.evaluate(() => !!navigator.serviceWorker.controller);
  assert(controlled, 'page not controlled by SW');
  // wait for the model warm-up to land in the runtime cache
  await p2.waitForFunction(async () => {
    const c = await caches.open('toy-arena-runtime-v1');
    const keys = (await c.keys()).map(r => r.url);
    return keys.some(u => u.includes('magic_touch')) && keys.some(u => u.includes('vision_wasm_internal.wasm'));
  }, null, { timeout: 120000, polling: 1000 });
  const cached = await p2.evaluate(async () => (await (await caches.open('toy-arena-runtime-v1')).keys()).map(r => new URL(r.url).pathname.split('/').pop()));
  facts.swRuntimeCache = cached;
  await c2.setOffline(true);
  await p2.reload();
  await ready(p2);
  await p2.waitForTimeout(800);
  await shot(p2, '20-offline-home');
  // skip setup if shown, then add a toy fully offline
  if (await p2.locator('text=Skip').count()) { await tapText(p2, 'Skip'); await screen(p2, 'home'); }
  await tapText(p2, 'Add a Toy');
  await screen(p2, 'add');
  await upload(p2, 'Take a photo', path.join(FIX, 'figure_front.jpg'));
  await p2.waitForSelector('.starburst canvas.cut', { timeout: 90000 });
  await idle(p2);
  const m = await p2.evaluate(() => document.querySelector('.screen.add').__cut.session.method);
  facts.offlineCutout = m;
  await shot(p2, '21-offline-cutout');
  assert(m === 'ai', `offline cutout used ${m}`);
  await c2.close();
});

await browser.close();

const ignorable = (e) => /GPU stall due to ReadPixels/.test(e);
const realErrors = errors.filter(e => !ignorable(e));
console.log('\n==== SUMMARY ====');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  → ${r.err}`}`);
console.log(`console errors: ${realErrors.length}`);
for (const e of realErrors.slice(0, 30)) console.log('  ', e.slice(0, 300));
const wUniq = [...new Set(warnings.map(w => w.replace(/0x[0-9a-f]+/g, '')))];
console.log(`console warnings (unique): ${wUniq.length}`);
for (const w of wUniq.slice(0, 15)) console.log('  ', w);
console.log('facts:', JSON.stringify(facts, null, 1));
fs.writeFileSync(path.join(OUT, `e2e-results-${ENGINE}.json`), JSON.stringify({ results, errors: realErrors, warnings: wUniq, facts }, null, 1));
process.exit(results.some(r => !r.ok) || realErrors.length ? 1 : 0);

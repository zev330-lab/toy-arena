// Play mode: friendly interactions for 2–4 toys, plus drag-a-toy-around.

import * as THREE from 'three';
import { h, btn, sleep } from './ui.js';
import { back as navBack } from './app.js';
import * as db from './db.js';
import { Arena } from './arena.js';
import { powBubble, banner } from './hud.js';
import { sfx, startMusic, stopMusic } from './audio.js';

// [x, z] per toy — a zig-zag in depth keeps 3–4 toys big on a narrow phone screen
const LAYOUTS = { 2: [[-1.0, 0], [1.0, 0]], 3: [[-1.25, 0.25], [0, -0.45], [1.25, 0.25]], 4: [[-1.5, 0.45], [-0.5, -0.45], [0.5, 0.45], [1.5, -0.45]] };

function ballTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#1a1030';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
    const x = i * 44 + (j % 2) * 22 + 10, y = j * 44 + 20;
    g.beginPath();
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * Math.PI * 2 / 5; g.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); }
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export async function playScreen(el, { ids, stage }) {
  el.classList.add('arena');
  const toys = (await Promise.all(ids.slice(0, 4).map(id => db.getToy(id)))).filter(Boolean);
  const n = toys.length;
  const view = h('div', { class: 'viewport' });
  const hud = h('div', { class: 'hud' });
  const fxLayer = h('div', { class: 'fullbleed', style: { pointerEvents: 'none', zIndex: 12 } });
  el.append(view, fxLayer, hud);
  const arena = new Arena(view, stage);
  arena.framing = { lookY: 0.9, extraSpan: 1.4, minSpan: 3.0, height: 0.34, bias: 0.55 };
  const xs = LAYOUTS[n] || LAYOUTS[2];
  const figs = [];
  for (let i = 0; i < n; i++) figs.push(await arena.addToy(toys[i], xs[i][0], xs[i][1]));
  const faceCentre = () => {
    const cx = figs.reduce((s, f) => s + f.home.x, 0) / n;
    for (const f of figs) f.face(f.home.x === cx ? cx + 1 : cx, f.home.x === cx ? 0 : 0.42);
  };
  faceCentre();
  let alive = true;
  let busy = null;
  const extras = [];
  const addExtra = (o) => { arena.scene.add(o); extras.push(o); return o; };
  const removeExtra = (o) => { o.removeFromParent(); o.traverse?.((c) => { c.geometry?.dispose?.(); if (c.material?.map && !c.material.map.userData.shared) c.material.map.dispose(); c.material?.dispose?.(); }); };

  // toys pair up (a 3rd toy cheers along)
  const pairs = () => (n >= 4 ? [[figs[0], figs[1]], [figs[2], figs[3]]] : [[figs[0], figs[1]]]);
  const cheerOthers = () => { for (const f of figs.slice(n >= 4 ? 4 : 2)) { f.jump(0.6, { dur: 0.6 }); say(f, 'YAY!'); } };
  const home = figs.map(f => f.home.clone());
  const goHome = () => Promise.all(figs.map((f, i) => (f.home.distanceTo(home[i]) > 0.05 ? f.hopTo(home[i].x, home[i].z) : null))).then(faceCentre);
  const say = (f, word, color) => powBubble(fxLayer, arena, f.headPos, word, { color });

  const ACTIONS = {
    async highfive() {
      await Promise.all(pairs().map(async ([a, b]) => {
        const mid = (a.home.x + b.home.x) / 2, z = (a.home.z + b.home.z) / 2;
        a.face(b.home.x); b.face(a.home.x);
        await Promise.all([a.hopTo(mid - 0.42 * Math.sign(b.home.x - a.home.x || 1), z), b.hopTo(mid + 0.42 * Math.sign(b.home.x - a.home.x || 1), z)]);
        a.face(b.home.x); b.face(a.home.x);
        a.jump(0.7, { dur: 0.6 }); await b.jump(0.7, { dur: 0.6 });
      }));
      for (const [a, b] of pairs()) {
        const p = a.headPos.clone().lerp(b.headPos, 0.5);
        arena.fx.stars(p, 8); arena.fx.hitSparks(p, 0xffe066, true);
        powBubble(fxLayer, arena, p, 'HIGH FIVE!', { big: true });
      }
      sfx.clap();
      cheerOthers();
      await sleep(600);
      await goHome();
    },
    async dance() {
      startMusic('dance');
      const cols = [0xff3d3d, 0x29d3ff, 0xffd23f, 0x8e5cff];
      const lights = cols.map((c, i) => { const l = new THREE.PointLight(c, 18, 9, 1.5); l.position.set(Math.cos(i * 1.6) * 2.5, 2.6, Math.sin(i * 1.6) * 2); return addExtra(l); });
      const ball = addExtra(new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.2, flatShading: true, emissive: 0x8888aa, emissiveIntensity: 0.6 })));
      ball.position.set(0, 5, -0.5);
      arena.lights.hemi.intensity *= 0.45;
      const beat = 0.5;
      const t0 = arena.time;
      const spin = () => {
        if (!alive) return;
        const t = arena.time - t0;
        lights.forEach((l, i) => { l.position.set(Math.cos(t * 2 + i * 1.6) * 2.6, 2.4 + Math.sin(t * 3 + i) * 0.4, Math.sin(t * 2 + i * 1.6) * 2); l.intensity = 12 + Math.sin(t * 8 + i) * 8; });
        ball.position.y += (3.2 - ball.position.y) * 0.05;
        ball.rotation.y = t;
        if (Math.random() < 0.05) arena.fx.notes(figs[Math.floor(Math.random() * n)].headPos, 1);
      };
      arena.onFrame = spin;
      await Promise.all(figs.map((f, i) => f.dance(beat, i % 4, 16)));
      arena.onFrame = null;
      arena.lights.hemi.intensity /= 0.45;
      for (const o of [...lights, ball]) removeExtra(o);
      stopMusic();
      sfx.cheer();
      figs.forEach(f => say(f, 'YEAH!'));
    },
    async race() {
      const lanes = figs.map((_, i) => (n === 1 ? 0 : -0.9 + (1.8 * i) / Math.max(1, n - 1)));
      const startX = -2.7, endX = 2.5;
      const line = addExtra(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.8), new THREE.MeshBasicMaterial({ map: checker(), transparent: true })));
      line.rotation.x = -Math.PI / 2; line.position.set(endX + 0.35, 0.02, 0);
      figs.forEach(f => f.face(10, 0.35));
      await Promise.all(figs.map((f, i) => f.hopTo(startX, lanes[i], { hopDur: 0.2 })));
      figs.forEach(f => f.face(10, 0.35));
      for (const w of ['3', '2', '1']) { sfx.countdown(); await banner(hud, w, { ms: 450 }); if (!alive) return; }
      sfx.countdown(true);
      banner(hud, 'GO!', { ms: 500, color: '#2fd26b' });
      let winner = null;
      await Promise.all(figs.map((f, i) => f.hopTo(endX, lanes[i], { hopDur: 0.16 + Math.random() * 0.1, perHop: 0.45 + Math.random() * 0.2, height: 0.3, onLand: () => { if (Math.random() < 0.3) arena.fx.dust(f.root.position, 2); } })
        .then(() => { if (!winner) { winner = f; sfx.fanfare(); arena.fx.stars(f.headPos, 12); say(f, '1ST!', '#ffd23f'); f.victory(); } })));
      await sleep(1500);
      removeExtra(line);
      await goHome();
    },
    async jump() {
      let best = null, bestH = 0;
      for (const f of figs) {
        const hgt = 0.9 + Math.random() * 1.8;
        sfx.jump();
        await f.jump(hgt, { dur: 0.7 + hgt * 0.15, flip: hgt > 2.0, onLand: () => { sfx.land(); arena.fx.dust(f.root.position, 5); } });
        say(f, hgt > 2 ? 'WOW!' : 'BOING!');
        if (hgt > bestH) { bestH = hgt; best = f; }
        if (!alive) return;
      }
      await sleep(250);
      arena.fx.stars(best.headPos, 14); sfx.fanfare(); say(best, 'HIGHEST!', '#ffd23f');
      await best.victory();
    },
    async hug() {
      await Promise.all(pairs().map(async ([a, b]) => {
        const mid = (a.home.x + b.home.x) / 2, z = (a.home.z + b.home.z) / 2;
        const s = Math.sign(b.home.x - a.home.x || 1);
        await Promise.all([a.hopTo(mid - 0.28 * s, z), b.hopTo(mid + 0.28 * s, z)]);
        a.face(b.home.x, 0.7); b.face(a.home.x, 0.7);
        sfx.kiss();
        arena.fx.hearts(a.headPos.clone().lerp(b.headPos, 0.5), 8);
        await Promise.all([a.lean(0.35, 1.4), b.lean(0.35, 1.4)]);
      }));
      cheerOthers();
      figs.forEach(f => say(f, '❤️'));
      await sleep(400);
      await goHome();
    },
    async tickle() {
      for (const [a, b] of pairs()) {
        const s = Math.sign(b.home.x - a.home.x || 1);
        await a.hopTo(b.home.x - 0.55 * s, b.home.z);
        a.face(b.home.x);
        a.wiggle(0.6);
        sfx.giggle();
        say(b, 'HA HA!', '#ff5fa2');
        await b.wiggle(1.4);
        say(b, 'HEE HEE!', '#29d3ff');
        sfx.giggle();
        await b.spin(1, 0.6);
      }
      await goHome();
    },
    async ball() {
      const ball = addExtra(new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.5 })));
      ball.castShadow = true;
      const order = n === 2 ? [0, 1, 0, 1, 0] : [...figs.keys(), ...figs.keys()].slice(0, n * 2);
      let pos = figs[order[0]].root.position.clone().add(new THREE.Vector3(0.4 * figs[order[0]].dir, 0.17, 0.2));
      ball.position.copy(pos);
      for (let k = 0; k < order.length - 1 && alive; k++) {
        const a = figs[order[k]], b = figs[order[k + 1]];
        a.face(b.home.x); b.face(a.home.x);
        await a.lunge(a.home.x + a.dir * 0.8, { windup: 0.12, strike: 0.08, recover: 0.2, kind: 'kick', reach: 0.8 });
        sfx.kickBall();
        say(a, k % 2 ? 'KICK!' : 'BOOT!');
        const from = ball.position.clone();
        const to = b.root.position.clone().add(new THREE.Vector3(-0.45 * Math.sign(b.home.x - a.home.x || 1), 0.17, 0.2));
        const dur = 0.7;
        await new Promise((res) => {
          const t0 = arena.time;
          const tick = () => {
            if (!alive) return res();
            const p = Math.min(1, (arena.time - t0) / dur);
            ball.position.lerpVectors(from, to, p);
            ball.position.y = 0.17 + Math.sin(Math.PI * p) * 1.1;
            ball.rotation.z -= 0.25;
            if (p >= 1) { arena.onFrame = null; res(); }
          };
          arena.onFrame = tick;
        });
        sfx.boing();
      }
      arena.fx.stars(ball.position, 8);
      sfx.cheer();
      await sleep(500);
      removeExtra(ball);
      faceCentre();
    },
    async spin() {
      await Promise.all(figs.map((f, i) => sleep(i * 150).then(() => f.showBack(1.6))));
      figs.forEach(f => say(f, 'TA-DA!'));
    },
  };

  const buttons = [
    ['highfive', '🙌', 'High Five', 'yellow'], ['dance', '💃', 'Dance', 'pink'], ['race', '🏃', 'Race', 'green'], ['jump', '🤸', 'Jump', 'blue'],
    ['hug', '🤗', 'Hug', 'orange'], ['tickle', '😂', 'Tickle', 'purple'], ['ball', '⚽', 'Ball', 'white'], ['spin', '🔄', 'Turn', 'cyan'],
  ];
  const row = h('div', { class: 'play-actions' });
  for (const [id, emoji, label, color] of buttons) {
    const b = btn({ emoji, label, cls: color });
    b.dataset.action = id;
    b.addEventListener('click', () => run(id, b));
    row.append(b);
  }
  el.dataset.busy = '';
  async function run(id, b) {
    if (busy || !alive) return;
    busy = id;
    el.dataset.busy = id;
    b.classList.add('busy-act');
    try { await ACTIONS[id](); } catch (e) { console.error('[toy-arena] play action', id, e); }
    b.classList.remove('busy-act');
    busy = null;
    el.dataset.busy = '';
    el.dataset.done = `${el.dataset.done || ''}${id},`;
  }

  hud.append(
    h('div', { class: 'topbar', style: { position: 'absolute', left: 'calc(var(--sal) + 12px)', right: 'calc(var(--sar) + 12px)', top: 'calc(var(--sat) + 8px)' } },
      btn({ emoji: '⬅️', cls: 'icon white', aria: 'Back', onClick: () => navBack() }), h('h2', {}, 'PLAY TIME!'), h('div', { class: 'ghost' })),
    h('div', { class: 'hint drag-hint' }, '👆 Drag a toy!'),
    row);

  // drag a toy: it hops after your finger
  let drag = null;
  const canvas = arena.canvas;
  const clampR = (p) => { const r = Math.hypot(p.x, p.z); if (r > 2.9) p.multiplyScalar(2.9 / r); return p; };
  canvas.addEventListener('pointerdown', (e) => {
    if (busy) return;
    const f = arena.figureAt(e.clientX, e.clientY);
    if (!f) return;
    drag = { f, target: null };
    canvas.setPointerCapture?.(e.pointerId);
    sfx.pop();
    f.jump(0.3, { dur: 0.3 });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const g = arena.groundAt(e.clientX, e.clientY);
    if (g) drag.target = clampR(g);
  });
  const endDrag = () => { if (drag) { const f = drag.f; drag = null; const i = figs.indexOf(f); home[i] = f.home.clone(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  const dragLoop = setInterval(() => {
    if (!drag?.target || drag.f.busy()) return;
    const f = drag.f, t = drag.target;
    const d = Math.hypot(t.x - f.home.x, t.z - f.home.z);
    if (d < 0.15) return;
    const step = Math.min(d, 0.6);
    const nx = f.home.x + ((t.x - f.home.x) / d) * step, nz = f.home.z + ((t.z - f.home.z) / d) * step;
    f.face(nx === f.home.x ? f.home.x + 1 : nx, 0.3);
    f.hopTo(nx, nz, { hopDur: 0.22, onLand: () => sfx.step() });
  }, 60);

  el.__play = { run, figs, ACTIONS, screenOf: (i) => arena.project(figs[i].chestPos) };
  // intro hop-in
  figs.forEach((f, i) => { const hx = f.home.x; f.setHome(hx, 4); f.hopTo(hx, home[i].z, { onLand: () => sfx.step() }); });
  await sleep(200);
  banner(hud, 'LET’S PLAY!', { ms: 900, small: true });

  return () => {
    alive = false;
    clearInterval(dragLoop);
    stopMusic();
    for (const o of extras) removeExtra(o);
    arena.dispose();
  };
}

let checkerTex = null;
function checker() {
  if (checkerTex) return checkerTex;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 128;
  const g = c.getContext('2d');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); }
  checkerTex = new THREE.CanvasTexture(c);
  checkerTex.magFilter = THREE.NearestFilter;
  checkerTex.colorSpace = THREE.SRGBColorSpace;
  checkerTex.userData.shared = true;
  return checkerTex;
}

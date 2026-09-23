// "My Toys" collection grid, toy detail with a drag-to-spin 3D turntable.

import * as THREE from 'three';
import { h, btn, topbar, modal, toast, UrlBag } from '../ui.js';
import { go, back as navBack, loadToys } from '../app.js';
import * as db from '../db.js';
import { POWERS, powerById, levelFromXp, starsForLevel, randomName, XP_PER_LEVEL } from '../core/stats.js';
import { mount, unmount, startLoop, onResize, disposeScene, maxAniso, getRenderer } from '../engine.js';
import { buildFigure } from '../mesh.js';
import { Figure } from '../figure.js';
import { FX } from '../fx.js';
import { sfx } from '../audio.js';

export class Turntable {
  constructor(container, toy, { intro = false } = {}) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    this.angle = -0.3; this.vel = intro ? 9 : 0; this.dragging = false;
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xffffff, 0x5040a0, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(2.5, 4, 4); key.castShadow = true;
    key.shadow.mapSize.set(512, 512); key.shadow.camera.left = -2; key.shadow.camera.right = 2; key.shadow.camera.top = 3; key.shadow.camera.bottom = -1;
    s.add(key);
    const rim = new THREE.DirectionalLight(0x9fd0ff, 2.2); rim.position.set(-3, 3, -4); s.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.ShadowMaterial({ opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    this.fx = new FX(s, { max: 60 });
    const canvas = mount(container);
    this.listen = new AbortController(); // shared canvas: remove our drag handlers on dispose
    this.offResize = onResize((w, hh) => { this.camera.aspect = w / hh; this.camera.updateProjectionMatrix(); this.frameCam(); });
    this.bindDrag(canvas);
    this.t = 0;
    this.ready = buildFigure(toy, { maxAniso: maxAniso() }).then((built) => {
      if (this.disposed) { built.dispose(); return; } // screen left while loading
      this.fig = new Figure(built, toy);
      this.fig.idleAmp = 1.2;
      s.add(this.fig.root);
      this.frameCam();
      if (intro) { this.fig.jump(1.2, { dur: 0.9, flip: true }); this.fx.stars(new THREE.Vector3(0, 1.2, 0), 10); }
      startLoop((dt) => this.frame(dt));
    });
    getRenderer().setClearColor(0x000000, 0);
  }
  frameCam() {
    if (!this.fig) return;
    const hgt = this.fig.height, wid = Math.max(this.fig.built.width, this.fig.built.radius * 2);
    const vf = THREE.MathUtils.degToRad(this.camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const d = Math.max((hgt * 1.25 / 2) / Math.tan(vf / 2), (wid * 1.3 / 2) / Math.tan(hf / 2));
    this.camera.position.set(0, hgt * 0.62, d);
    this.camera.lookAt(0, hgt * 0.5, 0);
  }
  bindDrag(canvas) {
    let lastX = 0, lastT = 0;
    const opt = { signal: this.listen.signal };
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; lastX = e.clientX; lastT = performance.now(); canvas.setPointerCapture?.(e.pointerId); }, opt);
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const now = performance.now();
      const dx = e.clientX - lastX;
      this.angle += dx * 0.012;
      this.vel = (dx * 0.012) / Math.max(0.008, (now - lastT) / 1000);
      lastX = e.clientX; lastT = now;
    }, opt);
    const up = () => { this.dragging = false; };
    canvas.addEventListener('pointerup', up, opt);
    canvas.addEventListener('pointercancel', up, opt);
  }
  frame(dt) {
    this.t += dt;
    if (!this.dragging) {
      this.vel *= Math.max(0, 1 - dt * 2.2);
      if (Math.abs(this.vel) < 0.5) this.vel += (0.5 * Math.sign(this.vel || 1) - this.vel) * dt * 2;
      this.angle += this.vel * dt;
    }
    if (this.fig) { this.fig.root.rotation.y = this.angle; this.fig.baseYaw = this.angle; this.fig.update(dt); }
    this.fx.update(dt);
    getRenderer().render(this.scene, this.camera);
  }
  dispose() {
    this.disposed = true;
    this.listen.abort();
    unmount();
    this.offResize?.();
    this.fig?.dispose();
    this.fx.dispose();
    disposeScene(this.scene);
  }
}

function starsText(toy) {
  const n = starsForLevel(levelFromXp(toy.xp));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export function toyCard(toy, bag, { onClick, selectedIndex = -1 } = {}) {
  const p = powerById(toy.power);
  const card = h('div', { class: `toy-card${selectedIndex >= 0 ? ' selected' : ''}`, role: 'button', tabindex: 0, 'aria-label': toy.name, dataset: { id: toy.id } },
    h('div', { class: 'pic', style: { '--tint': `${p.color}66` } }, toy.thumbBlob ? h('img', { src: bag.url(toy.thumbBlob), alt: '' }) : h('span', { style: { fontSize: '60px' } }, '🧸')),
    h('div', { class: 'pw', 'aria-hidden': 'true' }, p.emoji),
    toy.builtin ? h('div', { class: 'builtin-tag', title: 'Training dummy' }, '🥋') : null,
    h('div', { class: 'nm' }, toy.name),
    h('div', { class: 'meta' }, h('span', { class: 'stars' }, starsText(toy)), h('span', {}, `🏆${toy.wins || 0}`)),
    selectedIndex >= 0 ? h('div', { class: 'slotnum' }, String(selectedIndex + 1)) : null);
  card.style.setProperty('--tint', `${p.color}88`);
  if (onClick) card.addEventListener('click', () => onClick(toy, card));
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') card.click(); });
  return card;
}

export async function toysScreen(el) {
  const bag = new UrlBag();
  const grid = h('div', { class: 'toy-grid' });
  el.append(topbar('My Toys', { onBack: () => navBack() }), h('div', { class: 'scroll' }, grid));
  const toys = await loadToys();
  grid.append(h('div', { class: 'toy-card add', role: 'button', 'aria-label': 'Add a toy', onClick: () => go('add') },
    h('div', { class: 'plus' }, '📸'), h('div', { class: 'nm' }, 'Add a Toy')));
  for (const t of toys) grid.append(toyCard(t, bag, { onClick: () => go('toy', { id: t.id }) }));
  return () => bag.revoke();
}

export async function toyScreen(el, { id }) {
  let toy = await db.getToy(id);
  if (!toy) { go('toys', {}, { replace: true }); return null; }
  el.classList.add('detail');
  const view = h('div', { class: 'viewport' });
  const nameEl = h('p', { class: 'name' }, toy.name);
  const statBar = (emoji, label, v, color) => h('div', { class: 'statrow', 'aria-label': `${label} ${v}` },
    h('span', { style: { fontSize: '24px' } }, emoji), h('div', { class: 'bar' }, h('i', { style: { width: `${v}%`, background: color } })), h('b', {}, String(v)));
  const p = powerById(toy.power);
  const powerChip = h('span', { class: 'chip' }, p.emoji, ' ', p.short || p.label);
  const level = levelFromXp(toy.xp);
  const info = h('div', { class: 'panel info' },
    nameEl,
    h('div', { class: 'chips' }, powerChip, h('span', { class: 'chip' }, '🏆 ', String(toy.wins || 0)), h('span', { class: 'chip', style: { color: '#b07800' } }, starsText(toy)), h('span', { class: 'chip' }, `Lv ${level}`)),
    statBar('💪', 'Power', toy.stats.power, 'linear-gradient(#ff8a8a,#ff3d3d)'),
    statBar('⚡', 'Speed', toy.stats.speed, 'linear-gradient(#fff08a,#ffc400)'),
    statBar('🛡️', 'Defense', toy.stats.defense, 'linear-gradient(#8ac4ff,#2d7dff)'),
    h('div', { style: { fontSize: '14px', textAlign: 'center', opacity: 0.7 } }, `${(toy.xp || 0) % XP_PER_LEVEL}/${XP_PER_LEVEL} ⭐ to next level`),
  );
  const rename = async () => {
    const input = h('input', { class: 'field', type: 'text', maxlength: 18, value: toy.name, 'aria-label': 'Toy name' });
    const dice = btn({ emoji: '🎲', cls: 'icon purple', aria: 'Random name', onClick: () => { input.value = randomName(Math.random, input.value); sfx.boing(); } });
    const v = await modal({ emoji: '✏️', title: 'New name', body: h('div', { class: 'row' }, input, dice),
      actions: [{ emoji: '❌', label: 'Cancel', cls: 'white', value: null }, { emoji: '✅', label: 'Save', cls: 'green', value: () => input.value.trim() }] });
    if (v) { toy = await db.updateToy(toy.id, { name: v.slice(0, 18) }); nameEl.textContent = toy.name; sfx.sparkle(); }
  };
  const changePower = async () => {
    const grid = h('div', { class: 'power-grid', style: { gridTemplateColumns: 'repeat(2,1fr)' } });
    let chosen = null;
    const pr = modal({ emoji: '⚡', title: 'Pick a Power!', body: grid, actions: [{ emoji: '❌', label: 'Cancel', cls: 'white', value: null }] });
    for (const pw of POWERS) {
      const b = btn({ emoji: pw.emoji, label: pw.short || pw.label, cls: pw.id === toy.power ? 'on' : '' });
      b.style.setProperty('--c', pw.color);
      if (pw.id === 'ninja' || pw.id === 'shield' || pw.id === 'magic') b.style.setProperty('--fg', '#fff');
      b.addEventListener('click', () => { chosen = pw.id; sfx.special(pw.fx); document.querySelector('.modal-back')?.close?.(pw.id); });
      grid.append(b);
    }
    const v = (await pr) || chosen;
    if (v && v !== toy.power) {
      toy = await db.updateToy(toy.id, { power: v, thumbBlob: null });
      go('toy', { id: toy.id }, { replace: true });
    }
  };
  const remove = async () => {
    if (toy.builtin) {
      const v = await modal({ emoji: '🥋', title: 'Training dummy', text: 'Dummies can’t be deleted, but you can hide them.',
        actions: [{ emoji: '❌', label: 'Keep', cls: 'white', value: false }, { emoji: '🙈', label: 'Hide', cls: 'yellow', value: true }] });
      if (v) { await db.updateToy(toy.id, { hidden: true }); go('toys', {}, { replace: true }); }
      return;
    }
    const v = await modal({ emoji: '🗑️', title: `Delete ${toy.name}?`, text: 'Grown-ups: press and hold Delete.',
      actions: [{ emoji: '❌', label: 'Keep', cls: 'green', value: false }, { emoji: '🗑️', label: 'Delete', cls: 'red', value: true, hold: 1200 }] });
    if (v) { await db.deleteToy(toy.id); toast(`👋 Bye ${toy.name}!`); go('toys', {}, { replace: true }); }
  };
  el.append(
    topbar(toy.builtin ? 'Dummy' : 'My Toy', { onBack: () => navBack(), right: btn({ emoji: '🥊', cls: 'icon red', aria: 'Battle with this toy', onClick: () => go('pick', { mode: 'battle', preselect: [toy.id] }) }) }),
    view,
    info,
    h('div', { class: 'actions' },
      btn({ emoji: '✏️', label: 'Name', cls: 'yellow', onClick: rename }),
      btn({ emoji: p.emoji, label: 'Power', cls: 'purple', onClick: changePower }),
      toy.builtin ? null : btn({ emoji: '📸', label: 'Photo', cls: 'blue', onClick: () => go('add', { retakeId: toy.id }) }),
      btn({ emoji: toy.builtin ? '🙈' : '🗑️', label: toy.builtin ? 'Hide' : 'Delete', cls: 'white', onClick: remove }),
    ),
  );
  if (toy.builtin) el.querySelector('.actions').style.gridTemplateColumns = 'repeat(3, 1fr)';
  const tt = new Turntable(view, toy);
  tt.ready.then(async () => {
    if (!toy.thumbBlob && !tt.disposed) { const { renderThumb } = await import('../engine.js'); toy.thumbBlob = await renderThumb(toy); await db.putToy(toy); }
  }).catch((e) => console.warn('[toy-arena] turntable', e));
  return () => tt.dispose();
}

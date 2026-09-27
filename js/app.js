// Toy Arena — boot, screen router, shared state.

import { h, toast, busy } from './ui.js';
import { THUMB_V } from './core/versions.js';
import * as db from './db.js';
import { installAudioUnlock, setMuted, sfx } from './audio.js';

const screens = {
  setup: () => import('./screens/home.js').then(m => m.setupScreen),
  home: () => import('./screens/home.js').then(m => m.homeScreen),
  add: () => import('./screens/add.js').then(m => m.addScreen),
  toys: () => import('./screens/toys.js').then(m => m.toysScreen),
  toy: () => import('./screens/toys.js').then(m => m.toyScreen),
  bones: () => import('./screens/bones.js').then(m => m.bonesScreen),
  pick: () => import('./screens/pick.js').then(m => m.pickScreen),
  stage: () => import('./screens/pick.js').then(m => m.stageScreen),
  battle: () => import('./battle.js').then(m => m.battleScreen),
  play: () => import('./play.js').then(m => m.playScreen),
};

export const APP_VERSION = '2.0.0';

let current = null; // { name, params, el, cleanup }
const stack = [];
let navigating = Promise.resolve();

export function possessive(name) {
  const n = (name || '').trim().toUpperCase();
  if (!n) return '';
  return n.endsWith('S') ? `${n}'` : `${n}'S`;
}
export function ownerName() { return db.settings().ownerName || ''; }

async function show(name, params = {}, { replace = false, isBack = false } = {}) {
  const loader = screens[name];
  if (!loader) throw new Error(`unknown screen ${name}`);
  let factory;
  try { factory = await loader(); } catch (e) {
    console.error('[toy-arena] could not load screen', name, e);
    toast('Oops! Let’s try that again.');
    return;
  }
  const prev = current;
  if (prev) {
    try { await prev.cleanup?.(); } catch (e) { console.warn('[toy-arena] cleanup', e); }
  }
  const root = document.getElementById('app');
  const el = h('div', { class: `screen enter ${name}`, dataset: { screen: name } });
  const next = { name, params, el, cleanup: null };
  current = next;
  if (!isBack && prev && !replace) stack.push({ name: prev.name, params: prev.params });
  // replacing e.g. toy-detail with the toy list: don't leave a duplicate list behind us
  if (replace && stack.length && stack[stack.length - 1].name === name) stack.pop();
  root.querySelector('#boot')?.remove();
  if (prev?.el) {
    prev.el.classList.remove('enter');
    prev.el.classList.add('leave');
    const old = prev.el;
    setTimeout(() => old.remove(), 230);
  }
  root.append(el);
  try {
    next.cleanup = (await factory(el, params)) || null;
  } catch (e) {
    console.error('[toy-arena] screen failed', name, e);
    toast('Oops! Let’s try that again.');
    // queue (don't await) — awaiting here would wait on this very navigation and freeze the app
    if (name !== 'home') setTimeout(() => go('home', {}, { replace: true, reset: true }), 0);
  }
  if (!isBack) { try { history.pushState({ n: stack.length }, ''); } catch { /* ignore */ } }
  document.body.dataset.screen = name;
}

/** Navigate. opts.reset clears the back stack (e.g. after finishing a flow). */
export function go(name, params = {}, opts = {}) {
  if (opts.reset) stack.length = 0;
  navigating = navigating.then(() => show(name, params, opts)).catch(e => console.error(e));
  return navigating;
}
export function back() {
  const prev = stack.pop();
  sfx.back();
  navigating = navigating.then(() => show(prev ? prev.name : 'home', prev ? prev.params : {}, { isBack: true })).catch(e => console.error(e));
  return navigating;
}
export const currentScreen = () => current?.name;

// ---------- toys ----------
let dummiesReady = null;
export async function ensureDummies() {
  if (!dummiesReady) {
    dummiesReady = (async () => {
      const have = await db.allToys();
      const { makeDummies, BUILTIN_IDS, RETIRED_IDS, DUMMY_V } = await import('./dummies.js');
      // the v1 standee dummies are retired (they had no real arms/legs to animate); keep "hide dummies"
      const retired = have.filter(t => RETIRED_IDS.includes(t.id));
      const hidden = retired.some(t => t.hidden) || have.some(t => BUILTIN_IDS.includes(t.id) && t.hidden);
      const missing = BUILTIN_IDS.filter(id => !have.find(t => t.id === id && t.dummyV === DUMMY_V));
      if (missing.length) {
        const dummies = (await makeDummies()).filter(d => missing.includes(d.id));
        for (const d of dummies) {
          const old = have.find(t => t.id === d.id);
          Object.assign(d, { hidden, wins: old?.wins || 0, losses: old?.losses || 0, xp: old?.xp || 0 });
        }
        await db.putMany(dummies);
      }
      // only after the new ones are safely stored (a failure here keeps the "hidden" choice for the retry)
      for (const t of retired) await db.deleteToy(t.id);
    })().catch((e) => { dummiesReady = null; console.warn('[toy-arena] dummies', e); });
  }
  return dummiesReady;
}

/** All toys, with missing / out-of-date card thumbnails rendered (and cached) on the way. */
let thumbJob = null;
const thumbFailed = new Set(); // cards that failed to render this session: don't retry on every screen
export async function loadToys({ includeHidden = false } = {}) {
  await ensureDummies();
  let toys = await db.allToys();
  const need = toys.filter(t => (!t.thumbBlob || t.thumbV !== THUMB_V) && !thumbFailed.has(t.id));
  if (need.length) {
    // concurrent callers (home shelf + the next screen) share one refresh
    if (!thumbJob) thumbJob = refreshThumbs(need).finally(() => { thumbJob = null; });
    await thumbJob;
    toys = await db.allToys();
  }
  return includeHidden ? toys : toys.filter(t => !t.hidden);
}

async function refreshThumbs(need) {
  const { renderThumb } = await import('./engine.js');
  // after an update every card re-renders once: show a friendly wait when it's more than a couple
  const wait = need.length > 2 && document.getElementById('app') ? busy('Waking up your toys…', { emoji: '🧸' }) : null;
  try {
    for (const [i, t] of need.entries()) {
      try {
        const thumbBlob = await renderThumb(t);
        // write only the card fields onto the latest record (never clobber other edits)
        await db.updateToy(t.id, { thumbBlob, thumbV: THUMB_V });
      } catch (e) { thumbFailed.add(t.id); console.warn('[toy-arena] thumb', e); }
      wait?.set(null, (i + 1) / need.length);
    }
  } finally { wait?.close(); }
}

// ---------- boot ----------
function preventZoom() {
  // iOS ignores user-scalable=no; block pinch + double-tap zoom on game UI.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouch < 300 && !e.target.closest('input, textarea')) e.preventDefault();
    lastTouch = now;
  }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
  document.addEventListener('dblclick', (e) => e.preventDefault());
}

function buttonSounds() {
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn, .toy-card, .stage-card');
    if (!b || b.closest('.controls') || b.classList.contains('hold')) return;
    sfx.tap();
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  if (new URLSearchParams(location.search).has('nosw')) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // After first load, quietly cache the cutout model so "Add a Toy" works offline too.
    const warm = () => reg.active?.postMessage({ type: 'warm' });
    if (reg.active) setTimeout(warm, 4000);
    else navigator.serviceWorker.addEventListener('controllerchange', () => setTimeout(warm, 4000), { once: true });
  }).catch((e) => console.info('[toy-arena] no service worker:', e.message));
}

async function boot() {
  preventZoom();
  installAudioUnlock();
  buttonSounds();
  setMuted(db.settings().muted);
  window.addEventListener('popstate', () => {
    if (document.querySelector('.modal-back')) { document.querySelector('.modal-back').close?.(null); return; }
    if (current?.name !== 'home' && current?.name !== 'setup') back();
  });
  db.requestPersist();
  registerSW();
  ensureDummies();
  const s = db.settings();
  await go(s.setupDone ? 'home' : 'setup', {}, { reset: true });
  window.__toyArenaReady = true;
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').innerHTML = '<div class="screen center-col"><div class="big-emoji">😵</div><p class="subtitle">Oops! Please reload.</p></div>';
});

// Debug hooks for automated tests (harmless in production).
window.__toyArena = { go, back, db, loadToys, currentScreen };

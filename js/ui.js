// Tiny DOM toolkit: hyperscript, chunky buttons, modals, toasts, busy overlay, hold-to-confirm.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Chunky toy button: emoji + 1–2 words. */
export function btn({ emoji, label, cls = '', onClick, aria, id, disabled } = {}) {
  return h('button', { class: `btn ${cls}`, type: 'button', 'aria-label': aria || label || emoji, id, disabled, onClick },
    emoji ? h('span', { class: 'emo', 'aria-hidden': 'true' }, emoji) : null,
    label ? h('span', { class: 'lbl' }, label) : null);
}

export function backBtn(onClick) {
  return btn({ emoji: '⬅️', cls: 'icon white', aria: 'Back', onClick });
}

export function topbar(title, { onBack, right } = {}) {
  return h('div', { class: 'topbar' },
    onBack ? backBtn(onBack) : h('div', { class: 'ghost' }),
    h('h2', {}, title),
    right || h('div', { class: 'ghost' }));
}

const overlay = () => document.getElementById('overlay');

/**
 * In-app modal. actions: [{ emoji, label, cls, value, hold }] → resolves with the chosen value
 * (null when dismissed by tapping outside, if `dismissable`).
 */
export function modal({ emoji, title, text, body, actions = [], dismissable = true, cls = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const close = (v) => {
      if (done) return;
      done = true;
      back.remove();
      resolve(v);
    };
    const btns = actions.map(a => {
      const b = btn({ emoji: a.emoji, label: a.label, cls: a.cls || 'white' });
      if (a.hold) holdToConfirm(b, a.hold, () => close(a.value));
      else b.addEventListener('click', () => close(typeof a.value === 'function' ? a.value() : a.value));
      return b;
    });
    const m = h('div', { class: `modal ${cls}`, role: 'dialog', 'aria-modal': 'true' },
      emoji ? h('div', { class: 'emo-head' }, emoji) : null,
      title ? h('h3', {}, title) : null,
      text ? h('p', {}, text) : null,
      body || null,
      btns.length ? h('div', { class: 'mbtns' }, btns) : null);
    const back = h('div', { class: 'modal-back' }, m);
    back.addEventListener('click', (e) => { if (e.target === back && dismissable) close(null); });
    back.close = close;
    overlay().append(back);
    const inp = m.querySelector('input');
    if (inp && !matchMedia('(pointer: coarse)').matches) setTimeout(() => inp.focus(), 50);
  });
}
export function closeAllModals() {
  for (const m of overlay().querySelectorAll('.modal-back')) m.close?.(null);
}

export function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2500);
}

/** Full-screen "working on it" overlay with a fun animation. */
export function busy(label, { emoji = '✂️' } = {}) {
  const lbl = h('div', { class: 'label' }, label);
  const bar = h('i');
  const prog = h('div', { class: 'progress', style: { visibility: 'hidden' } }, bar);
  const el = h('div', { class: 'busy', role: 'alert', 'aria-live': 'polite' },
    h('div', { class: 'scissors' }, emoji), lbl, h('div', { class: 'sparkles' }, '✨⭐✨'), prog);
  document.getElementById('app').append(el);
  return {
    set(text, pct) {
      if (text) lbl.textContent = text;
      if (pct != null) { prog.style.visibility = 'visible'; bar.style.width = `${Math.round(pct * 100)}%`; }
    },
    close() { el.remove(); },
  };
}

/** Press-and-hold to trigger (parent gate / destructive actions). Shows a filling ring. */
export function holdToConfirm(el, ms, onDone) {
  el.classList.add('hold');
  let raf = 0, start = 0;
  const reset = () => { cancelAnimationFrame(raf); el.style.setProperty('--p', 0); start = 0; };
  const tick = (t) => {
    if (!start) start = t;
    const p = Math.min(1, (t - start) / ms);
    el.style.setProperty('--p', p);
    if (p >= 1) { reset(); onDone(); return; }
    raf = requestAnimationFrame(tick);
  };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); reset(); raf = requestAnimationFrame(tick); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, reset);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onDone(); });
}

export function confetti(container, n = 70) {
  const box = h('div', { class: 'confetti' });
  const colors = ['#ff3d3d', '#ffd23f', '#2d7dff', '#2fd26b', '#8e5cff', '#ff5fa2', '#29d3ff'];
  for (let i = 0; i < n; i++) {
    box.append(h('i', { style: {
      left: `${Math.random() * 100}%`, background: colors[i % colors.length],
      animationDuration: `${1.8 + Math.random() * 1.8}s`, animationDelay: `${Math.random() * 0.8}s`,
      transform: `rotate(${Math.random() * 360}deg)`,
    } }));
  }
  container.append(box);
  setTimeout(() => box.remove(), 4500);
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Object URLs for blobs, revoked when the owning screen goes away. */
export class UrlBag {
  constructor() { this.urls = []; }
  url(blob) { if (!blob) return ''; const u = URL.createObjectURL(blob); this.urls.push(u); return u; }
  revoke() { this.urls.forEach(u => URL.revokeObjectURL(u)); this.urls = []; }
}

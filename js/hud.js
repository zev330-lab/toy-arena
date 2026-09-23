// Screen-space comic overlays shared by Battle and Play: POW! bubbles, banners, combo counters.

import { h, sleep } from './ui.js';

const POW_COLORS = ['#ffd23f', '#ff5fa2', '#29d3ff', '#2fd26b', '#ff8a1f'];

export function powBubble(layer, arena, pos, word, { color, big = false } = {}) {
  const p = arena.project(pos);
  if (p.behind) return;
  const el = h('div', { class: `pow${big ? ' big' : ''}`, style: {
    left: `${p.x + (Math.random() - 0.5) * 40}px`, top: `${p.y - 30 + (Math.random() - 0.5) * 30}px`,
    '--c': color || POW_COLORS[Math.floor(Math.random() * POW_COLORS.length)],
  } }, h('span', {}, word));
  el.style.setProperty('--c', color || POW_COLORS[Math.floor(Math.random() * POW_COLORS.length)]);
  layer.append(el);
  setTimeout(() => el.remove(), 750);
}

export function comboText(layer, arena, pos, n) {
  const p = arena.project(pos);
  const el = h('div', { class: 'combo', style: { left: `${p.x - 40}px`, top: `${p.y - 110}px` } }, `${n} HITS!`);
  layer.append(el);
  setTimeout(() => el.remove(), 950);
}

/** Big slam-in banner; resolves after `ms`. */
export async function banner(layer, text, { ms = 1000, small = false, color } = {}) {
  const el = h('div', { class: `banner${small ? ' small' : ''}` }, text);
  if (color) el.style.color = color;
  layer.append(el);
  await sleep(ms);
  el.classList.add('out');
  setTimeout(() => el.remove(), 320);
}

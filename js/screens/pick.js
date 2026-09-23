// Choose fighters (or playmates), choose an arena, then the VS splash.

import { h, btn, topbar, UrlBag, sleep } from '../ui.js';
import { go, back as navBack, loadToys } from '../app.js';
import * as db from '../db.js';
import { toyCard } from './toys.js';
import { STAGES } from '../arena.js';
import { sfx } from '../audio.js';

export async function pickScreen(el, params = {}) {
  const mode = params.mode === 'play' ? 'play' : 'battle';
  const max = mode === 'battle' ? 2 : 4;
  const bag = new UrlBag();
  let players = params.players || '1p';
  const toys = await loadToys();
  const selected = (params.preselect || []).filter(id => toys.find(t => t.id === id)).slice(0, max);

  const slots = h('div', { class: `slots${max > 2 ? ' four' : ''}` });
  const grid = h('div', { class: 'toy-grid' });
  const goBtn = btn({ emoji: mode === 'battle' ? '⚔️' : '🎉', label: mode === 'battle' ? 'FIGHT!' : 'PLAY!', cls: 'red big wide', id: 'pick-go', onClick: () => next() });
  const renderSlots = () => {
    slots.replaceChildren();
    for (let i = 0; i < max; i++) {
      const t = toys.find(x => x.id === selected[i]);
      const label = mode === 'battle' ? (players === '1p' ? (i === 0 ? '🧒' : '🤖') : (i === 0 ? '1️⃣' : '2️⃣')) : '❓';
      const s = h('div', { class: `slot${t ? ' filled' : ''}`, 'aria-label': t ? t.name : `empty slot ${i + 1}` },
        t ? h('img', { src: bag.url(t.thumbBlob), alt: '' }) : label,
        t ? h('div', { class: 'x', 'aria-hidden': 'true' }, '✖') : null);
      if (t) s.addEventListener('click', () => { selected.splice(i, 1); sfx.back(); render(); });
      slots.append(s);
      if (mode === 'battle' && i === 0) slots.append(h('div', { class: 'vs-mini' }, 'VS'));
    }
    goBtn.disabled = selected.length < 2;
    goBtn.classList.toggle('pulse', selected.length >= 2);
  };
  const renderGrid = () => {
    grid.replaceChildren();
    for (const t of toys) {
      const idx = selected.indexOf(t.id);
      grid.append(toyCard(t, bag, { selectedIndex: idx, onClick: () => {
        const i = selected.indexOf(t.id);
        if (i >= 0) { selected.splice(i, 1); sfx.back(); }
        else if (selected.length < max) { selected.push(t.id); sfx.pop(); }
        else { selected[max - 1] = t.id; sfx.pop(); }
        render();
      } }));
    }
  };
  const render = () => { renderSlots(); renderGrid(); };

  const randomBtn = btn({ emoji: '🎲', label: 'Random', cls: 'purple', onClick: () => {
    const pool = toys.slice().sort(() => Math.random() - 0.5);
    const keep = selected.slice(0, 1);
    for (const t of pool) { if (keep.length >= (mode === 'battle' ? 2 : Math.min(max, Math.max(2, selected.length)))) break; if (!keep.includes(t.id)) keep.push(t.id); }
    selected.splice(0, selected.length, ...keep);
    sfx.boing();
    render();
  } });

  let seg = null;
  if (mode === 'battle') {
    seg = h('div', { class: 'seg' });
    for (const [id, emoji, label] of [['1p', '🤖', '1 Player'], ['2p', '👫', '2 Players']]) {
      const b = btn({ emoji, label, cls: id === players ? 'on' : '' });
      b.dataset.players = id;
      b.addEventListener('click', () => { players = id; seg.querySelectorAll('.btn').forEach(x => x.classList.toggle('on', x.dataset.players === id)); renderSlots(); });
      seg.append(b);
    }
  }

  const next = () => {
    if (selected.length < 2) return;
    go('stage', { mode, players, ids: selected.slice() });
  };

  el.append(...[
    topbar(mode === 'battle' ? 'Pick Fighters!' : 'Who’s Playing?', { onBack: () => navBack() }),
    slots,
    seg,
    h('div', { class: 'scroll', style: { marginTop: seg ? '10px' : '0' } }, grid),
    h('div', { class: 'pick-footer' }, h('div', { class: 'row' }, randomBtn, goBtn)),
  ].filter(Boolean));
  goBtn.style.flex = '1';
  render();
  return () => bag.revoke();
}

export async function stageScreen(el, params) {
  const { mode, players, ids } = params;
  const grid = h('div', { class: 'stage-grid' });
  const choose = async (stageId) => {
    db.saveSettings({ lastStage: stageId });
    sfx.pop();
    if (mode === 'battle') await vsSplash(el, ids);
    go(mode === 'battle' ? 'battle' : 'play', { ids, players, stage: stageId }, { replace: true });
  };
  for (const s of [...STAGES, { id: 'random', label: 'Surprise!', emoji: '🎲' }]) {
    const c = h('div', { class: `stage-card ${s.id}`, role: 'button', tabindex: 0, 'aria-label': s.label, dataset: { stage: s.id } },
      h('div', { class: 'emo', 'aria-hidden': 'true' }, s.emoji), h('div', { class: 'lbl' }, s.label));
    c.addEventListener('click', () => choose(s.id));
    grid.append(c);
  }
  grid.lastChild.style.gridColumn = '1 / -1';
  grid.lastChild.style.aspectRatio = '3 / 1';
  el.append(topbar('Pick Arena!', { onBack: () => navBack() }), h('div', { class: 'scroll' }, grid));
}

async function vsSplash(el, ids) {
  const bag = new UrlBag();
  const [a, b] = await Promise.all(ids.slice(0, 2).map(id => db.getToy(id)));
  const sp = h('div', { class: 'vs-splash', role: 'presentation' },
    h('div', { class: 'side s1' }, h('div', { class: 'nm' }, a.name), h('img', { src: bag.url(a.thumbBlob), alt: '' })),
    h('div', { class: 'side s2' }, h('img', { src: bag.url(b.thumbBlob), alt: '' }), h('div', { class: 'nm' }, b.name)),
    h('div', { class: 'bolt', 'aria-hidden': 'true' }, '⚡'),
    h('div', { class: 'vs' }, 'VS!'));
  document.getElementById('app').append(sp);
  sfx.whoosh();
  await sleep(550);
  sfx.hit(1.4);
  sfx.special('bolt');
  await sleep(1500);
  sp.style.transition = 'opacity .25s';
  sp.style.opacity = '0';
  setTimeout(() => { sp.remove(); bag.revoke(); }, 900);
}

// First-launch setup, home screen and the grown-ups' settings panel.

import { h, btn, modal, toast, holdToConfirm, UrlBag, busy } from '../ui.js';
import { go, possessive, ownerName, loadToys, APP_VERSION } from '../app.js';
import * as db from '../db.js';
import { setMuted, sfx } from '../audio.js';

function titleEl(size) {
  const owner = possessive(ownerName());
  return h('h1', { class: 'title', style: size ? { fontSize: size } : null },
    owner ? h('span', { class: 'owner' }, owner) : null, 'TOY', h('br'), 'ARENA');
}

export async function setupScreen(el) {
  el.classList.add('bg-comic');
  const input = h('input', { class: 'field', type: 'text', maxlength: 14, placeholder: 'Your name', autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done', 'aria-label': 'Your name' });
  const finish = (name) => {
    db.saveSettings({ ownerName: (name || '').trim().slice(0, 14), setupDone: true });
    sfx.fanfare();
    go('home', {}, { reset: true, replace: true });
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { input.blur(); finish(input.value); } });
  el.append(
    h('div', { class: 'bg-burst' }),
    h('div', { class: 'center-col', style: { position: 'relative' } },
      h('div', { class: 'big-emoji wiggle' }, '🦸'),
      h('p', { class: 'subtitle', style: { fontSize: '40px' } }, 'Who’s the', h('br'), 'Toy Master?'),
      h('div', { style: { width: 'min(360px, 100%)' } }, input),
      btn({ emoji: '🚀', label: 'Let’s Go!', cls: 'green big pulse', onClick: () => finish(input.value) }),
      btn({ emoji: '⏭️', label: 'Skip', cls: 'white small', onClick: () => finish('') }),
    ),
  );
}

export async function homeScreen(el) {
  const bag = new UrlBag();
  el.classList.add('home');
  const muteBtn = btn({ emoji: db.settings().muted ? '🔇' : '🔊', cls: 'icon white small mute', aria: 'Sound on or off' });
  muteBtn.addEventListener('click', () => {
    const m = !db.settings().muted;
    db.saveSettings({ muted: m });
    setMuted(m);
    muteBtn.querySelector('.emo').textContent = m ? '🔇' : '🔊';
  });
  const gear = btn({ emoji: '⚙️', cls: 'icon white small gear', aria: 'Grown-ups: hold for settings' });
  holdToConfirm(gear, 900, () => openSettings());
  gear.addEventListener('click', () => toast('👆 Grown-ups: press and hold'));

  const shelf = h('div', { class: 'shelf', 'aria-hidden': 'true' });
  const grid = h('div', { class: 'grid' },
    btn({ emoji: '📸', label: 'Add a Toy', cls: 'red add wiggle', onClick: () => go('add') }),
    btn({ emoji: '🥊', label: 'Battle', cls: 'yellow stack', onClick: () => go('pick', { mode: 'battle' }) }),
    btn({ emoji: '🎉', label: 'Play', cls: 'green stack', onClick: () => go('pick', { mode: 'play' }) }),
    btn({ emoji: '🧸', label: 'My Toys', cls: 'blue add', onClick: () => go('toys') }),
  );
  el.append(
    h('div', { class: 'bg-burst' }),
    muteBtn, gear,
    h('div', { class: 'hero' }, titleEl()),
    shelf,
    grid,
  );
  loadToys().then((toys) => {
    for (const t of toys.filter(x => x.thumbBlob).slice(-5).reverse()) shelf.append(h('img', { src: bag.url(t.thumbBlob), alt: '' }));
  }).catch(() => {});
  return () => bag.revoke();
}

// ---------- settings (grown-ups) ----------
export async function openSettings() {
  sfx.pop();
  const s = db.settings();
  const name = h('input', { class: 'field', type: 'text', maxlength: 14, value: s.ownerName || '', placeholder: 'Kid’s name', 'aria-label': 'Kid’s name', style: { fontSize: '22px', minHeight: '56px' } });
  const seg = (options, value, onPick) => {
    const box = h('div', { class: 'seg' });
    for (const o of options) {
      const b = btn({ emoji: o.emoji, label: o.label, cls: o.value === value ? 'on' : '' });
      b.addEventListener('click', () => { box.querySelectorAll('.btn').forEach(x => x.classList.remove('on')); b.classList.add('on'); onPick(o.value); });
      box.append(b);
    }
    return box;
  };
  const toys = await db.allToys();
  const dummies = toys.filter(t => t.builtin);
  const dummiesHidden = dummies.length && dummies.every(t => t.hidden);
  const body = h('div', { class: 'settings-list' },
    h('div', { class: 'sec' }, h('h4', {}, '🦸 Toy Master name'), name, h('small', {}, 'Shows on the title. Leave empty for “Toy Arena”.')),
    h('div', { class: 'sec' }, h('h4', {}, '🤖 Computer player'),
      seg([{ emoji: '🐣', label: 'Easy', value: 'easy' }, { emoji: '🔥', label: 'Hard', value: 'hard' }], s.difficulty, (v) => db.saveSettings({ difficulty: v }))),
    h('div', { class: 'sec' }, h('h4', {}, '🔊 Sound'),
      seg([{ emoji: '🔊', label: 'On', value: false }, { emoji: '🔇', label: 'Off', value: true }], !!s.muted, (v) => { db.saveSettings({ muted: v }); setMuted(v); })),
    h('div', { class: 'sec' }, h('h4', {}, '🥋 Training dummies'),
      seg([{ emoji: '👀', label: 'Show', value: false }, { emoji: '🙈', label: 'Hide', value: true }], !!dummiesHidden, async (v) => {
        for (const d of dummies) await db.updateToy(d.id, { hidden: v });
      })),
    h('div', { class: 'sec' }, h('h4', {}, '💾 Backup'),
      h('div', { class: 'row' },
        btn({ emoji: '📤', label: 'Save', cls: 'blue small', onClick: () => exportBackup() }),
        btn({ emoji: '📥', label: 'Restore', cls: 'green small', onClick: () => importBackup() })),
      h('small', {}, 'Photos never leave this device. A backup is one file you can keep in Files or iCloud Drive.')),
    h('small', { style: { textAlign: 'center' } }, `Toy Arena ${APP_VERSION} · no accounts · no tracking`),
  );
  await modal({ emoji: '⚙️', title: 'Grown-ups', body, actions: [{ emoji: '✅', label: 'Done', cls: 'green', value: true }] });
  const newName = name.value.trim().slice(0, 14);
  if (newName !== (s.ownerName || '')) db.saveSettings({ ownerName: newName });
  if (document.body.dataset.screen === 'home') go('home', {}, { replace: true });
}

const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
const dataURLToBlob = async (d) => (await fetch(d)).blob();

export async function exportBackup() {
  const b = busy('Packing toys…', { emoji: '📦' });
  try {
    const { serializeBackup } = await import('../core/backup.js');
    const toys = (await db.allToys()).filter(t => !t.builtin);
    const json = await serializeBackup(toys, blobToDataURL, { ownerName: ownerName() });
    const stamp = new Date().toISOString().slice(0, 10);
    const file = new File([json], `toy-arena-backup-${stamp}.json`, { type: 'application/json' });
    b.close();
    const canShare = navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches;
    if (canShare) {
      // Packing took a while, so the original tap no longer counts as a user gesture on iOS:
      // ask for a fresh tap before opening the share sheet (→ “Save to Files”).
      const ok = await modal({ emoji: '📦', title: 'Backup ready!', text: `${toys.length} toy${toys.length === 1 ? '' : 's'} packed.`,
        actions: [{ emoji: '❌', label: 'Cancel', cls: 'white', value: false }, { emoji: '📤', label: 'Share', cls: 'blue', value: true }] });
      if (!ok) return;
      try { await navigator.share({ files: [file], title: 'Toy Arena backup' }); toast('💾 Backup saved!'); return; } catch (e) {
        if (e.name === 'AbortError') return;
        console.info('[toy-arena] share failed, downloading instead:', e.message);
      }
    }
    const a = h('a', { href: URL.createObjectURL(file), download: file.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`💾 Saved ${toys.length} toy${toys.length === 1 ? '' : 's'}!`);
  } catch (e) {
    b.close();
    console.error(e);
    toast('😵 Backup failed');
  }
}

export function importBackup() {
  const input = h('input', { type: 'file', accept: 'application/json,.json', style: { position: 'fixed', left: '-9999px' } });
  input.dataset.role = 'restore-input';
  document.body.append(input);
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.remove();
    if (!f) return;
    const b = busy('Unpacking toys…', { emoji: '📦' });
    try {
      const { deserializeBackup } = await import('../core/backup.js');
      const { toys, ownerName: on } = await deserializeBackup(await f.text(), dataURLToBlob);
      await db.putMany(toys);
      if (on && !ownerName()) db.saveSettings({ ownerName: on });
      b.close();
      toast(`📥 ${toys.length} toy${toys.length === 1 ? '' : 's'} restored!`);
      sfx.fanfare();
    } catch (e) {
      b.close();
      modal({ emoji: '🤔', title: 'Hmm…', text: e.message || 'That backup could not be read.', actions: [{ emoji: '👍', label: 'OK', cls: 'yellow', value: true }] });
    }
  });
  input.click();
}

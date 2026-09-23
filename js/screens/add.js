// "Add a Toy" wizard: photo → magic cutout → (fix) → back photo? → name → power → 3D reveal.
// Also used for "Retake photo" on an existing toy (params.retakeId).

import { h, btn, topbar, busy, toast, modal, sleep } from '../ui.js';
import { go, back as navBack, possessive, ownerName } from '../app.js';
import * as db from '../db.js';
import { pickPhoto, fileToCanvas, canvasToBlob } from '../capture.js';
import { autoCutout, reselect, loadSegmenter, aiDisabled } from '../segment.js';
import { makeCutout, fitBack } from '../cutout.js';
import { POWERS, deriveStats, randomName } from '../core/stats.js';
import { maskArea } from '../core/mask.js';
import { sfx } from '../audio.js';

export async function addScreen(el, params = {}) {
  const retake = params.retakeId ? await db.getToy(params.retakeId) : null;
  const draft = { front: null, back: null, frontSession: null, backSession: null, name: '', power: null };
  let cleanupStep = null;
  let alive = true;
  // start warming the model while the kid lines up the photo
  if (!aiDisabled()) loadSegmenter().catch(() => {});

  const setStep = async (fn, ...args) => {
    try { cleanupStep?.(); } catch { /* ignore */ }
    cleanupStep = null;
    el.replaceChildren();
    el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
    cleanupStep = (await fn(...args)) || null;
  };

  // ---------- 1. take a photo ----------
  function start(side = 'front') {
    const isBack = side === 'back';
    el.append(
      topbar(isBack ? 'Its Back' : retake ? 'New Photo' : 'Add a Toy', { onBack: () => (isBack ? setStep(backQuestion) : navBack()) }),
      h('div', { class: 'center-col' },
        h('div', { class: 'big-emoji', style: { fontSize: '96px' } }, isBack ? '🔄' : '🧸'),
        h('p', { class: 'hint', style: { fontSize: '24px' } }, isBack ? 'Turn your toy around!' : 'Put your toy on a table!'),
        btn({ emoji: '📷', label: 'Take Photo', cls: 'red big pulse', aria: 'Take a photo with the camera', onClick: () => grab(side, true) }),
        btn({ emoji: '🖼️', label: 'Photos', cls: 'white', aria: 'Choose from photos', onClick: () => grab(side, false) }),
      ),
    );
  }

  async function grab(side, capture) {
    const file = await pickPhoto({ capture });
    if (!file || !alive) return;
    const b = busy('Snip snip!', { emoji: '✂️' });
    try {
      const photo = await fileToCanvas(file, 1024);
      const session = await autoCutout(photo, {
        onStatus: (s) => b.set(s === 'ready' ? 'Magic scissors…' : 'Snip snip!'),
      });
      draft[`${side}Session`] = session;
      b.close();
      if (!alive) return;
      sfx.sparkle();
      setStep(preview, side);
    } catch (e) {
      b.close();
      console.warn('[toy-arena] photo failed', e);
      await modal({ emoji: '🙈', title: 'Oops!', text: 'That photo didn’t work. Try another one!', actions: [{ emoji: '👍', label: 'OK', cls: 'yellow', value: true }] });
    }
  }

  // ---------- 2. preview: the cut-out pops on a starburst ----------
  function preview(side) {
    const session = draft[`${side}Session`];
    let cut;
    try { cut = makeCutout(session.photo, session.mask, session.w, session.h); } catch { return setStep(fix, side); }
    draft[side] = cut;
    cut.canvas.classList.add('cut');
    cut.canvas.setAttribute('role', 'img');
    cut.canvas.setAttribute('aria-label', 'Your cut-out toy');
    el.__cut = { session, cut, side }; // test hook: lets automated tests score the mask
    el.dataset.cutMethod = session.method;
    el.dataset.coverage = cut.coverage.toFixed(3);
    el.append(
      topbar(side === 'back' ? 'Its Back!' : 'Is this it?', { onBack: () => setStep(start, side) }),
      h('div', { class: 'starburst' }, cut.canvas),
      h('div', { class: 'action-row' },
        btn({ emoji: '🔄', label: 'Retake', cls: 'white', onClick: () => setStep(start, side) }),
        btn({ emoji: '👆', label: 'Fix', cls: 'blue', onClick: () => setStep(fix, side) }),
        btn({ emoji: '✅', label: 'Yes!', cls: 'green big pulse', id: 'cut-yes', onClick: () => {
          sfx.fanfare();
          if (side === 'back') return retake ? saveRetake() : setStep(nameStep);
          return setStep(backQuestion);
        } }),
      ),
    );
  }

  // ---------- 3. tap-to-fix (+ grown-up brush) ----------
  function fix(side) {
    const session = draft[`${side}Session`];
    const { w, h: hh, work } = session;
    const wrap = h('div', { class: 'fixwrap' });
    const cv = h('canvas');
    wrap.append(cv, h('div', { class: 'bubble-hint' }, '👆 Tap your toy!'));
    let tool = 'tap';
    const undo = [];
    const overlay = document.createElement('canvas');
    overlay.width = w; overlay.height = hh;
    const og = overlay.getContext('2d');
    const paintOverlay = () => {
      const img = og.createImageData(w, hh);
      const m = session.mask;
      for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (m[i]) {
          const edge = x === 0 || y === 0 || x === w - 1 || y === hh - 1 || !m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w];
          if (edge) { img.data[i * 4] = 255; img.data[i * 4 + 1] = 210; img.data[i * 4 + 2] = 63; img.data[i * 4 + 3] = 255; }
        } else { img.data[i * 4 + 3] = 195; img.data[i * 4] = 20; img.data[i * 4 + 1] = 10; img.data[i * 4 + 2] = 60; }
      }
      og.putImageData(img, 0, 0);
      draw();
    };
    let fitRect = { x: 0, y: 0, s: 1 };
    const draw = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
      const g = cv.getContext('2d');
      const s = Math.min(cv.width / w, cv.height / hh);
      const dx = (cv.width - w * s) / 2, dy = (cv.height - hh * s) / 2;
      fitRect = { x: dx / dpr, y: dy / dpr, s: s / dpr };
      g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
      g.imageSmoothingQuality = 'high';
      g.drawImage(work, dx, dy, w * s, hh * s);
      g.drawImage(overlay, dx, dy, w * s, hh * s);
    };
    const toWork = (e) => {
      const r = wrap.getBoundingClientRect();
      return [(e.clientX - r.left - fitRect.x) / fitRect.s, (e.clientY - r.top - fitRect.y) / fitRect.s];
    };
    const brush = (x, y, val) => {
      const R = Math.max(4, Math.round(Math.max(w, hh) * 0.035));
      for (let yy = Math.max(0, Math.floor(y - R)); yy < Math.min(hh, Math.ceil(y + R)); yy++) {
        for (let xx = Math.max(0, Math.floor(x - R)); xx < Math.min(w, Math.ceil(x + R)); xx++) {
          if ((xx - x) ** 2 + (yy - y) ** 2 <= R * R) session.mask[yy * w + xx] = val;
        }
      }
    };
    let pts = null;
    wrap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      wrap.setPointerCapture?.(e.pointerId);
      pts = [toWork(e)];
      if (tool !== 'tap') { undo.push(session.mask.slice()); brush(...pts[0], tool === 'restore' ? 1 : 0); paintOverlay(); }
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!pts) return;
      const p = toWork(e);
      const last = pts[pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 3) return;
      pts.push(p);
      if (tool !== 'tap') { brush(...p, tool === 'restore' ? 1 : 0); paintOverlay(); }
    });
    wrap.addEventListener('pointerup', async (e) => {
      if (!pts) return;
      const path = pts; pts = null;
      if (tool !== 'tap') return;
      const r = wrap.getBoundingClientRect();
      const ring = h('div', { class: 'tap-ring', style: { left: `${e.clientX - r.left}px`, top: `${e.clientY - r.top}px` } });
      wrap.append(ring); setTimeout(() => ring.remove(), 700);
      const inside = path.filter(([x, y]) => x >= 0 && y >= 0 && x < w && y < hh);
      if (!inside.length) return;
      undo.push(session.mask.slice());
      sfx.pop();
      const spread = Math.hypot(inside[0][0] - inside[inside.length - 1][0], inside[0][1] - inside[inside.length - 1][1]);
      await reselect(session, spread > 12 && inside.length > 3 ? inside.filter((_, i) => i % 2 === 0).slice(0, 40) : [inside[0]]);
      paintOverlay();
    });
    wrap.addEventListener('pointercancel', () => { pts = null; });
    const tools = h('div', { class: 'toolbar' });
    const toolBtn = (id, emoji, label) => {
      const b = btn({ emoji, label, cls: `small ${id === 'tap' ? 'yellow on' : 'white'}`, onClick: () => {
        tool = id;
        tools.querySelectorAll('[data-tool]').forEach(x => x.classList.toggle('on', x.dataset.tool === id));
        wrap.querySelector('.bubble-hint').textContent = id === 'tap' ? '👆 Tap your toy!' : id === 'erase' ? '🧽 Rub out extra bits' : '🖌️ Paint the toy back';
      } });
      b.dataset.tool = id;
      return b;
    };
    tools.append(
      toolBtn('tap', '👆', 'Tap'),
      toolBtn('erase', '🧽', 'Erase'),
      toolBtn('restore', '🖌️', 'Paint'),
      btn({ emoji: '↩️', label: 'Undo', cls: 'small white', onClick: () => { if (undo.length) { session.mask = undo.pop(); paintOverlay(); } } }),
    );
    el.append(
      topbar('Fix it!', { onBack: () => setStep(preview, side) }),
      wrap,
      tools,
      h('div', { class: 'action-row', style: { paddingTop: '10px' } },
        btn({ emoji: '✅', label: 'Done', cls: 'green big', onClick: () => {
          if (maskArea(session.mask) < 50) { toast('👆 Tap your toy first!'); return; }
          setStep(preview, side);
        } })),
    );
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    requestAnimationFrame(paintOverlay);
    return () => ro.disconnect();
  }

  // ---------- 4. back photo? ----------
  function backQuestion() {
    const img = h('div', { class: 'starburst', style: { flex: '0.9' } }, draft.front.canvas);
    el.append(
      topbar('Its back?', { onBack: () => setStep(preview, 'front') }),
      img,
      h('p', { class: 'subtitle', style: { margin: '14px 0 0' } }, '📸 Snap its back too?'),
      h('div', { class: 'action-row' },
        btn({ emoji: '⏭️', label: 'Skip', cls: 'white big', onClick: () => { draft.back = null; return retake ? saveRetake() : setStep(nameStep); } }),
        btn({ emoji: '📷', label: 'Yes!', cls: 'red big pulse', onClick: () => setStep(start, 'back') }),
      ),
    );
  }

  // ---------- 5. name ----------
  function nameStep() {
    const input = h('input', { class: 'field', type: 'text', maxlength: 18, placeholder: 'Toy name', value: draft.name, autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done', 'aria-label': 'Toy name' });
    const dice = btn({ emoji: '🎲', cls: 'icon purple', aria: 'Random name', onClick: () => {
      input.value = randomName(Math.random, input.value);
      sfx.boing();
      dice.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 400 });
    } });
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let mic = null;
    if (SR) {
      mic = btn({ emoji: '🎤', cls: 'icon red mic', aria: 'Say the name', onClick: () => {
        try {
          const rec = new SR();
          rec.lang = navigator.language || 'en-US';
          rec.interimResults = false; rec.maxAlternatives = 1;
          mic.classList.add('listening');
          rec.onresult = (ev) => {
            const said = ev.results[0][0].transcript.replace(/[.!?]$/, '').trim();
            input.value = said.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 18);
            sfx.sparkle();
          };
          rec.onend = () => mic.classList.remove('listening');
          rec.onerror = () => { mic.classList.remove('listening'); toast('🎤 Didn’t catch that'); };
          rec.start();
        } catch { mic.classList.remove('listening'); }
      } });
    }
    const next = () => {
      draft.name = input.value.trim() || randomName();
      setStep(powerStep);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { input.blur(); next(); } });
    const pic = draft.front.canvas;
    pic.style.maxHeight = '100%';
    el.append(
      topbar('Name it!', { onBack: () => setStep(backQuestion) }),
      h('div', { class: 'starburst', style: { flex: '1' } }, pic),
      h('div', { style: { padding: '16px 0 0', display: 'flex', flexDirection: 'column', gap: '12px' } },
        h('div', { class: 'row name-row' }, input, mic, dice),
        btn({ emoji: '➡️', label: 'Next', cls: 'green big wide', onClick: next })),
    );
  }

  // ---------- 6. power ----------
  function powerStep() {
    const grid = h('div', { class: 'power-grid' });
    for (const p of POWERS) {
      const b = btn({ emoji: p.emoji, label: p.short || p.label, cls: 'white', aria: p.label });
      b.style.setProperty('--c', p.color);
      if (p.id === 'ninja' || p.id === 'shield' || p.id === 'magic') b.style.setProperty('--fg', '#fff');
      b.dataset.power = p.id;
      b.addEventListener('click', async () => {
        grid.querySelectorAll('.btn').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        draft.power = p.id;
        sfx.special(p.fx);
        await sleep(450);
        if (alive) finish();
      });
      grid.append(b);
    }
    el.append(topbar('Pick a Power!', { onBack: () => setStep(nameStep) }), h('div', { class: 'scroll' }, grid));
  }

  // ---------- 7. save + reveal ----------
  async function buildRecord() {
    const f = draft.front;
    const frontBlob = await canvasToBlob(f.canvas);
    const backBlob = draft.back ? await canvasToBlob(fitBack(draft.back, f)) : null;
    return { width: f.width, height: f.height, contour: f.contour, outline: f.outline, edgeColor: f.edgeColor, frontBlob, backBlob };
  }

  async function finish() {
    const b = busy('Making it 3D…', { emoji: '🪄' });
    try {
      const parts = await buildRecord();
      const toy = {
        id: db.newId(), name: draft.name, power: draft.power || 'strength',
        stats: deriveStats(draft.front.features, draft.front.hash),
        createdAt: Date.now(), wins: 0, losses: 0, xp: 0, builtin: false, hidden: false,
        ...parts, thumbBlob: null,
      };
      const { renderThumb } = await import('../engine.js');
      toy.thumbBlob = await renderThumb(toy);
      await db.putToy(toy);
      db.requestPersist();
      b.close();
      setStep(reveal, toy);
    } catch (e) {
      b.close();
      console.error(e);
      await modal({ emoji: '😵', title: 'Uh-oh!', text: 'Couldn’t make that toy. Let’s try again!', actions: [{ emoji: '🔄', label: 'Again', cls: 'yellow', value: true }] });
      setStep(start, 'front');
    }
  }

  async function saveRetake() {
    const b = busy('Making it 3D…', { emoji: '🪄' });
    try {
      const parts = await buildRecord();
      Object.assign(retake, parts);
      const { renderThumb } = await import('../engine.js');
      retake.thumbBlob = await renderThumb(retake);
      await db.putToy(retake);
      b.close();
      toast('📸 New photo saved!');
      go('toy', { id: retake.id }, { replace: true });
    } catch (e) {
      b.close();
      console.error(e);
      toast('😵 That didn’t work');
    }
  }

  async function reveal(toy) {
    const { Turntable } = await import('./toys.js');
    const view = h('div', { class: 'viewport', style: { border: '4px solid var(--ink)', boxShadow: '0 8px 0 var(--ink)', background: '#2a1a8f' } });
    const who = possessive(ownerName());
    el.append(
      h('div', { class: 'topbar' }, h('div', { class: 'ghost' }), h('h2', {}, 'NEW TOY!'), h('div', { class: 'ghost' })),
      view,
      h('p', { class: 'subtitle', style: { margin: '12px 0 0' } }, who ? `${who} ${toy.name.toUpperCase()}` : toy.name.toUpperCase()),
      h('div', { class: 'action-row' },
        btn({ emoji: '📸', label: 'Another', cls: 'white', onClick: () => go('add', {}, { replace: true }) }),
        btn({ emoji: '🧸', label: 'My Toys', cls: 'blue', onClick: () => go('toys', {}, { reset: true }) }),
        btn({ emoji: '🥊', label: 'Battle!', cls: 'red pulse', onClick: () => go('pick', { mode: 'battle', preselect: [toy.id] }, { reset: true }) }),
      ),
    );
    const tt = new Turntable(view, toy, { intro: true });
    await tt.ready;
    sfx.fanfare();
    const { confetti } = await import('../ui.js');
    confetti(el, 60);
    return () => tt.dispose();
  }

  await setStep(start, 'front');
  return () => { alive = false; try { cleanupStep?.(); } catch { /* ignore */ } };
}

// Grown-ups' skeleton editor: drag the joint dots onto the toy's head, shoulders, elbows, hands,
// hips, knees and feet when the automatic skeleton guessed wrong. Reset = automatic again.

import { h, btn, topbar, toast } from '../ui.js';
import { back as navBack } from '../app.js';
import * as db from '../db.js';
import { blobToCanvas } from '../capture.js';
import { autoRig, RIG_VERSION } from '../core/rig.js';
import { rigFor } from '../mesh.js';
import { sfx } from '../audio.js';

const COLORS = { spine: '#ffd23f', L: '#29d3ff', R: '#ff5fa2', app: '#2fd26b' };
const colorOf = (name) => (name.startsWith('app') ? COLORS.app : /L$/.test(name) ? COLORS.L : /R$/.test(name) ? COLORS.R : COLORS.spine);
const HIDDEN = /^torso[LR]$/; // helper anchors: follow the chest, not shown

function addArms(rig) {
  const J = rig.joints, c = J.chest, hp = J.hips;
  const span = Math.max(20, hp.y - c.y), half = rig.w * 0.3;
  for (const [s, sg] of [['L', -1], ['R', 1]]) {
    J[`shoulder${s}`] = { x: c.x + sg * half * 0.55, y: c.y + span * 0.05, parent: 'chest' };
    J[`elbow${s}`] = { x: c.x + sg * half * 0.7, y: c.y + span * 0.5, parent: `shoulder${s}` };
    J[`hand${s}`] = { x: c.x + sg * half * 0.78, y: c.y + span * 0.95, parent: `elbow${s}` };
  }
}
function addLegs(rig) {
  const J = rig.joints, hp = J.hips, bottom = rig.h * 0.96, off = rig.w * 0.12;
  for (const [s, sg] of [['L', -1], ['R', 1]]) {
    J[`hip${s}`] = { x: hp.x + sg * off, y: hp.y + (bottom - hp.y) * 0.08, parent: 'hips' };
    J[`knee${s}`] = { x: hp.x + sg * off, y: hp.y + (bottom - hp.y) * 0.52, parent: `hip${s}` };
    J[`foot${s}`] = { x: hp.x + sg * off, y: bottom, parent: `knee${s}` };
  }
  rig.kind = 'humanoid';
}
const drop = (rig, names) => { for (const n of names) delete rig.joints[n]; };
const ARM_J = ['shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR', 'torsoL', 'torsoR'];
const LEG_J = ['hipL', 'kneeL', 'footL', 'hipR', 'kneeR', 'footR'];

export async function bonesScreen(el, { id }) {
  const toy = await db.getToy(id);
  if (!toy) { navBack(); return null; }
  const img = await blobToCanvas(toy.frontBlob);
  const W = img.width, H = img.height;
  const px = img.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const alpha = new Uint8Array(W * H);
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
  let rig = JSON.parse(JSON.stringify(rigFor(toy, alpha, W, H))); // structuredClone needs Safari 15.4+

  const wrap = h('div', { class: 'fixwrap bones' });
  const cv = h('canvas');
  wrap.append(cv, h('div', { class: 'bubble-hint' }, '✋ Drag the dots'));
  let fit = { x: 0, y: 0, s: 1 };
  const dpr = Math.min(2, devicePixelRatio || 1);
  const resize = () => { // reallocating the canvas is slow on iPhone: only on real size changes
    const r = wrap.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    draw();
  };
  const draw = () => {
    const g = cv.getContext('2d');
    const s = Math.min(cv.width / W, cv.height / H) * 0.94;
    const dx = (cv.width - W * s) / 2, dy = (cv.height - H * s) / 2;
    fit = { x: dx / dpr, y: dy / dpr, s: s / dpr };
    g.fillStyle = '#2a1a8f'; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(img, dx, dy, W * s, H * s);
    g.fillStyle = 'rgba(20,10,60,.35)'; g.fillRect(0, 0, cv.width, cv.height);
    const P = (j) => [dx + j.x * s, dy + j.y * s];
    const J = rig.joints;
    g.lineCap = 'round';
    for (const [name, j] of Object.entries(J)) {
      if (!j.parent || HIDDEN.test(name) || !J[j.parent]) continue;
      const [x0, y0] = P(J[j.parent]), [x1, y1] = P(j);
      g.lineWidth = 9 * dpr; g.strokeStyle = '#1a1030'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.lineWidth = 4 * dpr; g.strokeStyle = colorOf(name); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    for (const [name, j] of Object.entries(J)) {
      if (HIDDEN.test(name)) continue;
      const [x, y] = P(j);
      g.beginPath(); g.arc(x, y, (drag?.name === name ? 13 : 10) * dpr, 0, Math.PI * 2);
      g.fillStyle = colorOf(name); g.fill(); g.lineWidth = 3.5 * dpr; g.strokeStyle = '#1a1030'; g.stroke();
    }
  };
  const toImg = (e) => {
    const r = wrap.getBoundingClientRect();
    return [(e.clientX - r.left - fit.x) / fit.s, (e.clientY - r.top - fit.y) / fit.s];
  };
  let drag = null;
  wrap.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const [x, y] = toImg(e);
    let best = null, bd = 34 / fit.s; // generous finger-sized target
    for (const [name, j] of Object.entries(rig.joints)) {
      if (HIDDEN.test(name)) continue;
      const d = Math.hypot(j.x - x, j.y - y);
      if (d < bd) { bd = d; best = name; }
    }
    if (!best) return;
    drag = { name: best };
    wrap.setPointerCapture?.(e.pointerId);
    sfx.pop();
    draw();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = toImg(e);
    const j = rig.joints[drag.name];
    j.x = Math.min(W - 1, Math.max(1, x)); j.y = Math.min(H - 1, Math.max(1, y));
    draw();
  });
  const end = () => { if (drag) { drag = null; draw(); } };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);

  const hasArms = () => !!(rig.joints.shoulderL || rig.joints.shoulderR);
  const hasLegs = () => !!rig.joints.hipL;
  const armsBtn = btn({ emoji: '🦾', label: 'Arms', cls: 'small white', onClick: () => {
    if (hasArms()) drop(rig, ARM_J); else addArms(rig);
    armsBtn.classList.toggle('on', hasArms()); sfx.boing(); draw();
  } });
  const legsBtn = btn({ emoji: '🦵', label: 'Legs', cls: 'small white', onClick: () => {
    if (hasLegs()) { drop(rig, LEG_J); rig.kind = 'blob'; } else addLegs(rig);
    legsBtn.classList.toggle('on', hasLegs()); sfx.boing(); draw();
  } });
  armsBtn.classList.toggle('on', hasArms());
  legsBtn.classList.toggle('on', hasLegs());
  const tools = h('div', { class: 'toolbar' },
    armsBtn, legsBtn,
    btn({ emoji: '🪄', label: 'Auto', cls: 'small white', onClick: () => { rig = autoRig(alpha, W, H); armsBtn.classList.toggle('on', hasArms()); legsBtn.classList.toggle('on', hasLegs()); sfx.sparkle(); draw(); } }));
  el.append(
    topbar('Bones', { onBack: () => navBack() }),
    wrap,
    tools,
    h('div', { class: 'action-row', style: { paddingTop: '10px' } },
      btn({ emoji: '✅', label: 'Save', cls: 'green big', id: 'bones-save', onClick: async (e) => {
        const b = e.currentTarget;
        if (b.disabled) return; // one save, one step back
        b.disabled = true;
        // keep the torso anchors in step with a moved chest (they only matter for pressed-in arms)
        for (const sd of ['L', 'R']) if (!rig.joints[`shoulder${sd}`]) drop(rig, [`torso${sd}`]);
        try {
          await db.updateToy(toy.id, { rig: { ...rig, v: RIG_VERSION, auto: false, w: W, h: H } });
        } catch (err) { b.disabled = false; toast('😵 Could not save'); return; }
        sfx.fanfare();
        toast('🦴 Bones saved!');
        navBack();
      } })),
  );
  el.__bones = { rig: () => rig, fit: () => fit };
  const ro = new ResizeObserver(() => resize());
  ro.observe(wrap);
  requestAnimationFrame(resize);
  return () => ro.disconnect();
}

// Two built-in sparring partners, drawn on a canvas at runtime (no image files) and pushed
// through the same cutout → rig → puppet pipeline as real photos. They're drawn for the jointed
// puppets: a clear head, neck, torso, arms held away from the body and legs apart, plus a back view.

import { makeCutout, fitBack } from './cutout.js';
import { scaledCanvas, canvasToBlob } from './capture.js';
import { WORK_SIDE } from './segment.js';
import { cleanMask } from './core/mask.js';
import { autoRig } from './core/rig.js';

export const DUMMY_V = 2;
export const BUILTIN_IDS = ['builtin-megabot', 'builtin-kapow'];
export const RETIRED_IDS = ['builtin-robo', 'builtin-blobby']; // v1 standee dummies

const INK = '#1a1030';

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function fillStroke(g, fill, lw = 12) {
  g.fillStyle = fill; g.fill();
  g.lineWidth = lw; g.strokeStyle = INK; g.lineJoin = 'round'; g.stroke();
}
function circle(g, x, y, r, fill, lw = 10) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); fillStroke(g, fill, lw); }
/** A thick limb segment with an ink outline. */
function limb(g, pts, width, fill) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.lineWidth = width + 14; g.strokeStyle = INK; g.stroke();
  g.lineWidth = width; g.strokeStyle = fill; g.stroke();
}
function eye(g, x, y, r, look = 0.3) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); fillStroke(g, '#fff', 8);
  g.beginPath(); g.arc(x + r * look, y + r * 0.1, r * 0.5, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
  g.beginPath(); g.arc(x + r * look - r * 0.18, y - r * 0.12, r * 0.16, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
}
function shade(g, w, h) {
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0.16)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}
function lines(g, x0, y0, x1, n, dy, lw = 5) {
  g.lineWidth = lw; g.strokeStyle = INK; g.lineCap = 'round';
  for (let i = 0; i < n; i++) { g.beginPath(); g.moveTo(x0, y0 + i * dy); g.lineTo(x1, y0 + i * dy); g.stroke(); }
}

/** Mega Bot: boxy head + antenna, blue body, long jointed silver arms and legs. */
export function drawMegaBot(side = 'front') {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 860;
  const g = c.getContext('2d');
  const back = side === 'back';
  // antenna
  g.beginPath(); g.moveTo(300, 100); g.lineTo(300, 46); g.lineWidth = 14; g.strokeStyle = INK; g.lineCap = 'round'; g.stroke();
  circle(g, 300, 38, 20, '#ff3d3d');
  // legs + knees + feet
  for (const [x, fx] of [[240, 196], [310, 314]]) {
    rr(g, x, 520, 50, 232, 22); fillStroke(g, '#c7d3e3');
    circle(g, x + 25, 640, 21, '#ff8a1f', 8);
    rr(g, fx, 742, 90, 60, 26); fillStroke(g, '#2d7dff');
  }
  rr(g, 232, 492, 136, 46, 18); fillStroke(g, '#6b7a90'); // hips
  // arms: shoulder ball → upper arm → elbow → forearm → claw hand
  for (const s of [-1, 1]) {
    const sx = 300 + s * 124, ex = 300 + s * 162, hx = 300 + s * 180;
    limb(g, [[sx, 318], [ex, 430]], 44, '#c7d3e3');
    limb(g, [[ex, 430], [hx, 540]], 40, '#c7d3e3');
    circle(g, ex, 430, 22, '#ff8a1f', 8);
    circle(g, hx + s * 4, 566, 30, '#ffd23f');
    if (!back) { g.beginPath(); g.moveTo(hx + s * 4, 548); g.lineTo(hx + s * 4, 582); g.lineWidth = 6; g.strokeStyle = INK; g.stroke(); }
    circle(g, 300 + s * 122, 300, 34, '#ff8a1f');
  }
  // torso
  rr(g, 195, 268, 210, 232, 46); fillStroke(g, '#2d7dff');
  if (back) {
    rr(g, 240, 300, 120, 150, 20); fillStroke(g, '#1d5fd0', 8);
    lines(g, 258, 326, 342, 5, 24, 7);
  } else {
    rr(g, 232, 302, 136, 96, 20); fillStroke(g, '#1a1a6e', 8);
    ['#ff3d3d', '#ffd23f', '#2fd26b'].forEach((col, i) => circle(g, 262 + i * 38, 334, 13, col, 5));
    rr(g, 252, 360, 96, 22, 10); fillStroke(g, '#29d3ff', 5);
    g.beginPath(); g.moveTo(312, 414); g.lineTo(288, 452); g.lineTo(306, 452); g.lineTo(290, 486); g.lineTo(322, 440); g.lineTo(304, 440); g.lineTo(318, 414); g.closePath(); fillStroke(g, '#ffd23f', 6);
  }
  rr(g, 272, 240, 56, 36, 8); fillStroke(g, '#6b7a90'); // neck
  // head
  rr(g, 205, 96, 190, 150, 42); fillStroke(g, '#dbe7f5');
  for (const s of [-1, 1]) { rr(g, 300 + s * 104 - 10, 138, 20, 54, 8); fillStroke(g, '#ff8a1f', 7); }
  if (back) {
    rr(g, 240, 128, 120, 86, 20); fillStroke(g, '#b8c7dc', 7);
    lines(g, 256, 150, 344, 4, 18, 6);
  } else {
    eye(g, 258, 162, 34); eye(g, 342, 162, 34);
    rr(g, 252, 204, 96, 28, 12); fillStroke(g, '#fff', 6);
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(252 + i * 24, 206); g.lineTo(252 + i * 24, 230); g.lineWidth = 5; g.strokeStyle = INK; g.stroke(); }
  }
  shade(g, 600, 860);
  return c;
}

/** Kapow Kid: masked superhero, star emblem, red gloves and boots, arms out, legs apart. */
export function drawKapowKid(side = 'front') {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 820;
  const g = c.getContext('2d');
  const back = side === 'back';
  // legs + boots
  for (const s of [-1, 1]) {
    limb(g, [[300 + s * 40, 506], [300 + s * 56, 704]], 46, '#2d7dff');
    rr(g, 300 + s * 60 - 42, 690, 84, 72, 28); fillStroke(g, '#ff3d3d');
    if (!back) { g.beginPath(); g.moveTo(300 + s * 60 - 34, 712); g.lineTo(300 + s * 60 + 34, 712); g.lineWidth = 6; g.strokeStyle = '#ffd23f'; g.stroke(); }
  }
  rr(g, 236, 466, 128, 56, 20); fillStroke(g, '#ff3d3d'); // shorts
  // arms: sleeve + glove, held out from the body
  for (const s of [-1, 1]) {
    limb(g, [[300 + s * 90, 252], [300 + s * 146, 356]], 42, '#2d7dff');
    limb(g, [[300 + s * 146, 356], [300 + s * 176, 452]], 38, '#ffcc9e');
    circle(g, 300 + s * 180, 478, 32, '#ff3d3d');
    circle(g, 300 + s * 90, 252, 30, '#2d7dff');
  }
  // torso (a hero's V shape)
  g.beginPath();
  g.moveTo(206, 236); g.lineTo(394, 236); g.quadraticCurveTo(404, 240, 400, 256);
  g.lineTo(364, 458); g.lineTo(236, 458); g.lineTo(200, 256); g.quadraticCurveTo(196, 240, 206, 236); g.closePath();
  fillStroke(g, '#2d7dff');
  if (back) {
    g.beginPath(); g.moveTo(300, 246); g.lineTo(300, 440); g.lineWidth = 7; g.strokeStyle = '#1d5fd0'; g.stroke();
    circle(g, 300, 300, 18, '#ffd23f', 6);
  } else {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 22 : 50; g.lineTo(300 + Math.cos(a) * r, 326 + Math.sin(a) * r); }
    g.closePath(); fillStroke(g, '#ffd23f', 8);
  }
  rr(g, 230, 446, 140, 32, 12); fillStroke(g, '#ffd23f'); // belt
  if (!back) circle(g, 300, 462, 14, '#ff3d3d', 6);
  rr(g, 280, 196, 40, 46, 10); fillStroke(g, '#ffcc9e'); // neck
  // head + spiky hair
  g.beginPath();
  g.moveTo(236, 118);
  [[246, 64], [270, 98], [290, 48], [310, 94], [336, 52], [350, 98], [372, 72], [366, 124]].forEach(([x, y]) => g.lineTo(x, y));
  g.closePath(); fillStroke(g, '#4a2c1a');
  circle(g, 300, 142, 70, back ? '#4a2c1a' : '#ffcc9e');
  if (back) {
    g.beginPath(); g.arc(300, 142, 70, Math.PI * 0.15, Math.PI * 0.85); g.lineWidth = 12; g.strokeStyle = '#ffcc9e'; g.stroke();
    rr(g, 226, 116, 148, 30, 14); fillStroke(g, '#ff3d3d', 8); // mask band round the back of the head
  } else {
    rr(g, 228, 108, 144, 44, 20); fillStroke(g, '#ff3d3d', 8);
    eye(g, 272, 130, 17, 0.2); eye(g, 328, 130, 17, 0.2);
    g.beginPath(); g.arc(300, 168, 26, 0.15 * Math.PI, 0.85 * Math.PI); g.lineWidth = 8; g.strokeStyle = INK; g.lineCap = 'round'; g.stroke();
    for (const s of [-1, 1]) { g.beginPath(); g.arc(300 + s * 44, 172, 10, 0, 7); g.fillStyle = 'rgba(255,90,90,.45)'; g.fill(); }
  }
  shade(g, 600, 820);
  return c;
}

async function dummyRecord(id, name, power, stats, draw) {
  const front = draw('front');
  const work = scaledCanvas(front, WORK_SIDE);
  const w = work.width, h = work.height;
  const px = work.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 100 ? 1 : 0;
  const clean = cleanMask(mask, w, h);
  const cut = makeCutout(front, clean, w, h);
  const backCut = makeCutout(draw('back'), clean, w, h); // same silhouette, back details
  const cpx = cut.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cut.width, cut.height).data;
  const alpha = new Uint8Array(cut.width * cut.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = cpx[i * 4 + 3];
  return {
    id, name, power, stats, builtin: true, hidden: false, dummyV: DUMMY_V,
    createdAt: 0, wins: 0, losses: 0, xp: 0,
    width: cut.width, height: cut.height, contour: cut.contour, outline: cut.outline, edgeColor: cut.edgeColor,
    rig: autoRig(alpha, cut.width, cut.height),
    frontBlob: await canvasToBlob(cut.canvas), backBlob: await canvasToBlob(fitBack(backCut, cut)), thumbBlob: null,
  };
}

export async function makeDummies() {
  return [
    await dummyRecord('builtin-megabot', 'Mega Bot', 'laser', { power: 58, speed: 50, defense: 74 }, drawMegaBot),
    await dummyRecord('builtin-kapow', 'Kapow Kid', 'lightning', { power: 66, speed: 72, defense: 48 }, drawKapowKid),
  ];
}

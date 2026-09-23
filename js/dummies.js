// Two built-in "training dummies", drawn on a canvas at runtime (no image files),
// then pushed through the same cutout pipeline as real photos.

import { makeCutout } from './cutout.js';
import { scaledCanvas, canvasToBlob } from './capture.js';
import { WORK_SIDE } from './segment.js';
import { cleanMask } from './core/mask.js';

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
function eye(g, x, y, r, look = 0.3) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); fillStroke(g, '#fff', 8);
  g.beginPath(); g.arc(x + r * look, y + r * 0.1, r * 0.5, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
  g.beginPath(); g.arc(x + r * look - r * 0.18, y - r * 0.12, r * 0.16, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
}
function shade(g, w, h) {
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0.18)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}

export function drawRobot() {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 800;
  const g = c.getContext('2d');
  // antenna
  g.beginPath(); g.moveTo(300, 150); g.lineTo(300, 70); g.lineWidth = 14; g.strokeStyle = INK; g.stroke();
  g.beginPath(); g.arc(300, 58, 26, 0, Math.PI * 2); fillStroke(g, '#ff3d3d');
  // legs + feet
  rr(g, 205, 560, 70, 150, 20); fillStroke(g, '#8fa3bf');
  rr(g, 325, 560, 70, 150, 20); fillStroke(g, '#8fa3bf');
  rr(g, 175, 680, 125, 70, 30); fillStroke(g, '#2d7dff');
  rr(g, 300, 680, 125, 70, 30); fillStroke(g, '#2d7dff');
  // arms
  rr(g, 70, 340, 80, 200, 36); fillStroke(g, '#8fa3bf');
  rr(g, 450, 340, 80, 200, 36); fillStroke(g, '#8fa3bf');
  for (const x of [110, 490]) { g.beginPath(); g.arc(x, 560, 46, 0.15 * Math.PI, 0.85 * Math.PI, true); fillStroke(g, '#ffd23f'); }
  // body
  rr(g, 140, 320, 320, 270, 44); fillStroke(g, '#b8c7dc');
  rr(g, 200, 370, 200, 150, 22); fillStroke(g, '#2a1a8f', 8);
  ['#ff3d3d', '#ffd23f', '#2fd26b'].forEach((col, i) => { g.beginPath(); g.arc(245 + i * 55, 410, 18, 0, Math.PI * 2); fillStroke(g, col, 6); });
  rr(g, 225, 450, 150, 42, 12); fillStroke(g, '#29d3ff', 6);
  // head
  rr(g, 150, 130, 300, 210, 60); fillStroke(g, '#d7e2f1');
  rr(g, 120, 190, 36, 80, 14); fillStroke(g, '#ff8a1f', 8);
  rr(g, 444, 190, 36, 80, 14); fillStroke(g, '#ff8a1f', 8);
  eye(g, 240, 225, 44); eye(g, 360, 225, 44);
  rr(g, 235, 285, 130, 34, 14); fillStroke(g, '#fff', 7);
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(235 + i * 32.5, 287); g.lineTo(235 + i * 32.5, 317); g.lineWidth = 5; g.stroke(); }
  shade(g, 600, 800);
  return c;
}

export function drawMonster() {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 800;
  const g = c.getContext('2d');
  // horns
  for (const s of [-1, 1]) {
    g.beginPath(); g.moveTo(320 + s * 90, 200); g.quadraticCurveTo(320 + s * 190, 120, 320 + s * 170, 40); g.quadraticCurveTo(320 + s * 150, 150, 320 + s * 40, 190); g.closePath();
    fillStroke(g, '#fff6e0', 10);
  }
  // feet
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(320 + s * 95, 720, 85, 48, 0, 0, Math.PI * 2); fillStroke(g, '#1f9e4a'); }
  // arms
  for (const s of [-1, 1]) {
    g.beginPath(); g.moveTo(320 + s * 190, 380); g.quadraticCurveTo(320 + s * 300, 360, 320 + s * 290, 250); g.lineWidth = 58; g.lineCap = 'round'; g.strokeStyle = INK; g.stroke();
    g.lineWidth = 36; g.strokeStyle = '#43d16e'; g.stroke();
    g.beginPath(); g.arc(320 + s * 290, 235, 40, 0, Math.PI * 2); fillStroke(g, '#43d16e', 10);
  }
  // body blob
  g.beginPath();
  g.moveTo(320, 170);
  g.bezierCurveTo(520, 170, 560, 420, 520, 560);
  g.bezierCurveTo(490, 690, 150, 690, 120, 560);
  g.bezierCurveTo(80, 420, 120, 170, 320, 170);
  fillStroke(g, '#43d16e', 13);
  // belly + spots
  g.beginPath(); g.ellipse(320, 540, 140, 110, 0, 0, Math.PI * 2); fillStroke(g, '#b8f5c9', 8);
  [[200, 300, 22], [450, 330, 18], [180, 440, 15], [470, 470, 24]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); fillStroke(g, '#1f9e4a', 6); });
  // big eye
  eye(g, 320, 320, 78, 0.25);
  // mouth + teeth
  g.beginPath(); g.moveTo(215, 440); g.quadraticCurveTo(320, 540, 425, 440); g.closePath(); fillStroke(g, '#7a1030', 9);
  g.fillStyle = '#fff';
  for (const x of [255, 385]) { g.beginPath(); g.moveTo(x - 20, 447); g.lineTo(x + 20, 447); g.lineTo(x, 482); g.closePath(); fillStroke(g, '#fff', 6); }
  shade(g, 640, 800);
  return c;
}

async function dummyRecord(id, name, power, stats, canvas) {
  const work = scaledCanvas(canvas, WORK_SIDE);
  const w = work.width, h = work.height;
  const px = work.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 100 ? 1 : 0;
  const cut = makeCutout(canvas, cleanMask(mask, w, h), w, h);
  return {
    id, name, power, stats, builtin: true, hidden: false,
    createdAt: 0, wins: 0, losses: 0, xp: 0,
    width: cut.width, height: cut.height, contour: cut.contour, outline: cut.outline, edgeColor: cut.edgeColor,
    frontBlob: await canvasToBlob(cut.canvas), backBlob: null, thumbBlob: null,
  };
}

export async function makeDummies() {
  return [
    await dummyRecord('builtin-robo', 'Robo Buddy', 'laser', { power: 55, speed: 48, defense: 72 }, drawRobot()),
    await dummyRecord('builtin-blobby', 'Blobby Monster', 'magic', { power: 64, speed: 60, defense: 46 }, drawMonster()),
  ];
}

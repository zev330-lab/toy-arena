// Build a jointed, puffy 3D puppet from a stored toy: auto-rig (or the saved rig) → inflated,
// skinned mesh with the photo on the front and the back photo (or a darkened mirror) on the back
// → an inverted-hull ink outline that bends with the same skeleton. No base: toys stand on their feet.

import * as THREE from 'three';
import { edgeBleed } from './core/mask.js';
import { blobToCanvas } from './capture.js';
import { autoRig, RIG_VERSION, jointOrder } from './core/rig.js';
import { buildPuppetMesh } from './core/puppet.js';

export const FIG_H = 1.6;
export const THUMB_V = 2; // bump when the figure look changes: collection cards re-render once
export const BASE_H = 0;
const INFLATE = 0.62;      // front bulge relative to a round cross-section
const BACK_INFLATE = 0.5;  // the back is a little flatter, like a real action figure
const MAX_BULGE = 0.24;    // world units — very wide toys (a car) don't turn into balloons
const OUTLINE = 0.016;     // comic ink line width (world units)

const puppetCache = new Map(); // heavy pure data per toy + rig, reused across screens

async function decode(blob) {
  const c = await blobToCanvas(blob);
  const g = c.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, c.width, c.height);
  const alpha = new Uint8Array(c.width * c.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
  return { c, g, img, alpha };
}

function toTexture({ c, g, img, alpha }, maxAniso) {
  edgeBleed(img.data, alpha, c.width, c.height, 6);
  for (let i = 0; i < alpha.length; i++) img.data[i * 4 + 3] = 255;
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(4, maxAniso || 1);
  t.needsUpdate = true;
  return t;
}

/** The rig to use for a toy: its saved rig if it still matches the photo, else a fresh auto-rig. */
export function rigFor(toy, alpha, w, h) {
  const r = toy.rig;
  if (r && r.v === RIG_VERSION && r.w === w && r.h === h && r.joints?.hips) return r;
  return autoRig(alpha, w, h);
}

function puppetData(toy, alpha, w, h) {
  const rig = rigFor(toy, alpha, w, h);
  const key = `${toy.id}|${toy.updatedAt || toy.createdAt || 0}|${w}x${h}|${JSON.stringify(rig.joints)}`;
  let pm = puppetCache.get(key);
  if (!pm) {
    pm = buildPuppetMesh(alpha, w, h, rig);
    if (puppetCache.size > 12) puppetCache.delete(puppetCache.keys().next().value);
    puppetCache.set(key, pm);
  }
  return { rig, pm };
}

/**
 * @returns {Promise<{ object, figure, mesh, outline, skeleton, bones, joints, rig, kind, legs, arms,
 *   height, width, depth, radius, soles, dispose }>}
 */
export async function buildFigure(toy, { maxAniso = 1 } = {}) {
  const front = await decode(toy.frontBlob);
  const W = front.c.width, H = front.c.height;
  const { rig, pm } = puppetData(toy, front.alpha, W, H);
  const nv = pm.boundary.length;

  // image px → figure space: y up, feet on the ground, centred on the silhouette
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let v = 0; v < nv; v++) {
    const x = pm.pos[v * 2], y = pm.pos[v * 2 + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const pxW = Math.max(1, maxX - minX), pxH = Math.max(1, maxY - minY);
  let s = FIG_H / pxH;
  if (pxW * s > 1.9) s = 1.9 / pxW;
  const cx = (minX + maxX) / 2;
  const X = (x) => (x - cx) * s, Y = (y) => (maxY - y) * s;
  const bulge = (hpx, k) => { const z = hpx * s * k; return MAX_BULGE * Math.tanh(z / MAX_BULGE); };

  // front + back surfaces sharing the silhouette edge
  const P = new Float32Array(nv * 2 * 3), U = new Float32Array(nv * 2 * 2);
  const SI = new Uint16Array(nv * 2 * 4), SW = new Float32Array(nv * 2 * 4);
  for (let v = 0; v < nv; v++) {
    const x = pm.pos[v * 2], y = pm.pos[v * 2 + 1];
    for (const [o, z] of [[v, bulge(pm.height[v], INFLATE)], [v + nv, -bulge(pm.height[v], BACK_INFLATE)]]) {
      P[o * 3] = X(x); P[o * 3 + 1] = Y(y); P[o * 3 + 2] = z;
      U[o * 2] = x / W; U[o * 2 + 1] = 1 - y / H;
      for (let c = 0; c < 4; c++) { SI[o * 4 + c] = pm.skinIndex[v * 4 + c]; SW[o * 4 + c] = pm.skinWeight[v * 4 + c]; }
    }
  }
  const nt = pm.tris.length;
  const idx = new Uint32Array(nt * 2);
  for (let t = 0; t < nt; t += 3) {
    // puppet triangles are clockwise in image space; flipping y makes them clockwise seen from +Z,
    // so the front surface reverses them (counter-clockwise = facing the camera) and the back keeps them
    idx[t] = pm.tris[t]; idx[t + 1] = pm.tris[t + 2]; idx[t + 2] = pm.tris[t + 1];
    idx[nt + t] = pm.tris[t] + nv; idx[nt + t + 1] = pm.tris[t + 1] + nv; idx[nt + t + 2] = pm.tris[t + 2] + nv;
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  geo.addGroup(0, nt, 0);
  geo.addGroup(nt, nt, 1);
  geo.computeVertexNormals();
  // the silhouette edge is shared by both surfaces: give it one sideways normal so it looks round, not creased
  const N = geo.attributes.normal.array;
  for (let v = 0; v < nv; v++) {
    if (!pm.boundary[v]) continue;
    const a = v * 3, b = (v + nv) * 3;
    let nx = N[a] + N[b], ny = N[a + 1] + N[b + 1];
    const L = Math.hypot(nx, ny) || 1;
    nx /= L; ny /= L;
    N[a] = N[b] = nx; N[a + 1] = N[b + 1] = ny; N[a + 2] = N[b + 2] = 0;
  }
  geo.computeBoundingSphere();

  // outline: the same skinned surface pushed out along its normals, drawn back-faces only
  const OP = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    OP[i] = P[i] + N[i] * OUTLINE; OP[i + 1] = P[i + 1] + N[i + 1] * OUTLINE; OP[i + 2] = P[i + 2] + N[i + 2] * OUTLINE * 0.6;
  }
  const ogeo = new THREE.BufferGeometry();
  ogeo.setIndex(geo.index);
  ogeo.setAttribute('position', new THREE.BufferAttribute(OP, 3));
  ogeo.setAttribute('normal', geo.attributes.normal);
  ogeo.setAttribute('skinIndex', geo.attributes.skinIndex);
  ogeo.setAttribute('skinWeight', geo.attributes.skinWeight);
  ogeo.computeBoundingSphere();

  const disposables = [geo, ogeo];
  const frontTex = toTexture(front, maxAniso);
  disposables.push(frontTex);
  let backTex = null;
  if (toy.backBlob) {
    try { backTex = toTexture(await decode(toy.backBlob), maxAniso); disposables.push(backTex); } catch { backTex = null; }
  }
  const mats = [
    new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.5, metalness: 0.02 }),
    backTex ? new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.55, metalness: 0.02 })
      : new THREE.MeshStandardMaterial({ map: frontTex, color: 0x9a96a8, roughness: 0.62, metalness: 0.02 }),
  ];
  const inkMat = new THREE.MeshBasicMaterial({ color: 0x1a1030, side: THREE.BackSide });
  disposables.push(...mats, inkMat);

  // skeleton: one bone per joint, rest pose = the photo
  const names = pm.bones;
  const J = rig.joints;
  const joints = {};
  for (const n of names) joints[n] = new THREE.Vector3(X(J[n].x), Y(J[n].y), 0);
  const bones = {};
  const list = names.map((n) => { const b = new THREE.Bone(); b.name = n; bones[n] = b; return b; });
  for (const n of names) {
    const p = J[n].parent;
    if (p && bones[p]) { bones[p].add(bones[n]); bones[n].position.copy(joints[n]).sub(joints[p]); } else bones[n].position.copy(joints[n]);
  }
  const mesh = new THREE.SkinnedMesh(geo, mats);
  mesh.add(bones[names[0]]);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false; // limbs swing outside the rest-pose bounds
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  mesh.bind(skeleton);
  const outline = new THREE.SkinnedMesh(ogeo, inkMat);
  outline.frustumCulled = false;
  outline.bind(skeleton, mesh.bindMatrix);

  const figure = new THREE.Group();
  figure.name = 'figure';
  figure.add(mesh, outline);
  const object = new THREE.Group();
  object.add(figure);
  object.userData = { toyId: toy.id };

  const width = pxW * s, height = pxH * s;
  const has = (n) => !!bones[n];
  const soles = {};
  for (const f of ['footL', 'footR']) if (has(f)) soles[f] = joints[f].y; // tip height above the sole at rest
  return {
    object, figure, mesh, outline, skeleton, bones, joints, rig, kind: rig.kind,
    legs: has('kneeL') && has('kneeR') && has('footL') && has('footR'),
    arms: { L: has('elbowL') && has('handL'), R: has('elbowR') && has('handR') },
    legsMerged: !!rig.legsMerged,
    height, width, depth: bulge(Math.max(...pm.height), INFLATE) + bulge(Math.max(...pm.height), BACK_INFLATE),
    radius: THREE.MathUtils.clamp(width * 0.3, 0.18, 0.5),
    soles, base: null, order: names,
    dispose() { for (const d of disposables) d.dispose?.(); skeleton.dispose?.(); },
  };
}

export { jointOrder };

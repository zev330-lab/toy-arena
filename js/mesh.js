// Build a chunky 3D "standee" figure from a stored toy: extruded silhouette,
// photo on the front, back photo (or darkened mirror) on the back, edge colours on the sides,
// an ink outline slab for the comic look, and a round collectible base.

import * as THREE from 'three';
import { edgeBleed } from './core/mask.js';
import { blobToCanvas } from './capture.js';
import { powerById } from './core/stats.js';

export const FIG_H = 1.6;
export const BASE_H = 0.1;

async function textureFromBlob(blob, maxAniso) {
  const c = await blobToCanvas(blob);
  const g = c.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, c.width, c.height);
  const alpha = new Uint8Array(c.width * c.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
  edgeBleed(img.data, alpha, c.width, c.height, 6);
  for (let i = 0; i < alpha.length; i++) img.data[i * 4 + 3] = 255;
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(4, maxAniso || 1);
  t.needsUpdate = true;
  return t;
}

function toShapes(contour, map) {
  const shapes = [];
  for (const sh of contour?.shapes || []) {
    if (!sh.outer || sh.outer.length < 3) continue;
    const s = new THREE.Shape(sh.outer.map(([x, y]) => new THREE.Vector2(...map(x, y))));
    for (const hole of sh.holes || []) {
      if (hole.length >= 3) s.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(...map(x, y)))));
    }
    shapes.push(s);
  }
  return shapes;
}

/** Re-sort ExtrudeGeometry triangles into front / back / side groups and set photo UVs. */
function regroup(geo, uvOf) {
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  // ExtrudeGeometry adds [lids, sides] groups per shape (materialIndex 0 = lids, 1 = sides)
  const buckets = [[], [], []];
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: pos.length / 3, materialIndex: 0 }];
  for (const g of groups) {
    for (let v = g.start; v < g.start + g.count; v += 3) {
      let bucket = 2;
      if (g.materialIndex === 0) bucket = (pos[v * 3 + 2] + pos[v * 3 + 5] + pos[v * 3 + 8]) / 3 > 0 ? 0 : 1;
      buckets[bucket].push(v);
    }
  }
  const n = pos.length;
  const P = new Float32Array(n), N = new Float32Array(n), U = new Float32Array((n / 3) * 2);
  const out = new THREE.BufferGeometry();
  let o = 0;
  buckets.forEach((tris, gi) => {
    const start = o;
    for (const v of tris) {
      for (let k = 0; k < 3; k++) {
        const src = (v + k) * 3;
        P[o * 3] = pos[src]; P[o * 3 + 1] = pos[src + 1]; P[o * 3 + 2] = pos[src + 2];
        N[o * 3] = nor[src]; N[o * 3 + 1] = nor[src + 1]; N[o * 3 + 2] = nor[src + 2];
        const [u, w] = uvOf(pos[src], pos[src + 1]);
        U[o * 2] = u; U[o * 2 + 1] = w;
        o++;
      }
    }
    out.addGroup(start, o - start, gi);
  });
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * @returns {Promise<{ object: THREE.Group, figure: THREE.Group, base: THREE.Mesh, height, width, depth, radius, dispose }>}
 */
export async function buildFigure(toy, { maxAniso = 1, withBase = true } = {}) {
  const W = toy.width, H = toy.height;
  const pts = (toy.contour?.shapes || []).flatMap(s => s.outer);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const pxW = Math.max(1, maxX - minX), pxH = Math.max(1, maxY - minY);
  let s = FIG_H / pxH;
  if (pxW * s > 1.9) s = 1.9 / pxW;
  const cx = (minX + maxX) / 2;
  const baseTop = withBase ? BASE_H : 0;
  // image px → figure space (y up, feet on base)
  const map = (x, y) => [(x - cx) * s, (maxY - y) * s + baseTop];
  const uvOf = (X, Y) => [(X / s + cx) / W, 1 - (maxY - (Y - baseTop) / s) / H];

  const width = pxW * s, height = pxH * s;
  const depth = THREE.MathUtils.clamp(width * 0.1, 0.07, 0.15);
  const bevel = depth * 0.3;
  const extrude = { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: 0.012, bevelSegments: 2, curveSegments: 1, steps: 1 };

  const disposables = [];
  const front = await textureFromBlob(toy.frontBlob, maxAniso);
  disposables.push(front);
  let back = null;
  if (toy.backBlob) { try { back = await textureFromBlob(toy.backBlob, maxAniso); disposables.push(back); } catch { back = null; } }

  const raw = new THREE.ExtrudeGeometry(toShapes(toy.contour, map), extrude);
  raw.translate(0, 0, -depth / 2);
  const geo = regroup(raw, uvOf);
  raw.dispose();
  disposables.push(geo);

  const mats = [
    new THREE.MeshStandardMaterial({ map: front, roughness: 0.5, metalness: 0.05 }),
    back ? new THREE.MeshStandardMaterial({ map: back, roughness: 0.55, metalness: 0.05 })
      : new THREE.MeshStandardMaterial({ map: front, color: 0x8c8c96, roughness: 0.6, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ map: front, color: 0xa8a8b0, roughness: 0.65, metalness: 0.05 }),
  ];
  disposables.push(...mats);
  const body = new THREE.Mesh(geo, mats);
  body.castShadow = true;
  body.receiveShadow = false;

  const figure = new THREE.Group();
  figure.name = 'figure';
  figure.add(body);

  if (toy.outline?.shapes?.length) {
    const og = new THREE.ExtrudeGeometry(toShapes(toy.outline, map), { depth: depth * 0.6, bevelEnabled: false, curveSegments: 1 });
    og.translate(0, 0, -depth * 0.3);
    const om = new THREE.MeshBasicMaterial({ color: 0x1a1030 });
    disposables.push(og, om);
    const outline = new THREE.Mesh(og, om);
    outline.castShadow = true;
    figure.add(outline);
  }

  const object = new THREE.Group();
  object.add(figure);
  const radius = THREE.MathUtils.clamp(width * 0.42, 0.42, 0.75);
  let base = null;
  if (withBase) {
    const color = new THREE.Color(powerById(toy.power).color);
    const bg = new THREE.CylinderGeometry(radius, radius * 1.08, BASE_H, 40);
    bg.translate(0, BASE_H / 2, 0);
    const bm = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15 });
    const rg = new THREE.TorusGeometry(radius * 1.03, 0.022, 8, 40);
    rg.rotateX(Math.PI / 2); rg.translate(0, BASE_H, 0);
    const rm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.4 });
    disposables.push(bg, bm, rg, rm);
    base = new THREE.Mesh(bg, bm);
    base.castShadow = true; base.receiveShadow = true;
    base.add(new THREE.Mesh(rg, rm));
    object.add(base);
  }

  object.userData = { toyId: toy.id };
  return {
    object, figure, base, height: height + baseTop, width, depth, radius,
    dispose() { for (const d of disposables) d.dispose?.(); },
  };
}

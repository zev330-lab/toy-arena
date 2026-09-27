// Puppet mesh (pure, no DOM): alpha field → triangle mesh with interior vertices (marching-squares
// triangulation) → Poisson inflation for round cross-sections → skin weights from the geodesic
// (inside-the-silhouette) distance to each bone. See docs/PUPPETS.md.

import { jointOrder, rigSegments } from './rig.js';

/**
 * Triangulate the region alpha > iso on a regular grid. Interior grid corners become vertices;
 * boundary vertices sit on the iso-line (interpolated along cell edges). Triangles are wound
 * clockwise in image space (y down) = counter-clockwise once y points up.
 */
export function triangulateAlpha(alpha, w, h, { step = 5, iso = 127.5 } = {}) {
  const nx = Math.floor((w - 1) / step) + 2, ny = Math.floor((h - 1) / step) + 2;
  const val = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = i * step, y = j * step;
    val[j * nx + i] = x < w && y < h ? alpha[y * w + x] : 0;
  }
  const cornerId = new Int32Array(nx * ny).fill(-1);
  const edgeId = new Int32Array(nx * ny * 2).fill(-1);
  const pos = [], boundary = [], near = [];
  const corner = (i, j) => {
    const k = j * nx + i;
    if (cornerId[k] < 0) { cornerId[k] = boundary.length; pos.push(i * step, j * step); boundary.push(0); near.push(k); }
    return cornerId[k];
  };
  const edge = (ia, ja, ib, jb) => {
    const i0 = Math.min(ia, ib), j0 = Math.min(ja, jb), vert = ja !== jb;
    const key = ((j0 * nx + i0) << 1) | (vert ? 1 : 0);
    if (edgeId[key] < 0) {
      const i1 = vert ? i0 : i0 + 1, j1 = vert ? j0 + 1 : j0;
      const a = val[j0 * nx + i0], b = val[j1 * nx + i1];
      const t = Math.min(1, Math.max(0, (iso - a) / (b - a)));
      edgeId[key] = boundary.length;
      pos.push((i0 + (i1 - i0) * t) * step, (j0 + (j1 - j0) * t) * step);
      boundary.push(1);
      near.push(a > iso ? j0 * nx + i0 : j1 * nx + i1);
    }
    return edgeId[key];
  };
  const tris = [];
  const C = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const cs = C.map(([a, b]) => [i + a, j + b]);
    const ins = cs.map(([a, b]) => val[b * nx + a] > iso);
    const n = ins.reduce((s, v) => s + v, 0);
    if (!n) continue;
    if (n === 2 && ins[0] === ins[2]) {
      const centre = (val[j * nx + i] + val[j * nx + i + 1] + val[(j + 1) * nx + i + 1] + val[(j + 1) * nx + i]) / 4 > iso;
      if (!centre) { // two separate corners
        for (let k = 0; k < 4; k++) {
          if (!ins[k]) continue;
          const nk = (k + 1) % 4, pk = (k + 3) % 4;
          tris.push(corner(...cs[k]), edge(...cs[k], ...cs[nk]), edge(...cs[pk], ...cs[k]));
        }
        continue;
      }
    }
    const poly = [];
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      if (ins[k]) poly.push(corner(...cs[k]));
      if (ins[k] !== ins[k1]) poly.push(edge(...cs[k], ...cs[k1]));
    }
    for (let t = 1; t < poly.length - 1; t++) tris.push(poly[0], poly[t], poly[t + 1]);
  }
  return {
    pos: new Float32Array(pos), tris: new Uint32Array(tris), boundary: new Uint8Array(boundary), near: new Int32Array(near),
    grid: { val, nx, ny, step, iso },
  };
}

/**
 * Poisson inflation on the grid: solve ∇²f = −1 inside, f = 0 outside (SOR), return height = √(2f)
 * per grid corner in pixels — a round (circular) cross-section for any limb width ("Monster Mash").
 */
export function inflateGrid({ val, nx, ny, step, iso }, { iters = 240, omega = 1.86 } = {}) {
  const inside = new Uint8Array(nx * ny);
  for (let k = 0; k < inside.length; k++) inside[k] = val[k] > iso ? 1 : 0;
  // initial guess from a cheap chamfer distance keeps SOR iterations low
  const d = new Float32Array(nx * ny);
  for (let k = 0; k < d.length; k++) d[k] = inside[k] ? 1e6 : 0;
  for (let pass = 0; pass < 2; pass++) {
    const range = pass ? [ny - 1, -1, -1] : [0, ny, 1];
    for (let j = range[0]; j !== range[1]; j += range[2]) {
      const xr = pass ? [nx - 1, -1, -1] : [0, nx, 1];
      for (let i = xr[0]; i !== xr[1]; i += xr[2]) {
        const k = j * nx + i;
        if (!inside[k]) continue;
        let m = d[k];
        for (const [di, dj, c] of pass ? [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]] : [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]]) {
          const ii = i + di, jj = j + dj;
          const v = ii < 0 || jj < 0 || ii >= nx || jj >= ny ? 0 : d[jj * nx + ii];
          if (v + c < m) m = v + c;
        }
        d[k] = m;
      }
    }
  }
  const f = new Float32Array(nx * ny);
  const s2 = step * step;
  for (let k = 0; k < f.length; k++) if (inside[k]) f[k] = 0.5 * (d[k] * step) ** 2 * 0.8;
  for (let it = 0; it < iters; it++) {
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      if (!inside[k]) continue;
      const target = (f[k - 1] + f[k + 1] + f[k - nx] + f[k + nx] + s2) * 0.25;
      f[k] += omega * (target - f[k]);
    }
  }
  const height = new Float32Array(nx * ny);
  for (let k = 0; k < f.length; k++) height[k] = inside[k] ? Math.sqrt(2 * Math.max(0, f[k])) : 0;
  return height;
}

/** Tiny binary min-heap of (key, value) for Dijkstra. */
class Heap {
  constructor(n) { this.k = new Float64Array(n); this.v = new Int32Array(n); this.n = 0; }
  push(key, val) {
    if (this.n >= this.k.length) { const k = new Float64Array(this.k.length * 2); k.set(this.k); this.k = k; const v = new Int32Array(this.v.length * 2); v.set(this.v); this.v = v; }
    let i = this.n++;
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= key) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; }
    this.k[i] = key; this.v[i] = val;
  }
  pop() {
    const topK = this.k[0], topV = this.v[0];
    const lk = this.k[--this.n], lv = this.v[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= lk) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = lk; this.v[i] = lv;
    this.topKey = topK;
    return topV;
  }
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/**
 * Skin weights: for every vertex, up to 4 bones (indices into `bones`, parent-before-child order)
 * weighted by geodesic distance inside the silhouette to each bone's segments, so an arm hanging
 * next to the body never drags the body along. `blend` (px) = how soft the joints are.
 */
export function skinWeights(rig, mesh, { blend = 24 } = {}) {
  const bones = jointOrder(rig);
  const index = new Map(bones.map((b, i) => [b, i]));
  const segs = rigSegments(rig);
  const owners = [...new Set(segs.map(s => s.owner))];
  const { val, nx, ny, step, iso } = mesh.grid;
  const inside = (k) => val[k] > iso;
  const N = nx * ny;
  const dists = owners.map((owner) => {
    const d = new Float64Array(N).fill(Infinity); // float64: float32 rounding made Dijkstra re-relax nodes ~100×
    const heap = new Heap(1024);
    for (const s of segs.filter(q => q.owner === owner)) {
      const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      const n = Math.max(1, Math.ceil(L / (step * 0.5)));
      for (let t = 0; t <= n; t++) {
        const x = s.a[0] + (s.b[0] - s.a[0]) * t / n, y = s.a[1] + (s.b[1] - s.a[1]) * t / n;
        const i = Math.round(x / step), j = Math.round(y / step);
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i;
        if (!inside(k)) continue;
        const d0 = Math.hypot(i * step - x, j * step - y);
        if (d0 < d[k]) { d[k] = d0; heap.push(d0, k); }
      }
    }
    while (heap.n) {
      const k = heap.pop(), dk = heap.topKey;
      if (dk > d[k]) continue;
      const i = k % nx, j = (k / nx) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const q = jj * nx + ii;
        if (!inside(q)) continue;
        const nd = dk + (di && dj ? step * Math.SQRT2 : step);
        if (nd < d[q]) { d[q] = nd; heap.push(nd, q); }
      }
    }
    return d;
  });
  const nv = mesh.boundary.length;
  const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4);
  const ownerIdx = owners.map(o => index.get(o));
  const tmp = owners.map(() => 0);
  for (let v = 0; v < nv; v++) {
    const k = mesh.near[v];
    let dmin = Infinity;
    for (let o = 0; o < owners.length; o++) { tmp[o] = dists[o][k]; if (tmp[o] < dmin) dmin = tmp[o]; }
    if (!Number.isFinite(dmin)) { // detached island (a loose claw or sword): nearest bone as the crow flies
      const px = mesh.pos[v * 2], py = mesh.pos[v * 2 + 1];
      for (let o = 0; o < owners.length; o++) {
        tmp[o] = Infinity;
        for (const s of segs) if (s.owner === owners[o]) tmp[o] = Math.min(tmp[o], segDist(px, py, s.a[0], s.a[1], s.b[0], s.b[1]));
        if (tmp[o] < dmin) dmin = tmp[o];
      }
    }
    const cand = [];
    for (let o = 0; o < owners.length; o++) {
      const x = 1 - (tmp[o] - dmin) / blend;
      if (x > 0) cand.push([ownerIdx[o], x * x]);
    }
    cand.sort((a, b) => b[1] - a[1]);
    const top = cand.slice(0, 4);
    const sum = top.reduce((s, c) => s + c[1], 0) || 1;
    top.forEach(([bi, wt], c) => { skinIndex[v * 4 + c] = bi; skinWeight[v * 4 + c] = wt / sum; });
    if (!top.length) { skinIndex[v * 4] = 0; skinWeight[v * 4] = 1; }
  }
  return { bones, skinIndex, skinWeight };
}

/** Everything the 3D layer needs, in cutout pixels. */
export function buildPuppetMesh(alpha, w, h, rig, { step = Math.max(3, Math.round(Math.max(w, h) / 112)), iso = 127.5, blend } = {}) {
  const mesh = triangulateAlpha(alpha, w, h, { step, iso });
  const hGrid = inflateGrid(mesh.grid);
  const nv = mesh.boundary.length;
  const height = new Float32Array(nv);
  for (let v = 0; v < nv; v++) height[v] = mesh.boundary[v] ? 0 : hGrid[mesh.near[v]];
  let minY = Infinity, maxY = -Infinity;
  for (let v = 0; v < nv; v++) { const y = mesh.pos[v * 2 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const skin = skinWeights(rig, mesh, { blend: blend ?? Math.max(step * 2.5, (maxY - minY) * 0.045) });
  return { ...mesh, height, ...skin, step };
}

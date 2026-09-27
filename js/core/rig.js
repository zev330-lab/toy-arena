// Auto-rig a toy silhouette (pure, no DOM): mask → thickness (distance transform) → skeleton
// (Zhang–Suen thinning) → pixel tree → prune spurs → feet / pelvis / spine / arms / head →
// a joint tree in the cutout's pixel coordinates. See docs/PUPPETS.md for the format.

export const RIG_VERSION = 1;
const BIG = 1e10;

/** Box-downsample a field to a binary grid whose longest side is ≈ `side`. value > iso = inside. */
export function downsample(field, w, h, { side = 128, iso = 127 } = {}) {
  const s = Math.max(1, Math.max(w, h) / side);
  const gw = Math.max(1, Math.round(w / s)), gh = Math.max(1, Math.round(h / s));
  const sx = w / gw, sy = h / gh;
  const mask = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor(gy * sy), y1 = Math.min(h, Math.max(y0 + 1, Math.floor((gy + 1) * sy)));
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor(gx * sx), x1 = Math.min(w, Math.max(x0 + 1, Math.floor((gx + 1) * sx)));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (field[y * w + x] > iso) sum++; n++; }
      mask[gy * gw + gx] = n && sum * 2 >= n ? 1 : 0;
    }
  }
  return { mask, w: gw, h: gh, sx, sy };
}

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -BIG; z[1] = BIG;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = BIG;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

/** Exact Euclidean distance from each inside pixel to the nearest outside pixel (outside the grid counts as outside). */
export function distanceTransform(mask, w, h) {
  const W = w + 2, H = h + 2;
  const f = new Float64Array(W * H);
  for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) if (mask[(y - 1) * w + x - 1]) f[y * W + x] = BIG;
  const n = Math.max(W, H);
  const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), line = new Float64Array(n);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) line[y] = f[y * W + x];
    edt1d(line, H, d, v, z);
    for (let y = 0; y < H; y++) f[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) line[x] = f[y * W + x];
    edt1d(line, W, d, v, z);
    for (let x = 0; x < W; x++) f[y * W + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(f[(y + 1) * W + x + 1]);
  return out;
}

/** Zhang–Suen thinning → 1-px skeleton. */
export function thin(mask, w, h) {
  const m = mask.slice();
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]);
  const del = [];
  for (let changed = true; changed;) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) continue;
        const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
        const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
        if (A !== 1) continue;
        if (pass === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
        del.push(y * w + x);
      }
      if (del.length) { changed = true; for (const i of del) m[i] = 0; }
    }
  }
  return m;
}

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/** BFS spanning tree over the set `on` (Uint8Array) from `root`. */
function bfsTree(on, w, h, root) {
  const parent = new Int32Array(w * h).fill(-2); // -2 = not in tree
  const order = [root];
  parent[root] = -1;
  for (let qi = 0; qi < order.length; qi++) {
    const p = order[qi], x = p % w, y = (p / w) | 0;
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (on[q] && parent[q] === -2) { parent[q] = p; order.push(q); }
    }
  }
  const kids = new Map();
  for (const p of order) kids.set(p, []);
  for (const p of order) if (parent[p] >= 0) kids.get(parent[p]).push(p);
  return { parent, order, kids };
}

const stepLen = (a, b, w) => (a % w !== b % w && ((a / w) | 0) !== ((b / w) | 0) ? Math.SQRT2 : 1);

/** Remove short side spurs (shorter than the local thickness) from the skeleton set, in place. */
function pruneSpurs(on, w, h, root, D, minLen) {
  for (let round = 0; round < 60; round++) {
    const { parent, order, kids } = bfsTree(on, w, h, root);
    const branches = [];
    for (const p of order) {
      if (kids.get(p).length || p === root) continue;
      const path = [p];
      let len = 0, cur = p;
      while (parent[cur] >= 0 && kids.get(parent[cur]).length === 1 && parent[cur] !== root) { len += stepLen(cur, parent[cur], w); cur = parent[cur]; path.push(cur); }
      const junction = parent[cur];
      if (junction < 0) continue; // the whole tree is one line
      len += stepLen(cur, junction, w);
      branches.push({ path, len, junction });
    }
    branches.sort((a, b) => a.len - b.len);
    let removed = false;
    const lost = new Map();
    for (const b of branches) {
      const thr = Math.max(minLen, D[b.junction] * 1.15 + 1);
      if (b.len >= thr) break;
      const left = kids.get(b.junction).length - (lost.get(b.junction) || 0);
      if (left < 2) continue; // never cut the last way out of a junction
      for (const p of b.path) on[p] = 0;
      lost.set(b.junction, (lost.get(b.junction) || 0) + 1);
      removed = true;
    }
    if (!removed) return;
  }
}

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** Largest 8-connected component of the mask (the toy body; detached bits are ignored for the rig). */
function mainComponent(mask, w, h) {
  const seen = new Uint8Array(w * h);
  let best = null;
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp = [];
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const p = stack.pop(); comp.push(p);
      const x = p % w, y = (p / w) | 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (!best || comp.length > best.length) best = comp;
  }
  const out = new Uint8Array(w * h);
  if (best) for (const p of best) out[p] = 1;
  return out;
}

/**
 * Build the rig from an alpha/mask field of the cutout (size w×h, value > iso = toy).
 * Returns { v, auto, kind, w, h, joints: { name: { x, y, parent } }, legsMerged }.
 */
export function autoRig(field, w, h, { iso = 127, side = 128 } = {}) {
  const g = downsample(field, w, h, { side, iso });
  const mask = mainComponent(g.mask, g.w, g.h);
  const W = g.w, H = g.h;
  const toPx = (p) => ({ x: ((p % W) + 0.5) * g.sx, y: (((p / W) | 0) + 0.5) * g.sy });
  let minX = W, maxX = -1, minY = H, maxY = -1, area = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % W, y = (i / W) | 0;
    area++;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const rig = { v: RIG_VERSION, auto: true, kind: 'blob', w, h, joints: {}, legsMerged: false };
  if (area < 12) return templateRig(rig, { minX: 0, maxX: w, minY: 0, maxY: h });
  const bb = { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
  const bbPx = { minX: minX * g.sx, maxX: (maxX + 1) * g.sx, minY: minY * g.sy, maxY: (maxY + 1) * g.sy };

  const D = distanceTransform(mask, W, H);
  const skel = thin(mask, W, H);
  let root = -1;
  for (let i = 0; i < skel.length; i++) if (skel[i] && (root < 0 || D[i] > D[root])) root = i;
  if (root < 0) return templateRig(rig, bbPx);
  // keep only the skeleton piece connected to the thickest point
  {
    const { order } = bfsTree(skel, W, H, root);
    const keep = new Uint8Array(W * H);
    for (const p of order) keep[p] = 1;
    skel.set(keep);
  }
  pruneSpurs(skel, W, H, root, D, Math.max(2, bb.h * 0.05));

  const X = (p) => p % W, Y = (p) => (p / W) | 0;
  const t0 = bfsTree(skel, W, H, root);
  const leaves = t0.order.filter(p => !t0.kids.get(p).length);
  if (t0.kids.get(root).length === 1) leaves.push(root);
  const footBand = maxY - Math.max(2, bb.h * 0.16);
  let feet = leaves.filter(p => Y(p) >= footBand).sort((a, b) => X(a) - X(b));
  if (feet.length >= 2 && X(feet[feet.length - 1]) - X(feet[0]) < bb.w * 0.12) feet = [];
  const legLeaves = feet.length >= 2 ? [feet[0], feet[feet.length - 1]] : null;

  // pelvis: where the two legs meet (LCA in the root tree), else low on the body's middle
  let pelvis;
  if (legLeaves) {
    const up = new Set();
    for (let p = legLeaves[0]; p >= 0; p = t0.parent[p]) up.add(p);
    pelvis = legLeaves[1];
    while (!up.has(pelvis)) pelvis = t0.parent[pelvis];
  } else {
    const cx = (minX + maxX) / 2, ty = maxY - bb.h * 0.4;
    pelvis = root;
    let bd = Infinity;
    for (const p of t0.order) { const d = Math.hypot(X(p) - cx, (Y(p) - ty) * 1.5); if (d < bd) { bd = d; pelvis = p; } }
  }

  // re-root at the pelvis
  const T = bfsTree(skel, W, H, pelvis);
  const dist = new Float32Array(W * H); // arc length from the pelvis
  for (const p of T.order) if (T.parent[p] >= 0) dist[p] = dist[T.parent[p]] + stepLen(p, T.parent[p], W);
  // per-subtree stats (reverse BFS order): thickest point and centroid
  const maxD = new Float32Array(W * H), sumX = new Float64Array(W * H), sumY = new Float64Array(W * H), cnt = new Float64Array(W * H);
  for (let i = T.order.length - 1; i >= 0; i--) {
    const p = T.order[i];
    maxD[p] = Math.max(maxD[p], D[p]); sumX[p] += X(p); sumY[p] += Y(p); cnt[p] += 1;
    const q = T.parent[p];
    if (q >= 0) { maxD[q] = Math.max(maxD[q], maxD[p]); sumX[q] += sumX[p]; sumY[q] += sumY[p]; cnt[q] += cnt[p]; }
  }
  const inSubtree = (top, p) => { for (let c = p; c >= 0; c = T.parent[c]) if (c === top) return true; return false; };
  const pathTo = (p) => { const out = []; for (let c = p; c >= 0; c = T.parent[c]) out.push(c); return out.reverse(); }; // pelvis → p
  const legKids = legLeaves ? T.kids.get(pelvis).filter(c => legLeaves.some(f => inSubtree(c, f))) : [];

  // spine: from the pelvis keep following the branch that continues the BODY upward (thick, pointing up);
  // stop when only limbs are left (a round body with arms, a head reached)
  const spine = [pelvis];
  for (let cur = pelvis; ;) {
    let best = -1, bestScore = 0;
    for (const c of T.kids.get(cur)) {
      if (legKids.includes(c)) continue;
      const cy = sumY[c] / cnt[c], cxx = sumX[c] / cnt[c];
      const up = (Y(cur) - cy) / (Math.abs(X(cur) - cxx) + Math.abs(Y(cur) - cy) + 1);
      if (cur === pelvis && up < 0.15) continue;
      const score = maxD[c] * (up > 0.25 ? 1 : 0.3);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best < 0 || maxD[best] < D[cur] * 0.5) break;
    spine.push(best);
    cur = best;
  }
  const lower = spine.slice(0, Math.max(1, Math.ceil(spine.length * 0.6))).map(p => D[p]);
  const Dt = median(lower) || 1;
  let headIdx = spine.length - 1;
  while (headIdx > 0 && D[spine[headIdx]] < Dt * 0.35) headIdx--;
  const onSpine = new Set(spine);

  // side branches off the spine → arms (longest per side) and appendages
  const branches = [];
  for (let si = 0; si <= headIdx; si++) {
    const s = spine[si];
    for (const c of T.kids.get(s)) {
      if (onSpine.has(c) || legKids.includes(c)) continue;
      let tip = c;
      const stack = [c];
      while (stack.length) { const p = stack.pop(); if (dist[p] > dist[tip]) tip = p; stack.push(...T.kids.get(p)); }
      branches.push({ si, attach: s, tip, len: dist[tip] - dist[s] });
    }
  }
  if (headIdx < spine.length - 1) {
    const s = spine[headIdx], tip = spine[spine.length - 1];
    branches.push({ si: headIdx, attach: s, tip, len: dist[tip] - dist[s], top: true });
  }
  const arms = { L: null, R: null };
  for (const b of branches) {
    if (b.top || b.len < bb.h * 0.12 || Y(b.tip) >= footBand) continue;
    if (b.si === 0 && Y(b.tip) > Y(pelvis)) continue; // hanging off the pelvis: a tail or coat, not an arm
    const side = X(b.tip) < X(b.attach) ? 'L' : 'R';
    if (!arms[side] || b.len > arms[side].len) arms[side] = b;
  }
  const apps = branches.filter(b => b !== arms.L && b !== arms.R && b.len >= bb.h * 0.07 && !(Y(b.tip) >= footBand && (legLeaves || arms.L && arms.R)))
    .sort((a, b) => b.len - a.len).slice(0, 4);

  const branchPath = (b) => { const out = []; for (let c = b.tip; c !== b.attach && c >= 0; c = T.parent[c]) out.push(c); out.push(b.attach); return out.reverse(); }; // attach → tip
  const atLen = (path, s) => { // node along `path` at arc length s from path[0]
    let acc = 0;
    for (let i = 1; i < path.length; i++) { acc += stepLen(path[i], path[i - 1], W); if (acc >= s) return path[i]; }
    return path[path.length - 1];
  };
  const arcLen = (path) => { let a = 0; for (let i = 1; i < path.length; i++) a += stepLen(path[i], path[i - 1], W); return a; };
  /** Where a limb path turns (e.g. out of the torso and down the arm): farthest point from the chord. */
  const cornerIdx = (path, maxFrac) => {
    const a = path[0], b = path[path.length - 1];
    const ax = X(a), ay = Y(a), dx = X(b) - ax, dy = Y(b) - ay, L = Math.hypot(dx, dy) || 1;
    let bi = -1, bd = 0;
    for (let i = 1; i < path.length * maxFrac; i++) {
      const d = Math.abs((X(path[i]) - ax) * dy - (Y(path[i]) - ay) * dx) / L;
      if (d > bd) { bd = d; bi = i; }
    }
    return bd > L * 0.12 ? bi : -1;
  };

  const J = rig.joints;
  const put = (name, p, parent) => { const q = typeof p === 'number' ? toPx(p) : p; J[name] = { x: q.x, y: q.y, parent }; };
  const runW = (x, y) => {
    if (y < 0 || y >= H || x < 0 || x >= W || !mask[y * W + x]) return 0;
    let a = x, b = x;
    while (a > 0 && mask[y * W + a - 1]) a--;
    while (b < W - 1 && mask[y * W + b + 1]) b++;
    return b - a + 1;
  };

  // ---- torso: hips → chest → neck → head (tip) ----
  const last = spine[headIdx];
  const lx = X(last);
  let topY = Y(last);
  { const w0 = Math.max(1, runW(lx, Y(last))); for (let y = Y(last) - 1; y >= 0 && runW(lx, y) >= w0 * 0.4; y--) topY = y; }
  const hipsY = Y(pelvis), headY = Math.min(topY + 0.5, Y(last));
  const span = Math.max(1, hipsY - headY);
  const spineX = (y) => { let bx = lx, bd = Infinity; for (const p of spine.slice(0, headIdx + 1)) { const d = Math.abs(Y(p) - y); if (d < bd) { bd = d; bx = X(p); } } return bx; };
  const armPaths = {};
  const shoulderAt = {};
  for (const side of ['L', 'R']) {
    const b = arms[side];
    if (!b) continue;
    const path = branchPath(b);
    if (path.length < 5) { arms[side] = null; continue; }
    let si = cornerIdx(path, 0.55);
    if (si < 0) {
      const Da = median(path.slice(Math.floor(path.length * 0.3)).map(p => D[p])) || 1;
      si = 1;
      while (si < path.length * 0.4 && D[path[si]] > Da * 1.3) si++;
    }
    si = Math.min(Math.max(1, si), path.length - 3);
    armPaths[side] = path;
    shoulderAt[side] = si;
  }
  const sh = Object.entries(shoulderAt).map(([s, i]) => Y(armPaths[s][i]));
  let chestY = sh.length ? sh.reduce((a, b) => a + b, 0) / sh.length : hipsY - span * 0.55;
  chestY = Math.min(hipsY - span * 0.25, Math.max(hipsY - span * 0.8, chestY));
  // neck: a clear narrowing between head and chest, else where the width changes, else 65% up
  let neckY = -1;
  {
    const ys = [];
    for (let y = Math.ceil(headY) + 1; y < chestY; y++) ys.push(y);
    if (ys.length >= 3 && (legLeaves || arms.L || arms.R)) {
      const widths = ys.map(y => runW(spineX(y), y));
      const headPart = widths.slice(0, Math.max(1, Math.ceil(widths.length * 0.45)));
      const headW = Math.max(...headPart);
      const wi = widths.indexOf(headW);
      let mi = wi;
      for (let i = wi; i < widths.length; i++) if (widths[i] > 0 && widths[i] < widths[mi]) mi = i;
      if (widths[mi] < headW * 0.75) neckY = ys[mi];
      else for (let i = wi; i < widths.length; i++) if (Math.abs(widths[i] - headW) > headW * 0.18) { neckY = ys[i]; break; }
    }
    if (neckY < 0) neckY = chestY - (chestY - headY) * 0.65;
    neckY = Math.min(chestY - 1, Math.max(headY + 1, neckY));
  }
  const gp = (x, y) => ({ x: (x + 0.5) * g.sx, y: (y + 0.5) * g.sy });
  put('hips', pelvis, null);
  put('chest', gp(spineX(chestY), chestY), 'hips');
  put('neck', gp(spineX(neckY), neckY), 'chest');
  put('head', gp(lx, headY), 'neck');

  // ---- arms ----
  for (const side of ['L', 'R']) {
    const path = armPaths[side];
    if (!path) continue;
    const upper = path.slice(shoulderAt[side]);
    put(`shoulder${side}`, path[shoulderAt[side]], 'chest');
    put(`elbow${side}`, atLen(upper, arcLen(upper) * 0.5), `shoulder${side}`);
    put(`hand${side}`, path[path.length - 1], `elbow${side}`);
  }

  // ---- legs ----
  if (legLeaves) {
    rig.kind = 'humanoid';
    const [a, b] = legLeaves;
    for (const [side, foot] of [['L', a], ['R', b]]) {
      const path = pathTo(foot);
      const L = arcLen(path);
      let hi = cornerIdx(path, 0.4);
      const hip = hi > 0 ? path[hi] : atLen(path, Math.min(L * 0.25, Math.max(1.5, D[pelvis] * 0.7)));
      const rest = path.slice(path.indexOf(hip));
      put(`hip${side}`, hip, 'hips');
      put(`knee${side}`, atLen(rest, arcLen(rest) * 0.5), `hip${side}`);
      put(`foot${side}`, foot, `knee${side}`);
    }
  } else if (arms.L && arms.R && bb.h > bb.w * 1.25) {
    // looks like a person whose legs merged in the photo (or a long coat): split the lower body
    rig.kind = 'humanoid';
    rig.legsMerged = true;
    synthLegs(rig, mask, W, H, g, bb);
  }

  // appendages: tails, horns, antennae, weapons…
  apps.forEach((b, i) => {
    const path = branchPath(b);
    if (path.length < 4) return;
    const ay = Y(b.attach);
    const parent = b.top ? 'head' : ay <= neckY ? 'neck' : ay <= chestY + 1 ? 'chest' : 'hips';
    const L = arcLen(path);
    put(`app${i}_0`, atLen(path, Math.min(L * 0.15, 2)), J[parent] ? parent : 'hips');
    put(`app${i}_1`, atLen(path, L * 0.55), `app${i}_0`);
    put(`app${i}_2`, b.tip, `app${i}_1`);
  });
  return finalize(rig, bbPx);
}

function templateRig(rig, bb) {
  const cx = (bb.minX + bb.maxX) / 2, H = bb.maxY - bb.minY;
  const J = rig.joints;
  J.hips = { x: cx, y: bb.minY + H * 0.62, parent: null };
  J.chest = { x: cx, y: bb.minY + H * 0.36, parent: 'hips' };
  J.neck = { x: cx, y: bb.minY + H * 0.2, parent: 'chest' };
  J.head = { x: cx, y: bb.minY + H * 0.04, parent: 'neck' };
  return rig;
}

/** Split a merged lower body into two legs using the silhouette's width at knee height. */
function synthLegs(rig, mask, W, H, g, bb) {
  const J = rig.joints;
  const rowRun = (y) => {
    let a = -1, b = -1;
    for (let x = 0; x < W; x++) if (mask[y * W + x]) { if (a < 0) a = x; b = x; }
    return a < 0 ? null : [a, b];
  };
  const kneeY = Math.round(bb.maxY - bb.h * 0.22), hipY = Math.round(bb.maxY - bb.h * 0.42);
  const rk = rowRun(kneeY) || [bb.minX, bb.maxX];
  const cx = (rk[0] + rk[1]) / 2, half = (rk[1] - rk[0]) / 2;
  const hipsY = Math.max(hipY, J.chest ? J.chest.y / g.sy + 2 : hipY);
  const px = (x, y) => ({ x: (x + 0.5) * g.sx, y: (y + 0.5) * g.sy });
  J.hips = { ...px(cx, hipsY), parent: null };
  for (const [side, s] of [['L', -1], ['R', 1]]) {
    const lx = cx + s * half * 0.5;
    J[`hip${side}`] = { ...px(lx, hipsY + bb.h * 0.03), parent: 'hips' };
    J[`knee${side}`] = { ...px(lx, kneeY), parent: `hip${side}` };
    J[`foot${side}`] = { ...px(lx, bb.maxY - bb.h * 0.03), parent: `knee${side}` };
  }
}

/** Sanity: every joint's parent exists, the tree is rooted at hips, coordinates are finite and inside the image. */
function finalize(rig, bb) {
  const J = rig.joints;
  if (!J.hips) templateRig(rig, bb);
  for (const [k, j] of Object.entries(J)) {
    if (j.parent && !J[j.parent]) j.parent = 'hips';
    if (k === 'hips') j.parent = null;
    j.x = Math.round(Math.min(rig.w - 0.5, Math.max(0.5, j.x)) * 10) / 10;
    j.y = Math.round(Math.min(rig.h - 0.5, Math.max(0.5, j.y)) * 10) / 10;
  }
  return rig;
}

/** Joint names in parent-before-child order (hips first). */
export function jointOrder(rig) {
  const J = rig.joints, out = [], seen = new Set();
  const visit = (name) => {
    if (seen.has(name) || !J[name]) return;
    if (J[name].parent && !seen.has(J[name].parent)) visit(J[name].parent);
    seen.add(name); out.push(name);
  };
  visit('hips');
  for (const k of Object.keys(J)) visit(k);
  return out;
}

/** Bone segments: each joint owns the segments to its children. Returns [{ owner, a, b }] in cutout px. */
export function rigSegments(rig) {
  const J = rig.joints, segs = [];
  for (const [name, j] of Object.entries(J)) {
    if (!j.parent) continue;
    const p = J[j.parent];
    segs.push({ owner: j.parent, a: [p.x, p.y], b: [j.x, j.y] });
  }
  return segs;
}

export const hasLegs = (rig) => !!(rig?.joints?.kneeL && rig.joints.kneeR);
export const hasArm = (rig, side) => !!rig?.joints?.[`elbow${side}`];

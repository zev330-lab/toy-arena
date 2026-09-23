// Pure contour tracing + simplification (no DOM).

/**
 * Marching squares over a scalar field (e.g. 0..255 alpha). Field outside the
 * grid counts as 0, so every loop is closed. Returns an array of loops, each an
 * array of [x, y] points in pixel-centre coordinates. Loops are consistently
 * oriented: outer boundaries and holes have opposite signed area.
 */
export function marchingSquares(field, w, h, iso = 127.5) {
  const val = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : field[y * w + x]);
  const W = w + 2;
  // canonical edge ids: horizontal edge (i,j)-(i+1,j) and vertical edge (i,j)-(i,j+1)
  const hId = (i, j) => ((j + 1) * W + (i + 1)) * 2;
  const vId = (i, j) => ((j + 1) * W + (i + 1)) * 2 + 1;
  const pts = new Map();
  const edgePoint = (id, ax, ay, bx, by) => {
    if (!pts.has(id)) {
      const fa = val(ax, ay), fb = val(bx, by);
      const t = fb === fa ? 0.5 : (iso - fa) / (fb - fa);
      pts.set(id, [ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
    return id;
  };
  const next = new Map();
  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const inside = c.map(([x, y]) => val(x, y) > iso);
      if (inside.every(v => v) || inside.every(v => !v)) continue;
      // edges in traversal order: top, right, bottom, left
      const edges = [
        () => edgePoint(hId(i, j), i, j, i + 1, j),
        () => edgePoint(vId(i + 1, j), i + 1, j, i + 1, j + 1),
        () => edgePoint(hId(i, j + 1), i, j + 1, i + 1, j + 1),
        () => edgePoint(vId(i, j), i, j, i, j + 1),
      ];
      const enter = [], exit = [];
      for (let e = 0; e < 4; e++) {
        const a = inside[e], b = inside[(e + 1) % 4];
        if (a === b) continue;
        (a ? exit : enter).push(e);
      }
      if (enter.length === 1) {
        next.set(edges[enter[0]](), edges[exit[0]]());
      } else {
        // saddle: disambiguate with the cell centre
        const centre = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 > iso;
        for (const en of enter) {
          const order = [1, 2, 3].map(k => (en + k) % 4).filter(e => exit.includes(e));
          const ex = centre ? order[1] : order[0];
          next.set(edges[en](), edges[ex]());
        }
      }
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      loop.push(pts.get(cur));
      cur = next.get(cur);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function pointInPolygon([px, py], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Douglas–Peucker on an open polyline. */
export function simplifyDP(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let md = -1, mi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e]);
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Douglas–Peucker for a closed loop: split at the two mutually far points. */
export function simplifyClosed(pts, eps) {
  if (pts.length <= 4) return pts.slice();
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = simplifyDP(pts.slice(0, far + 1), eps);
  const b = simplifyDP(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

/** Simplify until at most `cap` vertices, starting from a fine tolerance. */
export function simplifyToCap(pts, cap = 300, eps = 0.6) {
  let out = simplifyClosed(pts, eps);
  while (out.length > cap) { eps *= 1.35; out = simplifyClosed(pts, eps); }
  return out;
}

/**
 * Trace a figure outline from an alpha/mask field.
 * Returns { shapes: [{ outer, holes }] } — the main body first, then any
 * sizeable detached islands (a separate claw, a sword). Outer loops have
 * negative signed area in image (y-down) coords, i.e. CCW once y is flipped
 * up for 3D; holes have the opposite winding. Total vertices ≈ maxVerts.
 */
export function traceOutline(field, w, h, { maxVerts = 300, iso = 127.5, minHoleFrac = 0.004, minIslandFrac = 0.015 } = {}) {
  const loops = marchingSquares(field, w, h, iso);
  if (!loops.length) return null;
  const withArea = loops.map(l => ({ l, a: signedArea(l) })).sort((x, y) => Math.abs(y.a) - Math.abs(x.a));
  const outerSign = Math.sign(withArea[0].a);
  const mainArea = Math.abs(withArea[0].a);
  const outersRaw = withArea.filter(o => Math.sign(o.a) === outerSign && Math.abs(o.a) >= mainArea * minIslandFrac).slice(0, 4);
  const holesRaw = withArea.filter(o => Math.sign(o.a) !== outerSign && Math.abs(o.a) >= mainArea * minHoleFrac);
  const totalArea = outersRaw.reduce((s, o) => s + Math.abs(o.a), 0);
  const shapes = outersRaw.map((o, idx) => {
    const cap = idx === 0 ? Math.max(40, Math.round(maxVerts * 0.75 * Math.abs(o.a) / totalArea + maxVerts * 0.1))
      : Math.max(12, Math.round(maxVerts * 0.6 * Math.abs(o.a) / totalArea));
    const outer = simplifyToCap(o.l, cap);
    if (signedArea(outer) > 0) outer.reverse();
    return { outer, holes: [], raw: o.l };
  });
  let budget = Math.max(0, maxVerts - shapes.reduce((s, x) => s + x.outer.length, 0));
  for (const { l } of holesRaw) {
    if (budget < 8) break;
    const owner = shapes.find(s => pointInPolygon(l[0], s.raw));
    if (!owner) continue;
    const s = simplifyToCap(l, Math.min(60, budget), 0.8);
    if (s.length < 3) continue;
    if (signedArea(s) < 0) s.reverse();
    owner.holes.push(s);
    budget -= s.length;
  }
  return { shapes: shapes.map(({ outer, holes }) => ({ outer, holes })) };
}

// Particles & special effects. Textures are drawn procedurally on canvases.

import * as THREE from 'three';

const texCache = new Map();
function canvasTex(key, size, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.shared = true;
  texCache.set(key, t);
  return t;
}
function starPath(g, cx, cy, R, r, n = 5) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const rr = i % 2 ? r : R;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

export function starTexture(kind = 'star') {
  if (kind === 'glow') {
    return canvasTex('glow', 128, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.3, 'rgba(255,255,255,.6)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    });
  }
  if (kind === 'spark') {
    return canvasTex('spark', 128, (g, s) => {
      starPath(g, s / 2, s / 2, s * 0.48, s * 0.12, 4);
      g.fillStyle = '#fff'; g.fill();
    });
  }
  if (kind === 'heart') {
    return canvasTex('heart', 128, (g, s) => {
      g.translate(s / 2, s / 2 + 6);
      g.beginPath();
      g.moveTo(0, 40);
      g.bezierCurveTo(-70, -10, -40, -60, 0, -28);
      g.bezierCurveTo(40, -60, 70, -10, 0, 40);
      g.fillStyle = '#ff4f8b'; g.fill(); g.lineWidth = 8; g.strokeStyle = '#1a1030'; g.stroke();
    });
  }
  if (kind === 'flake') {
    return canvasTex('flake', 128, (g, s) => {
      g.translate(s / 2, s / 2); g.strokeStyle = '#e8fbff'; g.lineWidth = 9; g.lineCap = 'round';
      for (let i = 0; i < 6; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -52); g.moveTo(0, -30); g.lineTo(-14, -44); g.moveTo(0, -30); g.lineTo(14, -44); g.stroke(); }
    });
  }
  if (kind === 'note') {
    return canvasTex('note', 128, (g) => {
      g.fillStyle = '#fff'; g.strokeStyle = '#1a1030'; g.lineWidth = 7;
      g.beginPath(); g.ellipse(44, 92, 22, 16, -0.4, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillRect(60, 20, 10, 72); g.strokeRect(60, 20, 10, 72);
      g.beginPath(); g.moveTo(70, 20); g.quadraticCurveTo(110, 36, 96, 66); g.lineWidth = 10; g.stroke();
    });
  }
  if (kind === 'shuriken') {
    return canvasTex('shuriken', 128, (g, s) => {
      starPath(g, s / 2, s / 2, s * 0.46, s * 0.14, 4);
      g.fillStyle = '#c9d3e0'; g.fill(); g.lineWidth = 7; g.strokeStyle = '#1a1030'; g.stroke();
      g.beginPath(); g.arc(s / 2, s / 2, 9, 0, Math.PI * 2); g.fillStyle = '#1a1030'; g.fill();
    });
  }
  if (kind === 'puff') {
    return canvasTex('puff', 128, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s / 2);
      grd.addColorStop(0, 'rgba(255,255,255,.95)'); grd.addColorStop(0.6, 'rgba(255,255,255,.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
    });
  }
  // comic star with ink outline
  return canvasTex('star', 128, (g, s) => {
    starPath(g, s / 2, s / 2 + 4, s * 0.44, s * 0.2);
    g.fillStyle = '#ffd23f'; g.fill();
    g.lineWidth = 9; g.lineJoin = 'round'; g.strokeStyle = '#1a1030'; g.stroke();
  });
}

const up = new THREE.Vector3(0, 1, 0);

export class FX {
  constructor(scene, { max = 220 } = {}) {
    this.scene = scene;
    this.max = max;
    this.pool = [];
    this.live = [];
    this.meshes = []; // temporary effect meshes { obj, life, age, update }
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  _sprite() {
    let s = this.pool.pop();
    if (!s) {
      if (this.live.length >= this.max) { s = this.live.shift(); }
      else s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    }
    s.visible = true;
    this.group.add(s);
    return s;
  }

  /** Spawn one particle. */
  spawn({ pos, vel = new THREE.Vector3(), grav = 0, life = 0.8, size = 0.2, size1 = null, color = 0xffffff, tex = 'spark', additive = true, spin = 0, drag = 0, fade = true, follow = null }) {
    const s = this._sprite();
    s.material.map = starTexture(tex);
    s.material.color.set(color);
    s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.material.opacity = 1;
    s.material.rotation = Math.random() * Math.PI * 2;
    s.material.needsUpdate = true;
    s.position.copy(pos);
    s.scale.setScalar(size);
    s.userData = { vel: vel.clone(), grav, life, age: 0, size, size1: size1 ?? size, spin, drag, fade, follow };
    this.live.push(s);
    return s;
  }

  burst(pos, { count = 14, speed = 3, color = 0xffe066, tex = 'spark', size = 0.22, life = 0.5, grav = -4, spread = 1, up: upBias = 0.4, additive = true, size1 = 0.02 } = {}) {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5 + upBias, (Math.random() - 0.5) * spread).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      this.spawn({ pos, vel: v, grav, life: life * (0.7 + Math.random() * 0.6), size: size * (0.7 + Math.random() * 0.6), size1, color, tex, additive, spin: (Math.random() - 0.5) * 8 });
    }
  }
  hitSparks(pos, color = 0xffe066, big = false) {
    this.burst(pos, { count: big ? 26 : 14, speed: big ? 5 : 3.5, color, size: big ? 0.35 : 0.24 });
    this.spawn({ pos, size: big ? 1.4 : 0.8, size1: big ? 2.2 : 1.3, life: 0.18, tex: 'glow', color });
  }
  stars(pos, n = 6) {
    this.burst(pos, { count: n, speed: 2.2, tex: 'star', additive: false, size: 0.28, size1: 0.2, life: 0.9, grav: -3, up: 0.8 });
  }
  dust(pos, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({ pos: pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3)), vel: new THREE.Vector3(Math.cos(a) * 1.2, 0.5 + Math.random() * 0.5, Math.sin(a) * 1.2), tex: 'puff', additive: false, color: 0xe8e0d0, size: 0.25, size1: 0.6, life: 0.6, drag: 3 });
    }
  }
  hearts(pos, n = 6) {
    this.burst(pos, { count: n, speed: 1.4, tex: 'heart', additive: false, size: 0.3, size1: 0.35, life: 1.4, grav: 0.8, up: 1.4 });
  }
  notes(pos, n = 3) {
    this.burst(pos, { count: n, speed: 1.1, tex: 'note', additive: false, size: 0.3, size1: 0.3, life: 1.6, grav: 0.6, up: 1.6, color: [0xffd23f, 0x29d3ff, 0xff5fa2][Math.floor(Math.random() * 3)] });
  }
  confetti(center, n = 60) {
    const cols = [0xff3d3d, 0xffd23f, 0x2d7dff, 0x2fd26b, 0x8e5cff, 0xff5fa2];
    for (let i = 0; i < n; i++) {
      this.spawn({ pos: center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 1.5, (Math.random() - 0.5) * 2)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5), grav: -2.2, drag: 0.8,
        life: 2.6, size: 0.14, color: cols[i % cols.length], tex: 'spark', additive: false, spin: (Math.random() - 0.5) * 14 });
    }
  }

  /** Temporary mesh with a custom update(age01, dt). */
  addMesh(obj, life, update) {
    this.group.add(obj);
    this.meshes.push({ obj, life, age: 0, update });
    return obj;
  }

  shockwave(pos, color = 0xffffff) {
    const geo = new THREE.RingGeometry(0.3, 0.45, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos).setY(0.06);
    this.addMesh(m, 0.6, (p) => { m.scale.setScalar(1 + p * 5); mat.opacity = 0.9 * (1 - p); });
  }

  /** A projectile that flies from → to, then calls onHit. */
  projectile(from, to, { tex = 'glow', color = 0xff7a1a, size = 0.6, dur = 0.45, trail = 'glow', trailColor = color, arc = 0.3, spin = 0, onHit } = {}) {
    const s = this.spawn({ pos: from, size, life: dur + 0.05, tex, color, additive: tex === 'glow', fade: false, spin });
    const start = from.clone(), end = to.clone();
    const holder = new THREE.Object3D();
    let fired = false;
    this.addMesh(holder, dur, (p) => {
      s.position.lerpVectors(start, end, p);
      s.position.y += Math.sin(Math.PI * p) * arc;
      s.userData.age = 0;
      if (Math.random() < 0.9) this.spawn({ pos: s.position.clone(), size: size * 0.6, size1: 0.02, life: 0.3, tex: trail, color: trailColor, vel: new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 0) });
      if (p >= 1 && !fired) { fired = true; s.userData.life = 0; onHit?.(); }
    });
  }

  beam(from, to, color = 0xff2d55, dur = 0.5) {
    const len = from.distanceTo(to);
    const geo = new THREE.CylinderGeometry(0.07, 0.07, 1, 12, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.Mesh(geo, mat);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    const inner = new THREE.Mesh(geo.clone(), glowMat);
    inner.scale.set(0.4, 1, 0.4);
    const g = new THREE.Group();
    g.add(core, inner);
    g.position.copy(from);
    g.quaternion.setFromUnitVectors(up, to.clone().sub(from).normalize());
    this.addMesh(g, dur, (p) => {
      const grow = Math.min(1, p / 0.25);
      g.scale.set(1 + Math.sin(p * 60) * 0.25, len * grow, 1 + Math.sin(p * 60) * 0.25);
      mat.opacity = glowMat.opacity = p > 0.75 ? (1 - p) / 0.25 : 0.95;
      if (Math.random() < 0.6) this.spawn({ pos: to, vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 2), size: 0.2, size1: 0.02, life: 0.3, color });
    });
  }

  bolt(from, to, color = 0xffe02e, dur = 0.45) {
    const make = () => {
      const pts = [];
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const p = from.clone().lerp(to, i / n);
        if (i > 0 && i < n) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3));
        pts.push(p);
      }
      return pts;
    };
    const geo = new THREE.BufferGeometry().setFromPoints(make());
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    // thick glow tube along the same path
    const tubeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    let tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(make()), 24, 0.05, 5), tubeMat);
    const g = new THREE.Group(); g.add(line, tube);
    let flick = 0;
    this.addMesh(g, dur, (p, dt) => {
      flick += dt;
      if (flick > 0.06) {
        flick = 0;
        geo.setFromPoints(make());
        tube.geometry.dispose();
        tube.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(make()), 24, 0.05, 5);
      }
      tubeMat.opacity = mat.opacity = Math.random() > 0.3 ? 0.95 * (1 - p * 0.6) : 0.2;
    });
    this.spawn({ pos: to, size: 1.6, size1: 2.4, life: 0.25, tex: 'glow', color });
  }

  slash(pos, dir = 1, color = 0xdfe8ff) {
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.TorusGeometry(0.55, 0.035, 6, 24, Math.PI * 0.7);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos).add(new THREE.Vector3(0, (i - 1) * 0.22, 0.25));
      m.rotation.z = dir > 0 ? -0.9 : Math.PI - 0.9 + 0.9;
      m.rotation.y = dir > 0 ? 0 : Math.PI;
      const delay = i * 0.07;
      this.addMesh(m, 0.45 + delay, (p) => {
        const q = Math.max(0, (p * (0.45 + delay) - delay) / 0.45);
        m.scale.setScalar(0.3 + q * 1.1);
        mat.opacity = q > 0 ? 1 - q : 0;
        m.rotation.z += 0.12 * dir;
      });
    }
  }

  crystals(pos, color = 0x9be8ff) {
    for (let i = 0; i < 9; i++) {
      const geo = new THREE.OctahedronGeometry(0.16 + Math.random() * 0.12, 0);
      geo.scale(0.6, 1.8, 0.6);
      const mat = new THREE.MeshStandardMaterial({ color, emissive: 0x3aa8ff, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9 });
      const m = new THREE.Mesh(geo, mat);
      const a = (i / 9) * Math.PI * 2;
      m.position.copy(pos).add(new THREE.Vector3(Math.cos(a) * 0.45, 0.1 + Math.random() * 1.2, Math.sin(a) * 0.3));
      m.rotation.set((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 1.2);
      this.addMesh(m, 1.3, (p) => {
        const s = p < 0.15 ? p / 0.15 : p > 0.8 ? (1 - p) / 0.2 : 1;
        m.scale.setScalar(Math.max(0.001, s));
      });
    }
    this.burst(pos.clone().setY(1), { count: 12, tex: 'flake', additive: false, color: 0xffffff, size: 0.25, size1: 0.1, speed: 2.4, life: 0.9, grav: -1 });
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      const u = s.userData;
      u.age += dt;
      if (u.age >= u.life) {
        this.live.splice(i, 1);
        s.visible = false;
        this.group.remove(s);
        this.pool.push(s);
        continue;
      }
      const p = u.age / u.life;
      u.vel.y += u.grav * dt;
      if (u.drag) u.vel.multiplyScalar(Math.max(0, 1 - u.drag * dt));
      s.position.addScaledVector(u.vel, dt);
      s.scale.setScalar(u.size + (u.size1 - u.size) * p);
      s.material.rotation += u.spin * dt;
      if (u.fade) s.material.opacity = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    }
    for (let i = this.meshes.length - 1; i >= 0; i--) {
      const m = this.meshes[i];
      m.age += dt;
      const p = Math.min(1, m.age / m.life);
      m.update?.(p, dt);
      if (p >= 1) {
        this.meshes.splice(i, 1);
        m.obj.removeFromParent();
        m.obj.traverse((o) => { o.geometry?.dispose?.(); if (o.material && !o.isSprite) o.material.dispose?.(); });
      }
    }
  }

  clear() {
    for (const s of this.live) { s.visible = false; this.group.remove(s); this.pool.push(s); }
    this.live = [];
    for (const m of this.meshes) { m.obj.removeFromParent(); m.obj.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
    this.meshes = [];
  }

  dispose() {
    this.clear();
    for (const s of this.pool) s.material.dispose();
    this.pool = [];
    this.group.removeFromParent();
  }
}

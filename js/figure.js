// Procedural animation for a toy standee — no rigging, just transforms:
// root (placement + facing) → hop (height, lean, tilt) → spinner (spin + squash) → mesh.

import * as THREE from 'three';
import { starTexture } from './fx.js';

const ease = {
  out: (t) => 1 - (1 - t) ** 3,
  in: (t) => t * t * t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; },
};
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const seg = (p, a, b) => clamp01((p - a) / (b - a));

export class Figure {
  constructor(built, toy) {
    this.toy = toy;
    this.built = built;
    this.height = built.height;
    this.root = new THREE.Group();
    this.hopG = new THREE.Group();
    this.flipG = new THREE.Group();
    this.spinG = new THREE.Group();
    this.root.add(this.hopG);
    this.hopG.add(this.flipG);
    this.flipG.add(this.spinG);
    this.flipG.position.y = built.height / 2;   // flips rotate around the middle
    this.spinG.position.y = -built.height / 2;
    this.pivotR = built.base ? built.radius : 0.15;
    this.spinG.add(built.object);
    this.home = new THREE.Vector3();
    this.baseYaw = 0;
    this.dir = 1; // +1 = opponent is to the right
    this.actions = [];
    this.hold = { lean: 0, y: 0, tilt: 0, spin: 0 };
    this.phase = Math.random() * 10;
    this.idleAmp = 1;
    this.dizzyUntil = 0;
    this.time = 0;
    this.stars = null;
    this.shield = null;
    this.glow = null;
  }

  setHome(x, z = 0) { this.home.set(x, 0, z); this.root.position.copy(this.home); }
  face(targetX, towardCamera = 0.42) {
    this.dir = targetX >= this.home.x ? 1 : -1;
    this.baseYaw = this.dir * towardCamera;
  }
  get headPos() { return new THREE.Vector3(this.root.position.x, this.hopG.position.y + this.height + 0.15, this.root.position.z); }
  get chestPos() { return new THREE.Vector3(this.root.position.x, this.hopG.position.y + this.height * 0.6, this.root.position.z + 0.1); }

  /** Queue an animation. fn(p, pose, dt) adds to pose. Returns a promise resolved at the end. */
  play(dur, fn, { events = [], onEnd } = {}) {
    return new Promise((resolve) => {
      this.actions.push({ t: 0, dur, fn, events: events.map(e => ({ ...e, fired: false })), resolve, onEnd });
    });
  }
  stopAll() { for (const a of this.actions) a.resolve(); this.actions = []; }
  busy() { return this.actions.length > 0; }

  update(dt) {
    this.time += dt;
    const t = this.time;
    const pose = { x: 0, y: 0, z: 0, lean: 0, tilt: 0, spin: 0, yaw: 0, sy: 1, flip: 0 };
    // idle breathing / sway
    const calm = this.actions.length ? 0.35 : 1;
    pose.sy += Math.sin(t * 2.6 + this.phase) * 0.022 * this.idleAmp * calm;
    pose.lean += Math.sin(t * 1.4 + this.phase) * 0.035 * this.idleAmp * calm;
    pose.y += Math.max(0, Math.sin(t * 2.6 + this.phase)) * 0.015 * this.idleAmp * calm;
    for (let i = this.actions.length - 1; i >= 0; i--) {
      const a = this.actions[i];
      a.t += dt;
      const p = Math.min(1, a.t / a.dur);
      a.fn(p, pose, dt);
      for (const e of a.events) if (!e.fired && p >= e.at) { e.fired = true; e.cb(); }
      if (p >= 1) {
        this.actions.splice(i, 1);
        a.onEnd?.();
        a.resolve();
      }
    }
    // dizzy wobble
    if (t < this.dizzyUntil) {
      pose.lean += Math.sin(t * 9) * 0.12;
      pose.yaw += Math.sin(t * 4.5) * 0.25;
    }
    this.root.position.set(this.home.x + pose.x, 0, this.home.z + pose.z);
    this.root.rotation.y = this.baseYaw + pose.yaw;
    // lean tips the toy over the edge of its base (pivot on the side it leans to)
    const th = -(pose.lean + this.hold.lean) * this.dir;
    const px = -Math.sign(th) * this.pivotR;
    this.hopG.rotation.z = th;
    this.hopG.rotation.x = pose.tilt + this.hold.tilt;
    this.hopG.position.x = px * (1 - Math.cos(th));
    this.hopG.position.y = Math.max(0, pose.y + this.hold.y) - px * Math.sin(th);
    this.flipG.rotation.x = pose.flip;
    this.spinG.rotation.y = pose.spin + this.hold.spin;
    const sy = Math.max(0.5, pose.sy);
    const sx = 1 / Math.sqrt(sy);
    this.spinG.scale.set(sx, sy, sx);
    if (this.stars) {
      const on = t < this.dizzyUntil;
      this.stars.visible = on;
      if (on) {
        this.stars.position.set(0, this.height + 0.12, 0);
        this.stars.rotation.y += dt * 5;
      }
    }
    if (this.shield) {
      const on = t < this.shieldUntil;
      const target = on ? 1 : 0;
      this.shieldScale += (target - this.shieldScale) * Math.min(1, dt * 18);
      this.shield.visible = this.shieldScale > 0.02;
      this.shield.scale.setScalar(this.shieldScale);
      this.shield.material.opacity = 0.35 + Math.sin(t * 20) * 0.08;
    }
    if (this.glow) {
      const on = t < this.glowUntil;
      this.glow.visible = on;
      if (on) { this.glow.material.opacity = 0.5 + Math.sin(t * 25) * 0.3; this.glow.scale.setScalar(this.height * (1.5 + Math.sin(t * 12) * 0.1)); }
    }
  }

  // ---------- moves ----------
  hopTo(x, z = this.home.z, { height = 0.35, perHop = 0.55, hopDur = 0.26, onLand } = {}) {
    const from = this.home.clone();
    const to = new THREE.Vector3(x, 0, z);
    const dist = from.distanceTo(to);
    const hops = Math.max(1, Math.ceil(dist / perHop));
    const dur = hops * hopDur;
    let lastHop = -1;
    return this.play(dur, (p, pose) => {
      const k = Math.min(hops - 1e-6, p * hops);
      const hi = Math.floor(k), f = k - hi;
      if (hi !== lastHop) { lastHop = hi; if (hi > 0) onLand?.(); }
      const cur = from.clone().lerp(to, ease.inOut(p));
      pose.x += cur.x - this.home.x; pose.z += cur.z - this.home.z;
      pose.y += Math.sin(Math.PI * f) * height;
      pose.sy += f < 0.12 ? -0.18 * (1 - f / 0.12) : f > 0.88 ? -0.15 * ((f - 0.88) / 0.12) : 0.08 * Math.sin(Math.PI * f);
      pose.lean += 0.12 * Math.sign(to.x - from.x || 1) * this.dir;
    }, { onEnd: () => { this.home.copy(to); onLand?.(); } });
  }

  /** Dash toward the opponent, strike, come back. onImpact fires at the hit frame. */
  lunge(targetX, { windup = 0.14, strike = 0.1, recover = 0.3, reach = 0.55, onImpact, kind = 'punch' } = {}) {
    const total = windup + strike + recover;
    const a = windup / total, b = (windup + strike) / total;
    const gap = Math.abs(targetX - this.home.x);
    const travel = Math.max(0, gap - reach) * this.dir;
    return this.play(total, (p, pose) => {
      if (p < a) { // wind-up: crouch and lean back
        const q = ease.out(p / a);
        pose.lean -= 0.3 * q; pose.sy -= 0.12 * q; pose.x -= 0.12 * this.dir * q;
      } else if (p < b) { // strike
        const q = ease.out(seg(p, a, b));
        pose.x += (-0.12 * this.dir) * (1 - q) + travel * q;
        pose.lean += -0.3 * (1 - q) + (kind === 'kick' ? 0.75 : 0.45) * q;
        pose.sy += 0.1 * q;
        if (kind === 'kick') pose.y += Math.sin(Math.PI * q) * 0.35;
      } else { // recover
        const q = ease.inOut(seg(p, b, 1));
        pose.x += travel * (1 - q);
        pose.lean += (kind === 'kick' ? 0.75 : 0.45) * (1 - q);
        pose.sy += 0.1 * (1 - q);
      }
    }, { events: [{ at: b, cb: () => onImpact?.() }] });
  }

  spinAttack(targetX, { onImpact } = {}) {
    const gap = Math.abs(targetX - this.home.x);
    const travel = Math.max(0, gap - 0.6) * this.dir;
    return this.play(0.9, (p, pose) => {
      const out = p < 0.5 ? ease.out(p / 0.5) : 1 - ease.inOut((p - 0.5) / 0.5);
      pose.x += travel * out;
      pose.spin += ease.inOut(p) * Math.PI * 4;
      pose.y += Math.sin(Math.PI * p) * 0.4;
    }, { events: [{ at: 0.5, cb: () => onImpact?.() }] });
  }

  knockback(strength = 1, { blocked = false } = {}) {
    const back = -this.dir * (blocked ? 0.12 : 0.35 + strength * 0.35);
    return this.play(blocked ? 0.25 : 0.45 + strength * 0.15, (p, pose) => {
      const out = p < 0.3 ? ease.out(p / 0.3) : 1 - ease.inOut((p - 0.3) / 0.7);
      pose.x += back * out;
      pose.lean -= (blocked ? 0.15 : 0.45 + strength * 0.3) * out;
      pose.sy += (p < 0.15 ? -0.2 : 0) * (1 - p / 0.15);
      if (!blocked && strength > 0.8) pose.y += Math.sin(Math.PI * Math.min(1, p / 0.6)) * 0.3 * strength;
    });
  }

  jump(height = 1.1, { dur = 0.8, flip = false, onLand } = {}) {
    return this.play(dur, (p, pose) => {
      const crouch = p < 0.15 ? Math.sin(Math.PI * p / 0.15) : 0;
      const air = seg(p, 0.15, 0.9);
      pose.sy -= crouch * 0.2;
      pose.y += Math.sin(Math.PI * air) * height;
      pose.sy += air > 0 && air < 1 ? 0.12 * Math.sin(Math.PI * air) : 0;
      if (p > 0.9) pose.sy -= 0.18 * Math.sin(Math.PI * seg(p, 0.9, 1));
      if (flip) pose.flip -= ease.inOut(air) * Math.PI * 2;
    }, { events: [{ at: 0.9, cb: () => onLand?.() }] });
  }

  spin(turns = 1, dur = 0.7) {
    return this.play(dur, (p, pose) => { pose.spin += ease.inOut(p) * Math.PI * 2 * turns; pose.y += Math.sin(Math.PI * p) * 0.2; });
  }

  /** Turn to show the back, then turn to the front again. */
  showBack(dur = 1.6) {
    return this.play(dur, (p, pose) => {
      const k = p < 0.35 ? ease.inOut(p / 0.35) : p > 0.65 ? 1 - ease.inOut((p - 0.65) / 0.35) : 1;
      pose.spin += Math.PI * k;
    });
  }

  victory() {
    return this.play(1.6, (p, pose) => {
      const j1 = seg(p, 0, 0.45), j2 = seg(p, 0.5, 1);
      pose.y += Math.sin(Math.PI * j1) * 0.8 + Math.sin(Math.PI * j2) * 1.1;
      pose.spin += ease.inOut(j1) * Math.PI * 2;
      pose.flip -= ease.inOut(j2) * Math.PI * 2;
      pose.sy += (p < 0.05 || (p > 0.45 && p < 0.5) ? -0.15 : 0);
    });
  }

  bow() {
    return this.play(1.1, (p, pose) => {
      const k = p < 0.35 ? ease.out(p / 0.35) : p > 0.7 ? 1 - ease.inOut((p - 0.7) / 0.3) : 1;
      pose.tilt += 0.55 * k;
    });
  }

  /** Cartoon KO: flop over sideways (stays down until getUp). */
  flop() {
    const target = -Math.PI / 2 * 0.92;
    return this.play(0.7, (p, pose) => {
      const k = ease.back(p);
      pose.lean += target * k;
      pose.y += Math.sin(Math.PI * p) * 0.4;
    }, { onEnd: () => { this.hold.lean = target; } });
  }
  getUp() {
    const from = this.hold.lean;
    this.hold.lean = 0;
    return this.play(0.6, (p, pose) => {
      pose.lean += from * (1 - ease.back(p));
      pose.y += Math.sin(Math.PI * p) * 0.35;
    });
  }

  dizzy(seconds = 2) {
    this.ensureStars();
    this.dizzyUntil = this.time + seconds;
  }

  wiggle(dur = 1.2) {
    return this.play(dur, (p, pose) => {
      pose.lean += Math.sin(p * 40) * 0.2 * (1 - p);
      pose.y += Math.abs(Math.sin(p * 20)) * 0.12;
      pose.sy += Math.sin(p * 30) * 0.06;
    });
  }

  dance(beat = 0.5, style = 0, beats = 8) {
    return this.play(beat * beats, (p, pose) => {
      const b = p * beats, f = b - Math.floor(b), n = Math.floor(b);
      pose.y += Math.abs(Math.sin(Math.PI * f)) * 0.25;
      pose.sy += f < 0.15 ? -0.12 : 0.04;
      if (style === 0) pose.lean += Math.sin(Math.PI * b) * 0.35;
      if (style === 1) pose.spin += n % 4 === 3 ? ease.inOut(f) * Math.PI * 2 : 0;
      if (style === 2) { pose.x += Math.sin(Math.PI * b / 2) * 0.3; pose.lean += Math.sin(Math.PI * b) * 0.2; }
      if (style === 3) pose.tilt += Math.sin(Math.PI * 2 * f) * 0.15;
    });
  }

  lean(amount, dur) {
    return this.play(dur, (p, pose) => { pose.lean += amount * Math.sin(Math.PI * p); });
  }

  // ---------- attachments ----------
  ensureStars() {
    if (this.stars) return;
    const g = new THREE.Group();
    const tex = starTexture();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
      s.scale.setScalar(0.28);
      const a = (i / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.35, Math.sin(a * 2) * 0.05, Math.sin(a) * 0.35);
      g.add(s);
    }
    g.visible = false;
    this.root.add(g);
    this.stars = g;
  }

  blockFor(seconds, color = 0x5fd3ff) {
    if (!this.shield) {
      const geo = new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      this.shield = new THREE.Mesh(geo, mat);
      this.shield.rotation.x = Math.PI / 2;
      this.shieldWrap = new THREE.Group();
      this.shieldWrap.position.set(0, this.height * 0.55, 0);
      this.shieldWrap.rotation.y = Math.PI / 2 * this.dir;
      this.shieldWrap.scale.set(this.height * 0.45, this.height * 0.62, this.height * 0.45);
      this.shieldWrap.add(this.shield);
      this.root.add(this.shieldWrap);
      this.shieldScale = 0;
    }
    this.shieldWrap.rotation.y = -this.baseYaw + (Math.PI / 2) * this.dir;
    this.shieldUntil = this.time + seconds;
  }

  glowFor(seconds, color) {
    if (!this.glow) {
      const tex = starTexture('glow');
      this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.glow.position.set(0, this.height * 0.5, -0.1);
      this.root.add(this.glow);
    }
    this.glow.material.color.set(color);
    this.glowUntil = this.time + seconds;
  }

  dispose() {
    this.stopAll();
    this.root.removeFromParent();
    this.built.dispose();
    for (const o of [this.stars, this.shieldWrap, this.glow]) {
      o?.traverse?.((c) => { c.geometry?.dispose?.(); c.material?.dispose?.(); });
    }
  }
}

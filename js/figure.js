// Procedural animation for a jointed toy puppet. Every frame builds a pose from layers —
// idle breathing / fighting stance → walk-run cycle (driven by distance travelled) → queued actions
// (punch, kick, block, hit, flop, jump, dance…) — then applies it to the body and the bones and
// plants the feet on the ground. Toys without legs hop instead of walking.
//
// Scene graph: root (placement + facing) → body (hop, lean, tilt) → flipG (flips about the middle)
//   → spinG (spin + squash) → puppet (skinned mesh + ink outline).
// Limb angles are "from the outward horizontal of that side": 0 = straight out sideways,
// +90° = up, −90° = down. "fwd" tilts the limb toward the front of the toy (the camera side).

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
const bell = (p, a, b) => Math.sin(Math.PI * seg(p, a, b)); // 0 → 1 → 0 over [a, b]
const D = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const dirOf = (ang, fwd, out = new THREE.Vector3()) => out.set(Math.cos(fwd) * Math.cos(ang), Math.cos(fwd) * Math.sin(ang), Math.sin(fwd));

export class Figure {
  constructor(built, toy) {
    this.toy = toy;
    this.built = built;
    this.height = built.height;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.flipG = new THREE.Group();
    this.spinG = new THREE.Group();
    this.root.add(this.body);
    this.body.add(this.flipG);
    this.flipG.add(this.spinG);
    this.flipG.position.y = built.height / 2; // flips rotate around the middle
    this.spinG.position.y = -built.height / 2;
    this.spinG.add(built.object);
    this.hopG = this.body; // old name, kept for callers
    this.pivotR = built.legs ? Math.max(0.12, Math.abs((built.joints.footR?.x ?? 0.15) - (built.joints.footL?.x ?? -0.15)) / 2 + 0.06) : built.radius;
    this.home = new THREE.Vector3();
    this.baseYaw = 0;
    this.yawNow = 0;
    this.walkYaw = 0;
    this.dir = 1; // +1 = opponent is to the right
    this.actions = [];
    this.hold = { lean: 0, y: 0, tilt: 0, spin: 0, limbs: null };
    this.phase = Math.random() * 10;
    this.idleAmp = 1;
    this.dizzyUntil = 0;
    this.time = 0;
    this.stance = false;   // fighting guard (battle)
    this.stanceW = 0;
    this.gait = { phase: Math.random() * 6, amp: 0, run: 0, lastX: 0, lastZ: 0, speed: 0 };
    this.grounded = 1;
    this.stars = null;
    this.shield = null;
    this.glow = null;
    this.bones = built.bones || {};
    // rest directions of every limb segment (joint → its child) in the figure plane
    this.restDir = {};
    const J = built.joints || {};
    const child = { shoulderL: 'elbowL', elbowL: 'handL', shoulderR: 'elbowR', elbowR: 'handR', hipL: 'kneeL', kneeL: 'footL', hipR: 'kneeR', kneeR: 'footR', neck: 'head', chest: 'neck', hips: 'chest' };
    for (const [a, b] of Object.entries(child)) {
      if (J[a] && J[b]) this.restDir[a] = new THREE.Vector3().subVectors(J[b], J[a]).normalize();
    }
    this.apps = Object.keys(this.bones).filter(n => /^app\d+_[01]$/.test(n));
    // how far a straight arm / leg reaches sideways from the toy's centre (where to stop when striking)
    const len = (a, b) => (J[a] && J[b] ? J[a].distanceTo(J[b]) : 0);
    const reachOf = (root, mid, tip, fb) => Math.max(...['L', 'R'].map(s => (J[root + s] ? Math.abs(J[root + s].x) + len(root + s, mid + s) + len(mid + s, tip + s) : fb)));
    this.reach = { punch: reachOf('shoulder', 'elbow', 'hand', built.width * 0.5), kick: reachOf('hip', 'knee', 'foot', built.width * 0.45) };
    this.hasLegs = !!built.legs;
    this.legScale = built.legsMerged ? 0.55 : 1; // merged legs stretch the middle: move them less
    this.lastBodyX = 0;
    this.sway = 0;
  }

  setHome(x, z = 0) { this.home.set(x, 0, z); this.root.position.copy(this.home); this.gait.lastX = x; this.gait.lastZ = z; }
  face(targetX, towardCamera = 0.42) {
    this.dir = targetX >= this.home.x ? 1 : -1;
    this.baseYaw = this.dir * towardCamera;
  }
  get lead() { return this.dir > 0 ? 'R' : 'L'; }
  get rear() { return this.dir > 0 ? 'L' : 'R'; }

  bonePos(name, fallbackY) {
    const b = this.bones[name];
    if (b) return b.getWorldPosition(new THREE.Vector3());
    return new THREE.Vector3(this.root.position.x, this.body.position.y + fallbackY, this.root.position.z);
  }
  get headPos() { return this.bonePos('head', this.height).add(new THREE.Vector3(0, 0.15, 0)); }
  get chestPos() {
    const c = this.bones.chest ? this.bonePos('chest', this.height * 0.6) : new THREE.Vector3(this.root.position.x, this.body.position.y + this.height * 0.6, this.root.position.z);
    const hp = this.bones.hips ? this.bonePos('hips', this.height * 0.45) : c;
    return c.lerp(hp, 0.3).add(new THREE.Vector3(0, 0, 0.1));
  }
  /** Ground contact for contact shadows: { x, z, air, radius }. */
  groundInfo() {
    return { x: this.root.position.x, z: this.root.position.z, air: Math.max(0, this.airNow || 0), radius: Math.max(0.22, this.built.width * 0.36) };
  }

  /** Queue an animation. fn(p, pose, dt) edits the pose. Returns a promise resolved at the end. */
  play(dur, fn, { events = [], onEnd } = {}) {
    return new Promise((resolve) => {
      this.actions.push({ t: 0, dur, fn, events: events.map(e => ({ ...e, fired: false })), resolve, onEnd });
    });
  }
  stopAll() { for (const a of this.actions) a.resolve(); this.actions = []; }
  busy() { return this.actions.length > 0; }

  // ---------- pose helpers (all no-ops when the toy has no such bone) ----------
  newPose() { return { x: 0, y: 0, z: 0, lean: 0, tilt: 0, spin: 0, yaw: 0, sy: 1, flip: 0, noWalk: false, snap: 1, q: new Map() }; }
  q(pose, name) { let q = pose.q.get(name); if (!q) { q = new THREE.Quaternion(); pose.q.set(name, q); } return q; }
  /** Additive local rotation (radians) on a bone. */
  turn(pose, name, rx = 0, ry = 0, rz = 0) {
    if (!this.bones[name]) return;
    this.q(pose, name).multiply(_q.setFromEuler(_e.set(rx, ry, rz)));
  }
  /** Aim a two-bone limb: upper segment (ang, fwd), lower segment (ang2, fwd2), blended by w. */
  limb(pose, upper, lower, side, [a1, f1], [a2, f2], w = 1, maxSwing = Infinity) {
    if (w <= 0 || !this.bones[upper] || !this.restDir[upper]) return;
    const mir = (a) => (side === 'L' ? Math.PI - a : a);
    const d1 = dirOf(mir(a1), f1, _v);
    const swing = this.restDir[upper].angleTo(d1);
    if (swing > maxSwing) w *= maxSwing / swing;
    const qU = _q.setFromUnitVectors(this.restDir[upper], d1);
    this.q(pose, upper).slerp(qU, w);
    if (!this.bones[lower] || !this.restDir[lower]) return;
    const d2 = dirOf(mir(a2), f2, _v2).applyQuaternion(_q2.copy(qU).invert());
    this.q(pose, lower).slerp(_q2.setFromUnitVectors(this.restDir[lower], d2), w);
  }
  arm(pose, side, up, fore, w = 1, maxSwing) { this.limb(pose, `shoulder${side}`, `elbow${side}`, side, up, fore, w, maxSwing); }
  leg(pose, side, thigh, shin, w = 1, maxSwing) {
    if (!this.hasLegs) return;
    this.limb(pose, `hip${side}`, `knee${side}`, side, thigh, shin, w, maxSwing);
  }
  arms(pose, up, fore, w = 1) { this.arm(pose, 'L', up, fore, w); this.arm(pose, 'R', up, fore, w); }

  // ---------- layers ----------
  idleLayer(pose, dt) {
    const t = this.time + this.phase;
    const calm = this.actions.length ? 0.35 : 1;
    const a = this.idleAmp * calm;
    this.stanceW += ((this.stance ? 1 : 0) - this.stanceW) * Math.min(1, dt * 6);
    const sw = this.stanceW;
    // breathing + sway (body)
    pose.sy += Math.sin(t * 2.6) * 0.018 * a * (1 - sw);
    pose.lean += Math.sin(t * 1.4) * 0.03 * a * (1 - sw);
    this.turn(pose, 'chest', Math.sin(t * 2.6) * 0.03 * a, Math.sin(t * 1.1) * 0.06 * a, 0);
    this.turn(pose, 'neck', Math.sin(t * 1.7) * 0.05 * a, Math.sin(t * 0.9) * 0.12 * a, Math.sin(t * 1.3) * 0.04 * a);
    // relaxed arms keep the pose they have in the photo and sway a little around it
    for (const [side, ph, sg] of [['L', 0, -1], ['R', 1.7, 1]]) {
      const s = Math.sin(t * 1.6 + ph);
      this.turn(pose, `shoulder${side}`, (-0.06 + s * 0.06) * a, 0, sg * s * 0.05 * a);
      this.turn(pose, `elbow${side}`, -0.08 * a, 0, sg * Math.sin(t * 1.6 + ph + 0.8) * 0.06 * a);
    }
    // fighting guard: fists up, knees soft, bouncing on the toes
    if (sw > 0.01) {
      const bounce = Math.abs(Math.sin(t * 5.2));
      pose.y += bounce * 0.035 * sw;
      pose.sy += (bounce - 0.5) * 0.03 * sw;
      this.arm(pose, this.lead, [-50 * D, 55 * D], [78 * D, 38 * D], sw, 85 * D);
      this.arm(pose, this.rear, [-62 * D, 40 * D], [92 * D, 28 * D], sw, 85 * D);
      this.leg(pose, this.lead, [-78 * D, 14 * D], [-96 * D, 0], sw * this.legScale);
      this.leg(pose, this.rear, [-80 * D, -12 * D], [-94 * D, -18 * D], sw * this.legScale);
      this.turn(pose, 'chest', 0.08 * sw, 0.18 * this.dir * sw, 0);
      this.turn(pose, 'neck', -0.05 * sw, -0.12 * this.dir * sw, 0);
    }
    // wiggly appendages (tails, antennae, horns)
    this.apps.forEach((n, i) => {
      const k = n.endsWith('_1') ? 1.6 : 1;
      this.turn(pose, n, 0, 0, (Math.sin(t * 3 + i * 1.3) * 0.14 + this.sway * 0.25) * k);
    });
  }

  walkLayer(pose, dt) {
    const g = this.gait;
    const amp = g.amp;
    if (amp < 0.02) return;
    const ph = g.phase;
    const s = Math.sin(ph), c = Math.cos(ph);
    const run = g.run;
    if (!this.hasLegs) { // hop along
      pose.y += Math.abs(s) * 0.22 * amp;
      pose.sy += (Math.abs(s) < 0.25 ? -0.14 : 0.06) * amp;
      return;
    }
    const A = (24 + run * 20) * D * this.legScale;
    const K = (38 + run * 40) * D * this.legScale;
    // legs swing forward/back and bend on the way through
    this.leg(pose, 'L', [-88 * D, A * s], [-90 * D, A * s - K * Math.max(0, -Math.sin(ph + 0.6))], amp);
    this.leg(pose, 'R', [-88 * D, -A * s], [-90 * D, -A * s - K * Math.max(0, Math.sin(ph + 0.6))], amp);
    // arms counter-swing (runners pump bent arms)
    const armA = (22 + run * 30) * D;
    this.arm(pose, 'L', [-80 * D, -armA * s], [-80 * D + run * 90 * D, -armA * s + (20 + run * 40) * D], amp * (1 - this.stanceW * 0.6));
    this.arm(pose, 'R', [-80 * D, armA * s], [-80 * D + run * 90 * D, armA * s + (20 + run * 40) * D], amp * (1 - this.stanceW * 0.6));
    this.turn(pose, 'hips', 0, s * 0.12 * amp, c * 0.05 * amp);
    this.turn(pose, 'chest', (0.06 + run * 0.18) * amp, -s * 0.16 * amp, 0);
    pose.y += Math.abs(c) * (0.03 + run * 0.05) * amp;
    pose.lean += (0.04 + run * 0.1) * amp * Math.sign(g.vx * this.dir || 1);
  }

  /** Keep walking toward a spot (drag a toy around in Play). */
  chaseTo(x, z, { onStep } = {}) {
    this.chase = new THREE.Vector3(x, 0, z);
    this.chaseStep = onStep;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    if (this.chase && !this.actions.length) {
      const dx = this.chase.x - this.home.x, dz = this.chase.z - this.home.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.02) { this.home.copy(this.chase); this.chase = null; } else {
        const step = Math.min(d, (this.hasLegs ? 1.9 : 1.5) * dt);
        this.home.x += (dx / d) * step; this.home.z += (dz / d) * step;
      }
      const st = Math.floor(this.gait.phase / Math.PI);
      if (st !== this.lastStepN) { this.lastStepN = st; this.chaseStep?.(); }
    }
    const pose = this.newPose();
    this.idleLayer(pose, dt);
    this.walkLayer(pose, dt);
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
    if (this.hold.limbs) this.hold.limbs(pose);
    if (t < this.dizzyUntil) {
      pose.lean += Math.sin(t * 9) * 0.1;
      pose.yaw += Math.sin(t * 4.5) * 0.25;
      this.turn(pose, 'neck', 0, 0, Math.sin(t * 6) * 0.25);
    }
    this.apply(pose, dt);
    this.updateAttachments(dt);
  }

  apply(pose, dt) {
    const g = this.gait;
    // placement + facing
    const x = this.home.x + pose.x, z = this.home.z + pose.z;
    this.root.position.set(x, 0, z);
    const vx = (x - g.lastX) / Math.max(1e-4, dt), vz = (z - g.lastZ) / Math.max(1e-4, dt);
    g.lastX = x; g.lastZ = z;
    const speed = Math.hypot(vx, vz);
    g.vx = vx;
    const want = pose.noWalk ? 0 : clamp01(speed / 1.2);
    g.amp += (want - g.amp) * Math.min(1, dt * (want > g.amp ? 10 : 6));
    g.run += ((speed > 2.2 ? 1 : 0) - g.run) * Math.min(1, dt * 4);
    const stride = Math.max(0.35, this.height * (0.42 + g.run * 0.25));
    if (!pose.noWalk) g.phase += (speed * dt / stride) * Math.PI;
    // walking turns the toy toward where it goes (but keeps its face to the camera)
    const moving = g.amp > 0.25 && speed > 0.3;
    const tgtWalkYaw = moving ? THREE.MathUtils.clamp(wrap(Math.atan2(vx, vz) - this.baseYaw), -0.7, 0.7) : 0;
    this.walkYaw += (tgtWalkYaw - this.walkYaw) * Math.min(1, dt * 5);
    const yawTarget = this.baseYaw + this.walkYaw + pose.yaw;
    this.yawNow += wrap(yawTarget - this.yawNow) * Math.min(1, dt * 14);
    this.root.rotation.y = this.yawNow;
    // body: lean pivots on the outer edge of the feet (the side it tips to)
    const th = -(pose.lean + this.hold.lean) * this.dir;
    const px = -Math.sign(th) * this.pivotR;
    this.body.rotation.z = th;
    this.body.rotation.x = pose.tilt + this.hold.tilt;
    this.body.position.x = px * (1 - Math.cos(th));
    const air = Math.max(0, pose.y + this.hold.y);
    this.body.position.y = air - px * Math.sin(th);
    this.flipG.rotation.x = pose.flip;
    this.spinG.rotation.y = pose.spin + this.hold.spin;
    const sy = Math.max(0.5, pose.sy);
    const sxz = 1 / Math.sqrt(sy);
    this.spinG.scale.set(sxz, sy, sxz);
    // bones
    for (const [name, b] of Object.entries(this.bones)) {
      const q = pose.q.get(name);
      if (q) b.quaternion.copy(q); else b.quaternion.identity();
    }
    // tail / antenna follow-through from sideways motion
    const bodyX = x;
    this.sway += ((this.lastBodyX - bodyX) * 6 - this.sway) * Math.min(1, dt * 5);
    this.lastBodyX = bodyX;
    // plant the feet: after posing, drop the body so the lowest foot touches the ground
    this.airNow = air;
    if (this.hasLegs) {
      const upright = Math.abs(th) < 0.5 && Math.abs(pose.flip) < 0.3;
      const snapW = (upright ? 1 : 0) * pose.snap;
      this.grounded += (snapW - this.grounded) * Math.min(1, dt * 12);
      if (this.grounded > 0.01) {
        this.root.updateMatrixWorld(true);
        let low = Infinity;
        for (const f of ['footL', 'footR']) {
          const b = this.bones[f];
          if (!b) continue;
          const wy = b.getWorldPosition(_v).y - (this.built.soles[f] ?? 0) * sy * 0.92;
          if (wy < low) low = wy;
        }
        if (Number.isFinite(low)) {
          const lift = low - air;           // how far the lowest sole floats above where it should be
          this.body.position.y -= lift * this.grounded;
          this.airNow = air;
        }
      }
    }
  }

  updateAttachments(dt) {
    const t = this.time;
    if (this.stars) {
      const on = t < this.dizzyUntil;
      this.stars.visible = on;
      if (on) {
        const hp = this.bones.head ? this.root.worldToLocal(this.bones.head.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(0, this.height, 0);
        this.stars.position.set(hp.x, hp.y + 0.14, hp.z);
        this.stars.rotation.y += dt * 5;
      }
    }
    if (this.shield) {
      const on = t < this.shieldUntil;
      this.shieldScale += ((on ? 1 : 0) - this.shieldScale) * Math.min(1, dt * 18);
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
  /** Walk (legs) or hop (no legs) to a spot. Kept as hopTo for callers. */
  hopTo(x, z = this.home.z, { height = 0.35, perHop = 0.55, hopDur = 0.26, onLand, run = false, speed: pace } = {}) {
    const from = this.home.clone();
    const to = new THREE.Vector3(x, 0, z);
    const dist = from.distanceTo(to);
    if (dist < 0.01) { this.home.copy(to); return Promise.resolve(); }
    if (!this.hasLegs) {
      const hops = Math.max(1, Math.ceil(dist / perHop));
      const dur = hops * hopDur;
      let lastHop = -1;
      return this.play(dur, (p, pose) => {
        const k = Math.min(hops - 1e-6, p * hops);
        const hi = Math.floor(k), f = k - hi;
        if (hi !== lastHop) { lastHop = hi; if (hi > 0) onLand?.(); }
        const cur = from.clone().lerp(to, ease.inOut(p));
        pose.x += cur.x - this.home.x; pose.z += cur.z - this.home.z;
        pose.noWalk = true;
        pose.y += Math.sin(Math.PI * f) * height;
        pose.sy += f < 0.12 ? -0.18 * (1 - f / 0.12) : f > 0.88 ? -0.15 * ((f - 0.88) / 0.12) : 0.08 * Math.sin(Math.PI * f);
        pose.lean += 0.12 * Math.sign(to.x - from.x || 1) * this.dir;
        this.arms(pose, [-20 * D + Math.sin(Math.PI * f) * 60 * D, 10 * D], [0, 10 * D], 0.8);
      }, { onEnd: () => { this.home.copy(to); onLand?.(); } });
    }
    // walking pace: ~1.4 units/s (running ~3.2), footstep sounds on each step
    const speed = pace ?? (run || hopDur < 0.2 ? 3.2 : 1.5);
    const dur = Math.max(0.35, dist / speed);
    let lastStep = Math.floor(this.gait.phase / Math.PI);
    return this.play(dur, (p, pose) => {
      const k = p < 0.15 ? p * p / 0.3 : p > 0.85 ? 1 - (1 - p) * (1 - p) / 0.3 : (p - 0.075) / 0.85; // gentle start/stop
      const cur = from.clone().lerp(to, Math.min(1, Math.max(0, k)));
      pose.x += cur.x - this.home.x; pose.z += cur.z - this.home.z;
      const st = Math.floor(this.gait.phase / Math.PI);
      if (st !== lastStep) { lastStep = st; onLand?.(); }
    }, { onEnd: () => { this.home.copy(to); } });
  }
  walkTo(x, z, opts = {}) { return this.hopTo(x, z, opts); }

  /** Step in and hit with a fist (punch) or foot (kick); onImpact fires at the hit frame. */
  lunge(targetX, { windup = 0.14, strike = 0.1, recover = 0.3, reach = 0.55, onImpact, kind = 'punch', side } = {}) {
    const total = windup + strike + recover;
    const a = windup / total, b = (windup + strike) / total;
    const gap = Math.abs(targetX - this.home.x);
    // stop where the fist / foot lands on the opponent's body (~0.2 from their centre)
    const limbReach = (kind === 'kick' ? this.reach.kick : this.reach.punch) * 0.92 + 0.2;
    const travel = Math.max(0, gap - Math.max(reach, limbReach)) * this.dir;
    this.punchCount = (this.punchCount || 0) + 1;
    const arm = side || (kind === 'punch' && this.punchCount % 2 === 0 && this.built.arms[this.rear] ? this.rear : this.lead);
    const cross = arm === this.rear;
    return this.play(total, (p, pose) => {
      pose.noWalk = true;
      const wind = p < a ? ease.out(p / a) : 1 - ease.out(seg(p, a, b));
      const hit = p < a ? 0 : p < b ? ease.out(seg(p, a, b)) : 1 - ease.inOut(seg(p, b, 1));
      const move = p < a ? -0.1 * ease.out(p / a) : p < b ? -0.1 + (travel / this.dir + 0.1) * ease.out(seg(p, a, b)) : (travel / this.dir) * (1 - ease.inOut(seg(p, b, 1)));
      pose.x += move * this.dir;
      if (kind === 'kick') {
        pose.lean += -0.22 * hit + 0.1 * wind;
        pose.y += 0.05 * hit;
        this.leg(pose, this.lead, [-35 * D + 30 * D * hit, 35 * D * wind + 18 * D * hit], [-110 * D * wind + (-5 * D) * hit, -30 * D * wind + 18 * D * hit], Math.max(wind, hit));
        this.leg(pose, this.rear, [-94 * D, -6 * D], [-96 * D, -10 * D], Math.max(wind, hit));
        this.arm(pose, this.lead, [-10 * D, -10 * D], [20 * D, 0], hit * 0.9);
        this.arm(pose, this.rear, [10 * D, 20 * D], [60 * D, 20 * D], hit * 0.9);
        this.turn(pose, 'chest', 0, -0.25 * this.dir * hit, 0);
        pose.snap = 1;
      } else {
        pose.lean += -0.12 * wind + 0.32 * hit;
        pose.sy -= 0.06 * wind;
        if (cross) {
          this.arm(pose, arm, [-40 * D, -20 * D], [60 * D, 0], wind);
          this.arm(pose, arm, [170 * D, 62 * D], [175 * D, 48 * D], hit);
          this.turn(pose, 'chest', 0, 0.45 * this.dir * hit, 0);
        } else {
          this.arm(pose, arm, [-30 * D, -30 * D], [70 * D, -5 * D], wind);
          this.arm(pose, arm, [4 * D, 22 * D], [4 * D, 22 * D], hit);
          this.turn(pose, 'chest', 0, -0.2 * this.dir * hit, 0);
        }
        const other = arm === 'L' ? 'R' : 'L';
        this.arm(pose, other, [-55 * D, 55 * D], [85 * D, 35 * D], Math.max(wind, hit) * 0.8);
        this.leg(pose, this.lead, [-70 * D, 20 * D], [-95 * D, 0], hit * this.legScale);
        this.leg(pose, this.rear, [-100 * D, -25 * D], [-96 * D, -30 * D], hit * this.legScale);
      }
    }, { events: [{ at: b, cb: () => onImpact?.() }] });
  }

  spinAttack(targetX, { onImpact } = {}) {
    const gap = Math.abs(targetX - this.home.x);
    const travel = Math.max(0, gap - 0.6) * this.dir;
    return this.play(0.9, (p, pose) => {
      pose.noWalk = true;
      const out = p < 0.5 ? ease.out(p / 0.5) : 1 - ease.inOut((p - 0.5) / 0.5);
      pose.x += travel * out;
      pose.spin += ease.inOut(p) * Math.PI * 4;
      pose.y += Math.sin(Math.PI * p) * 0.4;
      pose.snap = 0;
      this.arms(pose, [2 * D, 0], [2 * D, 0], bell(p, 0, 1) * 1.2);
      this.leg(pose, 'L', [-70 * D, 30 * D], [-120 * D, -30 * D], bell(p, 0, 1));
      this.leg(pose, 'R', [-70 * D, 30 * D], [-120 * D, -30 * D], bell(p, 0, 1));
    }, { events: [{ at: 0.5, cb: () => onImpact?.() }] });
  }

  knockback(strength = 1, { blocked = false } = {}) {
    const back = -this.dir * (blocked ? 0.12 : 0.3 + strength * 0.35);
    const dur = blocked ? 0.28 : 0.5 + strength * 0.15;
    const flail = Math.random() < 0.5 ? 1 : -1;
    return this.play(dur, (p, pose) => {
      pose.noWalk = true;
      const out = p < 0.3 ? ease.out(p / 0.3) : 1 - ease.inOut((p - 0.3) / 0.7);
      pose.x += back * out;
      if (blocked) {
        this.arms(pose, [-20 * D, 70 * D], [100 * D, 45 * D], out);
        pose.lean -= 0.12 * out;
        return;
      }
      pose.lean -= (0.35 + strength * 0.25) * out;
      pose.sy += (p < 0.15 ? -0.15 : 0) * (1 - p / 0.15);
      if (strength > 0.8) { pose.y += Math.sin(Math.PI * Math.min(1, p / 0.6)) * 0.28 * strength; pose.snap = 1 - out; }
      // head snaps back, arms fly out, knees buckle
      this.turn(pose, 'neck', -0.35 * out, 0, 0.45 * this.dir * out);
      this.turn(pose, 'chest', -0.15 * out, 0.2 * flail * out, 0.2 * this.dir * out);
      this.arm(pose, this.lead, [35 * D, -25 * D], [70 * D, -10 * D], out);
      this.arm(pose, this.rear, [20 * D, 15 * D], [50 * D, 10 * D], out);
      this.leg(pose, this.lead, [-65 * D, 20 * D], [-100 * D, -10 * D], out * 0.8 * this.legScale);
    });
  }

  jump(height = 1.1, { dur = 0.8, flip = false, onLand } = {}) {
    return this.play(dur, (p, pose) => {
      pose.noWalk = true;
      const crouch = p < 0.18 ? Math.sin(Math.PI * p / 0.18) : 0;
      const air = seg(p, 0.18, 0.88);
      const land = p > 0.88 ? Math.sin(Math.PI * seg(p, 0.88, 1)) : 0;
      pose.sy -= crouch * 0.14 + land * 0.14;
      pose.y += Math.sin(Math.PI * air) * height;
      pose.sy += air > 0 && air < 1 ? 0.08 * Math.sin(Math.PI * air) : 0;
      pose.snap = air > 0 && air < 1 ? 0 : 1;
      if (flip) pose.flip -= ease.inOut(air) * Math.PI * 2;
      const tuck = air > 0 && air < 1 ? Math.sin(Math.PI * air) : 0;
      const bend = Math.max(crouch, land);
      this.arms(pose, [-75 * D, -35 * D], [-80 * D, -20 * D], bend);
      this.arms(pose, [65 * D, 10 * D], [80 * D, 5 * D], tuck);
      this.leg(pose, 'L', [-85 * D, 45 * D * bend + 55 * D * tuck], [-95 * D, -40 * D * bend - 50 * D * tuck], Math.max(bend, tuck));
      this.leg(pose, 'R', [-85 * D, 45 * D * bend + 55 * D * tuck], [-95 * D, -40 * D * bend - 50 * D * tuck], Math.max(bend, tuck));
    }, { events: [{ at: 0.88, cb: () => onLand?.() }] });
  }

  spin(turns = 1, dur = 0.7) {
    return this.play(dur, (p, pose) => {
      pose.spin += ease.inOut(p) * Math.PI * 2 * turns;
      pose.y += Math.sin(Math.PI * p) * 0.2;
      pose.snap = 1 - Math.sin(Math.PI * p);
      this.arms(pose, [10 * D, 0], [15 * D, 0], Math.sin(Math.PI * p));
    });
  }

  /** Turn to show the back, then turn to the front again. */
  showBack(dur = 1.6) {
    return this.play(dur, (p, pose) => {
      const k = p < 0.35 ? ease.inOut(p / 0.35) : p > 0.65 ? 1 - ease.inOut((p - 0.65) / 0.35) : 1;
      pose.spin += Math.PI * k;
      // a little wave over the shoulder while showing the back
      const w = bell(p, 0.3, 0.7);
      this.arm(pose, 'R', [70 * D, 0], [100 * D + Math.sin(p * 40) * 25 * D, 0], w);
    });
  }

  victory() {
    return this.play(1.6, (p, pose) => {
      const j1 = seg(p, 0, 0.45), j2 = seg(p, 0.5, 1);
      pose.y += Math.sin(Math.PI * j1) * 0.7 + Math.sin(Math.PI * j2) * 0.9;
      pose.spin += ease.inOut(j1) * Math.PI * 2;
      pose.flip -= ease.inOut(j2) * Math.PI * 2;
      pose.snap = j1 > 0 && j1 < 1 || j2 > 0 && j2 < 1 ? 0 : 1;
      pose.sy += (p < 0.05 || (p > 0.45 && p < 0.5) ? -0.12 : 0);
      const pump = Math.sin(p * 30) * 12 * D;
      this.arms(pose, [62 * D, 12 * D], [80 * D + pump, 12 * D], 1);
      this.leg(pose, 'L', [-70 * D, 30 * D], [-110 * D, -35 * D], Math.sin(Math.PI * j1) + Math.sin(Math.PI * j2));
      this.leg(pose, 'R', [-70 * D, 30 * D], [-110 * D, -35 * D], Math.sin(Math.PI * j1) + Math.sin(Math.PI * j2));
    });
  }

  /** Stand-still hero pose for cards and the reveal. */
  heroPose() {
    this.hold.limbs = (pose) => {
      this.arm(pose, 'L', [-30 * D, 25 * D], [40 * D, 30 * D], 0.9);
      this.arm(pose, 'R', [-72 * D, 5 * D], [-60 * D, 20 * D], 0.9);
      this.leg(pose, 'L', [-82 * D, 6 * D], [-92 * D, 0], 0.8);
      this.leg(pose, 'R', [-80 * D, -4 * D], [-90 * D, 0], 0.8);
      this.turn(pose, 'chest', 0.04, 0.15, 0);
    };
  }

  bow() {
    return this.play(1.2, (p, pose) => {
      const k = p < 0.35 ? ease.out(p / 0.35) : p > 0.7 ? 1 - ease.inOut((p - 0.7) / 0.3) : 1;
      this.turn(pose, 'chest', 0.5 * k, 0, 0);
      this.turn(pose, 'hips', 0.25 * k, 0, 0);
      this.turn(pose, 'neck', 0.3 * k, 0, 0);
      this.arm(pose, 'L', [-95 * D, 25 * D], [-100 * D, 30 * D], k);
      this.arm(pose, 'R', [-20 * D, 60 * D], [150 * D, 40 * D], k); // hand on the tummy
      if (!this.bones.chest) pose.tilt += 0.55 * k;
    });
  }

  /** Cartoon KO: flop over sideways, arms and legs flung out (stays down until getUp). */
  flop() {
    const target = -Math.PI / 2 * 0.92;
    const splay = (pose) => {
      this.arms(pose, [55 * D, 0], [70 * D, 0], 1);
      this.leg(pose, 'L', [-55 * D, 10 * D], [-65 * D, 0], 1);
      this.leg(pose, 'R', [-55 * D, -10 * D], [-65 * D, 0], 1);
      this.turn(pose, 'neck', 0.25, 0, 0.3 * this.dir);
    };
    return this.play(0.7, (p, pose) => {
      const k = ease.back(p);
      pose.lean += target * k;
      pose.y += Math.sin(Math.PI * p) * 0.35;
      pose.snap = 0;
      pose.noWalk = true;
      for (const q of pose.q.values()) q.identity();
      splay(pose);
    }, { onEnd: () => { this.hold.lean = target; this.hold.limbs = (pose) => { pose.snap = 0; pose.noWalk = true; splay(pose); }; } });
  }
  getUp() {
    const from = this.hold.lean;
    this.hold.lean = 0;
    this.hold.limbs = null;
    return this.play(0.7, (p, pose) => {
      pose.lean += from * (1 - ease.back(p));
      pose.y += Math.sin(Math.PI * p) * 0.3;
      pose.snap = p > 0.7 ? 1 : 0;
      pose.noWalk = true;
      this.arms(pose, [55 * D, 0], [70 * D, 0], 1 - p);
    });
  }

  dizzy(seconds = 2) {
    this.ensureStars();
    this.dizzyUntil = this.time + seconds;
  }

  /** Giggly shake (being tickled): arms hug the tummy. */
  wiggle(dur = 1.2) {
    return this.play(dur, (p, pose) => {
      pose.lean += Math.sin(p * 40) * 0.16 * (1 - p);
      pose.y += Math.abs(Math.sin(p * 20)) * 0.1;
      pose.sy += Math.sin(p * 30) * 0.05;
      pose.noWalk = true;
      const k = bell(p, 0, 1) * 1.3;
      this.arms(pose, [-40 * D, 55 * D], [160 * D, 40 * D], Math.min(1, k));
      this.turn(pose, 'neck', -0.3 * Math.min(1, k), Math.sin(p * 25) * 0.3, 0);
      this.leg(pose, 'L', [-75 * D + Math.sin(p * 30) * 10 * D, 10 * D], [-90 * D, 0], Math.min(1, k) * 0.6);
    });
  }

  /** Wiggly fingers toward someone (doing the tickling). */
  tickle(dur = 1.4) {
    return this.play(dur, (p, pose) => {
      const k = Math.min(1, bell(p, 0, 1) * 1.5);
      const w = Math.sin(p * 60) * 18 * D;
      this.arm(pose, this.lead, [-5 * D + w, 40 * D], [10 * D - w, 30 * D], k);
      this.arm(pose, this.rear, [5 * D - w, 60 * D], [20 * D + w, 45 * D], k);
      pose.lean += 0.15 * k;
    });
  }

  dance(beat = 0.5, style = 0, beats = 8) {
    return this.play(beat * beats, (p, pose) => {
      const b = p * beats, f = b - Math.floor(b), n = Math.floor(b);
      const on = n % 2 ? 1 : -1;
      const fade = Math.min(1, seg(p, 0, 0.06) * 1) * Math.min(1, (1 - p) / 0.06);
      pose.y += Math.abs(Math.sin(Math.PI * f)) * 0.18;
      pose.sy += f < 0.15 ? -0.1 : 0.03;
      pose.noWalk = true;
      if (style === 0) { // hands in the air, waving
        pose.lean += Math.sin(Math.PI * b) * 0.22;
        this.arm(pose, 'L', [70 * D + Math.sin(Math.PI * b) * 20 * D, 10 * D], [95 * D + Math.sin(Math.PI * b * 2) * 30 * D, 10 * D], fade);
        this.arm(pose, 'R', [70 * D - Math.sin(Math.PI * b) * 20 * D, 10 * D], [95 * D - Math.sin(Math.PI * b * 2) * 30 * D, 10 * D], fade);
        this.leg(pose, on > 0 ? 'L' : 'R', [-70 * D, 25 * D], [-110 * D, -25 * D], fade * Math.sin(Math.PI * f));
      }
      if (style === 1) { // disco point
        const up = on > 0 ? 'R' : 'L', down = on > 0 ? 'L' : 'R';
        this.arm(pose, up, [55 * D, 15 * D], [60 * D, 15 * D], fade);
        this.arm(pose, down, [-60 * D, 20 * D], [-40 * D, 30 * D], fade);
        this.turn(pose, 'hips', 0, 0, 0.12 * on * fade);
        this.turn(pose, 'chest', 0, 0.25 * on * fade, -0.1 * on * fade);
        pose.spin += n % 4 === 3 ? ease.inOut(f) * Math.PI * 2 : 0;
      }
      if (style === 2) { // robot: square arms, jerky head
        const snapB = Math.floor(b * 2) % 4;
        const ang = [0, 25, -25, 0][snapB] * D;
        this.arm(pose, 'L', [0 + ang, 10 * D], [90 * D, 10 * D], fade);
        this.arm(pose, 'R', [0 - ang, 10 * D], [-90 * D, 10 * D], fade);
        this.turn(pose, 'neck', 0, [0.4, -0.4, 0.4, -0.4][snapB] * fade, 0);
        pose.x += Math.sin(Math.PI * b / 2) * 0.12;
      }
      if (style === 3) { // jumping jacks
        const open = Math.abs(Math.sin(Math.PI * b));
        pose.y += open * 0.12;
        pose.snap = 1 - open;
        this.arms(pose, [-80 * D + open * 160 * D, 5 * D], [-80 * D + open * 170 * D, 5 * D], fade);
        this.leg(pose, 'L', [-90 * D + open * 25 * D, 0], [-90 * D + open * 25 * D, 0], fade);
        this.leg(pose, 'R', [-90 * D + open * 25 * D, 0], [-90 * D + open * 25 * D, 0], fade);
      }
    });
  }

  lean(amount, dur) {
    return this.play(dur, (p, pose) => { pose.lean += amount * Math.sin(Math.PI * p); });
  }

  /** Hug: arms wrap forward and in. */
  hug(dur = 1.4) {
    return this.play(dur, (p, pose) => {
      const k = Math.min(1, bell(p, 0, 1) * 1.6);
      pose.lean += 0.3 * Math.sin(Math.PI * p);
      this.arm(pose, this.lead, [-5 * D, 70 * D], [150 * D, 35 * D], k);
      this.arm(pose, this.rear, [-5 * D, 75 * D], [150 * D, 40 * D], k);
      this.turn(pose, 'neck', 0.1 * k, 0, -0.25 * this.dir * k);
    });
  }

  /** Raise the lead hand for a high five (or a wave hello when `wave`). */
  highFive(dur = 0.7, { wave = false } = {}) {
    return this.play(dur, (p, pose) => {
      const k = Math.min(1, bell(p, 0, 1) * 1.6);
      const w = wave ? Math.sin(p * 36) * 25 * D : 0;
      this.arm(pose, this.lead, [55 * D, 20 * D], [80 * D + w, 15 * D], k);
      pose.y += wave ? 0 : Math.sin(Math.PI * p) * 0.25;
      pose.snap = wave ? 1 : 1 - Math.sin(Math.PI * p);
      this.leg(pose, this.rear, [-75 * D, -20 * D], [-110 * D, -40 * D], wave ? 0 : k * 0.7);
    });
  }
  wave(dur = 1.2) { return this.highFive(dur, { wave: true }); }

  /** Throw something (fireball, stars): wind back, fling forward. onRelease at the throw frame. */
  throwMove({ dur = 0.55, onRelease } = {}) {
    return this.play(dur, (p, pose) => {
      pose.noWalk = true;
      const wind = p < 0.45 ? ease.out(p / 0.45) : 0;
      const fling = p < 0.45 ? 0 : 1 - ease.inOut(seg(p, 0.45, 1));
      this.arm(pose, this.lead, [40 * D, -70 * D], [90 * D, -60 * D], wind);
      this.arm(pose, this.lead, [8 * D, 30 * D], [8 * D, 30 * D], fling);
      this.arm(pose, this.rear, [-40 * D, 30 * D], [60 * D, 30 * D], Math.max(wind, fling));
      pose.lean += -0.18 * wind + 0.3 * fling;
      this.turn(pose, 'chest', 0, (-0.4 * wind + 0.3 * fling) * this.dir, 0);
    }, { events: [{ at: 0.5, cb: () => onRelease?.() }] });
  }

  /** Power pose: both arms thrust at the opponent (beams, ice, magic). */
  castForward(dur = 0.9) {
    return this.play(dur, (p, pose) => {
      pose.noWalk = true;
      const k = Math.min(1, bell(p, 0, 1) * 1.8);
      this.arm(pose, this.lead, [5 * D, 30 * D], [5 * D, 30 * D], k);
      this.arm(pose, this.rear, [170 * D, 65 * D], [172 * D, 50 * D], k);
      pose.lean += 0.15 * k;
      this.leg(pose, this.lead, [-68 * D, 20 * D], [-96 * D, 0], k * this.legScale);
      this.leg(pose, this.rear, [-104 * D, -20 * D], [-96 * D, -25 * D], k * this.legScale);
    });
  }

  /** Both fists up to the sky (lightning, charge-up). */
  castUp(dur = 0.8) {
    return this.play(dur, (p, pose) => {
      const k = Math.min(1, bell(p, 0, 1) * 1.8);
      this.arms(pose, [80 * D, 8 * D], [88 * D, 8 * D], k);
      this.turn(pose, 'neck', -0.3 * k, 0, 0);
      pose.sy += 0.04 * k;
    });
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
      this.shieldWrap.scale.set(this.height * 0.45, this.height * 0.62, this.height * 0.45);
      this.shieldWrap.add(this.shield);
      this.root.add(this.shieldWrap);
      this.shieldScale = 0;
    }
    this.shield.material.color.set(color);
    this.shieldWrap.rotation.y = -this.baseYaw + (Math.PI / 2) * this.dir;
    this.shieldUntil = this.time + seconds;
    // arms come up to guard the face for the whole block
    this.play(seconds, (p, pose) => {
      const k = Math.min(1, bell(p, 0, 1) * 3);
      this.arm(pose, this.lead, [-18 * D, 34 * D], [100 * D, 16 * D], k);
      this.arm(pose, this.rear, [-28 * D, 30 * D], [108 * D, 14 * D], k);
      this.turn(pose, 'chest', 0.12 * k, 0, 0);
      this.turn(pose, 'neck', 0.15 * k, 0, 0);
    });
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

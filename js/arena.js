// 3D arena: themed stages dressed with instanced procedural props (one draw call per prop kind),
// studio environment + key/rim lighting with soft shadows that follow the action, a contact
// shadow under every toy, a camera director that frames every toy, slow-mo, shake and
// screen-space projection for comic bubbles.

import * as THREE from 'three';
import { mount, unmount, startLoop, onResize, disposeScene, maxAniso, getRenderer, applyEnvironment, shadowMapSize } from './engine.js';
import { buildFigure } from './mesh.js';
import { Figure } from './figure.js';
import { FX, starTexture } from './fx.js';

export const STAGES = [
  { id: 'city', label: 'City Roof', emoji: '🌆' },
  { id: 'jungle', label: 'Jungle', emoji: '🌴' },
  { id: 'space', label: 'Space', emoji: '🚀' },
  { id: 'volcano', label: 'Volcano', emoji: '🌋' },
];
export function resolveStage(id) {
  if (!id || id === 'random' || !STAGES.find(s => s.id === id)) return STAGES[Math.floor(Math.random() * STAGES.length)].id;
  return id;
}

// ---------- building blocks ----------
/** Seeded PRNG (mulberry32): every visit to a stage looks the same. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw, { repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = Math.min(4, maxAniso());
  return t;
}

const _o = new THREE.Object3D();
const _c = new THREE.Color();
/** Many copies of one mesh in one draw call. place(i, obj, color) poses instance i. */
function instances(geo, mat, n, place, { shadow = false, receive = false } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  for (let i = 0; i < n; i++) {
    _o.position.set(0, 0, 0); _o.rotation.set(0, 0, 0); _o.scale.set(1, 1, 1); _c.set(0xffffff);
    place(i, _o, _c);
    _o.updateMatrix();
    m.setMatrixAt(i, _o.matrix);
    m.setColorAt(i, _c);
  }
  m.instanceMatrix.needsUpdate = true;
  m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere();
  m.castShadow = shadow;
  m.receiveShadow = receive;
  return m;
}

/** True for ground spots between the arena and the camera, where props would hide the toys. */
const inCameraCorridor = (x, z) => z > 1.2 && Math.abs(x) < 4.8 + z * 0.35;
/** Random point on the ground ring rMin..rMax that stays out of the camera corridor. */
function aroundClear(R, rMin, rMax) {
  for (let k = 0; k < 20; k++) {
    const a = R() * Math.PI * 2, r = rMin + R() * (rMax - rMin);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!inCameraCorridor(x, z)) return [x, z];
  }
  return [0, -rMax];
}

/** Random point on an arc behind the arena (the camera looks from +Z, so props stay at the back and sides). */
function behind(R, rMin, rMax, spread = 1.75) {
  const a = (R() - 0.5) * 2 * spread; // 0 = straight behind
  const r = rMin + R() * (rMax - rMin);
  return [Math.sin(a) * r, -Math.cos(a) * r, a];
}

function skyDome(top, mid, fogColor, { sunDir = null, sunColor = 0xffffff, sunPower = 24, sunGain = 0 } = {}) {
  const geo = new THREE.SphereGeometry(80, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, horizon: { value: new THREE.Color(fogColor) },
      sunDir: { value: new THREE.Vector3(...(sunDir || [0, 1, 0])).normalize() }, sunColor: { value: new THREE.Color(sunColor) },
      sunPower: { value: sunPower }, sunGain: { value: sunDir ? sunGain : 0 },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor;
      uniform float sunPower; uniform float sunGain; varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 c = mix(mid, top, smoothstep(0.02, 0.6, h));
        float s = max(dot(normalize(vP), sunDir), 0.0);
        c += sunColor * (pow(s, sunPower) * sunGain + pow(s, 3.0) * sunGain * 0.18) * smoothstep(-0.02, 0.1, h);
        c = mix(horizon, c, smoothstep(-0.01, 0.13, h)); // melt into the fogged ground
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  return m;
}

/** Comic emblem painted in the middle of the fighting floor. */
function emblem(fill, ink = '#1a1030', { radius = 0.95, shape = 'star', glow = false } = {}) {
  const tex = canvasTexture(256, 256, (g, s) => {
    g.translate(s / 2, s / 2);
    g.beginPath(); g.arc(0, 0, s * 0.47, 0, Math.PI * 2); g.lineWidth = 10; g.strokeStyle = ink; g.globalAlpha = 0.55; g.stroke();
    g.globalAlpha = 1;
    g.beginPath(); g.arc(0, 0, s * 0.41, 0, Math.PI * 2); g.lineWidth = 6; g.strokeStyle = fill; g.stroke();
    g.beginPath();
    if (shape === 'bolt') {
      const p = [[-10, -100], [52, -100], [14, -18], [60, -18], [-34, 104], [-8, 14], [-52, 14]];
      p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    } else {
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const r = i % 2 ? 42 : 96; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    }
    g.closePath();
    g.fillStyle = fill; g.globalAlpha = 0.9; g.fill();
    g.globalAlpha = 1; g.lineWidth = 9; g.lineJoin = 'round'; g.strokeStyle = ink; g.stroke();
  });
  const mat = glow
    ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, toneMapped: false })
    : new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.004;
  m.receiveShadow = true;
  return m;
}

function platform(topColor, sideColor, { radius = 3.4, texture = null, emissive = 0x000000, ring = 0xffd23f } = {}) {
  const g = new THREE.Group();
  const side = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius + 0.25, 0.35, 64, 1, true), new THREE.MeshLambertMaterial({ color: sideColor }));
  side.position.y = -0.175;
  side.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.MeshLambertMaterial({ color: topColor, map: texture, emissive, emissiveIntensity: 0.4 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.002;
  top.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.08, 10, 72), new THREE.MeshStandardMaterial({ color: ring, roughness: 0.25, metalness: 0.55, emissive: new THREE.Color(ring).multiplyScalar(0.22) }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.02;
  rim.receiveShadow = true;
  g.add(side, top, rim);
  return g;
}

function ground(color, texture, y = -0.35) {
  // Lambert: a rough PBR floor seen at the low camera's grazing angle picks up a pale sun-specular sheen
  const m = new THREE.Mesh(new THREE.CircleGeometry(78, 48), new THREE.MeshLambertMaterial({ color, map: texture }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

function glow(color, size, pos, opacity = 0.8, fog = false) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture('glow'), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog }));
  s.scale.set(size, size, 1);
  s.position.set(...pos);
  return s;
}

// ---------- stage builders ----------
function cityStage() {
  const R = seeded(11);
  const g = new THREE.Group();
  const tiles = canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#9793ab'; c.fillRect(0, 0, w, w);
    c.strokeStyle = '#6f6b86'; c.lineWidth = 4;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, w); c.moveTo(0, i * 64); c.lineTo(w, i * 64); c.stroke(); }
    for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(0,0,0,${R() * 0.08})`; c.fillRect(R() * w, R() * w, 3, 3); }
  }, { repeat: [3, 3] });
  const roof = canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#4c4563'; c.fillRect(0, 0, w, w);
    for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * 0.07})`; c.fillRect(R() * w, R() * w, 2, 2); }
  }, { repeat: [16, 16] });
  g.add(ground(0x4e4766, roof, -0.35));
  g.add(platform(0xb3aec8, 0x5a5670, { texture: tiles }));
  g.add(emblem('#ffd23f', '#1a1030', { shape: 'star' }));

  // skyline: a near ring and a hazy far ring of towers, window glow from one shared map
  const windows = canvasTexture(128, 256, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    for (let y = 6; y < h; y += 16) for (let x = 6; x < w; x += 14) {
      const r = R();
      c.fillStyle = r < 0.42 ? `hsl(${38 + R() * 16},100%,${62 + R() * 18}%)` : r < 0.5 ? `hsl(${190 + R() * 130},90%,70%)` : '#000';
      c.fillRect(x, y, 8, 10);
    }
  });
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const towerMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveMap: windows, emissiveIntensity: 1.15 });
  const nearPal = [0x3b2d5a, 0x4a3570, 0x2f2550, 0x563d7c, 0x3a3e78];
  g.add(instances(box, towerMat, 26, (i, o, col) => {
    const [x, z] = behind(R, 16, 23, 1.9);
    const w = 2.6 + R() * 3.2;
    o.position.set(x, -3, z); o.scale.set(w, 6 + R() * 14, w * (0.8 + R() * 0.4)); o.rotation.y = R() * 0.6;
    col.set(nearPal[i % nearPal.length]);
  }));
  const farPal = [0x6a4f9a, 0x7a5aa8, 0x5c4a92, 0x8a64b0];
  g.add(instances(box, towerMat, 22, (i, o, col) => {
    const [x, z] = behind(R, 30, 40, 1.7);
    const w = 3 + R() * 4;
    o.position.set(x, -3, z); o.scale.set(w, 10 + R() * 18, w); o.rotation.y = R();
    col.set(farPal[i % farPal.length]);
  }));
  // rooftop edge behind the arena
  const parapetMat = new THREE.MeshLambertMaterial({ color: 0x6d6488, side: THREE.DoubleSide });
  const parapet = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.8, 64, 1, true, Math.PI * 0.58, Math.PI * 0.84), parapetMat);
  parapet.position.y = 0.05; parapet.receiveShadow = true;
  // open-ended: a closed partial cylinder gets pie-slice lids that would roof over half the arena
  const ledge = new THREE.Mesh(new THREE.CylinderGeometry(9.12, 9.12, 0.14, 64, 1, true, Math.PI * 0.58, Math.PI * 0.84), new THREE.MeshLambertMaterial({ color: 0xa79ec4, side: THREE.DoubleSide }));
  ledge.position.y = 0.5;
  g.add(parapet, ledge);
  // water tower
  const tank = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x9c5a2e });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.5, 20), wood); body.position.y = 2.2; body.castShadow = true;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.7, 20), new THREE.MeshLambertMaterial({ color: 0x5a3a2a })); cap.position.y = 3.3;
  tank.add(body, cap);
  tank.add(instances(new THREE.CylinderGeometry(0.06, 0.06, 1.5), wood, 4, (i, o) => { o.position.set(i % 2 ? 0.6 : -0.6, 0.75, i < 2 ? -0.6 : 0.6); }));
  tank.position.set(-5.4, -0.35, -5.6);
  g.add(tank);
  // AC units with spinning fans
  const acs = [[4.7, -3.2], [5.6, -1.6], [-6.4, -2.2]];
  g.add(instances(new THREE.BoxGeometry(1.1, 0.8, 0.9), new THREE.MeshLambertMaterial({ color: 0xc9c6d6 }), acs.length, (i, o) => { o.position.set(acs[i][0], 0.05, acs[i][1]); o.rotation.y = i * 0.4; }, { shadow: true }));
  const fans = instances(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16), new THREE.MeshLambertMaterial({ color: 0x333344 }), acs.length, (i, o) => { o.position.set(acs[i][0], 0.47, acs[i][1]); });
  g.add(fans);
  // antenna with a blinking light
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 5), new THREE.MeshLambertMaterial({ color: 0x8a8a9c }));
  mast.position.set(3.8, 2.1, -6.4); g.add(mast);
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }));
  blink.position.set(3.8, 4.65, -6.4); g.add(blink);
  const blinkGlow = glow(0xff3030, 1.2, [3.8, 4.65, -6.35], 0.9, true); g.add(blinkGlow);
  // neon "POW!" sign on the rooftop edge
  const neonTex = canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = 'rgba(20,10,40,0.92)'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#29d3ff'; c.lineWidth = 10; c.shadowColor = '#29d3ff'; c.shadowBlur = 24; c.strokeRect(18, 18, w - 36, h - 36);
    c.font = 'bold 150px Bangers, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#ff4fb0'; c.shadowBlur = 30; c.fillStyle = '#ffd6f2'; c.fillText('POW!', w / 2, h / 2 + 8);
    c.lineWidth = 6; c.strokeStyle = '#ff4fb0'; c.strokeText('POW!', w / 2, h / 2 + 8);
  });
  const neonMat = new THREE.MeshBasicMaterial({ map: neonTex, toneMapped: false, fog: true });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), neonMat);
  sign.position.set(-1.9, 2.25, -8.4); sign.rotation.y = 0.12;
  const signGlow = glow(0xff4fb0, 5, [-1.9, 2.25, -8.7], 0.35, true);
  const legs = instances(new THREE.CylinderGeometry(0.05, 0.05, 1.7), new THREE.MeshLambertMaterial({ color: 0x3a3450 }), 2, (i, o) => { o.position.set(-3.1 + i * 2.4, 0.6, -8.55 + i * 0.28); });
  g.add(sign, signGlow, legs);
  // party string lights across the back
  const p0 = new THREE.Vector3(-6.2, 3.0, -4.6), p1 = new THREE.Vector3(6.2, 3.0, -4.6);
  const bulbPos = [];
  const N = 24;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    bulbPos.push(p0.clone().lerp(p1, t).add(new THREE.Vector3(0, -Math.sin(Math.PI * t) * 1.1, Math.sin(Math.PI * t) * -0.6)));
  }
  const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p0, ...bulbPos, p1]), new THREE.LineBasicMaterial({ color: 0x241a3a }));
  const bulbCols = [0xffd23f, 0xff5fa2, 0x29d3ff, 0xfff1c4, 0x7dff9a];
  const bulbs = instances(new THREE.SphereGeometry(0.075, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), N, (i, o, col) => { o.position.copy(bulbPos[i]); col.set(bulbCols[i % bulbCols.length]); });
  const poles = instances(new THREE.CylinderGeometry(0.06, 0.08, 3.4), new THREE.MeshLambertMaterial({ color: 0x5a5470 }), 2, (i, o) => { o.position.set(i ? 6.2 : -6.2, 1.35, -4.6); }, { shadow: true });
  g.add(wire, bulbs, poles);
  // sunset: sun disc low on the horizon + drifting clouds
  const sun = new THREE.Mesh(new THREE.CircleGeometry(6, 40), new THREE.MeshBasicMaterial({ color: 0xffd08a, fog: false, toneMapped: false }));
  sun.position.set(-10, 4, -64); g.add(sun);
  const clouds = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture('puff'), color: [0xffb3c8, 0xffc59a, 0xd9a3ff][i % 3], transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    s.scale.set(14 + R() * 10, 4 + R() * 2, 1);
    s.position.set(-30 + i * 15 + R() * 6, 14 + R() * 8, -66);
    clouds.push(s); g.add(s);
  }
  const bulbColor = new THREE.Color();
  return {
    group: g, sky: skyDome(0x2b1f6e, 0xff8a5c, 0xe8848a, { sunDir: [-0.16, 0.07, -1], sunColor: 0xffb070, sunPower: 60, sunGain: 1.1 }),
    fog: new THREE.Fog(0xe8848a, 22, 70),
    hemi: [0xffd9c0, 0x4a3a6a, 0.9], sun: [0xffc28a, 3.2, [-4, 7, 4.5]], rim: [0xb89cff, 2.0], env: 0.45, shadowTint: 0x241640,
    update: (t, dt) => {
      const on = Math.sin(t * 4) > 0;
      blink.visible = on; blinkGlow.visible = on;
      neonMat.color.setScalar(Math.sin(t * 17) > -0.93 ? 1 : 0.45); // a flicker now and then
      signGlow.material.opacity = 0.3 + Math.sin(t * 2.2) * 0.06;
      for (let i = 0; i < N; i++) {
        const k = 0.55 + 0.45 * Math.max(0, Math.sin(t * 3 - i * 0.7));
        bulbs.setColorAt(i, bulbColor.set(bulbCols[i % bulbCols.length]).multiplyScalar(k));
      }
      bulbs.instanceColor.needsUpdate = true;
      clouds.forEach((c, i) => { c.position.x += dt * 0.12 * (0.5 + (i % 3) * 0.3); if (c.position.x > 40) c.position.x = -40; });
    },
  };
}

function jungleStage() {
  const R = seeded(23);
  const g = new THREE.Group();
  const grass = canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#389c47'; c.fillRect(0, 0, w, w);
    for (let i = 0; i < 1100; i++) { c.fillStyle = `hsl(${100 + R() * 34},${45 + R() * 20}%,${26 + R() * 18}%)`; c.fillRect(R() * w, R() * w, 3, 7); }
  }, { repeat: [10, 10] });
  const dirt = canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#c4945a'; c.fillRect(0, 0, w, w);
    for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(90,55,20,${R() * 0.22})`; c.beginPath(); c.arc(R() * w, R() * w, 2 + R() * 5, 0, 7); c.fill(); }
    for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(255,240,200,${R() * 0.25})`; c.beginPath(); c.arc(R() * w, R() * w, 1 + R() * 2, 0, 7); c.fill(); }
  }, { repeat: [2, 2] });
  g.add(ground(0x4fae4f, grass));
  g.add(platform(0xe8c088, 0x7a5230, { texture: dirt, ring: 0xffc83d }));
  g.add(emblem('#ff8a1f', '#5a3314', { shape: 'star', radius: 0.9 }));

  // rolling hills far behind
  const hills = instances(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 8, (i, o, col) => {
    const [x, z] = behind(R, 34, 46, 1.5);
    o.position.set(x, -2, z); o.scale.set(12 + R() * 8, 5 + R() * 6, 9); col.set([0x49b85a, 0x3a9e4d, 0x5cc768][i % 3]);
  });
  g.add(hills);
  // round-canopy trees
  const trees = [];
  for (let i = 0; i < 11; i++) {
    const [x, z] = behind(R, 7.5, 15, 1.95);
    trees.push({ x, z, h: 2.4 + R() * 2.6, s: 0.9 + R() * 0.6 });
  }
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a4a24 });
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 1, 8); trunkGeo.translate(0, 0.5, 0);
  g.add(instances(trunkGeo, trunkMat, trees.length, (i, o) => { const t = trees[i]; o.position.set(t.x, -0.35, t.z); o.scale.set(t.s, t.h * t.s, t.s); }, { shadow: true }));
  const leafCols = [0x2f9e44, 0x40c057, 0x2b8a3e, 0x69db7c, 0x37b24d];
  g.add(instances(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), trees.length * 3, (i, o, col) => {
    const t = trees[Math.floor(i / 3)], k = i % 3;
    o.position.set(t.x + (R() - 0.5) * 0.9 * t.s, -0.35 + (t.h + 0.2 + k * 0.55) * t.s, t.z + (R() - 0.5) * 0.9 * t.s);
    o.scale.setScalar((1.25 - k * 0.22) * t.s); o.rotation.set(R(), R(), R());
    col.set(leafCols[(i * 7) % leafCols.length]);
  }, { shadow: true }));
  // palm trees at the sides: curved trunks from stacked segments, drooping fronds, coconuts
  const palms = [[-5.6, -2.4, 0.35], [5.8, -2.0, -0.3], [-7.6, 1.2, 0.5], [7.4, 0.9, -0.45]];
  const segs = 7;
  const palmTops = [];
  g.add(instances(new THREE.CylinderGeometry(0.13, 0.17, 0.62, 7), new THREE.MeshLambertMaterial({ color: 0x9a6a3a, flatShading: true }), palms.length * segs, (i, o) => {
    const [px, pz, lean] = palms[Math.floor(i / segs)], k = i % segs;
    const bend = lean * (k / segs) ** 1.6;
    o.position.set(px + Math.sin(bend) * k * 0.55, -0.35 + 0.3 + k * 0.56, pz); o.rotation.z = -bend * 1.3;
    if (k === segs - 1) palmTops.push(new THREE.Vector3(o.position.x, o.position.y + 0.3, pz));
  }, { shadow: true }));
  const frondGeo = new THREE.ConeGeometry(0.34, 2.1, 4, 1); frondGeo.translate(0, 1.05, 0); frondGeo.scale(1, 1, 0.22);
  g.add(instances(frondGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, side: THREE.DoubleSide }), palms.length * 7, (i, o, col) => {
    const top = palmTops[Math.floor(i / 7)], k = i % 7;
    o.position.copy(top); o.rotation.set(0, (k / 7) * Math.PI * 2 + R() * 0.3, 0);
    o.rotateZ(Math.PI * 0.62 + R() * 0.2);
    col.set([0x2fae4a, 0x44c25a, 0x279640][k % 3]);
  }, { shadow: true }));
  g.add(instances(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshLambertMaterial({ color: 0x6b4423 }), palms.length * 3, (i, o) => {
    const top = palmTops[Math.floor(i / 3)], a = (i % 3) * 2.1;
    o.position.set(top.x + Math.cos(a) * 0.18, top.y - 0.18, top.z + Math.sin(a) * 0.18);
  }));
  // bushes hugging the arena, grass tufts, flowers, rocks
  g.add(instances(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 18, (i, o, col) => {
    const [x, z] = behind(R, 4.4, 7, 1.85);
    o.position.set(x, -0.3, z); o.scale.set(0.7 + R() * 0.6, 0.45 + R() * 0.4, 0.6 + R() * 0.5); o.rotation.y = R() * 3;
    col.set([0x2f9e44, 0x3fb553, 0x278a3a][i % 3]);
  }, { shadow: true }));
  const bladeGeo = new THREE.ConeGeometry(0.05, 0.42, 4, 1, true); bladeGeo.translate(0, 0.21, 0);
  let tuftAt = [0, 0];
  g.add(instances(bladeGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), 360, (i, o, col) => {
    if (i % 4 === 0) tuftAt = aroundClear(R, 3.6, 10);
    o.position.set(tuftAt[0] + (R() - 0.5) * 0.18, -0.35, tuftAt[1] + (R() - 0.5) * 0.18);
    o.rotation.set((R() - 0.5) * 0.7, R() * 3, (R() - 0.5) * 0.7); o.scale.setScalar(0.7 + R() * 0.8);
    col.setHSL(0.27 + R() * 0.07, 0.6, 0.32 + R() * 0.16);
  }));
  const flowerCols = [0xff5fa2, 0xffd23f, 0xff8a1f, 0xffffff, 0xb36bff];
  g.add(instances(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x221111 }), 70, (i, o, col) => {
    const [x, z] = aroundClear(R, 3.7, 10.5);
    o.position.set(x, -0.26, z); o.scale.setScalar(0.8 + R() * 0.7);
    col.set(flowerCols[i % flowerCols.length]);
  }));
  g.add(instances(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 12, (i, o, col) => {
    const [x, z] = behind(R, 4, 8, 2.2);
    o.position.set(x, -0.25, z); o.scale.setScalar(0.25 + R() * 0.45); o.rotation.set(R() * 3, R() * 3, R() * 3);
    col.set([0x8a8f98, 0x9aa0a8, 0x7a7f88][i % 3]);
  }, { shadow: true }));
  // hanging vines from the nearest canopies
  const vineMat = new THREE.MeshLambertMaterial({ color: 0x2e8b3a });
  const vines = [];
  trees.slice().sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, 4).forEach((t) => {
    const top = new THREE.Vector3(t.x, -0.35 + (t.h + 0.1) * t.s, t.z + 0.4);
    const pts = [0, 1, 2, 3].map(k => top.clone().add(new THREE.Vector3(Math.sin(k * 1.3) * 0.12, -k * 0.55, 0.05 * k)));
    const vine = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.035, 5), vineMat);
    vines.push({ m: vine, base: 0 }); g.add(vine);
  });
  // butterflies
  const wingTex = canvasTexture(64, 64, (c) => {
    c.fillStyle = '#1a1030';
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse(32 + s * 13, 26, 13, 15, s * 0.4, 0, 7); c.fill(); c.beginPath(); c.ellipse(32 + s * 11, 44, 9, 10, -s * 0.3, 0, 7); c.fill(); }
    c.fillStyle = '#fff';
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse(32 + s * 13, 26, 10, 12, s * 0.4, 0, 7); c.fill(); c.beginPath(); c.ellipse(32 + s * 11, 44, 6.5, 7.5, -s * 0.3, 0, 7); c.fill(); }
  });
  const flies = [0xff8ad8, 0xffe14d, 0x7ae7ff].map((col, i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: wingTex, color: col, transparent: true, depthWrite: false }));
    s.scale.set(0.34, 0.34, 1); s.userData.k = i; g.add(s); return s;
  });
  // pollen motes
  const motes = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xfff27a, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }));
  const fp = new Float32Array(50 * 3);
  for (let i = 0; i < 50; i++) { fp[i * 3] = (R() - 0.5) * 14; fp[i * 3 + 1] = 0.4 + R() * 3; fp[i * 3 + 2] = -1 - R() * 8; }
  motes.geometry.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  g.add(motes);
  return {
    group: g, sky: skyDome(0x1f8cff, 0x9fdcf0, 0xa6e2cf, { sunDir: [0.35, 0.55, -1], sunColor: 0xfff4c8, sunPower: 80, sunGain: 0.9 }),
    fog: new THREE.Fog(0xa6e2cf, 22, 70),
    hemi: [0xeafff2, 0x2f7a3e, 0.95], sun: [0xfff0c0, 3.2, [3, 8, 4.5]], rim: [0xffe9a8, 1.4], env: 0.5, shadowTint: 0x1f4a1a,
    update: (t) => {
      motes.position.y = Math.sin(t * 0.8) * 0.2; motes.rotation.y = Math.sin(t * 0.2) * 0.1;
      for (const f of flies) {
        const k = f.userData.k, a = t * (0.35 + k * 0.08) + k * 2.1;
        f.position.set(Math.sin(a) * (3.4 + k * 0.7), 1.3 + Math.sin(a * 2.3) * 0.5 + k * 0.3, -2.6 - Math.cos(a) * 1.4 - k * 0.8);
        f.scale.x = 0.34 * (0.25 + 0.75 * Math.abs(Math.sin(t * 16 + k)));
      }
      vines.forEach((v, i) => { v.m.rotation.z = Math.sin(t * 0.9 + i) * 0.03; });
    },
  };
}

function spaceStage() {
  const R = seeded(37);
  const g = new THREE.Group();
  const floor = canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#353c68'; c.fillRect(0, 0, w, w);
    c.strokeStyle = '#29d3ff'; c.lineWidth = 3; c.shadowColor = '#29d3ff'; c.shadowBlur = 8;
    c.strokeRect(4, 4, w - 8, w - 8);
    c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, w); c.moveTo(0, w / 2); c.lineTo(w, w / 2); c.stroke();
    c.shadowBlur = 0; c.fillStyle = '#4b5285';
    for (const [x, y] of [[20, 20], [w - 28, 20], [20, w - 28], [w - 28, w - 28]]) c.fillRect(x, y, 8, 8);
  }, { repeat: [3, 3] });
  g.add(ground(0x1e2244, null, -0.6));
  g.add(platform(0x9aa3e0, 0x2b3060, { texture: floor, emissive: 0x112244, ring: 0x9be8ff }));
  g.add(emblem('#ff5fa2', '#0d0b2a', { shape: 'bolt', radius: 0.9, glow: true }));
  // pulsing light rings on the floor
  const ringA = new THREE.Mesh(new THREE.RingGeometry(3.02, 3.16, 72), new THREE.MeshBasicMaterial({ color: 0x29d3ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const ringB = new THREE.Mesh(new THREE.RingGeometry(2.05, 2.11, 72), new THREE.MeshBasicMaterial({ color: 0xff5fa2, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  for (const r of [ringA, ringB]) { r.rotation.x = -Math.PI / 2; r.position.y = 0.008; g.add(r); }
  // stars + nebulae + planet + moon
  const stars = new THREE.BufferGeometry();
  const sp = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const v = new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize().multiplyScalar(60 + R() * 10);
    if (v.y < -5) v.y = -v.y;
    sp.set([v.x, v.y, v.z], i * 3);
  }
  stars.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const starPts = new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, fog: false }));
  g.add(starPts);
  for (const [col, pos, s] of [[0x8e5cff, [-26, 18, -62], 46], [0x29d3ff, [22, 8, -64], 34], [0xff4fb0, [2, 26, -66], 30]]) g.add(glow(col, s, pos, 0.28));
  const planet = new THREE.Mesh(new THREE.SphereGeometry(7, 40, 24), new THREE.MeshLambertMaterial({ color: 0xff7ab8, emissive: 0x6a2050, emissiveIntensity: 0.55, fog: false }));
  planet.position.set(15, 12, -46);
  const pring = new THREE.Mesh(new THREE.RingGeometry(9, 12.5, 64), new THREE.MeshBasicMaterial({ color: 0xffd6ec, side: THREE.DoubleSide, transparent: true, opacity: 0.6, fog: false }));
  pring.rotation.set(1.2, 0.3, 0); planet.add(pring);
  g.add(planet);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2, 24, 16), new THREE.MeshLambertMaterial({ color: 0xcfd6ff, emissive: 0x303a7a, fog: false }));
  moon.position.set(-17, 17, -42); g.add(moon);
  // pylons in an arc behind the arena, glowing orbs on top
  const pyl = [];
  for (let i = 0; i < 6; i++) { const a = (i < 3 ? -1 : 1) * (0.62 + (i % 3) * 0.34); pyl.push([Math.sin(a) * 7.4, -Math.cos(a) * 7.4]); }
  g.add(instances(new THREE.CylinderGeometry(0.18, 0.3, 2.8, 10), new THREE.MeshStandardMaterial({ color: 0xaab2e8, metalness: 0.75, roughness: 0.25 }), 6, (i, o) => { o.position.set(pyl[i][0], 0.8, pyl[i][1]); }, { shadow: true }));
  const orbs = instances(new THREE.SphereGeometry(0.3, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 6, (i, o, col) => { o.position.set(pyl[i][0], 2.45, pyl[i][1]); col.set(i % 2 ? 0x29d3ff : 0xff5fa2); });
  g.add(orbs);
  const orbGlows = pyl.map(([x, z], i) => { const s = glow(i % 2 ? 0x29d3ff : 0xff5fa2, 1.6, [x, 2.45, z + 0.05], 0.6, true); g.add(s); return s; });
  // floating crystals orbiting the arena
  const crystals = [];
  for (let i = 0; i < 10; i++) { const [x, z, a] = behind(R, 4.4, 6.6, 1.9); crystals.push({ x, z, a, y: 0.9 + R() * 2.2, s: 0.22 + R() * 0.2, sp: 0.6 + R() * 0.8 }); }
  const crystalGeo = new THREE.OctahedronGeometry(1, 0); crystalGeo.scale(0.6, 1.5, 0.6);
  const crystalMesh = instances(crystalGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x2a1a70, emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.12, flatShading: true }), crystals.length, (i, o, col) => {
    const c = crystals[i]; o.position.set(c.x, c.y, c.z); o.scale.setScalar(c.s); col.set([0x7ae7ff, 0xff8ad8, 0xb89cff][i % 3]);
  });
  crystalMesh.frustumCulled = false; // animated every frame
  g.add(crystalMesh);
  // asteroids tumbling far away
  const rocks = instances(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 9, (i, o, col) => {
    const [x, z] = behind(R, 18, 30, 1.6);
    o.position.set(x, 3 + R() * 9, z); o.scale.setScalar(0.4 + R() * 1.2); o.rotation.set(R() * 3, R() * 3, R() * 3); col.set([0x6a6f9a, 0x575c86, 0x7a7fa8][i % 3]);
  });
  g.add(rocks);
  return {
    group: g, sky: skyDome(0x05031a, 0x2a1a6b, 0x1a1250), fog: new THREE.Fog(0x1a1250, 22, 90),
    hemi: [0xb7c4ff, 0x221a55, 0.95], sun: [0xffffff, 2.6, [2, 7, 5]], rim: [0xff5fa2, 2.4], env: 0.6, shadowTint: 0x05031a,
    update: (t) => {
      starPts.rotation.y = t * 0.01; planet.rotation.y = t * 0.05; rocks.rotation.y = t * 0.004;
      orbGlows.forEach((o, i) => o.scale.setScalar(1.6 * (1 + Math.sin(t * 3 + i) * 0.18)));
      ringA.material.opacity = 0.55 + Math.sin(t * 2.4) * 0.25;
      ringB.material.opacity = 0.4 + Math.sin(t * 2.4 + Math.PI) * 0.25;
      crystals.forEach((c, i) => {
        _o.position.set(c.x, c.y + Math.sin(t * c.sp + i) * 0.25, c.z);
        _o.rotation.set(0, t * c.sp, 0.2); _o.scale.setScalar(c.s); _o.updateMatrix();
        crystalMesh.setMatrixAt(i, _o.matrix);
      });
      crystalMesh.instanceMatrix.needsUpdate = true;
    },
  };
}

function volcanoStage() {
  const R = seeded(53);
  const g = new THREE.Group();
  const rock = canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#3f2c27'; c.fillRect(0, 0, w, w);
    c.strokeStyle = '#ff6a1a'; c.lineWidth = 3; c.shadowColor = '#ffae00'; c.shadowBlur = 10;
    for (let i = 0; i < 7; i++) {
      c.beginPath(); let x = R() * w, y = R() * w; c.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 70; y += (R() - 0.5) * 70; c.lineTo(x, y); }
      c.stroke();
    }
  }, { repeat: [3, 3] });
  const lava = canvasTexture(128, 128, (c, w) => {
    c.fillStyle = '#ff4a00'; c.fillRect(0, 0, w, w);
    for (let i = 0; i < 26; i++) {
      const x = R() * w, y = R() * w, r = 6 + R() * 16;
      const grd = c.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,236,120,0.95)'); grd.addColorStop(1, 'rgba(255,120,0,0)');
      c.fillStyle = grd;
      for (const dx of [-w, 0, w]) for (const dy of [-w, 0, w]) { c.beginPath(); c.arc(x + dx, y + dy, r, 0, 7); c.fill(); }
    }
    c.strokeStyle = 'rgba(90,10,0,0.55)'; c.lineWidth = 3;
    for (let i = 0; i < 8; i++) { c.beginPath(); c.moveTo(R() * w, R() * w); c.lineTo(R() * w, R() * w); c.stroke(); }
  }, { repeat: [1, 1] });
  lava.wrapS = lava.wrapT = THREE.RepeatWrapping;
  g.add(ground(0x2a1a17, rock));
  g.add(platform(0x8f6e5e, 0x3b2420, { texture: rock, emissive: 0x552200, ring: 0xffa040 }));
  g.add(emblem('#ffae00', '#2a0a05', { shape: 'bolt', radius: 0.9 }));
  // volcanoes on the horizon, lava crowns, smoke plume
  const coneMat = new THREE.MeshLambertMaterial({ color: 0x3a2320, flatShading: true });
  const cones = [[-30, -52, 15, 19], [28, -58, 10, 12]];
  const plumes = [];
  cones.forEach(([x, z, r, h], i) => {
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.17, r, h, 24, 1, true), coneMat);
    cone.position.set(x, h / 2 - 0.5, z); g.add(cone);
    const crown = new THREE.Mesh(new THREE.CircleGeometry(r * 0.16, 20), new THREE.MeshBasicMaterial({ color: 0xff7a1a, toneMapped: false }));
    crown.rotation.x = -Math.PI / 2; crown.position.set(x, h - 0.7, z); g.add(crown);
    g.add(glow(0xff6a00, r * 1.1, [x, h + 0.5, z], 0.7, false));
    if (i === 0) for (let k = 0; k < 5; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture('puff'), color: 0x8a5a4a, transparent: true, opacity: 0.35, depthWrite: false, fog: true }));
      s.userData = { x, y: h, z, k }; plumes.push(s); g.add(s);
    }
  });
  // lava pools + a lava river behind the arena, all scrolling the same glowing texture
  const lavaMat = new THREE.MeshBasicMaterial({ map: lava, toneMapped: false });
  const pools = [[-5.6, 2.2, 1.3], [5.2, -1.2, 1.05], [6.6, 3.4, 0.85], [-4.3, -4.6, 1.15]];
  const poolGeo = new THREE.CircleGeometry(1, 28); poolGeo.rotateX(-Math.PI / 2);
  g.add(instances(poolGeo, lavaMat, pools.length, (i, o) => { const [x, z, r] = pools[i]; o.position.set(x, -0.33, z); o.scale.set(r, 1, r * 0.85); }));
  const riverCurve = new THREE.CatmullRomCurve3([[-14, -9], [-7, -7.2], [0, -8.2], [7, -7], [14, -9.5]].map(([x, z]) => new THREE.Vector3(x, -0.33, z)));
  const river = new THREE.BufferGeometry();
  const RN = 40, rp = [], ruv = [], ri = [];
  for (let i = 0; i <= RN; i++) {
    const t = i / RN, p = riverCurve.getPointAt(t), tan = riverCurve.getTangentAt(t);
    const nrm = new THREE.Vector3(-tan.z, 0, tan.x).multiplyScalar(0.55 + Math.sin(t * 9) * 0.12);
    rp.push(p.x + nrm.x, p.y, p.z + nrm.z, p.x - nrm.x, p.y, p.z - nrm.z);
    ruv.push(t * 8, 0, t * 8, 1);
    if (i < RN) { const a = i * 2; ri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  river.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  river.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
  river.setIndex(ri);
  const riverMesh = new THREE.Mesh(river, lavaMat);
  g.add(riverMesh);
  // glowing heat over the lava (one draw call of soft points)
  const heatPts = [];
  for (const [x, z] of pools) heatPts.push(x, -0.2, z);
  for (let i = 0; i <= 8; i++) { const p = riverCurve.getPointAt(i / 8); heatPts.push(p.x, -0.2, p.z); }
  const heatGeo = new THREE.BufferGeometry(); heatGeo.setAttribute('position', new THREE.Float32BufferAttribute(heatPts, 3));
  const heat = new THREE.Points(heatGeo, new THREE.PointsMaterial({ map: starTexture('glow'), color: 0xff7a1a, size: 2.2, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(heat);
  // boulders with glowing cracks and glossy obsidian spikes
  g.add(instances(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, map: rock, emissive: 0xffffff, emissiveMap: rock, emissiveIntensity: 0.55, flatShading: true }), 14, (i, o, col) => {
    const [x, z] = behind(R, 4.6, 11, 2.1);
    o.position.set(x, -0.1, z); o.scale.setScalar(0.4 + R() * 0.9); o.rotation.set(R() * 3, R() * 3, R() * 3); col.set([0x6a4a40, 0x5a3d35, 0x7a5448][i % 3]);
  }, { shadow: true }));
  const spikeGeo = new THREE.ConeGeometry(0.35, 1.8, 5); spikeGeo.translate(0, 0.9, 0);
  g.add(instances(spikeGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.05, envMapIntensity: 0.35, flatShading: true }), 16, (i, o, col) => {
    const [x, z] = behind(R, 5.2, 12, 2.0);
    o.position.set(x, -0.35, z); o.scale.set(0.6 + R() * 0.8, 0.5 + R() * 1.3, 0.6 + R() * 0.8); o.rotation.set((R() - 0.5) * 0.5, R() * 3, (R() - 0.5) * 0.5);
    col.set([0x2a1f2e, 0x3a2438, 0x1f1622][i % 3]);
  }, { shadow: true }));
  // embers
  const embersGeo = new THREE.BufferGeometry();
  const ep = new Float32Array(120 * 3);
  for (let i = 0; i < 120; i++) { ep[i * 3] = (R() - 0.5) * 20; ep[i * 3 + 1] = R() * 8; ep[i * 3 + 2] = -R() * 14; }
  embersGeo.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  const embers = new THREE.Points(embersGeo, new THREE.PointsMaterial({ color: 0xffa040, size: 0.1, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(embers);
  return {
    group: g, sky: skyDome(0x12040a, 0x6a1c10, 0x5a1a0c, { sunDir: [-0.5, 0.12, -1], sunColor: 0xff5a1a, sunPower: 12, sunGain: 0.28 }),
    fog: new THREE.Fog(0x5a1a0c, 20, 68),
    hemi: [0xffb080, 0x3a1008, 1.0], sun: [0xffa060, 2.8, [-3, 7, 4.5]], rim: [0xff3300, 2.6], env: 0.45, shadowTint: 0x1a0503,
    update: (t, dt) => {
      const a = embersGeo.attributes.position;
      for (let i = 0; i < a.count; i++) { let y = a.getY(i) + dt * (0.6 + (i % 5) * 0.2); if (y > 8) y = 0; a.setY(i, y); }
      a.needsUpdate = true;
      lava.offset.set(t * 0.03, t * 0.05);
      heat.material.opacity = 0.34 + Math.sin(t * 2) * 0.08;
      for (const s of plumes) {
        const { x, y, z, k } = s.userData;
        const p = ((t * 0.06 + k / plumes.length) % 1);
        s.position.set(x + p * 5, y + 1 + p * 10, z);
        s.scale.setScalar(4 + p * 9);
        s.material.opacity = 0.35 * Math.sin(Math.PI * p);
      }
    },
  };
}

const BUILDERS = { city: cityStage, jungle: jungleStage, space: spaceStage, volcano: volcanoStage };

// ---------- contact shadows ----------
let contactTex = null;
function contactTexture() {
  if (contactTex) return contactTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  contactTex = new THREE.CanvasTexture(c);
  contactTex.userData.shared = true;
  return contactTex;
}
let contactGeo = null;
function contactGeometry() {
  if (!contactGeo) { contactGeo = new THREE.PlaneGeometry(1, 1); contactGeo.rotateX(-Math.PI / 2); }
  return contactGeo;
}

const UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up2 = new THREE.Vector3();

export class Arena {
  constructor(container, stageId) {
    this.container = container;
    this.stageId = resolveStage(stageId);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.figures = [];
    this.contacts = new Map(); // figure → contact-shadow decal
    this.timeScale = 1;
    this.slowUntil = 0;
    this.time = 0;
    this.shakeAmt = 0;
    this.punch = 0;
    this.orbit = 0;
    this.focusOverride = null;
    this.framing = { lookY: 0.9, extraSpan: 1.8, minSpan: 3.4, height: 0.32, bias: 0 };
    this.camPos = new THREE.Vector3(0, 3, 10);
    this.camLook = new THREE.Vector3(0, 1, 0);
    this.onFrame = null;

    const st = BUILDERS[this.stageId]();
    this.stage = st;
    this.scene.add(st.sky, st.group);
    this.scene.fog = st.fog;
    this.scene.background = new THREE.Color(st.fog.color);
    applyEnvironment(this.scene, st.env ?? 0.5);
    const hemi = new THREE.HemisphereLight(st.hemi[0], st.hemi[1], st.hemi[2]);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(st.sun[0], st.sun[1]);
    sun.position.set(...st.sun[2]);
    sun.castShadow = true;
    const ms = shadowMapSize();
    sun.shadow.mapSize.set(ms, ms);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;       // curved, skinned toys: keeps self-shadow acne away
    sun.shadow.radius = ms >= 2048 ? 6 : 3.5; // same soft penumbra (~2 cm) at either map size
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 30;
    this.sunOffset = new THREE.Vector3(...st.sun[2]);
    this.shadowHalf = 0;
    this.scene.add(sun, sun.target);
    const rim = new THREE.DirectionalLight(st.rim[0], st.rim[1]);
    rim.position.set(-3, 4, -6);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(0, 2, 8);
    this.scene.add(fill);
    this.lights = { hemi, sun, rim, fill };
    this.fitShadow(new THREE.Vector3(), 3.2);
    this.fx = new FX(this.scene);

    this.canvas = mount(container);
    this.offResize = onResize((w, h) => { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.size = { w, h }; });
    startLoop((dt, t) => this.frame(dt, t));
  }

  async addToy(toy, x = 0, z = 0) {
    const built = await buildFigure(toy, { maxAniso: maxAniso() });
    const f = new Figure(built, toy);
    f.setHome(x, z);
    this.scene.add(f.root);
    this.figures.push(f);
    const decal = new THREE.Mesh(contactGeometry(), new THREE.MeshBasicMaterial({
      map: contactTexture(), color: this.stage.shadowTint ?? 0x1a1030, transparent: true, opacity: 0.6, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    decal.renderOrder = 1;
    this.scene.add(decal);
    this.contacts.set(f, decal);
    this.updateContact(f, decal);
    return f;
  }

  /** Soft blob shadow under a toy: follows it, shrinks and fades as it leaves the ground. */
  updateContact(f, decal) {
    const vis = f.root.visible && !!f.root.parent;
    decal.visible = vis;
    if (!vis) return;
    const gi = f.groundInfo?.() ?? {
      x: f.root.position.x, z: f.root.position.z,
      air: Math.max(0, f.hopG?.position?.y || 0),
      radius: (f.built?.width || 0.8) * 0.45,
    };
    const k = Math.min(1, Math.max(0, gi.air || 0) / 1.6);
    const lie = f.groundInfo ? 0 : Math.abs(Math.sin(f.hopG?.rotation?.z || 0)); // old standees flop sideways
    const s = Math.max(0.2, gi.radius) * 2.5 * (1 - 0.45 * k);
    decal.position.set(gi.x, 0.012, gi.z);
    decal.rotation.y = f.root.rotation.y;
    decal.scale.set(s * (1 + lie * 1.3), 1, s * 0.72);
    decal.material.opacity = 0.62 * (1 - 0.7 * k);
  }

  /** Keep the shadow map tight around the action, texel-snapped so still shadows never shimmer. */
  fitShadow(center, need) {
    const sun = this.lights.sun;
    const half = THREE.MathUtils.clamp(need, 2.6, 6.5);
    if (half > this.shadowHalf || this.shadowHalf - half > 0.6) {
      this.shadowHalf = half;
      const sc = sun.shadow.camera;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
    }
    const texel = (2 * this.shadowHalf) / sun.shadow.mapSize.x;
    const fwd = _fwd.copy(this.sunOffset).negate().normalize();
    const right = _right.crossVectors(fwd, UP).normalize();
    const up2 = _up2.crossVectors(right, fwd);
    const snap = (v) => Math.round(v / texel) * texel;
    const a = snap(center.dot(right)), b = snap(center.dot(up2)), d = center.dot(fwd);
    sun.target.position.copy(right).multiplyScalar(a).addScaledVector(up2, b).addScaledVector(fwd, d);
    sun.position.copy(sun.target.position).add(this.sunOffset);
  }

  slowmo(factor = 0.25, seconds = 1.2) { this.timeScale = factor; this.slowUntil = this.time + seconds; }
  shake(amount = 0.15) { this.shakeAmt = Math.max(this.shakeAmt, amount); }
  zoomPunch(amount = 1) { this.punch = Math.max(this.punch, amount); }

  frame(dtReal, tReal) {
    this.time += dtReal;
    if (this.slowUntil && this.time > this.slowUntil) { this.timeScale = 1; this.slowUntil = 0; }
    const dt = dtReal * this.timeScale;
    for (const f of this.figures) f.update(dt);
    for (const [f, d] of this.contacts) this.updateContact(f, d);
    this.fx.update(dt);
    this.stage.update?.(this.time, dtReal);
    this.onFrame?.(dt, dtReal);
    this.updateCamera(dtReal);
    getRenderer().render(this.scene, this.camera);
  }

  updateCamera(dt) {
    const figs = this.figures.filter(f => f.root.visible);
    const box = new THREE.Box3();
    if (this.focusOverride) box.setFromPoints(this.focusOverride);
    else if (figs.length) for (const f of figs) { box.expandByPoint(f.root.position); for (const p of f.framePoints?.() || []) box.expandByPoint(p); }
    else box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const fr = this.framing;
    const span = Math.max(fr.minSpan, size.x + fr.extraSpan, size.z * 1.2 + fr.extraSpan);
    const aspect = this.camera.aspect || 1;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const figH = 2.4;
    let dist = Math.max((span / 2) / Math.tan(hfov / 2), (figH / 2) / Math.tan(vfov / 2) * 1.85) * 1.04 + size.z * 0.5;
    dist *= 1 - this.punch * 0.12;
    // gentle cinematic drift: slow orbit, a breath of dolly, a slight bob
    const t = this.time;
    this.orbit = Math.sin(t * 0.13) * 0.16;
    dist *= 1 + Math.sin(t * 0.17) * 0.012;
    const target = new THREE.Vector3(center.x, fr.lookY, center.z);
    const desired = new THREE.Vector3(
      target.x + Math.sin(this.orbit) * dist,
      target.y + dist * fr.height * 0.84 + Math.sin(t * 0.23) * 0.05, // a touch lower than asked: heroic toys, more sky
      target.z + Math.cos(this.orbit) * dist);
    const k = Math.min(1, dt * 3);
    this.camPos.lerp(desired, k);
    this.camLook.lerp(target, k);
    this.camera.position.copy(this.camPos);
    if (this.shakeAmt > 0.001) {
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shakeAmt, (Math.random() - 0.5) * this.shakeAmt, 0));
      this.shakeAmt *= Math.max(0, 1 - dt * 8);
    }
    this.punch *= Math.max(0, 1 - dt * 4);
    this.camera.lookAt(this.camLook.x, this.camLook.y - fr.bias, this.camLook.z);
    // shadow map follows the toys (plus room for jumps, knockbacks and long shadows)
    this.fitShadow(center.setY(0), Math.max(size.x, size.z) / 2 + 2.2);
  }

  /** Screen position (CSS px within the container) of a world point. */
  project(v) {
    const p = v.clone().project(this.camera);
    const { w, h } = this.size || { w: 1, h: 1 };
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, behind: p.z > 1 };
  }

  /** Ground point under a screen position (for drag). */
  groundAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? hit : null;
  }
  figureAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    let best = null, bestD = Infinity;
    for (const f of this.figures) {
      const hits = ray.intersectObject(f.root, true);
      if (hits.length && hits[0].distance < bestD) { bestD = hits[0].distance; best = f; }
    }
    if (best) return best;
    // generous fallback: nearest figure to the ground point
    const g = this.groundAt(clientX, clientY);
    if (!g) return null;
    for (const f of this.figures) {
      const d = Math.hypot(f.root.position.x - g.x, f.root.position.z - g.z);
      if (d < 1.0 && d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  dispose() {
    this.onFrame = null;
    unmount();
    this.offResize?.();
    for (const f of this.figures) f.dispose();
    this.figures = [];
    this.contacts.clear();
    this.fx.dispose();
    disposeScene(this.scene);
  }
}

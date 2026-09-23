// 3D arena: themed stages built from simple geometry, lights, a camera director
// that frames every toy, slow-mo, shake and screen-space projection for comic bubbles.

import * as THREE from 'three';
import { mount, unmount, startLoop, onResize, disposeScene, maxAniso, getRenderer } from './engine.js';
import { buildFigure } from './mesh.js';
import { Figure } from './figure.js';
import { FX } from './fx.js';

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

function skyDome(top, mid, bottom) {
  const geo = new THREE.SphereGeometry(80, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.55, h)) : mix(mid, bottom, smoothstep(0.0, 0.25, -h));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  return m;
}

function platform(topColor, sideColor, { radius = 3.4, texture = null, emissive = 0x000000 } = {}) {
  const g = new THREE.Group();
  const side = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius + 0.25, 0.35, 64), new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.8 }));
  side.position.y = -0.175;
  side.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.MeshStandardMaterial({ color: topColor, map: texture, roughness: 0.85, emissive, emissiveIntensity: 0.4 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.002;
  top.receiveShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.08, 8, 64), new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.3, metalness: 0.4, emissive: 0x553300 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  g.add(side, top, ring);
  return g;
}

function ground(color, texture, y = -0.35) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color, map: texture, roughness: 1 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

// ---------- stage builders ----------
function cityStage() {
  const g = new THREE.Group();
  const tiles = canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#8d8a9b'; c.fillRect(0, 0, w, w);
    c.strokeStyle = '#6f6b80'; c.lineWidth = 4;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, w); c.moveTo(0, i * 64); c.lineTo(w, i * 64); c.stroke(); }
    for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; c.fillRect(Math.random() * w, Math.random() * w, 3, 3); }
  }, { repeat: [3, 3] });
  g.add(ground(0x4a4560, tiles, -0.35));
  g.add(platform(0xa7a3b8, 0x5a5670, { texture: tiles }));
  const windows = canvasTexture(128, 256, (c, w, h) => {
    c.fillStyle = '#2b2346'; c.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 22) for (let x = 8; x < w; x += 20) {
      c.fillStyle = Math.random() < 0.55 ? `hsl(${40 + Math.random() * 15},100%,${60 + Math.random() * 20}%)` : '#1d1733';
      c.fillRect(x, y, 12, 14);
    }
  });
  const pal = [0x3b2d5a, 0x4a3570, 0x2f2550, 0x563d7c];
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + Math.random() * 0.1;
    if (Math.cos(a) > 0.55 && Math.abs(Math.sin(a)) < 0.6) continue; // keep the camera side open
    const r = 16 + Math.random() * 12;
    const hgt = 5 + Math.random() * 14, wd = 2.5 + Math.random() * 3;
    const mat = new THREE.MeshStandardMaterial({ color: pal[i % pal.length], emissive: 0xffffff, emissiveMap: windows, emissiveIntensity: 0.9, roughness: 0.9 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(wd, hgt, wd), mat);
    b.position.set(Math.sin(a) * r, hgt / 2 - 3, -Math.abs(Math.cos(a)) * r - 4);
    g.add(b);
  }
  // water tank
  const tank = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x9c5a2e, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.5, 20), wood); body.position.y = 2.2; body.castShadow = true;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.7, 20), new THREE.MeshStandardMaterial({ color: 0x5a3a2a })); roof.position.y = 3.3;
  tank.add(body, roof);
  for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5), wood); l.position.set(x, 0.75, z); tank.add(l); }
  tank.position.set(-4.8, -0.35, -3.5);
  g.add(tank);
  // AC units + antenna with blinking light
  for (const [x, z] of [[4.6, -2.8], [5.4, -1.2]]) {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.9), new THREE.MeshStandardMaterial({ color: 0xc9c6d6, roughness: 0.5, metalness: 0.3 }));
    ac.position.set(x, 0.05, z); ac.castShadow = true; g.add(ac);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0x333344 }));
    fan.position.set(x, 0.47, z); g.add(fan);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 5), new THREE.MeshStandardMaterial({ color: 0x777788, metalness: 0.6 }));
  mast.position.set(3.8, 2.1, -5); g.add(mast);
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  blink.position.set(3.8, 4.65, -5); g.add(blink);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(6, 40), new THREE.MeshBasicMaterial({ color: 0xffd08a, fog: false }));
  sun.position.set(-8, 7, -60); g.add(sun);
  return {
    group: g, sky: skyDome(0x3a2a7a, 0xff8a5c, 0x3b2d5a), fog: new THREE.Fog(0xd4708a, 18, 65),
    hemi: [0xffd1b0, 0x3b2d5a, 1.3], sun: [0xffc38a, 2.6, [-4, 7, 4]], rim: [0xa08cff, 1.6],
    update: (t) => { blink.visible = Math.sin(t * 4) > 0; },
  };
}

function jungleStage() {
  const g = new THREE.Group();
  const grass = canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#3aa14a'; c.fillRect(0, 0, w, w);
    for (let i = 0; i < 900; i++) { c.fillStyle = `hsl(${105 + Math.random() * 30},${50 + Math.random() * 20}%,${28 + Math.random() * 18}%)`; c.fillRect(Math.random() * w, Math.random() * w, 3, 6); }
  }, { repeat: [8, 8] });
  const dirt = canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#b98a4e'; c.fillRect(0, 0, w, w);
    for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(80,50,20,${Math.random() * 0.25})`; c.beginPath(); c.arc(Math.random() * w, Math.random() * w, 2 + Math.random() * 5, 0, 7); c.fill(); }
  }, { repeat: [2, 2] });
  g.add(ground(0x5fbf5a, grass));
  g.add(platform(0xe0b77a, 0x7a5230, { texture: dirt }));
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.9 });
  const leafMats = [0x2f9e44, 0x40c057, 0x2b8a3e, 0x69db7c].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true }));
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
    if (Math.cos(a) > 0.5) continue;
    const r = 7 + Math.random() * 10;
    const tree = new THREE.Group();
    const hgt = 2.5 + Math.random() * 3;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, hgt, 8), trunkMat); trunk.position.y = hgt / 2; trunk.castShadow = true;
    tree.add(trunk);
    for (let k = 0; k < 3; k++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 - k * 0.2, 0), leafMats[(i + k) % 4]);
      leaf.position.set((Math.random() - 0.5) * 0.8, hgt + k * 0.6, (Math.random() - 0.5) * 0.8);
      leaf.castShadow = true;
      tree.add(leaf);
    }
    tree.position.set(Math.sin(a) * r, -0.35, Math.cos(a) * r);
    tree.scale.setScalar(0.9 + Math.random() * 0.6);
    g.add(tree);
  }
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.9, flatShading: true });
  for (let i = 0; i < 10; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.5, 0), rockMat);
    const a = Math.random() * Math.PI * 2;
    if (Math.cos(a) > 0.6) continue;
    rock.position.set(Math.sin(a) * (4 + Math.random() * 3), -0.2, Math.cos(a) * (4 + Math.random() * 3));
    rock.castShadow = true; g.add(rock);
  }
  // flowers
  const flowerCols = [0xff5fa2, 0xffd23f, 0xff8a1f, 0xffffff];
  for (let i = 0; i < 40; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: flowerCols[i % 4], emissive: flowerCols[i % 4], emissiveIntensity: 0.2 }));
    const a = Math.random() * Math.PI * 2, r = 3.8 + Math.random() * 6;
    f.position.set(Math.sin(a) * r, -0.28, Math.cos(a) * r); g.add(f);
  }
  // fireflies
  const flies = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xfff27a, size: 0.12, transparent: true, opacity: 0.9 }));
  const fp = new Float32Array(40 * 3);
  for (let i = 0; i < 40; i++) { fp[i * 3] = (Math.random() - 0.5) * 14; fp[i * 3 + 1] = 0.5 + Math.random() * 3; fp[i * 3 + 2] = -2 - Math.random() * 8; }
  flies.geometry.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  g.add(flies);
  return {
    group: g, sky: skyDome(0x4cc3ff, 0xc8f7d2, 0x2f9e44), fog: new THREE.Fog(0xb8ecc8, 14, 45),
    hemi: [0xe6fff0, 0x2f7a3e, 1.4], sun: [0xfff2c4, 2.7, [3, 8, 4]], rim: [0xffe9a8, 1.2],
    update: (t) => { flies.position.y = Math.sin(t * 0.8) * 0.2; flies.rotation.y = Math.sin(t * 0.2) * 0.1; },
  };
}

function spaceStage() {
  const g = new THREE.Group();
  const floor = canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#39406b'; c.fillRect(0, 0, w, w);
    c.strokeStyle = '#29d3ff'; c.lineWidth = 3; c.shadowColor = '#29d3ff'; c.shadowBlur = 8;
    c.strokeRect(4, 4, w - 8, w - 8);
    c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, w); c.moveTo(0, w / 2); c.lineTo(w, w / 2); c.stroke();
    c.shadowBlur = 0; c.fillStyle = '#4b5285';
    for (const [x, y] of [[20, 20], [w - 28, 20], [20, w - 28], [w - 28, w - 28]]) c.fillRect(x, y, 8, 8);
  }, { repeat: [3, 3] });
  g.add(ground(0x1e2244, null, -0.6));
  g.add(platform(0x8e97d6, 0x2b3060, { texture: floor, emissive: 0x112244 }));
  const stars = new THREE.BufferGeometry();
  const sp = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 10);
    if (v.y < -5) v.y = -v.y;
    sp.set([v.x, v.y, v.z], i * 3);
  }
  stars.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const starPts = new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, fog: false }));
  g.add(starPts);
  const planet = new THREE.Mesh(new THREE.SphereGeometry(7, 40, 24), new THREE.MeshStandardMaterial({ color: 0xff7ab8, emissive: 0x6a2050, emissiveIntensity: 0.5, roughness: 0.7, fog: false }));
  planet.position.set(14, 11, -45);
  const ring = new THREE.Mesh(new THREE.RingGeometry(9, 12.5, 64), new THREE.MeshBasicMaterial({ color: 0xffd6ec, side: THREE.DoubleSide, transparent: true, opacity: 0.6, fog: false }));
  ring.rotation.set(1.2, 0.3, 0); planet.add(ring);
  g.add(planet);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2, 24, 16), new THREE.MeshStandardMaterial({ color: 0xcfd6ff, emissive: 0x303a7a, fog: false }));
  moon.position.set(-16, 16, -40); g.add(moon);
  const pylons = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (i - 2.5) * 0.42;
    const p = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.6, 10), new THREE.MeshStandardMaterial({ color: 0xaab2e8, metalness: 0.7, roughness: 0.3 }));
    col.position.y = 1.3; col.castShadow = true;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x29d3ff : 0xff5fa2 }));
    orb.position.y = 2.8;
    p.add(col, orb);
    p.position.set(Math.sin(a) * 5.2, -0.6, Math.cos(a) * 5.2);
    pylons.push(orb);
    g.add(p);
  }
  return {
    group: g, sky: skyDome(0x05031a, 0x2a1a6b, 0x05031a), fog: new THREE.Fog(0x1a1250, 20, 80),
    hemi: [0xb7c4ff, 0x221a55, 1.2], sun: [0xffffff, 2.4, [2, 7, 5]], rim: [0xff5fa2, 2.2],
    update: (t) => { starPts.rotation.y = t * 0.01; planet.rotation.y = t * 0.05; pylons.forEach((o, i) => o.scale.setScalar(1 + Math.sin(t * 3 + i) * 0.2)); },
  };
}

function volcanoStage() {
  const g = new THREE.Group();
  const rock = canvasTexture(256, 256, (c, w) => {
    c.fillStyle = '#3b2a26'; c.fillRect(0, 0, w, w);
    c.strokeStyle = '#ff6a1a'; c.lineWidth = 3; c.shadowColor = '#ffae00'; c.shadowBlur = 10;
    for (let i = 0; i < 7; i++) {
      c.beginPath(); let x = Math.random() * w, y = Math.random() * w; c.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 70; y += (Math.random() - 0.5) * 70; c.lineTo(x, y); }
      c.stroke();
    }
  }, { repeat: [3, 3] });
  g.add(ground(0x2a1a17, rock));
  g.add(platform(0x8a6a5a, 0x3b2420, { texture: rock, emissive: 0x552200 }));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(14, 16, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x3a2320, roughness: 1, flatShading: true }));
  cone.position.set(-6, 7.5, -38);
  g.add(cone);
  const lavaTop = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
  lavaTop.rotation.x = -Math.PI / 2; lavaTop.position.set(-6, 14.6, -38); g.add(lavaTop);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff6a00, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(22, 14, 1); glow.position.set(-6, 16, -37.5); g.add(glow);
  const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff5a00 });
  for (const [x, z, r] of [[-5.5, 2, 1.4], [5, -1, 1.1], [6.5, 3.5, 0.9], [-4, -4.5, 1.2]]) {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(r, 24), lavaMat);
    pool.rotation.x = -Math.PI / 2; pool.position.set(x, -0.33, z); g.add(pool);
  }
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a3530, roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    if (Math.cos(a) > 0.55) continue;
    const r = 4.5 + Math.random() * 7;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + Math.random() * 0.9, 0), rockMat);
    m.position.set(Math.sin(a) * r, -0.1, Math.cos(a) * r); m.castShadow = true; g.add(m);
  }
  const embersGeo = new THREE.BufferGeometry();
  const ep = new Float32Array(120 * 3);
  for (let i = 0; i < 120; i++) { ep[i * 3] = (Math.random() - 0.5) * 20; ep[i * 3 + 1] = Math.random() * 8; ep[i * 3 + 2] = -Math.random() * 14; }
  embersGeo.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  const embers = new THREE.Points(embersGeo, new THREE.PointsMaterial({ color: 0xffa040, size: 0.1, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(embers);
  return {
    group: g, sky: skyDome(0x1a0505, 0xc2410c, 0x2a0a05), fog: new THREE.Fog(0x7a2410, 16, 60),
    hemi: [0xffb080, 0x3a1008, 1.25], sun: [0xffa060, 2.6, [-3, 7, 4]], rim: [0xff3300, 2.4],
    update: (t, dt) => {
      const a = embersGeo.attributes.position;
      for (let i = 0; i < a.count; i++) { let y = a.getY(i) + dt * (0.6 + (i % 5) * 0.2); if (y > 8) y = 0; a.setY(i, y); }
      a.needsUpdate = true;
      glow.material.opacity = 0.7 + Math.sin(t * 2) * 0.15;
    },
  };
}

const BUILDERS = { city: cityStage, jungle: jungleStage, space: spaceStage, volcano: volcanoStage };

export class Arena {
  constructor(container, stageId) {
    this.container = container;
    this.stageId = resolveStage(stageId);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.figures = [];
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
    const hemi = new THREE.HemisphereLight(st.hemi[0], st.hemi[1], st.hemi[2]);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(st.sun[0], st.sun[1]);
    sun.position.set(...st.sun[2]);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 1; sc.far = 25;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    this.scene.add(sun, sun.target);
    const rim = new THREE.DirectionalLight(st.rim[0], st.rim[1]);
    rim.position.set(-3, 4, -6);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(0, 2, 8);
    this.scene.add(fill);
    this.lights = { hemi, sun, rim, fill };
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
    return f;
  }

  slowmo(factor = 0.25, seconds = 1.2) { this.timeScale = factor; this.slowUntil = this.time + seconds; }
  shake(amount = 0.15) { this.shakeAmt = Math.max(this.shakeAmt, amount); }
  zoomPunch(amount = 1) { this.punch = Math.max(this.punch, amount); }

  frame(dtReal, tReal) {
    this.time += dtReal;
    if (this.slowUntil && this.time > this.slowUntil) { this.timeScale = 1; this.slowUntil = 0; }
    const dt = dtReal * this.timeScale;
    for (const f of this.figures) f.update(dt);
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
    else if (figs.length) for (const f of figs) box.expandByPoint(f.root.position);
    else box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const fr = this.framing;
    const span = Math.max(fr.minSpan, size.x + fr.extraSpan, size.z * 1.2 + fr.extraSpan);
    const aspect = this.camera.aspect || 1;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const figH = 2.4;
    let dist = Math.max((span / 2) / Math.tan(hfov / 2), (figH / 2) / Math.tan(vfov / 2) * 1.9) * 1.05 + size.z * 0.5;
    dist *= 1 - this.punch * 0.12;
    this.orbit = Math.sin(this.time * 0.13) * 0.16;
    const target = new THREE.Vector3(center.x, fr.lookY, center.z);
    const desired = new THREE.Vector3(
      target.x + Math.sin(this.orbit) * dist,
      target.y + dist * fr.height,
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
    // keep the shadow camera centred on the action
    this.lights.sun.target.position.set(center.x, 0, center.z);
    this.lights.sun.position.set(center.x + this.stage.sun[2][0], this.stage.sun[2][1], center.z + this.stage.sun[2][2]);
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
    this.fx.dispose();
    disposeScene(this.scene);
  }
}

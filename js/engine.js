// One shared WebGL renderer (iOS dislikes many contexts) that screens mount into,
// a frame loop that only runs while a 3D screen is visible, image-based lighting
// (one PMREM "studio room" per renderer, shared by every scene) and a thumbnail renderer.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildFigure } from './mesh.js';
import { canvasToBlob } from './capture.js';

// Khronos PBR Neutral keeps the toy photos' own colours (a red cape stays red, yellow stays
// yellow) while still rolling off bright highlights; ACES shifts saturated hues and AgX greys them.
export const TONE = { mapping: THREE.NeutralToneMapping, exposure: 1.0 };

let renderer = null;
let mountEl = null;
let ro = null;
let raf = 0;
let last = 0;
let frameFn = null;
let size = { w: 1, h: 1 };
let resizeFns = new Set();

function configure(r) {
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = TONE.mapping;
  r.toneMappingExposure = TONE.exposure;
}

export function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  configure(renderer);
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap was removed in three r18x; PCF + shadow.radius is its soft replacement.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stopLoop(); dropEnvironment(renderer); });
  renderer.domElement.addEventListener('webglcontextrestored', () => { refreshEnvironment(renderer); if (frameFn) startLoop(frameFn); });
  return renderer;
}

export function maxAniso() { return getRenderer().capabilities.getMaxAnisotropy(); }

let software = null;
/** True when WebGL runs on the CPU (SwiftShader / llvmpipe: blocklisted GPUs, headless test browsers). */
export function softwareGL(r = getRenderer()) {
  if (software === null) {
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    software = /swiftshader|llvmpipe|software/i.test(String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)));
  }
  return software;
}

/** Shadow-map size the device can afford: 2048 on real GPUs with big textures, else 1024. */
export function shadowMapSize(r = getRenderer()) { return r.capabilities.maxTextureSize >= 4096 && !softwareGL(r) ? 2048 : 1024; }

// ---------- image-based lighting ----------
const envCache = new Map();   // renderer → PMREM render target
const envScenes = new Map();  // scene → renderer (so a lost context can re-light them)

function buildEnvironment(r) {
  const pmrem = new THREE.PMREMGenerator(r);
  const room = new RoomEnvironment();
  const target = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  target.texture.userData.shared = true; // disposeScene must never free it
  return target;
}
function dropEnvironment(r) { envCache.get(r)?.dispose(); envCache.delete(r); }
function refreshEnvironment(r) {
  dropEnvironment(r);
  const tex = getEnvironment(r);
  for (const [scene, owner] of envScenes) if (owner === r) scene.environment = tex;
}

/** The shared studio environment map for a renderer (built once, lazily). */
export function getEnvironment(r = getRenderer()) {
  let target = envCache.get(r);
  if (!target) { target = buildEnvironment(r); envCache.set(r, target); }
  return target.texture;
}

/** Light a scene with the shared environment (soft studio reflections on every PBR material). */
export function applyEnvironment(scene, intensity = 0.6, r = getRenderer()) {
  scene.environment = getEnvironment(r);
  scene.environmentIntensity = intensity;
  envScenes.set(scene, r);
  return scene.environment;
}

/**
 * Studio lighting for a small turntable / thumbnail scene: sky-ground hemisphere fill, a warm key
 * light (optionally casting soft shadows onto an optional shadow-catcher floor), a cool rim light
 * for toy-box separation, plus the shared environment.
 * @returns {{ hemi: THREE.HemisphereLight, key: THREE.DirectionalLight, rim: THREE.DirectionalLight, floor: THREE.Mesh|null }}
 */
export function studioLights(scene, { renderer: r = getRenderer(), shadow = true, floor = false, envIntensity = 0.7, height = 1.6 } = {}) {
  applyEnvironment(scene, envIntensity, r);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x5a48b0, 1.05);
  const key = new THREE.DirectionalLight(0xfff2e0, 2.5);
  key.position.set(2.2, height * 2.6, 3.6);
  const rim = new THREE.DirectionalLight(0x9fd0ff, 2.3);
  rim.position.set(-3, height * 1.8, -3.5);
  scene.add(hemi, key, key.target, rim);
  if (shadow) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    const e = Math.max(1.6, height * 1.4);
    sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.near = 0.5; sc.far = 14;
    sc.updateProjectionMatrix();
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    key.shadow.radius = 3;
  }
  let catcher = null;
  if (floor) {
    catcher = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.ShadowMaterial({ opacity: 0.32, color: 0x1a1030 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.receiveShadow = true;
    scene.add(catcher);
  }
  return { hemi, key, rim, floor: catcher };
}

/** Put the renderer canvas inside `el` and keep it sized. */
export function mount(el) {
  const r = getRenderer();
  mountEl = el;
  el.append(r.domElement);
  ro?.disconnect();
  ro = new ResizeObserver(() => resize());
  ro.observe(el);
  resize();
  return r.domElement;
}
function resize() {
  if (!mountEl) return;
  const w = Math.max(1, mountEl.clientWidth), h = Math.max(1, mountEl.clientHeight);
  size = { w, h };
  getRenderer().setSize(w, h, false);
  for (const fn of resizeFns) fn(w, h);
}
export function onResize(fn) { resizeFns.add(fn); fn(size.w, size.h); return () => resizeFns.delete(fn); }
export const viewSize = () => size;

export function unmount() {
  stopLoop();
  ro?.disconnect(); ro = null;
  resizeFns = new Set();
  if (renderer?.domElement.parentNode) renderer.domElement.remove();
  mountEl = null;
  frameFn = null;
}

export function startLoop(fn) {
  frameFn = fn;
  cancelAnimationFrame(raf);
  last = performance.now();
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (document.hidden) return;
    frameFn?.(dt, now / 1000);
  };
  raf = requestAnimationFrame(tick);
}
export function stopLoop() { cancelAnimationFrame(raf); raf = 0; }

export function disposeScene(scene) {
  envScenes.delete(scene);
  scene.traverse((o) => {
    if (o.isLight && o.shadow) o.shadow.dispose(); // shadow-map render targets are GPU textures too
    if (o.isInstancedMesh) o.dispose();            // frees the per-instance matrix/colour buffers
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const k of Object.keys(m)) if (m[k]?.isTexture && !m[k].userData?.shared) m[k].dispose();
        m.dispose();
      }
    }
  });
  if (scene.background?.isTexture && !scene.background.userData?.shared) scene.background.dispose();
}

// ---------- thumbnails: render a figure once, cache as PNG ----------
let thumbR = null;
export async function renderThumb(toy) {
  if (!thumbR) {
    thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbR.setPixelRatio(1);
    thumbR.setSize(320, 400, false);
    configure(thumbR);
    thumbR.setClearColor(0x000000, 0);
  }
  const scene = new THREE.Scene();
  const fig = await buildFigure(toy, { maxAniso: thumbR.capabilities.getMaxAnisotropy() });
  const hgt = fig.height;
  studioLights(scene, { renderer: thumbR, shadow: false, envIntensity: 0.75, height: hgt });
  fig.object.rotation.y = -0.38;
  scene.add(fig.object);
  const cam = new THREE.PerspectiveCamera(30, 320 / 400, 0.1, 50);
  const dist = Math.max(hgt / 0.83, fig.width * 1.25 / 0.83) / (2 * Math.tan(THREE.MathUtils.degToRad(15))) * 0.95;
  cam.position.set(0.25, hgt * 0.62, dist);
  cam.lookAt(0, hgt * 0.47, 0);
  thumbR.render(scene, cam);
  const blob = await canvasToBlob(thumbR.domElement, 'image/png');
  fig.dispose();
  disposeScene(scene);
  return blob;
}

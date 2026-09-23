// One shared WebGL renderer (iOS dislikes many contexts) that screens mount into,
// a frame loop that only runs while a 3D screen is visible, and a thumbnail renderer.

import * as THREE from 'three';
import { buildFigure } from './mesh.js';
import { canvasToBlob } from './capture.js';

let renderer = null;
let mountEl = null;
let ro = null;
let raf = 0;
let last = 0;
let frameFn = null;
let size = { w: 1, h: 1 };
let resizeFns = new Set();

export function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stopLoop(); });
  renderer.domElement.addEventListener('webglcontextrestored', () => { if (frameFn) startLoop(frameFn); });
  return renderer;
}

export function maxAniso() { return getRenderer().capabilities.getMaxAnisotropy(); }

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
  scene.traverse((o) => {
    if (o.isLight && o.shadow) o.shadow.dispose(); // shadow-map render targets are GPU textures too
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
  if (scene.background?.isTexture) scene.background.dispose();
}

// ---------- thumbnails: render a figure once, cache as PNG ----------
let thumbR = null;
export async function renderThumb(toy) {
  if (!thumbR) {
    thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbR.setPixelRatio(1);
    thumbR.setSize(320, 400, false);
    thumbR.outputColorSpace = THREE.SRGBColorSpace;
    thumbR.toneMapping = THREE.ACESFilmicToneMapping;
    thumbR.setClearColor(0x000000, 0);
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6655aa, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 3, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x99ccff, 2.0); rim.position.set(-3, 2, -3); scene.add(rim);
  const fig = await buildFigure(toy, { maxAniso: thumbR.capabilities.getMaxAnisotropy() });
  fig.object.rotation.y = -0.38;
  scene.add(fig.object);
  const cam = new THREE.PerspectiveCamera(30, 320 / 400, 0.1, 50);
  const hgt = fig.height;
  const dist = Math.max(hgt / 0.83, fig.width * 1.25 / 0.83) / (2 * Math.tan(THREE.MathUtils.degToRad(15))) * 0.95;
  cam.position.set(0.25, hgt * 0.62, dist);
  cam.lookAt(0, hgt * 0.47, 0);
  thumbR.render(scene, cam);
  const blob = await canvasToBlob(thumbR.domElement, 'image/png');
  fig.dispose();
  disposeScene(scene);
  return blob;
}

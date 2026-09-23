// Toy Arena service worker: precache the app shell, runtime-cache CDN libraries,
// fonts and the cutout model so everything works offline after the first visit.

const VERSION = 'v1.0.0';
const SHELL_CACHE = `toy-arena-shell-${VERSION}`;
const RUNTIME_CACHE = 'toy-arena-runtime-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'js/app.js',
  'js/arena.js',
  'js/audio.js',
  'js/battle.js',
  'js/capture.js',
  'js/cutout.js',
  'js/db.js',
  'js/dummies.js',
  'js/engine.js',
  'js/figure.js',
  'js/fx.js',
  'js/hud.js',
  'js/mesh.js',
  'js/play.js',
  'js/segment.js',
  'js/ui.js',
  'js/core/backup.js',
  'js/core/battle-logic.js',
  'js/core/contour.js',
  'js/core/mask.js',
  'js/core/stats.js',
  'js/screens/add.js',
  'js/screens/home.js',
  'js/screens/pick.js',
  'js/screens/toys.js',
];

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35';
const WARM = [
  'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.core.js',
  `${MP}/vision_bundle.mjs`,
  `${MP}/wasm/vision_wasm_internal.js`,
  `${MP}/wasm/vision_wasm_internal.wasm`,
  'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite',
];
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('toy-arena-shell-') && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'warm') return;
  event.waitUntil((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    for (const url of WARM) {
      try {
        if (await cache.match(url)) continue;
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (res.ok) await cache.put(url, res);
      } catch { /* offline — try again next visit */ }
    }
  })());
});

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(request, { ignoreVary: true }) || await cache.match(request.url, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone()).catch(() => {});
  return res;
}

async function shell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (cached) { network.catch(() => {}); return cached; } // stale-while-revalidate
  const res = await network;
  if (res) return res;
  if (request.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
  return Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(fetch(request).catch(async () => (await caches.open(SHELL_CACHE)).match('index.html')));
      return;
    }
    event.respondWith(shell(request));
    return;
  }
  if (RUNTIME_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(request));
});

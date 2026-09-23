// Cut the toy out of the photo.
//  1) MediaPipe InteractiveSegmenter (magic_touch) with a few keypoints, best mask wins.
//  2) Fallback: border-colour flood fill (works for a toy on a plain table / wall).
// Masks are produced at a "work" resolution (≤ 512 px long side).

import { scaledCanvas } from './capture.js';
import {
  thresholdMask, cleanMask, scoreMask, backgroundFloodMask, componentAt, resizeBilinear, maskArea,
} from './core/mask.js';

export const MP_VERSION = '0.10.35';
export const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
export const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite';
export const WORK_SIDE = 512;

let segPromise = null;

// MediaPipe's WASM runtime prints glog INFO/WARNING lines through console.error.
// Route just those benign lines to console.debug; real errors (E-level, exceptions) pass through.
const MP_CHATTER = /^(INFO:|[IW]\d{4} |Graph successfully started|Created TensorFlow Lite)/;
let quietDepth = 0;
const realConsole = { error: console.error, warn: console.warn, log: console.log, info: console.info };
function quiet(on) {
  quietDepth += on ? 1 : -1;
  if (quietDepth === 1 && on) {
    for (const k of Object.keys(realConsole)) {
      console[k] = (...a) => (typeof a[0] === 'string' && MP_CHATTER.test(a[0]) ? console.debug(...a) : realConsole[k].apply(console, a));
    }
  } else if (quietDepth === 0) Object.assign(console, realConsole);
}
async function quietly(fn) { quiet(true); try { return await fn(); } finally { quiet(false); } }
let segFailed = false;

function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);
}

/** Force the fallback path (settings / tests): ?cutout=simple */
export function aiDisabled() {
  return segFailed || new URLSearchParams(location.search).get('cutout') === 'simple';
}

export function loadSegmenter() {
  if (aiDisabled()) return Promise.reject(new Error('ai disabled'));
  if (!segPromise) {
    segPromise = quietly(async () => {
      const { FilesetResolver, InteractiveSegmenter } = await import(`${MP_BASE}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      return InteractiveSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MP_MODEL, delegate: 'CPU' },
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    });
    segPromise.catch(() => { segFailed = true; segPromise = null; });
  }
  return segPromise;
}

/** Run the model for one region of interest; returns a Float32Array foreground probability at work res. */
function runModel(seg, image, roi, ww, wh) {
  let out = null;
  quiet(true);
  try {
  seg.segment(image, roi, (res) => {
    const m = res.confidenceMasks?.[0];
    if (!m) return;
    const f = m.getAsFloat32Array();
    out = m.width === ww && m.height === wh ? new Float32Array(f) : resizeBilinear(f, m.width, m.height, ww, wh);
  });
  } finally { quiet(false); }
  if (!out) throw new Error('no mask');
  return out;
}

/**
 * Automatic cutout. Returns a "cut session" object that the tap-to-fix UI keeps using:
 * { work (canvas), w, h, mask, method: 'ai'|'simple', score }
 */
export async function autoCutout(photo, { onStatus = () => {}, modelTimeout = 30000 } = {}) {
  const work = scaledCanvas(photo, WORK_SIDE);
  const w = work.width, h = work.height;
  const session = { photo, work, w, h, mask: null, method: 'simple', score: 0, fallbackRaw: null };

  let seg = null;
  if (!aiDisabled()) {
    try {
      onStatus('ready');
      seg = await withTimeout(loadSegmenter(), modelTimeout, 'model');
    } catch (e) {
      console.info('[toy-arena] smart cutout unavailable, using simple cutout:', e.message);
    }
  }
  if (seg) {
    onStatus('cutting');
    try {
      const candidates = [];
      for (const [x, y] of [[0.5, 0.5], [0.5, 0.4], [0.5, 0.62], [0.45, 0.5], [0.55, 0.5]]) {
        const conf = runModel(seg, photo, { keypoint: { x, y } }, w, h);
        const m = cleanMask(thresholdMask(conf, w, h, 0.5), w, h);
        const s = scoreMask(m, w, h);
        candidates.push({ m, s: s.score });
        await new Promise(r => setTimeout(r, 0)); // keep the UI breathing
      }
      candidates.sort((a, b) => b.s - a.s);
      if (candidates[0].s > 0.2) {
        Object.assign(session, { mask: candidates[0].m, method: 'ai', score: candidates[0].s, seg });
      }
    } catch (e) {
      console.info('[toy-arena] smart cutout failed, using simple cutout:', e.message);
    }
  }
  const simple = () => {
    const g = work.getContext('2d', { willReadFrequently: true });
    const px = g.getImageData(0, 0, w, h).data;
    const raw = backgroundFloodMask(px, w, h);
    const m = cleanMask(raw, w, h);
    return { raw, m, s: scoreMask(m, w, h).score };
  };
  if (!session.mask) {
    onStatus('cutting');
    const r = simple();
    Object.assign(session, { mask: r.m, method: 'simple', score: r.s, fallbackRaw: r.raw });
  }
  if (!session.mask || maskArea(session.mask) < w * h * 0.01) {
    // Nothing plausible: keep a centred oval so the kid can fix it with taps / brush.
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (((x - w / 2) / (w * 0.3)) ** 2 + ((y - h / 2) / (h * 0.4)) ** 2 < 1) m[y * w + x] = 1;
    }
    Object.assign(session, { mask: m, score: 0 });
  }
  return session;
}

/**
 * Tap-to-fix: re-select the toy from a tap (x, y in work pixels) or a scribble (array of points).
 * Returns the new mask (session.mask is updated).
 */
export async function reselect(session, points) {
  const { w, h } = session;
  const pts = points.map(([x, y]) => ({ x: Math.min(0.999, Math.max(0, x / w)), y: Math.min(0.999, Math.max(0, y / h)) }));
  if (session.method === 'ai' && session.seg) {
    try {
      const roi = pts.length > 1 ? { scribble: pts } : { keypoint: pts[0] };
      const conf = runModel(session.seg, session.photo, roi, w, h);
      const m = cleanMask(thresholdMask(conf, w, h, 0.5), w, h);
      if (maskArea(m) > w * h * 0.003) { session.mask = m; return m; }
    } catch (e) { console.info('[toy-arena] reselect fell back:', e.message); }
  }
  // simple mode: pick the blob under the finger from the raw background-removed mask
  if (!session.fallbackRaw) {
    const px = session.work.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    session.fallbackRaw = backgroundFloodMask(px, w, h);
  }
  const [x, y] = points[0];
  const m = cleanMask(componentAt(session.fallbackRaw, w, h, x, y), w, h);
  if (maskArea(m) > 0) session.mask = m;
  return session.mask;
}

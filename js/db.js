// IndexedDB toy box. Photos are stored as Blobs and never leave the device.

const DB_NAME = 'toy-arena';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('toys')) db.createObjectStore('toys', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => { dbp = null; reject(req.error); };
    req.onblocked = () => reject(new Error('Database blocked'));
  });
  return dbp;
}

async function tx(mode, fn, retry = true) {
  try { return await txOnce(mode, fn); } catch (e) {
    // iOS can drop the IndexedDB connection while the app is in the background: reopen once.
    if (!retry || !['UnknownError', 'InvalidStateError', 'AbortError'].includes(e?.name)) throw e;
    try { (await dbp)?.close(); } catch { /* ignore */ }
    dbp = null;
    return tx(mode, fn, false);
  }
}
async function txOnce(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction('toys', mode);
    const store = t.objectStore('toys');
    let result;
    Promise.resolve(fn(store)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}
const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// Images are stored as { buf: ArrayBuffer, type } rather than Blobs: Safari refuses Blobs in
// IndexedDB in private/ephemeral sessions, ArrayBuffers work everywhere.
const BLOB_KEYS = ['frontBlob', 'backBlob', 'thumbBlob'];
async function pack(toy) {
  const rec = { ...toy };
  for (const k of BLOB_KEYS) {
    const b = toy[k];
    if (b instanceof Blob) rec[k] = { buf: await b.arrayBuffer(), type: b.type || 'image/png' };
  }
  return rec;
}
function unpack(rec) {
  if (!rec) return rec;
  for (const k of BLOB_KEYS) {
    const v = rec[k];
    if (v && !(v instanceof Blob) && v.buf) rec[k] = new Blob([v.buf], { type: v.type });
  }
  return rec;
}

export async function allToys() {
  const toys = ((await tx('readonly', s => req2p(s.getAll()))) || []).map(unpack);
  return toys.sort((a, b) => (a.builtin === b.builtin ? (a.createdAt || 0) - (b.createdAt || 0) : a.builtin ? 1 : -1));
}
export const getToy = async (id) => unpack(await tx('readonly', s => req2p(s.get(id))));
export async function putToy(toy) {
  toy.updatedAt = Date.now();
  const rec = await pack(toy);
  await tx('readwrite', s => { s.put(rec); });
  return toy;
}
export const deleteToy = (id) => tx('readwrite', s => { s.delete(id); });
export async function putMany(toys) {
  const recs = await Promise.all(toys.map(pack));
  await tx('readwrite', s => { for (const r of recs) s.put(r); });
  return toys.length;
}

export async function updateToy(id, patch) {
  const toy = await getToy(id);
  if (!toy) return null;
  Object.assign(toy, patch);
  await putToy(toy);
  return toy;
}

export async function requestPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* not supported */ }
}

export function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
}

// ---------- settings (small, synchronous, per device) ----------
const SKEY = 'toyArena.settings.v1';
const DEFAULTS = { ownerName: '', setupDone: false, muted: false, difficulty: 'easy', lastStage: 'random' };
let cache = null;
export function settings() {
  if (!cache) {
    try { cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch { cache = { ...DEFAULTS }; }
  }
  return cache;
}
export function saveSettings(patch) {
  Object.assign(settings(), patch);
  try { localStorage.setItem(SKEY, JSON.stringify(cache)); } catch { /* private mode */ }
  return cache;
}

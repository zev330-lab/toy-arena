// Backup format: one JSON file, images inlined as data URLs.
// Blob <-> dataURL conversion is injected so this stays testable in node.

export const BACKUP_APP = 'toy-arena';
export const BACKUP_VERSION = 1;
export const BLOB_FIELDS = ['frontBlob', 'backBlob', 'thumbBlob'];

export async function serializeBackup(toys, blobToDataURL, { ownerName = '' } = {}) {
  const out = [];
  for (const toy of toys) {
    const rec = {};
    for (const [k, v] of Object.entries(toy)) {
      if (BLOB_FIELDS.includes(k)) continue;
      rec[k] = v;
    }
    for (const k of BLOB_FIELDS) {
      if (toy[k]) rec[k.replace('Blob', 'Data')] = await blobToDataURL(toy[k]);
    }
    out.push(rec);
  }
  return JSON.stringify({ app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), ownerName, toys: out });
}

/**
 * Parse a backup file. Returns { toys, ownerName, skipped }.
 * Throws a friendly Error when the file isn't a Toy Arena backup at all.
 */
export async function deserializeBackup(text, dataURLToBlob) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('That file is not a Toy Arena backup.'); }
  if (!data || data.app !== BACKUP_APP || !Array.isArray(data.toys)) throw new Error('That file is not a Toy Arena backup.');
  if (data.version > BACKUP_VERSION) throw new Error('This backup is from a newer version of Toy Arena.');
  const toys = [];
  let skipped = 0;
  for (const rec of data.toys) {
    if (!rec || typeof rec.id !== 'string' || typeof rec.name !== 'string' || !rec.frontData && !rec.builtin) { skipped++; continue; }
    const toy = {};
    for (const [k, v] of Object.entries(rec)) {
      if (/Data$/.test(k) && BLOB_FIELDS.includes(k.replace('Data', 'Blob'))) continue;
      toy[k] = v;
    }
    for (const k of BLOB_FIELDS) {
      const d = rec[k.replace('Blob', 'Data')];
      toy[k] = d ? await dataURLToBlob(d) : null;
    }
    toys.push(toy);
  }
  return { toys, ownerName: typeof data.ownerName === 'string' ? data.ownerName : '', skipped };
}

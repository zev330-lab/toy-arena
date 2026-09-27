// Grown-ups' "Many Photos": pick a pile of photos from the library and every one that shows a toy
// becomes a toy (automatic cutout, skeleton, fun unique name, random power, card).

import { busy, toast, modal, confetti } from '../ui.js';
import { go } from '../app.js';
import * as db from '../db.js';
import { pickPhotos, fileToCanvas, canvasToBlob } from '../capture.js';
import { autoCutout, loadSegmenter, aiDisabled } from '../segment.js';
import { makeCutout } from '../cutout.js';
import { POWERS, deriveStats, randomName } from '../core/stats.js';
import { autoRig } from '../core/rig.js';
import { THUMB_V } from '../core/versions.js';
import { sfx } from '../audio.js';

const MAX = 40; // one batch; more photos = pick again

function alphaOf(canvas) {
  const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  const a = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3];
  return a;
}

/** Must be called straight from a tap (iOS only opens the photo picker inside a user gesture). */
export async function bulkAdd() {
  if (!aiDisabled()) loadSegmenter().catch(() => {}); // start the model while the picker is open
  const picked = await pickPhotos();
  const files = picked.slice(0, MAX);
  if (!files.length) return 0;
  let stopped = false;
  const b = busy(`Making toy 1 of ${files.length}…`, { emoji: '🪄', onStop: () => { stopped = true; b.set('Stopping…'); } });
  let made = 0, skipped = 0;
  try {
    const taken = new Set((await db.allToys()).map(t => t.name));
    const { renderThumb } = await import('../engine.js');
    for (const [i, file] of files.entries()) {
      if (stopped) break;
      b.set(`Making toy ${i + 1} of ${files.length}…`, i / files.length);
      try {
        const photo = await fileToCanvas(file, 1024);
        const session = await autoCutout(photo);
        // score 0 = no toy found (a placeholder oval meant for the Fix step): skip, don't save it
        if (!session.score || (session.method === 'simple' && session.score < 0.2)) { skipped++; continue; }
        const cut = makeCutout(session.photo, session.mask, session.w, session.h);
        let name = randomName();
        for (let k = 0; k < 12 && taken.has(name); k++) name = randomName(Math.random, name);
        taken.add(name);
        const toy = {
          id: db.newId(), name, power: POWERS[Math.floor(Math.random() * POWERS.length)].id,
          stats: deriveStats(cut.features, cut.hash), createdAt: Date.now(), wins: 0, losses: 0, xp: 0, builtin: false, hidden: false,
          width: cut.width, height: cut.height, contour: cut.contour, outline: cut.outline, edgeColor: cut.edgeColor,
          frontBlob: await canvasToBlob(cut.canvas), backBlob: null, rig: autoRig(alphaOf(cut.canvas), cut.width, cut.height), thumbBlob: null,
        };
        toy.thumbBlob = await renderThumb(toy);
        toy.thumbV = THUMB_V;
        await db.putToy(toy);
        made++;
      } catch (e) { skipped++; console.warn('[toy-arena] bulk photo skipped', e); }
    }
  } catch (e) {
    console.error('[toy-arena] bulk add', e);
    b.close();
    await modal({ emoji: '😵', title: 'Uh-oh!', text: 'Couldn’t make toys from those photos. Let’s try again!', actions: [{ emoji: '👍', label: 'OK', cls: 'yellow', value: true }] });
    return made;
  }
  b.close();
  db.requestPersist();
  if (!made) {
    if (!stopped) await modal({ emoji: '🙈', title: 'Oops!', text: 'No toys found in those photos. Try photos where the toy stands out!', actions: [{ emoji: '👍', label: 'OK', cls: 'yellow', value: true }] });
    return 0;
  }
  sfx.fanfare();
  confetti(document.getElementById('app'), 80);
  const extra = [skipped ? `${skipped} skipped` : '', picked.length > MAX ? `first ${MAX} photos` : ''].filter(Boolean).join(', ');
  toast(`🎉 ${made} new toy${made === 1 ? '' : 's'}!${extra ? ` (${extra})` : ''}`);
  go('toys', {}, { reset: true });
  return made;
}

# Toy Arena — handoff

## Purpose
Kids' phone game (target: a 6-year-old on an iPhone). Photograph real action figures → automatic
cutout → auto-rigged, puffy, jointed 3D puppet (no base: it walks, punches, kicks, dances) →
collection → Battle (vs CPU / 2 players) or Play (friendly actions) in a 3D arena. Zero reading
required to play; big bright tactile UI; no dead ends. Figure pipeline: `docs/PUPPETS.md`.

## Hard rules
- Static site, no build step. Libraries only from `cdn.jsdelivr.net/npm/` with pinned versions
  (three 0.186.0 via import map in `index.html`; @mediapipe/tasks-vision 0.10.35 in `js/segment.js`
  and `sw.js`). Fonts from Google Fonts. Nothing else external.
- No server, no accounts, no analytics, no paid APIs. Photos stay in IndexedDB on the device.
- Never hard-code the child's name (a unit test greps for it). Owner name comes from the first-launch
  "Who's the Toy Master?" screen / grown-ups panel.
- Kid-appropriate: cartoon action only (POW bubbles, stars, flop-and-bow KO). No blood/scary content.
- Live: https://zev330-lab.github.io/toy-arena/ (GitHub Pages from `main`, repo zev330-lab/toy-arena, public — owner approved 2026-09-22). Every push to `main` deploys; bump the SW cache version when shell files change.
- The repo is public: never commit real toy photos (`test/photos/` is git-ignored) or the child's name.
- Tests must be silent (see `js/audio.js` webdriver guard + `SILENCE` in e2e). Never run WebKit tests on the owner's Mac.

## Architecture
- `index.html` — shell, import map, boot splash. `css/app.css` — all styling (comic/toy-box tokens at top).
- `js/app.js` — boot, screen router (`go/back`, back stack + history for Android back), toy loading,
  training-dummy seeding, SW registration. Exposes `window.__toyArena` for tests.
- `js/screens/` — `home.js` (setup, home, grown-ups settings, backup/restore), `add.js` (capture →
  cutout → fix → back photo → name → power → reveal; also retake), `toys.js` (collection, detail,
  `Turntable`), `pick.js` (fighters, arena, VS splash).
- `js/battle.js`, `js/play.js` — arena screens. `js/hud.js` — POW bubbles/banners.
- `js/arena.js` — stages + `Arena` (scene, lights, camera director, slow-mo, shake, projection).
- `js/engine.js` — single shared WebGLRenderer mounted per screen, frame loop, thumbnail renderer.
- `js/mesh.js` — toy record → skinned puppet (inflated front/back photo surfaces + skinned ink outline).
  `js/figure.js` — layered procedural animation on the bones (stance, walk/run, punch, kick, block,
  hit, flop KO, jump, dances, hug, high five…; feet planted; legless toys hop). `js/fx.js` — particles/effects.
- `js/core/rig.js` — auto-rig: silhouette → skeleton → joints (feet/pelvis/spine/arms/head/appendages;
  merged arms and legs are split off the silhouette). `js/core/puppet.js` — marching-squares mesh,
  Poisson inflation, geodesic skin weights. Both pure + unit-tested.
- `js/dummies.js` — built-in sparring partners Mega Bot + Kapow Kid (canvas-drawn, front + back views);
  the v1 dummies (Robo Buddy, Blobby Monster) are deleted on boot (`RETIRED_IDS`).
- `js/capture.js`, `js/segment.js`, `js/cutout.js`, `js/dummies.js` — photo → cutout pipeline.
- `js/core/*.js` — pure logic, no DOM, unit-tested with `node --test`.
- `sw.js` — shell precache (list must include every file; `test/unit/sw.test.js` enforces it) +
  runtime cache for CDN/model/fonts + `warm` message to prefetch the model.

Toy record (IndexedDB `toys`): `id, name, power, stats{power,speed,defense}, createdAt, wins, losses,
xp, builtin, hidden, width, height, contour{shapes[{outer,holes}]}, outline{…}, edgeColor,
frontBlob, backBlob, thumbBlob, thumbV, rig{v,auto,kind,w,h,joints{name:{x,y,parent}}}, dummyV`.
Old records without `rig`/`thumbV` are fine: the rig is computed on load and cards re-render once
(`THUMB_V` in mesh.js). Updates never touch photos/stats; the only deletion is the retired dummies.

## How to test
```bash
npm test                                   # unit tests (52)
python3 -m http.server 18431 --bind 127.0.0.1 &   # serve (8765/8777 are often taken by other apps on this Mac)
BASE=http://127.0.0.1:18431/ node test/e2e.mjs    # full iPhone-emulated E2E, screenshots in test/screenshots/
BASE=… ONLY=01,02 node test/e2e.mjs               # subset (steps 06+ depend on toys made in 02/03)
BASE=… node test/look.mjs outDir                  # frozen-clock pose snapshots (stance, punch, kick, block, super)
BASE=… node test/rigdebug.mjs outDir              # every toy's auto-rig + skin-weight map as PNGs
```
Check which app a port serves before trusting a run (`curl -s localhost:PORT | grep title`).
Look at the screenshots after UI changes — visual quality is part of acceptance.

## Known limits / open items
- Auto-rig verified on drawn characters + synthetic shapes only; real toy photos not yet run through it
  (a backup file from the family iPad would be the test set — keep it in git-ignored test/photos/).
  Hard cases: arms pressed to the body (split from the silhouette's wide rows), feet touching (legs
  split down the middle), non-humanoids (become 'blob' rigs that hop). No joint editor yet.
- Toys are per-device (no server by design). Moving toys = Grown-ups → Backup Save → AirDrop → Restore
  (restore adds/updates by id, never deletes).
- Smart cutout verified in headless Chromium (CPU delegate) with generated photos; not yet run on a
  physical iPhone or on real toy photos (`test/photos/` is empty). Expect to tune on real photos.
- The model tends to include narrow background gaps (between legs, between claws). Kids/parents
  can fix with tap/erase; an automatic colour-based refinement was tried and removed because it
  also ate skin-coloured faces and silver claws.
- Speech-to-text name entry only appears where `webkitSpeechRecognition` exists (not testable headless).
- No round timer (optional in the brief; rounds end on KO only).
- `navigator.vibrate` is a no-op on iOS by design.

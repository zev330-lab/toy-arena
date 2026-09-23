# Toy Arena — handoff

## Purpose
Kids' phone game (target: a 6-year-old on an iPhone). Photograph real action figures → automatic
cutout → 3D standee figure → collection → Battle (vs CPU / 2 players) or Play (friendly actions)
in a 3D arena. Zero reading required to play; big bright tactile UI; no dead ends.

## Hard rules
- Static site, no build step. Libraries only from `cdn.jsdelivr.net/npm/` with pinned versions
  (three 0.186.0 via import map in `index.html`; @mediapipe/tasks-vision 0.10.35 in `js/segment.js`
  and `sw.js`). Fonts from Google Fonts. Nothing else external.
- No server, no accounts, no analytics, no paid APIs. Photos stay in IndexedDB on the device.
- Never hard-code the child's name (a unit test greps for it). Owner name comes from the first-launch
  "Who's the Toy Master?" screen / grown-ups panel.
- Kid-appropriate: cartoon action only (POW bubbles, stars, flop-and-bow KO). No blood/scary content.
- Do not publish/deploy or create a remote without the owner's approval.

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
- `js/mesh.js` — toy record → extruded figure. `js/figure.js` — procedural animation. `js/fx.js` — particles/effects.
- `js/capture.js`, `js/segment.js`, `js/cutout.js`, `js/dummies.js` — photo → cutout pipeline.
- `js/core/*.js` — pure logic, no DOM, unit-tested with `node --test`.
- `sw.js` — shell precache (list must include every file; `test/unit/sw.test.js` enforces it) +
  runtime cache for CDN/model/fonts + `warm` message to prefetch the model.

Toy record (IndexedDB `toys`): `id, name, power, stats{power,speed,defense}, createdAt, wins, losses,
xp, builtin, hidden, width, height, contour{shapes[{outer,holes}]}, outline{…}, edgeColor,
frontBlob, backBlob, thumbBlob`.

## How to test
```bash
npm test                                   # unit tests (37)
python3 -m http.server 8765 &              # serve
node test/e2e.mjs                          # full iPhone-emulated E2E, screenshots in test/screenshots/
ONLY=01,02 node test/e2e.mjs               # subset (steps 07+ depend on toys made in 02/03)
```
Look at the screenshots after UI changes — visual quality is part of acceptance.

## Known limits / open items
- Smart cutout verified in headless Chromium (CPU delegate) with generated photos; not yet run on a
  physical iPhone or on real toy photos (`test/photos/` is empty). Expect to tune on real photos.
- The model tends to include narrow background gaps (between legs, between claws). Kids/parents
  can fix with tap/erase; an automatic colour-based refinement was tried and removed because it
  also ate skin-coloured faces and silver claws.
- Speech-to-text name entry only appears where `webkitSpeechRecognition` exists (not testable headless).
- No round timer (optional in the brief; rounds end on KO only).
- `navigator.vibrate` is a no-op on iOS by design.

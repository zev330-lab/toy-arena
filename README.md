# Toy Arena

A phone game for young kids: snap a photo of a real action figure, the app cuts the toy out,
turns it into a chunky 3D figure, keeps it in a toy collection, and lets two toys **battle**
(vs the computer or 2 players on one phone) or **play** together (high-fives, dance party,
races, jump contest, hugs, tickles, football) in a 3D arena.

- Plain static site, no build step: vanilla ES modules + `three@0.186.0` and
  `@mediapipe/tasks-vision@0.10.35` from jsDelivr (pinned).
- No server, no accounts, no analytics, no paid APIs. Photos never leave the device (IndexedDB).
- Installable PWA (home-screen app on iPhone), works offline after the first visit.

## Run it locally

```bash
cd ~/dev/toy-arena
python3 -m http.server 8765
# open http://localhost:8765/
```

Handy URL switches: `?cutout=simple` forces the non-AI cutout, `?nosw` skips the service worker.

## How it works

| Step | What happens | Code |
|---|---|---|
| Photo | `<input type=file accept=image/* capture=environment>` (or photo library). Decoded via `<img>` so EXIF orientation is applied; iOS hands over JPEG for HEIC. Downscaled to 1024 px. | `js/capture.js` |
| Cutout | MediaPipe **InteractiveSegmenter** (`magic_touch`) runs from 5 keypoints around the centre; each mask is cleaned and scored (5–85 % of frame, not glued to edges, centred) and the best wins. If the model can't load (offline first run, old phone, timeout) a **border-colour flood fill** (k-means background model in Lab) takes over. Kids can tap / scribble on the toy to re-select; grown-ups get an erase/paint brush. | `js/segment.js`, `js/core/mask.js`, `js/screens/add.js` |
| 3D | Mask → marching squares → Douglas–Peucker (≤ ~300 verts, islands + holes kept) → `THREE.ExtrudeGeometry` with a small bevel. Front cap = photo, back cap = back photo (mirrored, fitted) or a darkened mirror of the front, sides = stretched edge colours, plus an ink-outline slab and a collectible base. | `js/cutout.js`, `js/core/contour.js`, `js/mesh.js` |
| Animation | Transform-only procedural moves: idle breathing, hop-walk with squash & stretch, lunge, jump-kick, spin attack, knockback, flop-over KO, dizzy stars, bow, victory flip, dance moves. | `js/figure.js` |
| Battle | Best of 3. Punch / Kick / Block / Super (charges as you land hits; each of 10 powers has its own effect). CPU is gentle on Easy. Comic POW! bubbles, combo counter, shake, slow-mo KO, XP + levels. | `js/battle.js`, `js/core/battle-logic.js`, `js/fx.js`, `js/hud.js` |
| Play | 2–4 toys: High Five, Dance (music + disco lights), Race, Jump contest, Hug, Tickle, Ball, Turn around; drag a toy and it hops after your finger. | `js/play.js` |
| Arenas | City Roof at sunset, Jungle, Space Station, Volcano — simple geometry, gradient sky dome, fog, one shadow-casting light. | `js/arena.js` |
| Sound | All Web Audio synthesis (hits, whooshes, specials, crowd, chiptune + dance loop). Unlocked on first touch for iOS. | `js/audio.js` |
| Storage | IndexedDB `toy-arena/toys` (images as Blobs), `navigator.storage.persist()`, settings in `localStorage`. Grown-ups panel (press-and-hold ⚙️): name, Easy/Hard, sound, hide dummies, **Backup** (one JSON file, images inlined) and **Restore**. | `js/db.js`, `js/core/backup.js`, `js/screens/home.js` |
| Offline | `sw.js` precaches the app shell and runtime-caches jsDelivr, the model and Google Fonts; a few seconds after first load it quietly pre-fetches the MediaPipe wasm + model so the smart cutout works offline too. | `sw.js` |

## Tests

```bash
npm test                       # node --test: mask cleanup, contour tracing, simplification,
                               # stats, battle rules + simulated matches, backup round-trip, SW list
python3 -m http.server 8765 &  # then:
npm run e2e                    # Playwright, emulated iPhone 390×844 @3x, touch
```

The E2E driver (`test/e2e.mjs`) needs `@playwright/test` resolvable from this folder
(`npm i -D @playwright/test && npx playwright install chromium`). It uses the generated photos in
`test/fixtures/` (`python3 test/fixtures/make_test_photos.py` rebuilds them) and any real photos
you drop into `test/photos/`. Screenshots land in `test/screenshots/` (git-ignored).

Icons are generated: `python3 icons/make_icons.py`.

## Deploy to GitHub Pages

The folder is the whole site — no build.

1. Create a repo and push `main` (all paths are relative, so a project page like
   `https://<user>.github.io/toy-arena/` works).
2. Repo → Settings → Pages → *Deploy from a branch* → `main` / root.
3. Open the URL on the iPhone in Safari → Share → **Add to Home Screen**.

When you ship a change, bump `VERSION` in `sw.js` so installed copies pick up the new shell.

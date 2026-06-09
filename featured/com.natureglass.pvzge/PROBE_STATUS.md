# PvZ GE — probe status (2026-06-04)

Status: bundled, not yet booted. Source = master @ time of pull from
`Gzh0821/pvzge_web` (GPL-3.0). 1.125 GB / 7,257 upstream files. See
`ATTRIBUTION.md` for license/credit notes.

## What's known from static probe (before first run)

### Good news (blockers I expected that turned out fine)

- **SystemJS module loader uses `fetch()`, not XHR.** `src/system.bundle.js`
  has one `fetch(` call and zero `XMLHttpRequest` references. Our engine's
  page-script `fetch()` to local files is already working, so module
  loading should boot.
- **All asset URLs are relative.** The page is self-contained under
  `sdmc:/switch/brewser/apps/pvzge/` — no cross-origin, no CORS, no need
  for permissive headers anywhere.
- **`tmpPatch.js` is harmless.** It only defines `window.electron` with
  fullscreen + IPC stubs. All branches degrade to no-ops on a non-Electron
  browser. Keep as-is.
- **Touch event surface in Cocos is small.** Only 2 references to
  `touchstart|move|end|TouchEvent|PointerEvent|pointerdown` across the
  entire `cocos-js/_virtual_cc-23be142f.js` (3.2 MB) bundle. That suggests
  Cocos has a thin input adapter, not pervasive touch wiring — should be
  cheaper to shim than a typical web game.

### Concrete blockers to chase

1. **Cocos engine bundle uses XHR for asset loading.**
   `cocos-js/_virtual_cc-23be142f.js` matches `XMLHttpRequest` / `.open(`.
   At runtime Cocos's `assetManager` will XHR every texture / audio / level
   JSON. Our engine has no XMLHttpRequest yet (Tier-B per itch.io roadmap).
   - **Two paths**: (a) ship XHR Tier-1 in the engine, or (b) monkey-patch
     `window.XMLHttpRequest` to a `fetch()`-backed shim in a pre-boot
     script injected into our copy of `index.html`. (b) is cheaper to spike,
     (a) is the real fix.

2. **Touch input dispatch.**
   Our shell currently fires `mousedown/move/up` on tap (controller-shortcuts.ts
   line 612 setPseudoActive + dispatchEvent path). Cocos may listen for
   touch OR mouse — needs runtime test. If touch is required, Tier-B
   TouchEvent shim becomes load-bearing.

3. **Cocos WebGL2 surface coverage.**
   Cocos uses instancing, transform feedback, `texSubImage3D`, sampler
   objects — features beyond the WebGL 2 Tier-1 surface we've validated
   so far. Will surface as `null function` errors or silent miscompiles
   in the bridge logs. First sign: black screen or shader-link errors in
   `nxjs-debug.log`.

4. **Audio format compatibility.**
   Cocos web build typically uses MP3 or OGG. Our HTMLMediaElement +
   `<audio>` paths in the engine support some formats but not all. If the
   game's audio files are an unsupported codec, voice triggers will silently
   no-op. Check `assets/` for the dominant audio file extension.

5. **`window.electron` is defined by tmpPatch.js.**
   Could trip a feature-detection check in the game that switches to
   "desktop" code paths the web build doesn't ship. Watch for that on first
   boot — if any path calls `electron.ipcRenderer.send` with a channel the
   shim doesn't handle, it'll silently no-op (no crash, but feature won't
   work). Easy revert: don't load `tmpPatch.js`.

6. **`type="712dd8056d5e1ce4434d96f7-text/javascript"` in `index.html`?**
   The upstream `index.html` in our local copy should NOT have those
   Cloudflare Rocket Loader rewrites (Rocket Loader rewrites the served
   HTML on the fly, not the source on disk). Verify on first read — if
   any script tag has that unknown MIME type, our browser will skip it.
   Compare against `test.html` (the snapshot taken from
   live `play.pvzge.com` — has the Rocket Loader rewrites and ad/analytics
   inline; kept for reference, NOT used at runtime).

## First-boot triage plan

1. Open `brewser://apps/pvzge/index.html` and capture the `nxjs-debug.log`.
2. If the page is blank: check the log for fetch/XHR errors → likely
   blocker #1 above. Spike the `XMLHttpRequest → fetch()` shim and
   inject it into `index.html` as the very first inline `<script>`.
3. If the page paints `#GameDiv` but the canvas is black: WebGL2 surface
   gap → check log for missing GL functions.
4. If the canvas paints but taps don't register: blocker #2 → spike
   touch event dispatch in controller-shortcuts.ts.
5. If audio is silent: blocker #4 → check `assets/` for audio extensions
   and compare to our supported codec list.

## House-keeping

- `test.html` (~7 KB) at the folder root is the manual snapshot from
  `play.pvzge.com` (has CF Rocket Loader rewrites + ad/analytics inline).
  Kept only as a reference for what the live deployment serves. It is
  **not** linked from anywhere and does not run. Safe to delete once
  `index.html` boot is verified.
- `.git*`, `Dockerfile`, `.github/`, `README.md` from the upstream repo
  were excluded by selecting only `docs/` to copy. `LICENSE` was copied
  from the repo root, not from `docs/`.

## Engine work this app surfaces

Confirms the [[project_swb_itchio_compat_roadmap]] Tier-B order is still
right. If we want pvzge to boot:

- XHR shim (or a real Tier-1 XMLHttpRequest) — most likely the literal
  load-bearing piece.
- TouchEvent dispatch in controller-shortcuts.ts — needed for input even
  after the page paints.

The two together would also unlock most of the Construct 3 / GameMaker
HTML5 export pipeline, so the investment isn't pvzge-specific.

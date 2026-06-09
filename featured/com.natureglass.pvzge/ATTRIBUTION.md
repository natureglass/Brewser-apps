# PvZ GE — Attribution

This app bundles a web build of **PvZ Gardendless** by **Gzh0821**, redistributed
under the terms of the GNU General Public License v3.0.

- Upstream source: https://github.com/Gzh0821/pvzge_web
- Live deployment: https://play.pvzge.com/
- License: GPL-3.0 (full text in `LICENSE`)

The contents of this folder (everything except `manifest.json`, `assets/pvzge_logo.png`,
this `ATTRIBUTION.md`, and the `test.html` reference capture) are a verbatim copy
of the `docs/` directory of the upstream repository at the commit checked out
during packaging. No game files have been modified.

The upstream project describes itself as a rewrite of the Plants vs. Zombies 2
gameplay using the Cocos engine and is distributed under GPL-3.0 by its author.
Any underlying IP questions are between the upstream author and the original
rights holder; this redistribution is downstream of the upstream license grant.

## GPL-3.0 obligations met

- `LICENSE` is shipped alongside the binary distribution.
- Source is available at the upstream URL above (a link satisfies §6's
  "corresponding source" requirement for software conveyed under §6(d)).
- Author attribution preserved in this file.

## Modifications

### 2026-06-04 — `index.html`

Two edits, both inside a single `<script>` block in `<head>`:

1. **Removed** the inline `window.location.hostname === 'play.pvzge.com'` gate
   and the block it guarded (Google Analytics tag, AdSense loader, Funding
   Choices loader, and `googlefcPresent` signal-iframe injector with a
   `setTimeout(_, 0)` recursion). The block is unreachable off `play.pvzge.com`
   and crashes our engine on its first statement because `window.location` is
   undefined here.

2. **Added** a minimal `location` shim that defines `globalThis.location` /
   `window.location` with `href` / `origin` / `protocol` / `host` / `hostname` /
   `pathname` / etc. fields plus no-op `reload` / `assign` / `replace` / `toString`
   methods. Needed because the polyfills bundle (`src/polyfills.bundle.js`) and
   SystemJS (`src/system.bundle.js`) both reference the bare global `location` at
   parse time and our engine doesn't define it.

### 2026-06-04 (second round) — `index.html`

Three more edits, all additive (no upstream lines removed beyond round one):

1. **Added checkpoint logs** (`console.debug('[pvzge] cpN ...')`) after each
   load-bearing script tag, so we can see in `nxjs-debug.log` exactly how far
   page execution progresses. `console.debug` is used in place of
   `console.error`/`.log`/`.warn`/`.info` because the latter trigger this
   engine's render-mode switch and may swallow output.

2. **Pre-registered the SystemJS import map programmatically** between the
   `system.bundle.js` and `System.import('./index.js')` calls. The upstream
   `<script src="src/import-map.json" type="systemjs-importmap">` tag is kept
   in place for parity, but our engine's `runPageScripts` correctly skips
   non-JS script types, so SystemJS never sees the map via that channel. The
   programmatic call tries `System.addImportMap(...)` (newer SystemJS) and
   falls back to direct `System.importMap` field write (older SystemJS). Map
   content mirrors `src/import-map.json` exactly, just resolved to absolute
   `brewser://apps/pvzge/cocos-js/cc.js`.

3. **Replaced `console.error` with `console.debug`** in the `System.import`
   `.catch` handler so any rejection lands in the debug log instead of being
   swallowed by the render-mode switch. Also added a `.then(...)` so successful
   resolution is also visible.

### 2026-06-04 (third round) — `index.html`

Diagnostic instrumentation only, all additive. Used to trace why
`System.import('./index.js')` was hanging without ever resolving or rejecting:

1. **Wrapped `globalThis.fetch`** to log every URL/start/ok/err to the
   debug log. Helps identify which specific fetch (if any) stalls
   inside SystemJS's module-loading chain.

2. **Shimmed `document.baseURI`** to `location.href` (only when absent).
   SystemJS resolves bare/relative module specifiers against `baseURI`
   on some code paths; if `baseURI` is undefined here, resolution may
   silently fail.

3. **Added watchdog `setTimeout`s** at 1s/3s/8s that log whether the
   `System.import` has settled. One-shot (not recursive) to avoid the
   audio-driver starvation pattern documented elsewhere in memory.

### 2026-06-04 (fourth round) — `index.html`

Diagnostic refinement based on third-round findings (fetch wrapper didn't see
any SystemJS module requests because SystemJS captured the original `fetch`
in closure before the wrapper installed):

1. **Moved the fetch wrap to BEFORE `system.bundle.js`** (it now lives in the
   inline block immediately after `polyfills.bundle.js`, alongside `cp1`).
   This ensures `globalThis.fetch` is already our wrapper when SystemJS
   evaluates its bundle and captures the global reference.

2. **Added direct-fetch probes** for `index.js`, `application.js`, and
   `cocos-js/cc.js` from the same pre-systemjs block. These verify the
   engine's resource loader can serve the three URLs SystemJS will try,
   independent of SystemJS itself.

3. **Demoted the post-systemjs `cp2.5` line** to a status check (does
   `globalThis.fetch` still carry our marker?) since the wrap itself
   already happened earlier.

### 2026-06-04 (fifth round) — `index.html`

Based on fourth-round findings: fetch wrapper IS installed before SystemJS
evaluates, and `cp2.5 fetch is wrap?` confirms SystemJS captured our wrapped
fetch. Direct-fetch probes for `index.js` / `application.js` / `cocos-js/cc.js`
all return status=200. Yet `System.import('./index.js')` issues NO fetch and
neither resolves nor rejects — pending forever.

This points at SystemJS's `prepareImport()` (which all `System.import()` calls
await) hanging *before* the fetch step. Most likely cause: the
`<script src="src/import-map.json" type="systemjs-importmap">` tag in the
page. SystemJS's `prepareImport` scans for these tags and (for `src`-form
tags) tries to fetch the map content first — through the documentShim's
`querySelectorAll`, which may return the tag in a way SystemJS can't handle.

1. **Removed** the `<script type="systemjs-importmap">` tag entirely.
   Comment-block in its place explains the removal and the diagnosis.
   `System.importMap.imports['cc']` is still pre-populated via direct
   field write earlier in the page, so the tag is redundant anyway.

2. **Added probes** `cp2.7` / `cp2.8` / `cp2.9`:
   - `document.readyState` — if `'loading'`, SystemJS may wait for ready.
   - `System.resolve('./index.js', location.href)` — confirms URL resolution.
   - `System.resolve('cc', location.href)` — confirms the bare-specifier
     resolves through our pre-registered import map.

### 2026-06-04 (sixth round) — `index.html`

Fifth round confirmed two root causes:

- `cp2.7` reported `document.readyState=undefined`. The bundled SystemJS
  has both `readyState` and `DOMContentLoaded` references; with readyState
  undefined, `prepareImport()` stays in the waiting state and every
  `System.import()` call queues behind it.
- `cp2.9 System.resolve(cc)` threw with SystemJS error code #8
  ("Module Not Resolved"). The direct field write
  `System.importMap.imports['cc'] = ...` from earlier rounds does not
  take effect — this SystemJS version keeps its real importmap in a
  different internal field, so resolve() can't find 'cc'.

Three additive changes:

1. **Shimmed `document.readyState` to `'complete'`** as the FIRST thing
   after the fetch wrap (so SystemJS sees the right value when it
   captures readyState references during bundle parse). Uses
   `Object.defineProperty` with a getter, falls back to direct
   assignment, with diagnostic logs for either path.

2. **Wrapped `System.resolve`** right after `cp2.1` to special-case
   `id === 'cc'` and return the absolute URL `brewser://apps/pvzge/cocos-js/cc.js`.
   Bypasses whatever internal importmap field SystemJS uses since the
   resolve override gets called before any internal lookup.

3. **Dispatched `DOMContentLoaded` on document and `load` on window**
   right before the `System.import` call. Defense-in-depth in case
   SystemJS or the polyfills bundle queued listeners that haven't been
   woken by the readyState shim alone.

### 2026-06-04 (seventh round) — `index.html`

Sixth round confirmed: `readyState`, `DOMContentLoaded`, and the `cc` resolver
override are all working (probes `cp2.7` / `cp2.9` / `cp2.95` all pass). But
`System.import('./index.js')` still neither resolves nor rejects, and no
fetch fires from SystemJS for `index.js`. So the hang is not `prepareImport`'s
readyState gate, not resolution — it's deeper inside SystemJS's import
machinery, before any network call.

Two diagnostic additions only (no behavior changes to the existing flow):

1. **`cp2.96` `System.prepareImport()` probe** — calls it directly and logs
   when (or whether) its promise settles. All `System.import()` calls await
   the same `prepareImport` promise, so this tells us in isolation whether
   that's where the hang lives.

2. **`cp3.0`/`cp3.1`/`cp3.2` manual fetch + indirect-eval of `index.js`** —
   fetches the file ourselves, evals it with a `sourceURL` comment for
   stack traces, then queries `System.get(...)` to see if `index.js`'s
   `System.register()` call succeeded. If this works while `System.import()`
   hangs, we have a workaround path: pre-register all three module bodies
   via direct eval, then call `System.import()` to drive boot of the
   already-registered modules.

### 2026-06-04 (eighth round) — `index.html`

Seventh round confirmed `prepareImport` resolves and manual fetch+eval of
`index.js` works in our context. But `System.import('./index.js')` still
neither resolves nor rejects, and SystemJS itself never fetches `index.js`
(the only fetch START for it was from our own `cp3.0` manual probe). The
hang sits between SystemJS's post-prepareImport step and its `instantiate`
hook.

Two additive diagnostics:

1. **`cp2.3` System API inventory** — logs `typeof` for `import`,
   `instantiate`, `getRegister`, `set`, `has`, `get`, `load`,
   `prepareImport`. Tells us which hooks are public on this build and
   which workaround paths are open to us if `instantiate` override
   doesn't help.

2. **`cp2.4` + `ip[instantiate]` `System.instantiate` override** — replaces
   the default loader with a fetch+eval+`getRegister()` implementation that
   logs each phase (`ENTER`, fetch status, eval len, `getRegister` return
   type, `FAILED`). If `System.import('./index.js')` invokes this hook,
   we'll see `ip[instantiate] ENTER url=brewser://apps/pvzge/index.js` and
   each subsequent phase. If we DON'T see it, SystemJS isn't reaching the
   instantiate step and the workaround path is to bypass `System.import`
   entirely and drive boot via `System.register` directly.

### 2026-06-04 (ninth round) — `index.html`

Eighth round was a major unlock: the `System.instantiate` override drove
the full module chain (index.js + application.js loaded and registered).
But `index.js`'s execute body crashed at line 14 with
`cannot read property 'parentElement' of null` —
`document.getElementById('GameCanvas')` returned null.

Diagnosis: the canvas-runner wraps each `<script>` body as
`new AsyncFunctionCtor('document', 'console', 'window', body)` and passes
the documentShim/consoleShim/windowProxy as PARAMETERS. But module bodies
evaluated via `(0, eval)(...)` (indirect eval) run in global scope and
resolve `document` through `globalThis.document` — they never see the
function-parameter shims.

Two additive changes:

1. **`cp1.7` globalThis bridge** — early in the head, copy our script's
   `document` / `window` / `console` parameters onto `globalThis` so
   modules evaluated in global scope find the same shim surface that
   inline scripts get. Idempotent: skips the assign if the values
   already match.

2. **`cp1.8` getElementById probe** — calls `document.getElementById('GameCanvas')`
   in both the script's local scope and via `globalThis.document` to
   confirm the shim works and the bridge is effective. Reports the
   returned element's `tagName` (or `typeof` if null/non-element).

### 2026-06-04 (tenth round) — `index.html`

Ninth round regressed: bridging `globalThis.window = window` (where `window`
is the LiveWindow Proxy that itself reads through to `globalThis`) caused a
proxy ↔ globalThis recursion that hung the page-script runner — `onHtmlResponse`
never returned, no `[page]` log lines appeared, FPS dropped to 0. The
related-hazard memory `[[feedback-proxy-private-fields-trap]]` documents the
same family of Proxy issues in this engine.

Rolled back to keep only the minimum necessary bridge:

1. **`cp1.7` reduced to `globalThis.document = document` only.** Dropped
   the `window` and `console` assignments — those weren't strictly needed
   for `document.getElementById('GameCanvas')` resolution and they're the
   ones at risk of the Proxy recursion.

2. **`cp1.8` probe removed entirely.** Its `getElementById` calls would
   only matter for diagnostic confirmation; with the bridge alone in place,
   the next run's `cp4` outcome tells us if the fix worked. If it didn't,
   we can re-add the probe in isolation without the window/console
   bridges that hung things.

### 2026-06-04 (eleventh round) — `index.html`

Tenth round confirmed the surgical `globalThis.document` bridge restored
stability AND fixed the previous `getElementById` → `null` error. Module
boot reached `index.js`'s execute body and threw at the very next line:
`canvas.parentElement.getBoundingClientRect()` → "cannot read property
'getBoundingClientRect' of undefined" because the canvas-runner's
CanvasShim has no parent context.

Two additive changes:

1. **`cp1.9` `canvas.parentElement` shim** — installs a synthetic
   `parentElement` (and `parentNode`) on the GameCanvas shim. The
   synthetic parent reports `getBoundingClientRect()` as 1280×720
   (Switch screen) and stubs `appendChild` / `removeChild` /
   `insertBefore` as no-ops. Lets Cocos's `canvas.width = bcr.width`
   / `canvas.height = bcr.height` boot logic complete without
   modifying the upstream `index.js`.

2. **`cp1.95` `console.error` forwarder** — replaces `console.error`
   with a wrapper that also calls `console.debug` with a `[pvzge:console.error]`
   prefix. Needed because index.js's deeper boot chain
   (`topLevelImport('cc').then(application.init).then(application.start)`)
   has its own `.catch(err => console.error(err))` — without forwarding,
   those errors get swallowed by this engine's render-mode switch on
   `console.error` and disappear from `nxjs-debug.log`.

No upstream files modified.

### 2026-06-04 (seventeenth round) — `index.html`

Sixteenth round's diagnostic revealed the source is a canvas-shaped
LiveElement (`tagName=CANVAS`, has `getContext`, has `offscreen` property,
no `src`). Cocos is calling `createImageBitmap(canvas)` — the
canvas-as-source overload that's valid per WHATWG (HTMLCanvasElement +
OffscreenCanvas are valid `ImageBitmapSource` types).

Engine-level fix this round (not in this folder):

- **`live-dom.ts` LiveElement.convertToBlob + LiveElement.toBlob** —
  added two new methods on the LiveElement class. `convertToBlob` is
  spec-aligned with OffscreenCanvas's API (promise-based, lazy-inits
  the offscreen, delegates encoding to nxjs's native canvas→blob path).
  `toBlob` is the callback-shaped HTMLCanvasElement convenience.

Page-script change in this folder:

- **`cp1.45` wrapper rewritten to prefer `source.convertToBlob()`** as
  the primary canvas-source path. Falls back to fetch-by-src for img
  sources, and to a descriptive Promise.reject for canvas sources still
  missing the new method. Now that LiveElement implements convertToBlob,
  the canvas-source case is fully handled without coupling the wrapper
  to LiveElement internals.

Requires the swb .nro rebuild (LiveElement.convertToBlob is engine code).

No upstream files modified.

### 2026-06-04 (sixteenth round) — `index.html`

Fifteenth round's wrapper was triggered (`cp1.45` fired) but Cocos's
source didn't match our IMG-only detection — passthrough fired, native
impl threw the same "Unsupported image source: LiveElement" error. The
new stack frame `<input>:62:54` (our wrapper's passthrough line) +
`apply (native)` + `createImageBitmap` confirms the wrapper sees the
call but the source isn't shaped as `tagName === 'IMG'` with a string
`src`. Likely a Canvas-shaped LiveElement, or an Image LiveElement
where `tagName` reports differently than expected.

One additive change:

- **Beefed-up `cp1.45` wrapper**:
  - Logs source shape (`constructor.name`, `tagName`, `typeof src`,
    `typeof width`, `typeof getContext`, first 12 own-keys) for the
    first 5 calls so we can see what Cocos is passing.
  - Detection now triggers on `typeof source.src === 'string' && source.src.length > 0`
    regardless of `tagName` (more permissive).
  - Canvas-shaped sources (`getContext` + numeric `width`) get a
    descriptive rejection so Cocos's `.catch` handlers can identify them.
  - Native `Blob` and other sources still passthrough to the original.

No upstream files modified.

### 2026-06-04 (fifteenth round) — `index.html`

Fourteenth round + the engine `LiveWindow` type-guards (separate fix in
switch-web-browser/src/scripts/live-dom.ts shipped in the new .nro)
unblocked the toLowerCase fatal. Remaining issue: nxjs runtime's
`createImageBitmap` (nxjs-source/packages/runtime/src/canvas/image-bitmap.ts:94)
only accepts `Blob` and throws "Unsupported image source: LiveElement"
when Cocos passes the `<img>`-element-shaped LiveElements it preloaded.
The unhandledrejection handler caught the throw, but Cocos's forEach
over the preload list kept hitting it for every image.

One additive change:

- **`cp1.45` `createImageBitmap` wrapper** — installed BEFORE the
  SystemJS bundle loads, replacing `globalThis.createImageBitmap` with
  a wrapper that detects image-element-shaped LiveElements (tagName
  IMG + truthy string `src`), fetches the URL, wraps the bytes in
  a Blob, and forwards to the native createImageBitmap. The Blob path
  is already implemented in nxjs runtime. Idempotent via
  `__pvzge_createImageBitmap_wrapped` marker. Any non-image-element
  sources passthrough unchanged so the original impl's own errors
  surface unmodified.

No upstream files modified.

### 2026-06-04 (fourteenth round) — `index.html`

Thirteenth round's engine regex fix + `r.ok` guard let the 3.2 MB Cocos
engine bundle (`_virtual_cc-23be142f.js`) load and eval successfully —
`getRegister returned isArr=true`. The engine paused for ~8s doing real
work, then threw `TypeError: cannot read property 'toLowerCase' of undefined`
deep in the bundle at col 162170. The stack frame `forEach (native)`
points at Cocos's `cc.sys` platform-detection module, which iterates over
UA-string patterns calling `navigator.userAgent.toLowerCase()`.

Our engine doesn't define `navigator` in global scope, so
`navigator.userAgent` is `undefined` and `.toLowerCase` throws.

One additive change:

- **`cp1.55` `navigator` shim** — installed BEFORE the SystemJS bundle
  loads. Populates `userAgent` (desktop Chrome 120 UA — keeps Cocos on
  the generic web-browser code path rather than mobile / iOS-specific
  paths that assume compressed-texture formats and touch-only input),
  plus `platform` / `vendor` / `language` / `languages` / `onLine` /
  `cookieEnabled` / `maxTouchPoints` / `hardwareConcurrency`. Fills
  missing fields if `globalThis.navigator` already exists; assigns the
  whole object if not.

No upstream files modified.

### 2026-06-04 (thirteenth round) — `index.html`

Twelfth round's beefier logging immediately surfaced the real cause of the
"SyntaxError at line 1 col 1": the brewser:// resource loader returned a
404 for `_virtual_cc-23be142f.js` (engine's `FILE_SEGMENT` regex rejected
the leading underscore). Our instantiate override didn't check `r.ok`,
called `r.text()` on the 404 response, got the body `"Not found: ..."`,
and tried to eval that — the parser hit the `N` and failed.

Two coordinated fixes:

- **Engine fix (not in this folder)** — `browser-resource-loader.ts`'s
  `FILE_SEGMENT` / `DIR_SEGMENT` / `PATH_PATTERN` regexes relaxed to
  allow leading underscore. Safe: `..` directory-escape protection is
  preserved because `..` starts with `.`, not `_`. Requires .nro rebuild.

- **One-line guard in our instantiate override** — throws
  `Error('fetch <url> returned <status>')` when `r.ok` is false instead
  of feeding a 404 body to eval. Future loader misses will surface as
  clear "fetch returned 404" errors rather than misleading SyntaxErrors.

No upstream files modified.

### 2026-06-04 (twelfth round) — `index.html`

Eleventh round's `parentElement` shim + `console.error` forwarder were
working, but the run ended in a hard exit with
`Uncaught (in promise) SyntaxError: expecting ';' at <input>:1:1`. The
debug log wasn't captured this round, so we don't yet know which eval'd
source had the bad token. Likely candidates: `cc.js` or its dependency
`_virtual_cc-23be142f.js` (the 3.2 MB minified engine bundle — a heap or
parser-table limit in QuickJS could surface as a "line 1 col 1" failure
on the giant single-line source).

Three additive changes:

1. **Beefier eval-failure logging in `ip[instantiate]`** — pre-eval
   now logs `typeof src`, `src.length`, first 80 chars, last 80 chars
   so we can identify the failing source. On eval throw, logs error
   `name`, `message`, and first 300 chars of stack.

2. **Removed the `cp3.0` / `cp3.1` / `cp3.2` manual fetch+eval probe.**
   It was redundant now that the instantiate override handles module
   loading, and calling `System.register` a second time for `index.js`
   after SystemJS had already registered it via the instantiate path
   may have been corrupting SystemJS's pending-register slot — a
   probable contributor to this round's crash.

3. **`cp2.97` global `unhandledrejection` handler.** Catches any
   promise rejection that escapes our explicit `.catch` chains and
   logs it to the debug log instead of bubbling up to the engine as
   a fatal "Uncaught (in promise)". Belt + suspenders.

No upstream files modified.

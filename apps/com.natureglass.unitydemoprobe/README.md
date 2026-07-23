# Unity Demos — Brewser diagnostic harness

Measurement tool that loads a curated set of real Unity WebGL debug builds
(vendored from [JohannesDeml/UnityWebGL-LoadingTest][upstream], MIT) one at a
time and produces a per-run NDJSON log capturing where each build gets to:
loader/framework console output, uncaught errors, missing-API interceptor
hits (KNOWN-GAP vs NEW-GAP), load milestones, capacity failures, 5-second
heartbeats, and a preliminary/final verdict.

**Not a fix-it app.** Every shim gap found here is a finding for later
triage, not something this app patches.

[upstream]: https://github.com/JohannesDeml/UnityWebGL-LoadingTest

## Matrix

| # | Slug | Unity | Renderer | GL | Symbols | Purpose |
|---|---|---|---|---|---|---|
| 1 | `2021.3.45f2-webgl1` | 2021.3.45f2 | BiRP | WebGL1 | stripped | Oldest WebGL1 — surface reality check |
| 2 | `2022.3.62f3-webgl1` | 2022.3.62f3 | BiRP | WebGL1 | stripped | Last-LTS WebGL1 (paired with #3) |
| 3 | `2022.3.62f3-webgl2-debug` | 2022.3.62f3 | BiRP | WebGL2 | full | Same-version WebGL1↔WebGL2 A/B |
| 4 | `2023.2.20f1-webgl2-debug` | 2023.2.20f1 | BiRP | WebGL2 | full | Mid-generation modern Unity |
| 5 | `6000.0.74f1-webgl2-debug` | 6000.0.74f1 | BiRP | WebGL2 | full | Unity 6 baseline |
| 6 | `6000.4.0f1-webgl2-debug` | 6000.4.0f1 | BiRP | WebGL2 | full | Heaviest wasm (~23.5 MB) — capacity probe |
| 7 | `6000.4.0f1-urp-webgl2-debug` | 6000.4.0f1 | URP | WebGL2 | full | Only URP row — different shader binding path than BiRP |

Rows 3–7 are **debug** variants: uncompressed `.wasm` / `.data` /
`.framework.js` with full stack traces + readable symbols.

## Symbols

Rows 1 and 2 are the exception. `deml.io` does not publish WebGL1 debug
variants — only WebGL1 release. Release variants ship Brotli-compressed
files (`.wasm.br` etc.) with **stripped** debug symbols; a crash inside
Unity's IL2CPP-compiled wasm on those rows produces shallow stack traces
by design. The picker surfaces `symbols=stripped` in a badge so nobody
misreads that as a harness failure — it's an upstream property, not
signal about the harness.

For rows 1 and 2 the vendor script Brotli-decodes the upstream files at
vendor time using `node:zlib.brotliDecompressSync`; the runner and the
runtime see plain bytes only. `demo.json` records both the compressed
(fetched) and the decompressed (on-disk) sha256 hashes so the transform
is auditable across sessions (Rider 1). Compressed and decompressed byte
sizes are both preserved in `demo.json` so the picker's size column
stays honest.

## Immutability

Vendored build directories under `builds/` are **never modified in place**.
New Unity versions land as additive sibling directories. This is what lets
runs across sessions be compared cleanly — silently patching a vendored
build would break longitudinal comparison and invalidate every prior log.

If upstream reshapes a Unity version's build output enough that it no longer
matches the vendored copy, the correct move is to publish a new sibling
directory with a suffix (e.g. `6000.4.0f1-webgl2-debug-r2`) and update the
matrix, not to overwrite the old one.

## Log format

One NDJSON file per run at
`sdmc:/switch/brewser/logs/unity-demos/<slug>_<utcTimestamp>.ndjson`.

Record classes (envelope: `{t, seq, kind, …}`):

- **SYNC-FLUSH** (written to disk immediately per record): `header`,
  `env-mods`, `probe`, `error`, `capacity`, `milestone`, `heartbeat`,
  `verdict:preliminary`, `verdict:updated`, `verdict:final`.
- **BUFFERED** (~250 ms + milestone-boundary + `beforeunload` flushes):
  `console`, `api-miss`.

`api-miss` records dedupe: first 3 identical `(path, callsite)` pairs get
full-fidelity records with the top 5 stack frames; further occurrences fold
into a periodic `api-miss-summary` record with a count. This keeps the log
readable and prevents Unity's per-frame accessors from drowning the useful
signal.

Verdict taxonomy: `WASM-UNAVAILABLE`, `CAPACITY(wasm-memory|wasm-code|js-heap)`,
`CRASHED(loader|framework|runtime)`, `STALLED(<milestone>)` (inferred by the
picker from heartbeat cessation, not written by the runner), `COMPLETED`.

Verdicts are written **eagerly** — a `verdict:preliminary` is written the
moment the wasm probe result pins one down, then `verdict:updated` at each
new load-bearing evidence point, then `verdict:final` at exit. A hard crash
still leaves the strongest verdict known so far on disk.

## Env-mods (honesty ledger)

The harness installs a curated set of monkey-patches inside the runner page
before the Unity loader executes. Every one is enumerated in the `env-mods`
record at the top of each log, and every polyfilled or stubbed call still
records a `KNOWN-GAP` api-miss so the report never over-claims that we
"filled in" a missing API. See `interceptor.js` for the current inventory;
current headline entries: `wasm-streaming-polyfill` (falls back to
arrayBuffer + `WebAssembly.instantiate`), `crossOriginIsolated-getter`
(returns `false`), and `absent-log` stubs for `SharedArrayBuffer`, `Atomics`,
`Worker`.

## Godot

There is no Godot leg. JohannesDeml's Godot-Web-LoadingTest only publishes
Godot 4.3+ builds. Every Godot 4 web export instantiates its engine with
`ensureCrossOriginIsolationHeaders: true`; Godot 4's Compatibility (WebGL2)
renderer still requires `SharedArrayBuffer` and `Atomics` for its thread
pool, and Brewser's V8 runtime ships neither. Every Godot row would produce
one identical low-signal record — die at `crossOriginIsolated === false`
before the first frame — so no row is worth adding. Godot 3.x web export
(single-threaded, GLES2) would be viable but is not published in a
comparable curated matrix; if Unity findings show engine-differentiated gaps
worth cross-checking, we'd add a separate `com.natureglass.godot3-demos`
app rather than force a row here.

## Running

Launch from the Brewser experimental catalogue. The picker page shows a
table of rows with the most-recent verdict badge for each. Selecting a row
opens `runner.html?demo=<slug>` which loads the vendored build. PLUS returns
to the shell per Brewser convention.

Under Citron the wasm probe reports `unavailable` and every row terminates
at `WASM-UNAVAILABLE` after harvesting loader-stage shim gaps. On real
Tegra hardware with JIT the full path runs.

## Vendoring

`tools/vendor-unity-build.mjs` at the repo root is a one-shot script that
downloads a debug build from `deml.io`, verifies it is uncompressed, rewrites
Unity's content-hashed filenames to stable slot names (`loader.js`,
`framework.js`, `code.wasm`, `data.data`), and emits a `demo.json` metadata
sidecar that the runner reads verbatim (per Phase 1 amendment G — no
per-demo logic in code).

Vendor a row with:

```
node tools/vendor-unity-build.mjs --slug <upstream-tag>
```

For debug rows the on-disk bytes are byte-identical to the upstream
build modulo the filename rewrite in `index.html`. For release rows the
on-disk bytes are the Brotli-decoded upstream bytes; the compressed and
decoded sha256 hashes are both recorded in `demo.json` under
`provenance.<file>.compressed_sha256` / `decoded_sha256`.

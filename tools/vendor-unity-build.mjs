#!/usr/bin/env node
/*
 * Unity Demos harness — vendor script.
 *
 * Downloads one Unity WebGL build from JohannesDeml/UnityWebGL-
 * LoadingTest's deml.io mirror, decompresses if the upstream ships
 * Brotli, rewrites Unity's content-hashed filenames to stable slot
 * names, and emits a demo.json metadata sidecar that the runner reads
 * verbatim.
 *
 * Two modes:
 *
 *   symbols=full   — debug builds (upstream tag ends in -debug). Files
 *                    ship uncompressed with full stack traces + readable
 *                    symbols. loader/framework/wasm/data written to
 *                    disk byte-identical to upstream.
 *
 *   symbols=stripped — release builds (webgl1-only rows, since deml.io
 *                    does not publish WebGL1 debug variants). Files
 *                    ship Brotli-compressed with .br suffix in URLs and
 *                    Content-Encoding: br on the wire; the vendor
 *                    script decompresses via node:zlib and writes plain
 *                    bytes to disk under the same stable slot names.
 *                    Release builds have stripped debug symbols —
 *                    picker surfaces symbols="stripped" so a shallow
 *                    stack on those rows isn't mistaken for a harness
 *                    failure (Rider 1).
 *
 * The rewrite is the ONLY content modification we make for debug rows.
 * For release rows the on-disk bytes are the Brotli-decoded upstream
 * bytes (rider 1 sha256 fields make the transform auditable). index.html
 * is rewritten for both to reference the stable slot filenames instead
 * of the hashed originals.
 *
 * Usage:
 *   node tools/vendor-unity-build.mjs --slug 6000.4.0f1-webgl2-debug
 *   node tools/vendor-unity-build.mjs --slug 2021.3.45f2-webgl1
 *   node tools/vendor-unity-build.mjs --slug ... --overwrite
 *
 * The default refuses to overwrite an existing vendored directory —
 * IMMUTABILITY rule (Phase 1 §K). Pass --overwrite only when
 * bootstrapping / re-vendoring intentionally.
 *
 * License: vendored builds are MIT (upstream repo LICENSE). This
 * script is MIT too (Brewser-apps repo license).
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { get as httpsGet, Agent } from 'node:https';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const APP_DIR = join(repoRoot, 'apps', 'experimental', 'com.natureglass.unity-demos');
const BUILDS_DIR = join(APP_DIR, 'builds');

const MIRROR_BASE = 'https://deml.io/experiments/unity-webgl';

// Slug → matrix metadata. Add a row here when adding a new build.
// `symbols` is a rider-1 field: full for debug builds, stripped for
// release builds. Picker displays this so shallow stacks on release
// rows are recognized as expected upstream behavior, not harness bugs.
const KNOWN_ROWS = {
  '2021.3.45f2-webgl1':           { unity_version: '2021.3.45f2', variant: 'webgl1-release',   render_pipeline: 'birp', gl: 'webgl1', row: 1, symbols: 'stripped' },
  '2022.3.62f3-webgl1':           { unity_version: '2022.3.62f3', variant: 'webgl1-release',   render_pipeline: 'birp', gl: 'webgl1', row: 2, symbols: 'stripped' },
  '2022.3.62f3-webgl2-debug':     { unity_version: '2022.3.62f3', variant: 'webgl2-debug',     render_pipeline: 'birp', gl: 'webgl2', row: 3, symbols: 'full' },
  '2023.2.20f1-webgl2-debug':     { unity_version: '2023.2.20f1', variant: 'webgl2-debug',     render_pipeline: 'birp', gl: 'webgl2', row: 4, symbols: 'full' },
  '6000.0.74f1-webgl2-debug':     { unity_version: '6000.0.74f1', variant: 'webgl2-debug',     render_pipeline: 'birp', gl: 'webgl2', row: 5, symbols: 'full' },
  '6000.4.0f1-webgl2-debug':      { unity_version: '6000.4.0f1',  variant: 'webgl2-debug',     render_pipeline: 'birp', gl: 'webgl2', row: 6, symbols: 'full' },
  '6000.4.0f1-urp-webgl2-debug':  { unity_version: '6000.4.0f1',  variant: 'urp-webgl2-debug', render_pipeline: 'urp',  gl: 'webgl2', row: 7, symbols: 'full' }
};

function parseArgs(argv) {
  const out = { slug: null, overwrite: false, insecure: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slug') out.slug = argv[++i];
    else if (a === '--overwrite') out.overwrite = true;
    else if (a === '--insecure') out.insecure = true;
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else { console.error('unknown arg: ' + a); printUsage(); process.exit(2); }
  }
  return out;
}

function printUsage() {
  console.error('usage: node tools/vendor-unity-build.mjs --slug <upstream-tag> [--overwrite] [--insecure]');
  console.error('       Known slugs:');
  for (const s of Object.keys(KNOWN_ROWS)) {
    const r = KNOWN_ROWS[s];
    console.error('         ' + s + '  (row ' + r.row + ', symbols=' + r.symbols + ')');
  }
}

function sha256hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// Simple HTTPS GET returning {status, headers, body:Buffer}. Follows
// redirects. --insecure disables cert verification for hosts where the
// system trust store can't reach LetsEncrypt.
//
// We request Accept-Encoding: identity so text/HTML responses arrive
// uncompressed. Build assets (loader/framework/wasm/data) on release
// rows come from URLs ending in .br and carry the compressed bytes
// regardless of Accept-Encoding — those are decoded downstream in
// fetchAsset via brotliDecompressSync.
function fetchBuffer(url, opts) {
  return new Promise((resolveReq, rejectReq) => {
    const agent = opts && opts.insecure ? new Agent({ rejectUnauthorized: false }) : undefined;
    const reqOpts = { agent, headers: { 'Accept-Encoding': 'identity' } };
    httpsGet(url, reqOpts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const next = res.headers.location;
        res.resume();
        return fetchBuffer(next, opts).then(resolveReq, rejectReq);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolveReq({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
          url
        });
      });
      res.on('error', rejectReq);
    }).on('error', rejectReq);
  });
}

function extractPaths(indexHtml) {
  // Match Unity's Build/ preload lines + createUnityInstance config.
  // Both surface the exact filenames the loader will fetch. Newer Unity
  // versions use content-hashed names (32-char hex); older ones name
  // files WebGL-<slug>.<ext> or just WebGL.<ext>. This regex accepts
  // any non-slash / non-quote filename ending in a known extension.
  const paths = { loader: null, framework: null, code: null, data: null };
  const seen = new Set();
  const re = /Build\/(?:\/)?([^"'\s\/]+?\.(?:loader\.js|framework\.js(?:\.br)?|wasm(?:\.br)?|data(?:\.br)?))(?=["'\s?])/g;
  let m;
  while ((m = re.exec(indexHtml)) !== null) {
    const p = m[1];
    if (seen.has(p)) continue;
    seen.add(p);
    if (/\.loader\.js$/.test(p)) paths.loader = p;
    else if (/\.framework\.js(?:\.br)?$/.test(p)) paths.framework = p;
    else if (/\.wasm(?:\.br)?$/.test(p)) paths.code = p;
    else if (/\.data(?:\.br)?$/.test(p)) paths.data = p;
  }
  return paths;
}

function extractProductInfo(indexHtml) {
  const grab = (key) => {
    const m = new RegExp(key + '\\s*:\\s*"([^"]*)"').exec(indexHtml);
    return m ? m[1] : null;
  };
  return {
    companyName: grab('companyName') || 'JohannesDeml',
    productName: grab('productName') || 'WebLoadingTest',
    productVersion: grab('productVersion') || 'unknown'
  };
}

function rewriteIndexHtml(indexHtml, hashedPaths) {
  // Replace every occurrence of the hashed path with the stable slot
  // name. Global (not just Build/-prefixed) replacement is safe because
  // the hashes are 32-char hex strings unique to this build — they can't
  // legitimately appear elsewhere.
  let out = indexHtml;
  const replacements = [
    [hashedPaths.loader, 'loader.js'],
    [hashedPaths.framework, 'framework.js'],
    [hashedPaths.code, 'code.wasm'],
    [hashedPaths.data, 'data.data']
  ];
  for (const [from, to] of replacements) {
    if (!from) continue;
    out = out.split(from).join(to);
  }
  return out;
}

// Fetch a build asset. If URL ends in .br OR response has
// Content-Encoding: br, decompress via node:zlib before writing.
// Returns { compressedBytes, compressedSha256, decodedBytes, decodedSha256, contentEncoding }
// with compressedBytes/compressedSha256 = null when the file was plain.
async function fetchAsset(url, opts) {
  const resp = await fetchBuffer(url, opts);
  if (resp.status !== 200) throw new Error('HTTP ' + resp.status + ' at ' + url);
  const enc = (resp.headers['content-encoding'] || '').toLowerCase();
  const urlIsBr = /\.br(\?|$)/.test(url);

  if (enc === 'br' || urlIsBr) {
    // Server may or may not have set Content-Encoding — some CDNs echo
    // the header on .br URLs, some don't. Either way the bytes are
    // Brotli. Node.js https doesn't auto-decompress.
    let decompressed;
    try { decompressed = brotliDecompressSync(resp.body); }
    catch (e) { throw new Error('brotli decompress failed at ' + url + ': ' + e.message); }
    return {
      compressedBytes: resp.body,
      compressedSha256: sha256hex(resp.body),
      decodedBytes: decompressed,
      decodedSha256: sha256hex(decompressed),
      contentEncoding: enc || 'br(from-suffix)'
    };
  }

  return {
    compressedBytes: null,
    compressedSha256: null,
    decodedBytes: resp.body,
    decodedSha256: sha256hex(resp.body),
    contentEncoding: null
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.slug) { printUsage(); process.exit(2); }
  const meta = KNOWN_ROWS[args.slug];
  if (!meta) {
    console.error('unknown slug: ' + args.slug);
    printUsage();
    process.exit(2);
  }

  const outDir = join(BUILDS_DIR, args.slug);
  if (existsSync(outDir) && !args.overwrite) {
    console.error('refusing to overwrite existing ' + outDir);
    console.error('  Vendored builds are IMMUTABLE per Phase 1 §K.');
    console.error('  Pass --overwrite only when re-vendoring intentionally.');
    process.exit(2);
  }
  const outBuild = join(outDir, 'Build');
  mkdirSync(outBuild, { recursive: true });

  const baseUrl = `${MIRROR_BASE}/${args.slug}/`;
  console.log('mode: symbols=' + meta.symbols + ', row=' + meta.row);
  console.log('fetching index.html: ' + baseUrl);
  const idxResp = await fetchBuffer(baseUrl, { insecure: args.insecure });
  if (idxResp.status !== 200) throw new Error('index.html HTTP ' + idxResp.status);
  const indexHtml = idxResp.body.toString('utf8');

  const paths = extractPaths(indexHtml);
  console.log('  paths: ' + JSON.stringify(paths));
  if (!paths.loader || !paths.code || !paths.data || !paths.framework) {
    throw new Error('could not resolve all four Build/ paths from index.html — upstream template changed?');
  }

  // Fetch each asset. Debug URLs have no .br; release URLs have .br on
  // wasm/data/framework (loader.js is served with Content-Encoding: br
  // even without .br in URL — fetchAsset handles both signals).
  const fileEntries = [
    { hash: paths.loader,    slot: 'loader.js',    kind: 'loader',    contentTypeAllow: /javascript/i },
    { hash: paths.framework, slot: 'framework.js', kind: 'framework', contentTypeAllow: /javascript/i },
    { hash: paths.code,      slot: 'code.wasm',    kind: 'code',      contentTypeAllow: /wasm/i },
    { hash: paths.data,      slot: 'data.data',    kind: 'data',      contentTypeAllow: /octet-stream|application\/data/i }
  ];

  const perFile = {}; // rider-1 provenance record per file
  for (const entry of fileEntries) {
    const url = `${baseUrl}Build/${entry.hash}`;
    console.log('fetching ' + entry.kind + ': ' + url);
    const asset = await fetchAsset(url, { insecure: args.insecure });
    writeFileSync(join(outBuild, entry.slot), asset.decodedBytes);
    perFile[entry.kind] = {
      source_url: url,
      upstream_filename: entry.hash,
      slot_filename: entry.slot,
      compressed_bytes: asset.compressedBytes ? asset.compressedBytes.length : null,
      compressed_sha256: asset.compressedSha256,
      decoded_bytes: asset.decodedBytes.length,
      decoded_sha256: asset.decodedSha256,
      content_encoding: asset.contentEncoding
    };
    const sizeMsg = asset.compressedBytes
      ? '(' + asset.compressedBytes.length + ' compressed → ' + asset.decodedBytes.length + ' bytes)'
      : '(' + asset.decodedBytes.length + ' bytes)';
    console.log('  wrote ' + entry.slot + ' ' + sizeMsg);
  }

  // Rewrite index.html to reference the stable slot filenames. Same
  // transform for both symbols=full and symbols=stripped — the runner
  // never executes this file, but keeping it self-consistent means it
  // can be opened directly for upstream-style debugging.
  const rewritten = rewriteIndexHtml(indexHtml, {
    loader: paths.loader, framework: paths.framework, code: paths.code, data: paths.data
  });
  writeFileSync(join(outDir, 'index.html'), rewritten, 'utf8');
  console.log('  wrote index.html (rewritten)');

  // Debug console + logo — best-effort. May be absent on release rows.
  const auxFiles = ['debug-console.js', 'debug-console.css', 'logo.svg'];
  for (const aux of auxFiles) {
    try {
      const url = baseUrl + aux;
      const asset = await fetchAsset(url, { insecure: args.insecure });
      writeFileSync(join(outDir, aux), asset.decodedBytes);
      console.log('  wrote ' + aux + ' (' + asset.decodedBytes.length + ' bytes)');
    } catch (e) { /* aux files optional */ }
  }

  const info = extractProductInfo(indexHtml);
  const demoJson = {
    // matrix metadata for the picker
    slug: args.slug,
    row: meta.row,
    unity_version: meta.unity_version,
    variant: meta.variant,
    render_pipeline: meta.render_pipeline,
    gl: meta.gl,
    symbols: meta.symbols,                    // rider 1: "full" | "stripped"

    // vendor provenance (rider 1)
    vendored_from: baseUrl,
    vendored_at_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    vendor_script_version: '2.0.0',
    upstream_hashes: {
      loader:    paths.loader,
      framework: paths.framework,
      code:      paths.code,
      data:      paths.data
    },
    provenance: perFile,                      // rider 1: per-file url + sha256 (compressed + decoded)

    // createUnityInstance() config — runner concatenates buildRoot +
    // these paths verbatim (amendment G).
    loaderPath:          'Build/loader.js',
    dataUrl:             'Build/data.data',
    frameworkUrl:        'Build/framework.js',
    codeUrl:             'Build/code.wasm',
    streamingAssetsUrl:  'StreamingAssets',
    companyName:         info.companyName,
    productName:         info.productName,
    productVersion:      info.productVersion,

    // On-disk byte sizes (what the loader actually fetches through us).
    loader_bytes:    perFile.loader.decoded_bytes,
    framework_bytes: perFile.framework.decoded_bytes,
    wasm_bytes:      perFile.code.decoded_bytes,
    data_bytes:      perFile.data.decoded_bytes,

    // Compressed sizes for release rows — nulls for debug rows. Picker
    // uses these + the decoded sizes so the size column stays honest.
    loader_compressed_bytes:    perFile.loader.compressed_bytes,
    framework_compressed_bytes: perFile.framework.compressed_bytes,
    wasm_compressed_bytes:      perFile.code.compressed_bytes,
    data_compressed_bytes:      perFile.data.compressed_bytes
  };
  writeFileSync(join(outDir, 'demo.json'), JSON.stringify(demoJson, null, 2) + '\n', 'utf8');
  console.log('  wrote demo.json');

  console.log('\ndone. ' + outDir);
  console.log('  symbols=' + meta.symbols +
              ' wasm=' + perFile.code.decoded_bytes +
              ' data=' + perFile.data.decoded_bytes +
              ' framework=' + perFile.framework.decoded_bytes +
              ' loader=' + perFile.loader.decoded_bytes);
}

main().catch((err) => {
  console.error('vendor failed:', err && err.stack || err);
  process.exit(1);
});

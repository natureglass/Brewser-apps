/* Unity Demos harness — per-demo runner.
 *
 * Boots one Unity build in strict order (Phase 1 §C):
 *
 *   1. parse ?demo=<slug>; construct log path
 *   2. open NDJSON writer + write header (with UA-sniff snapshot,
 *      capability map, engine-boot hint from brewser-debug.log)
 *   3. run wasm execution oracle (T1/T2/T3); write probe records +
 *      eager verdict:preliminary if tier is not `execution`
 *   4. install interceptor (env-mods) + write env-mods record
 *   5. wrap fetch + requestAnimationFrame so milestones fire from
 *      inside Unity's loader without touching upstream code
 *   6. milestone(harness-boot), start 5s heartbeat
 *   7. fetch demo.json — SOLE SOURCE of Unity config (amendment G)
 *   8. append Unity loader.js as <script>; on load, call
 *      createUnityInstance(canvas, config, progressCb) with the
 *      config assembled from demo.json — no per-demo logic in code
 *   9. resolve → verdict:final COMPLETED; reject → CRASHED(<phase>)
 *
 * State object is the single verdict-writer: interceptor's capacity
 * callback + onerror handler + first-frame detector all funnel through
 * state.updateVerdict / state.writeFinalVerdict so verdicts are eagerly
 * written whenever new load-bearing evidence arrives (amendment C).
 */
(function () {
  'use strict';

  var HEARTBEAT_MS = 5000;
  var STATUS_UPDATE_MS = 500;

  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(String(location.search || ''));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
  function pad4(n) { n = String(n); return '0000'.slice(0, 4 - n.length) + n; }
  function utcStamp(d) {
    d = d || new Date();
    return pad4(d.getUTCFullYear()) + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
           'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }

  function updateStatus(text, cls) {
    var el = document.getElementById('harness-status');
    if (!el) return;
    el.innerHTML = text;
    if (cls) el.className = cls;
  }

  function tryReadBootHint() {
    // Best-effort scrape of the engine's boot log for `[wasm] mode=` — the
    // engine writes this once at startup and we want it in the header so
    // post-mortem reads don't need to guess the tier from probe alone.
    if (typeof Switch === 'undefined' || !Switch || typeof Switch.readFileSync !== 'function') return null;
    var candidates = ['sdmc:/switch/brewser/nxjs-debug.log', 'sdmc:/switch/nxjs-debug.log', 'sdmc:/switch/brewser-debug.log'];
    for (var i = 0; i < candidates.length; i++) {
      try {
        var raw = Switch.readFileSync(candidates[i]);
        var text = (raw instanceof Uint8Array || raw instanceof ArrayBuffer) ? new TextDecoder().decode(raw) : String(raw);
        var m = /\[wasm\]\s*mode\s*=\s*[^\n]+/i.exec(text);
        if (m) return m[0].replace(/\s+/g, ' ').slice(0, 200);
      } catch (e) { /* try next */ }
    }
    return null;
  }

  function snapCapabilities() {
    return {
      SharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      Atomics: typeof Atomics !== 'undefined',
      Worker: typeof Worker !== 'undefined',
      crossOriginIsolated: (typeof crossOriginIsolated !== 'undefined') ? !!crossOriginIsolated : false,
      WebAssembly: typeof WebAssembly !== 'undefined',
      'WebAssembly.instantiateStreaming': (typeof WebAssembly !== 'undefined' && typeof WebAssembly.instantiateStreaming === 'function'),
      AudioContext: (typeof AudioContext !== 'undefined') ? 'present' : (typeof webkitAudioContext !== 'undefined' ? 'webkit' : 'absent'),
      webgl: !!document.createElement('canvas').getContext('webgl'),
      webgl2: !!document.createElement('canvas').getContext('webgl2')
    };
  }

  function snapNavigator() {
    var n = (typeof navigator !== 'undefined') ? navigator : {};
    return {
      userAgent: n.userAgent || null,
      platform: n.platform || null,
      vendor: n.vendor || null,
      language: n.language || null,
      hardwareConcurrency: (typeof n.hardwareConcurrency !== 'undefined') ? n.hardwareConcurrency : null,
      deviceMemory: (typeof n.deviceMemory !== 'undefined') ? n.deviceMemory : null
    };
  }

  function makeState(writer, slug, demoMeta) {
    var lastMilestoneT = Date.now();
    var lastMilestoneName = 'harness-boot';
    var rafCount = 0;
    var finalVerdictWritten = false;
    var currentVerdict = null;
    var loaderScriptLoaded = false;
    var unityInstance = null;

    // Wrap requestAnimationFrame so we can count Unity's frames.
    var origRAF = globalThis.requestAnimationFrame;
    if (typeof origRAF === 'function') {
      globalThis.requestAnimationFrame = function (cb) {
        return origRAF.call(globalThis, function (ts) {
          rafCount++;
          try { cb(ts); } catch (e) { throw e; }
        });
      };
    }

    function milestone(name, extra) {
      var now = Date.now();
      var duration = now - lastMilestoneT;
      writer.writeSync('milestone', Object.assign({ name: name, duration_ms: duration }, extra || {}));
      lastMilestoneT = now;
      lastMilestoneName = name;
    }

    function updateVerdict(verdict, reason, basedOn) {
      if (finalVerdictWritten) return;
      var wasNull = !currentVerdict;
      currentVerdict = verdict;
      var kind = wasNull ? 'verdict:preliminary' : 'verdict:updated';
      writer.writeSync(kind, {
        verdict: verdict,
        reason: reason,
        based_on: basedOn || null
      });
    }

    function writeFinalVerdict(reason, basedOn) {
      if (finalVerdictWritten) return;
      finalVerdictWritten = true;
      writer.writeSync('verdict:final', {
        verdict: currentVerdict || 'CRASHED(runtime)',
        reason: reason || 'unspecified',
        based_on: basedOn || null,
        stats: writer.stats()
      });
      writer.flushBuffered('final');
    }

    var state = {
      slug: slug,
      demoMeta: demoMeta,
      milestone: milestone,
      updateVerdict: updateVerdict,
      writeFinalVerdict: writeFinalVerdict,
      lastMilestoneName: function () { return lastMilestoneName; },
      lastMilestoneT: function () { return lastMilestoneT; },
      rafCount: function () { return rafCount; },
      loaderScriptLoaded: function (v) { if (typeof v !== 'undefined') loaderScriptLoaded = v; return loaderScriptLoaded; },
      unityInstance: function (v) { if (typeof v !== 'undefined') unityInstance = v; return unityInstance; },
      currentVerdict: function () { return currentVerdict; },
      finalVerdictWritten: false
    };
    Object.defineProperty(state, 'finalVerdictWritten', { get: function () { return finalVerdictWritten; } });
    return state;
  }

  function wrapFetch(state) {
    var origFetch = globalThis.fetch;
    if (typeof origFetch !== 'function') return;
    globalThis.fetch = function (input, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var kind = classifyFetchUrl(url, state.demoMeta);
      if (kind) state.milestone(kind + '-fetch-start', { url: url });
      var p = origFetch.call(globalThis, input, init);
      if (kind) {
        p = p.then(function (resp) {
          state.milestone(kind + '-fetch-end', { url: url, status: resp && resp.status, ok: resp && resp.ok });
          return resp;
        }, function (err) {
          state.milestone(kind + '-fetch-error', { url: url, error: String((err && err.message) || err) });
          throw err;
        });
      }
      return p;
    };
  }

  function classifyFetchUrl(url, meta) {
    if (!url || !meta) return null;
    if (endsWithPath(url, meta.dataUrl))      return 'data';
    if (endsWithPath(url, meta.frameworkUrl)) return 'framework';
    if (endsWithPath(url, meta.codeUrl))      return 'wasm';
    return null;
  }
  function endsWithPath(url, needle) {
    if (!needle) return false;
    var i = String(url).indexOf(needle);
    return i >= 0 && (i + needle.length) === String(url).length;
  }

  function startHeartbeat(writer, state) {
    return setInterval(function () {
      var stats = writer.stats();
      writer.writeSync('heartbeat', {
        raf_count: state.rafCount(),
        last_milestone: state.lastMilestoneName(),
        elapsed_since_last_milestone_ms: Date.now() - state.lastMilestoneT(),
        buffered_records: stats.buffered,
        seq: stats.seq
      });
    }, HEARTBEAT_MS);
  }

  function startStatusRefresh(state) {
    return setInterval(function () {
      var v = state.currentVerdict();
      var cls = v ? (/COMPLETED/.test(v) ? 'ok' : /CRASHED|CAPACITY/.test(v) ? 'fail' : '') : '';
      var text = '<span class="k">demo:</span> ' + state.slug +
                 ' &nbsp; <span class="k">milestone:</span> ' + state.lastMilestoneName() +
                 ' &nbsp; <span class="k">rAF:</span> ' + state.rafCount() +
                 ' &nbsp; <span class="k">verdict:</span> ' + (v || '(pending)');
      updateStatus(text, cls);
    }, STATUS_UPDATE_MS);
  }

  function fetchDemoJson(slug) {
    // The runner is served from apps/experimental/com.natureglass.unity-demos/;
    // build directories live at builds/<slug>/. demo.json is emitted by the
    // vendor script and is the ONLY per-demo config the runner reads
    // (Phase 1 amendment G).
    var url = 'builds/' + slug + '/demo.json';
    return fetch(url).then(function (resp) {
      if (!resp.ok) throw new Error('demo.json fetch failed: HTTP ' + resp.status);
      return resp.json();
    });
  }

  function loadUnityScript(scriptSrc) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = scriptSrc;
      s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function (e) { reject(new Error('loader script failed to load: ' + scriptSrc)); };
      document.body.appendChild(s);
    });
  }

  function scheduleFirstFrameDetector(state) {
    // Best-effort: rAF >= 1 after createUnityInstance resolves + a probe
    // via unityInstance.SendMessage. Documented as heuristic in the log.
    var checked = false;
    function check() {
      if (checked) return;
      if (state.rafCount() < 1) { requestAnimationFrame(check); return; }
      var inst = state.unityInstance();
      if (!inst) { requestAnimationFrame(check); return; }
      checked = true;
      var probeResult = 'send-message-not-attempted';
      try {
        if (typeof inst.SendMessage === 'function') {
          inst.SendMessage('WebGL', 'LogInitializationTime');
          probeResult = 'send-message-ok';
        }
      } catch (e) {
        probeResult = 'send-message-threw: ' + String((e && e.message) || e);
      }
      state.milestone('first-frame-rendered', {
        detection: 'createUnityInstance.then + rAF>=1 + LogInitTime probe',
        probe_result: probeResult
      });
      state.updateVerdict('COMPLETED', 'first-frame-rendered milestone reached', 'first-frame-detector');
    }
    requestAnimationFrame(check);
  }

  function boot() {
    var slug = qs('demo');
    if (!slug) {
      updateStatus('<span class="fail">missing ?demo=&lt;slug&gt; parameter</span>', 'fail');
      return;
    }
    var logPath = 'sdmc:/switch/brewser/logs/unity-demos/' + slug + '_' + utcStamp() + '.ndjson';

    // Best-effort mkdir chain (each level individually — nx.js mkdirSync
    // isn't recursive).
    if (typeof Switch !== 'undefined' && Switch && typeof Switch.mkdirSync === 'function') {
      var chain = ['sdmc:/switch/brewser/logs', 'sdmc:/switch/brewser/logs/unity-demos'];
      for (var i = 0; i < chain.length; i++) {
        try { Switch.mkdirSync(chain[i]); } catch (e) { /* exists — fine */ }
      }
    }

    var writer = new globalThis.UnityDemosNdjson.Writer(logPath);

    // Provisional state before we've read demo.json; header will be
    // patched with demoMeta once we have it.
    var state = makeState(writer, slug, null);

    // Header FIRST — before interceptor, before probe. If anything blows
    // up we at least know which demo the log belongs to.
    var ua = (typeof navigator !== 'undefined' && navigator && navigator.userAgent) || '';
    writer.writeSync('header', {
      demo_id: slug,
      demo_meta: null, // filled by verdict:updated once demo.json loads
      harness_version: '1.0.0',
      harness_commit: null,
      engine_boot_hint: tryReadBootHint(),
      ua: ua,
      ua_seen_by_unity_sniff: globalThis.UnityDemosInterceptor.unityUaSniff(ua),
      navigator: snapNavigator(),
      capabilities: snapCapabilities(),
      run_utc: new Date().toISOString(),
      logging: writer.loggingConfig()
    });

    // Milestone: harness-boot. Reset the milestone clock so wasm-probe's
    // duration reflects real wall-clock, not "time since page load".
    state.milestone('harness-boot');

    // Wasm probe — synchronous, reads WebAssembly BEFORE interceptor
    // wraps ctors so the probe measures the engine itself, not the
    // instrumented surface.
    var probeResult = globalThis.UnityDemosWasmProbe.run(writer);
    state.milestone('wasm-probe-done', { tier: probeResult.tier });
    if (probeResult.tier !== 'execution') {
      state.updateVerdict('WASM-UNAVAILABLE', 'wasm probe tier=' + probeResult.tier, 'wasm-probe');
    }

    // Interceptor + env-mods. From this point on every subsequent code
    // path runs against the instrumented surface.
    var installed = globalThis.UnityDemosInterceptor.install(writer, state);
    writer.writeSync('env-mods', { patches: installed.patches });
    state.milestone('env-mods-installed', { patch_count: installed.patches.length });

    // Wrap fetch after interceptor so its logging is in place.
    wrapFetch(state);

    // Heartbeat + status refresh.
    var hbTimer = startHeartbeat(writer, state);
    var statusTimer = startStatusRefresh(state);
    globalThis.addEventListener('beforeunload', function () {
      clearInterval(hbTimer);
      clearInterval(statusTimer);
    });

    // Fetch demo.json — SOLE per-demo config source (amendment G).
    fetchDemoJson(slug).then(function (meta) {
      state.demoMeta = meta;
      state.milestone('demo-json-loaded', { productName: meta.productName, productVersion: meta.productVersion });
      // Header's demo_meta is patched via verdict:updated so post-hoc
      // readers can find the byte sizes without scanning to the middle
      // of the log.
      writer.writeSync('milestone', {
        name: 'demo-meta-attached',
        duration_ms: 0,
        demo_meta: {
          unity_version: meta.unity_version,
          variant: meta.variant,
          render_pipeline: meta.render_pipeline,
          wasm_bytes: meta.wasm_bytes,
          data_bytes: meta.data_bytes,
          framework_bytes: meta.framework_bytes,
          loader_bytes: meta.loader_bytes
        }
      });

      // Load Unity's loader.js. buildRoot is the vendored directory; all
      // fetch URLs Unity constructs are relative to the runner page's
      // origin so we prepend buildRoot to each config field.
      var buildRoot = 'builds/' + slug + '/';
      state.milestone('loader-script-fetch-start', { url: buildRoot + meta.loaderPath });
      return loadUnityScript(buildRoot + meta.loaderPath).then(function () {
        state.milestone('loader-script-parsed');
        if (typeof globalThis.createUnityInstance !== 'function') {
          throw new Error('loader.js did not define createUnityInstance');
        }
        state.loaderScriptLoaded(true);

        var canvas = document.getElementById('unity-canvas');
        var config = {
          dataUrl:             buildRoot + meta.dataUrl,
          frameworkUrl:        buildRoot + meta.frameworkUrl,
          codeUrl:             buildRoot + meta.codeUrl,
          streamingAssetsUrl:  buildRoot + (meta.streamingAssetsUrl || 'StreamingAssets'),
          companyName:         meta.companyName,
          productName:         meta.productName,
          productVersion:      meta.productVersion
        };
        state.milestone('unity-config-created');

        return globalThis.createUnityInstance(canvas, config, function (progress) {
          // Progress ranges 0..1; log at major thresholds to avoid spam.
          var pct = Math.floor(progress * 10) / 10;
          if (!config.__lastReported || config.__lastReported < pct) {
            config.__lastReported = pct;
            writer.writeSync('milestone', { name: 'loader-progress', duration_ms: 0, progress: pct });
          }
        });
      });
    }).then(function (unityInstance) {
      state.unityInstance(unityInstance);
      state.milestone('unity-instance-created');
      state.updateVerdict('COMPLETED', 'createUnityInstance promise resolved', 'unity-instance-created');
      scheduleFirstFrameDetector(state);
    }).catch(function (err) {
      // Classify by phase. If we never reached loader-script-parsed the
      // error is loader-side; between there and unity-instance-created
      // it's framework-side; after, runtime.
      var last = state.lastMilestoneName();
      var phase = 'runtime';
      if (last === 'harness-boot' || last === 'wasm-probe-done' ||
          last === 'env-mods-installed' || last === 'demo-json-loaded' ||
          last === 'demo-meta-attached' || last === 'loader-script-fetch-start') {
        phase = 'loader';
      } else if (last === 'loader-script-parsed' || last === 'unity-config-created' ||
                 /-fetch-/.test(last) || last === 'wasm-compile-start' ||
                 last === 'loader-progress') {
        phase = 'framework';
      }
      var cap = globalThis.UnityDemosInterceptor.classifyCapacity(err);
      if (cap) {
        state.updateVerdict(cap, 'capacity-classified from thrown error', 'runner-catch');
      } else {
        state.updateVerdict('CRASHED(' + phase + ')', 'runner promise chain rejected at ' + last, phase);
      }
      writer.writeSync('error', {
        source: 'runner-catch',
        phase: phase,
        message: String((err && err.message) || err),
        stack: (err && err.stack) ? String(err.stack) : null
      });
      state.writeFinalVerdict('runner-catch', last);
    });

    // Safety net: verdict:final is also written on beforeunload by the
    // interceptor's hook, but the interceptor only knows about state via
    // reference — attach it now.
    globalThis.__unityDemosState = state;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

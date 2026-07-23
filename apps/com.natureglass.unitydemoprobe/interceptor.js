/* Unity Demos harness — env-mods installer + missing-API interceptor.
 *
 * Installs a curated set of monkey-patches inside the runner page before
 * the Unity loader executes. Every patch is enumerated in the env-mods
 * record so the log carries an honest ledger of what the harness altered
 * (Phase 1 amendment 3).
 *
 * Mechanisms:
 *   1. Proactive getters for KNOWN-GAP APIs (SharedArrayBuffer, Atomics,
 *      Worker, crossOriginIsolated) — read logs a KNOWN-GAP api-miss.
 *   2. Observing getters / passthrough wrappers for navigator sniff
 *      surface + document.fonts + pointerlock + fullscreen so the log
 *      captures actual UA-branch decisions Unity's loader makes.
 *   3. WebAssembly.compile/.instantiate/Module/Instance/Memory/Table
 *      wrappers with CAPACITY classification (amendment B).
 *   4. WebAssembly.instantiateStreaming polyfill (amendment 3 honesty:
 *      logs KNOWN-GAP + polyfilled: true on each call).
 *   5. console.log/warn/error/info/debug mirrored to buffered NDJSON.
 *   6. window.onerror + unhandledrejection hooks (NEW-GAP discovery via
 *      ReferenceError message parsing).
 *   7. beforeunload flush + eager verdict:final if none written yet.
 *
 * Documented coverage limits (see README):
 *   - Cannot proactively intercept truly-unknown globalThis.<name>
 *     accesses; those surface as ReferenceError caught by onerror.
 *   - Cannot detect "API called with unsupported arguments"; those
 *     surface as engine-level errors, not shim gaps.
 */
(function () {
  'use strict';

  var CAPACITY_MEMORY_RE = /(cannot allocate|could not allocate|WebAssembly\.Memory).*(memory|pages)/i;
  var CAPACITY_CODE_RE   = /(code space|module too big|too many functions|compilation failed.*(size|space))/i;
  var CAPACITY_HEAP_RE   = /(out of memory|invalid array length|heap)/i;

  // KNOWN-GAP dictionary — used both to install proactive getters AND to
  // classify NEW-GAP-vs-KNOWN-GAP for ReferenceErrors caught by onerror.
  // Path is what the code accesses; key is the terminal identifier.
  var KNOWN_GAPS = {
    'SharedArrayBuffer': { path: 'globalThis.SharedArrayBuffer', kind: 'absent-log' },
    'Atomics':           { path: 'globalThis.Atomics',           kind: 'absent-log' },
    'Worker':            { path: 'globalThis.Worker',            kind: 'absent-log' },
    'crossOriginIsolated': { path: 'globalThis.crossOriginIsolated', kind: 'stub' }
  };

  function unityUaSniff(ua) {
    ua = String(ua || '');
    return {
      is_mobile: /iPhone|iPad|iPod|Android/i.test(ua),
      is_ios:    /iPhone|iPad|iPod/i.test(ua),
      is_android:/Android/i.test(ua),
      is_safari: /Safari\//.test(ua) && !/Chrome/.test(ua),
      is_chrome: /Chrome/.test(ua),
      is_firefox:/Firefox/.test(ua),
      is_unknown: !/iPhone|iPad|iPod|Android|Safari|Chrome|Firefox/i.test(ua)
    };
  }

  function classifyCapacity(err) {
    var msg = String((err && err.message) || err || '');
    if (CAPACITY_MEMORY_RE.test(msg)) return 'CAPACITY(wasm-memory)';
    if (CAPACITY_CODE_RE.test(msg))   return 'CAPACITY(wasm-code)';
    if (/^RangeError/i.test(String(err && err.name || '')) && CAPACITY_HEAP_RE.test(msg)) return 'CAPACITY(js-heap)';
    if (err && err.name === 'RangeError' && CAPACITY_HEAP_RE.test(msg)) return 'CAPACITY(js-heap)';
    return null;
  }

  function install(writer, state) {
    var patches = [];
    var log = writer;

    // ---- 1 + 2: proactive + observing getters --------------------------

    function installAbsentLog(host, prop, path) {
      // "absent-log": leave the API missing (return undefined) but log
      // each read. Emulates the browser-without-SAB behavior Unity's
      // feature-detection expects, so the loader takes its no-SAB branch
      // instead of hard-crashing.
      try {
        Object.defineProperty(host, prop, {
          configurable: true,
          get: function () {
            log.writeBuffered('api-miss', {
              path: path,
              label: 'KNOWN-GAP',
              callsite: globalThis.UnityDemosNdjson.captureCallsite(),
              extra: { return: 'undefined', kind: 'absent-log' }
            });
            return undefined;
          }
        });
        patches.push({ name: prop + '-getter', kind: 'absent-log', target: path, note: 'read logs KNOWN-GAP, returns undefined' });
      } catch (e) { /* already-defined property — skip silently */ }
    }

    function installStubGetter(host, prop, path, stubValue, note) {
      try {
        Object.defineProperty(host, prop, {
          configurable: true,
          get: function () {
            log.writeBuffered('api-miss', {
              path: path,
              label: 'KNOWN-GAP',
              callsite: globalThis.UnityDemosNdjson.captureCallsite(),
              extra: { return: JSON.stringify(stubValue), kind: 'stub' }
            });
            return stubValue;
          }
        });
        patches.push({ name: prop + '-getter', kind: 'stub', target: path, note: note });
      } catch (e) { /* skip */ }
    }

    function installObservingGetter(host, prop, path, note) {
      var original;
      try { original = host[prop]; } catch (e) { original = undefined; }
      try {
        Object.defineProperty(host, prop, {
          configurable: true,
          get: function () {
            log.writeBuffered('api-miss', {
              path: path,
              label: 'OBSERVE',
              callsite: globalThis.UnityDemosNdjson.captureCallsite(),
              extra: { observed: (typeof original === 'undefined' ? null : String(original)) }
            });
            return original;
          }
        });
        patches.push({ name: prop + '-observe', kind: 'observe', target: path, note: note });
      } catch (e) { /* skip */ }
    }

    installAbsentLog(globalThis, 'SharedArrayBuffer', 'globalThis.SharedArrayBuffer');
    installAbsentLog(globalThis, 'Atomics',           'globalThis.Atomics');
    installAbsentLog(globalThis, 'Worker',            'globalThis.Worker');
    installStubGetter(globalThis, 'crossOriginIsolated', 'globalThis.crossOriginIsolated', false,
                      'returns false so isolation-dependent code takes its unsupported branch');

    if (typeof navigator !== 'undefined' && navigator) {
      installObservingGetter(navigator, 'hardwareConcurrency', 'navigator.hardwareConcurrency', 'read passes through');
      installObservingGetter(navigator, 'deviceMemory',        'navigator.deviceMemory',        'read passes through');
    }
    if (typeof document !== 'undefined' && document) {
      installObservingGetter(document, 'fonts', 'document.fonts', 'read passes through');
    }

    // ---- 3: WebAssembly wrappers with CAPACITY classification ---------

    if (typeof WebAssembly !== 'undefined' && WebAssembly) {
      wrapConstructor(WebAssembly, 'Module',   'WebAssembly.Module');
      wrapConstructor(WebAssembly, 'Instance', 'WebAssembly.Instance');
      wrapConstructor(WebAssembly, 'Memory',   'WebAssembly.Memory');
      wrapConstructor(WebAssembly, 'Table',    'WebAssembly.Table');
      wrapPromise(WebAssembly, 'compile',      'WebAssembly.compile');
      wrapPromise(WebAssembly, 'instantiate',  'WebAssembly.instantiate');
      patches.push({ name: 'wasm-instantiation-wrappers', kind: 'observe',
                     target: 'WebAssembly.{Module,Instance,Memory,Table,compile,instantiate}',
                     note: 'catches errors + classifies capacity failures per amendment B' });

      function wrapConstructor(host, name, path) {
        var Orig = host[name];
        if (typeof Orig !== 'function') return;
        function Wrapped() {
          var self = Object.create(Orig.prototype);
          try {
            var inst = Reflect.construct(Orig, Array.prototype.slice.call(arguments), Orig);
            return inst;
          } catch (e) {
            var cap = classifyCapacity(e);
            if (cap) {
              log.writeSync('capacity', {
                kind: cap,
                message: String((e && e.message) || e),
                stack: (e && e.stack) ? String(e.stack).split(/\r?\n/).slice(0, 8) : null,
                path: path
              });
              if (state) state.updateVerdict(cap, 'wasm-ctor-throw', path);
            }
            throw e;
          }
        }
        Wrapped.prototype = Orig.prototype;
        try { host[name] = Wrapped; } catch (err) { /* frozen host — skip */ }
      }

      function wrapPromise(host, name, path) {
        var Orig = host[name];
        if (typeof Orig !== 'function') return;
        function Wrapped() {
          try {
            var p = Orig.apply(host, arguments);
            if (p && typeof p.then === 'function') {
              return p.then(function (v) { return v; }, function (e) {
                var cap = classifyCapacity(e);
                if (cap) {
                  log.writeSync('capacity', {
                    kind: cap,
                    message: String((e && e.message) || e),
                    stack: (e && e.stack) ? String(e.stack).split(/\r?\n/).slice(0, 8) : null,
                    path: path
                  });
                  if (state) state.updateVerdict(cap, 'wasm-promise-reject', path);
                }
                throw e;
              });
            }
            return p;
          } catch (e) {
            var cap = classifyCapacity(e);
            if (cap) {
              log.writeSync('capacity', {
                kind: cap, message: String((e && e.message) || e),
                stack: (e && e.stack) ? String(e.stack).split(/\r?\n/).slice(0, 8) : null,
                path: path
              });
              if (state) state.updateVerdict(cap, 'wasm-fn-throw', path);
            }
            throw e;
          }
        }
        try { host[name] = Wrapped; } catch (err) { /* skip */ }
      }
    }

    // ---- 4: instantiateStreaming polyfill -----------------------------

    if (typeof WebAssembly !== 'undefined' && WebAssembly) {
      var _origStreaming = WebAssembly.instantiateStreaming;
      WebAssembly.instantiateStreaming = function (source, importObj) {
        log.writeBuffered('api-miss', {
          path: 'WebAssembly.instantiateStreaming',
          label: 'KNOWN-GAP',
          callsite: globalThis.UnityDemosNdjson.captureCallsite(),
          extra: { polyfilled: true, note: 'falls back to arrayBuffer + WebAssembly.instantiate' }
        });
        return Promise.resolve(source).then(function (resp) {
          if (!resp || typeof resp.arrayBuffer !== 'function') {
            throw new TypeError('instantiateStreaming polyfill: source is not a Response');
          }
          return resp.arrayBuffer().then(function (bytes) {
            return WebAssembly.instantiate(bytes, importObj);
          });
        });
      };
      patches.push({ name: 'wasm-streaming-polyfill', kind: 'polyfill',
                     target: 'WebAssembly.instantiateStreaming',
                     note: 'was ' + (typeof _origStreaming) + '; polyfilled to arrayBuffer path; logs KNOWN-GAP per call' });
    }

    // ---- 5: console mirror --------------------------------------------

    var CONSOLE_LEVELS = ['log', 'warn', 'error', 'info', 'debug'];
    for (var i = 0; i < CONSOLE_LEVELS.length; i++) {
      (function (level) {
        var orig = console[level];
        if (typeof orig !== 'function') return;
        console[level] = function () {
          var args = new Array(arguments.length);
          for (var j = 0; j < arguments.length; j++) {
            var a = arguments[j];
            try { args[j] = (typeof a === 'string') ? a : (a && a.stack ? String(a.stack).slice(0, 800) : JSON.stringify(a)); }
            catch (e) { args[j] = '(unserializable ' + (typeof a) + ')'; }
          }
          log.writeBuffered('console', { level: level, args: args });
          try { orig.apply(console, arguments); } catch (e) { /* nop */ }
        };
      })(CONSOLE_LEVELS[i]);
    }
    patches.push({ name: 'console-mirror', kind: 'observe', target: 'console.{log,warn,error,info,debug}',
                   note: 'args mirrored into buffered NDJSON console record; originals still fire' });

    // ---- 6: onerror + unhandledrejection ------------------------------

    var origOnError = globalThis.onerror;
    globalThis.onerror = function (message, filename, lineno, colno, error) {
      var refMatch = /(?:^|\s)(?:Reference|Type)Error:.*?['"`]?([A-Za-z_$][A-Za-z_$0-9]*)['"`]?\s+is\s+not\s+defined/i.exec(String(message || ''));
      var propMatch = /Cannot read propert(?:y|ies)\s+(?:of\s+undefined\s+\()?['"`]?([A-Za-z_$][A-Za-z_$0-9]*)['"`]?/i.exec(String(message || ''));
      var missName = refMatch ? refMatch[1] : (propMatch ? propMatch[1] : null);
      if (missName) {
        var known = KNOWN_GAPS[missName];
        log.writeBuffered('api-miss', {
          path: known ? known.path : ('unknown.' + missName),
          label: known ? 'KNOWN-GAP' : 'NEW-GAP',
          callsite: (error && error.stack) ? String(error.stack).split(/\r?\n/).slice(0, 5) : [],
          extra: { via: 'onerror', name: missName, message: String(message) }
        });
      }
      log.writeSync('error', {
        source: 'onerror',
        message: String(message || ''),
        stack: (error && error.stack) ? String(error.stack) : null,
        filename: filename || null,
        lineno: lineno || null,
        colno: colno || null
      });
      if (typeof origOnError === 'function') try { return origOnError.apply(this, arguments); } catch (e) { /* nop */ }
      return false;
    };
    globalThis.addEventListener('unhandledrejection', function (ev) {
      var reason = ev && ev.reason;
      log.writeSync('error', {
        source: 'unhandledrejection',
        message: String((reason && reason.message) || reason || 'unknown'),
        stack: (reason && reason.stack) ? String(reason.stack) : null
      });
    });
    patches.push({ name: 'onerror-hook',              kind: 'observe', target: 'window.onerror',              note: 'records error kind; NEW-GAP discovery via ReferenceError parse' });
    patches.push({ name: 'unhandledrejection-hook',   kind: 'observe', target: 'window.onunhandledrejection', note: 'records error kind for Promise rejections' });

    // ---- 7: beforeunload flush ----------------------------------------

    globalThis.addEventListener('beforeunload', function () {
      if (state && !state.finalVerdictWritten) {
        state.writeFinalVerdict('beforeunload', 'shell requested exit before completion');
      }
      log.flushBuffered('beforeunload');
      log.close();
    });
    patches.push({ name: 'beforeunload-flush', kind: 'observe', target: 'window.addEventListener(beforeunload)',
                   note: 'writes verdict:final if not already written + flushes buffered records' });

    return { patches: patches, unityUaSniff: unityUaSniff, KNOWN_GAPS: KNOWN_GAPS, classifyCapacity: classifyCapacity };
  }

  globalThis.UnityDemosInterceptor = {
    install: install,
    unityUaSniff: unityUaSniff,
    KNOWN_GAPS: KNOWN_GAPS,
    classifyCapacity: classifyCapacity
  };
})();

/* Unity Demos harness — wasm execution oracle (Phase 1 amendment A).
 *
 * Direct port of wasmprobe's T1/T2/T3 execution sequence. Runs
 * synchronously before Unity's loader is fetched; writes probe records
 * and, if the tier is not `execution`, eagerly writes verdict:preliminary
 * = WASM-UNAVAILABLE so the log has a stable answer even if the loader
 * hangs later.
 *
 * MOD_EMPTY: 8-byte magic+version-only module. Compile succeeds only if
 *   the API surface is present.
 * MOD_ADD:   41-byte i32 add(a,b) module. Instantiate + execute succeed
 *   only if the engine actually runs wasm.
 *
 * Both byte layouts are copied verbatim from wasmprobe.js — that module
 * is Node-verified and already carries the fail-soft contract from
 * NXJS_PATCHES_NEEDED.md #74.
 */
(function () {
  'use strict';

  var MOD_EMPTY = new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0
  ]);

  var MOD_ADD = new Uint8Array([
    0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    // Type section: 1 type = (i32,i32) -> i32
    1, 7, 1, 0x60, 2, 0x7f, 0x7f, 1, 0x7f,
    // Function section: 1 fn of type 0
    3, 2, 1, 0,
    // Export section: "add" -> fn 0
    7, 7, 1, 3, 0x61, 0x64, 0x64, 0, 0,
    // Code section: fn body = local.get 0; local.get 1; i32.add; end
    10, 9, 1, 7, 0, 0x20, 0, 0x20, 1, 0x6a, 0x0b
  ]);

  function describe(e) {
    if (!e) return '(no error)';
    var n = e && e.constructor && e.constructor.name;
    return (n ? n + ': ' : '') + String(e.message || e);
  }

  function runProbe(writer) {
    var result = { t1: false, t2: false, t3a: false, t3b: false, tier: 'unavailable' };

    // T1 — API surface. Constructor presence + minimum-conforming binary.
    try {
      if (typeof WebAssembly !== 'object') throw new Error('typeof WebAssembly === ' + typeof WebAssembly);
      if (typeof WebAssembly.Module !== 'function') throw new Error('WebAssembly.Module is not a constructor');
      if (typeof WebAssembly.Instance !== 'function') throw new Error('WebAssembly.Instance is not a constructor');
      new WebAssembly.Module(MOD_EMPTY);
      result.t1 = true;
      writer.writeSync('probe', { test: 'T1-compile', result: 'pass', detail: 'WebAssembly.Module ctor accepted 8-byte magic+version' });
    } catch (e) {
      writer.writeSync('probe', { test: 'T1-compile', result: 'fail', error: describe(e) });
    }

    // T2 — Instance construction with the add module (compile + instantiate).
    var addModule = null;
    var addInstance = null;
    try {
      addModule = new WebAssembly.Module(MOD_ADD);
      addInstance = new WebAssembly.Instance(addModule);
      result.t2 = true;
      writer.writeSync('probe', { test: 'T2-instantiate', result: 'pass', detail: '41-byte add module instantiated' });
    } catch (e) {
      writer.writeSync('probe', { test: 'T2-instantiate', result: 'fail', error: describe(e) });
    }

    // T3 — execution. Two call variants prove the compiled path is
    // functional and not just returning canned constants.
    if (addInstance) {
      try {
        var r1 = addInstance.exports.add(2, 3);
        if (r1 !== 5) throw new Error('add(2,3) returned ' + r1 + ', expected 5');
        result.t3a = true;
        writer.writeSync('probe', { test: 'T3-execute-call1', result: 'pass', detail: 'add(2,3) = 5' });
      } catch (e) {
        writer.writeSync('probe', { test: 'T3-execute-call1', result: 'fail', error: describe(e) });
      }
      try {
        var r2 = addInstance.exports.add(1000, 25);
        if (r2 !== 1025) throw new Error('add(1000,25) returned ' + r2 + ', expected 1025');
        result.t3b = true;
        writer.writeSync('probe', { test: 'T3-execute-call2', result: 'pass', detail: 'add(1000,25) = 1025' });
      } catch (e) {
        writer.writeSync('probe', { test: 'T3-execute-call2', result: 'fail', error: describe(e) });
      }
    } else {
      writer.writeSync('probe', { test: 'T3-execute-call1', result: 'skip', detail: 'T2 did not produce an Instance' });
      writer.writeSync('probe', { test: 'T3-execute-call2', result: 'skip', detail: 'T2 did not produce an Instance' });
    }

    // Tier per Phase 1 §J — same mapping as wasmprobe.
    result.tier = (result.t3a && result.t3b) ? 'execution'
                  : (result.t1 || result.t2) ? 'api-only'
                  : 'unavailable';
    return result;
  }

  globalThis.UnityDemosWasmProbe = {
    run: runProbe
  };
})();

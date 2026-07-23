/* Unity Demos harness — NDJSON writer.
 *
 * Two record classes per Phase 1 amendment E:
 *
 *   SYNC-FLUSH (immediate per-record): header, env-mods, probe, error,
 *     capacity, milestone, heartbeat, verdict:preliminary,
 *     verdict:updated, verdict:final.
 *
 *   BUFFERED (in-memory, flushed on milestone boundary, every ~250 ms, and
 *     at beforeunload): console, api-miss.
 *
 * api-miss dedupe: first 3 identical (path, callsite) records go through
 * with full stack; further occurrences accumulate into a periodic
 * api-miss-summary record with a count. Stack capture is confined to the
 * dedupe cases; the summary carries no stack.
 *
 * Timestamps are captured BEFORE the record is formatted so the JSON
 * serialization cost is not attributed to milestone durations (amendment E).
 *
 * The writer prefers Switch.appendFileSync when available; otherwise it
 * accumulates the whole log in memory and rewrites the file with
 * Switch.writeFileSync on every SYNC event. Detection happens once at
 * boot.
 */
(function () {
  'use strict';

  var SYNC_KINDS = {
    'header': 1, 'env-mods': 1, 'probe': 1, 'error': 1, 'capacity': 1,
    'milestone': 1, 'heartbeat': 1,
    'verdict:preliminary': 1, 'verdict:updated': 1, 'verdict:final': 1,
    'api-miss-summary': 1
  };
  var BUFFERED_KINDS = { 'console': 1, 'api-miss': 1 };

  var FLUSH_MS = 250;
  var DEDUPE_FULL = 3;
  var CALLSITE_MAX_FRAMES = 5;

  function NdjsonWriter(path, opts) {
    this.path = path;
    this.seq = 0;
    this.buffer = [];                      // BUFFERED-class records pending flush
    this.fileText = '';                    // full-log fallback for non-append runtimes
    this.flushCount = 0;
    this.lastFlushMs = 0;
    this.missCounters = Object.create(null); // key -> {count, sample, full_written}
    this._flushTimer = null;
    this._appendOk = !!(typeof Switch !== 'undefined' && Switch && typeof Switch.appendFileSync === 'function');
    this._writeOk = !!(typeof Switch !== 'undefined' && Switch && typeof Switch.writeFileSync === 'function');
    this._writeAttempted = false;
    this.opts = opts || {};
    this._logging = {
      flush_ms: FLUSH_MS,
      dedupe_full: DEDUPE_FULL,
      callsite_max_frames: CALLSITE_MAX_FRAMES,
      writer: this._appendOk ? 'appendFileSync' : (this._writeOk ? 'writeFileSync-rewrite' : 'memory-only'),
      path: path
    };
    this._startFlushTimer();
  }

  NdjsonWriter.prototype.loggingConfig = function () {
    return this._logging;
  };

  NdjsonWriter.prototype._startFlushTimer = function () {
    var self = this;
    this._flushTimer = setInterval(function () { self.flushBuffered('timer'); }, FLUSH_MS);
  };

  NdjsonWriter.prototype._formatLine = function (kind, payload, tCapture) {
    // tCapture is captured by the caller BEFORE serialization so milestone
    // deltas don't include JSON.stringify overhead (amendment E).
    var envelope = { t: tCapture, seq: ++this.seq, kind: kind };
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) envelope[k] = payload[k];
    var line;
    try { line = JSON.stringify(envelope); }
    catch (e) {
      var safe = { t: tCapture, seq: envelope.seq, kind: kind, _serialize_error: String(e && e.message || e) };
      line = JSON.stringify(safe);
    }
    return line + '\n';
  };

  NdjsonWriter.prototype._writeToDisk = function (text) {
    if (!text) return;
    if (this._appendOk) {
      try { Switch.appendFileSync(this.path, text); return; }
      catch (e) {
        this._appendOk = false;
      }
    }
    this.fileText += text;
    if (this._writeOk) {
      try { Switch.writeFileSync(this.path, this.fileText); this._writeAttempted = true; }
      catch (e) { /* swallow — worst case, log is memory-only */ }
    }
  };

  NdjsonWriter.prototype.writeSync = function (kind, payload) {
    if (!SYNC_KINDS[kind]) {
      // Coding error — always route through sync/buffered per class.
      // Fall through to sync so nothing gets silently dropped.
    }
    // Flushing buffered records BEFORE writing sync preserves causal order
    // in the file: a milestone appears after the console/api-miss records
    // that led up to it, not before them.
    this.flushBuffered('pre-sync');
    var line = this._formatLine(kind, payload, Date.now());
    this._writeToDisk(line);
  };

  NdjsonWriter.prototype.writeBuffered = function (kind, payload) {
    var tCapture = Date.now();
    if (kind === 'api-miss') {
      var key = String(payload.path) + '|' + String((payload.callsite && payload.callsite[0]) || '');
      var slot = this.missCounters[key];
      if (!slot) {
        slot = { count: 0, path: payload.path, label: payload.label };
        this.missCounters[key] = slot;
      }
      slot.count++;
      if (slot.count > DEDUPE_FULL) {
        // Fold into aggregate — full record NOT queued.
        return;
      }
    }
    this.buffer.push(this._formatLine(kind, payload, tCapture));
  };

  NdjsonWriter.prototype.flushBuffered = function (reason) {
    if (!this.buffer.length && !this._summariesDue()) return;
    var chunk = this.buffer.join('');
    this.buffer.length = 0;
    // Emit api-miss-summary records for any keys whose count exceeded
    // DEDUPE_FULL since the last flush. Summaries are themselves
    // SYNC-flush class but writing them here amortizes them.
    for (var key in this.missCounters) if (Object.prototype.hasOwnProperty.call(this.missCounters, key)) {
      var slot = this.missCounters[key];
      if (slot.count > DEDUPE_FULL && !slot._reported_at || (slot._reported_at && slot.count > slot._reported_at + 20)) {
        chunk += this._formatLine('api-miss-summary', {
          path: slot.path,
          label: slot.label,
          count: slot.count
        }, Date.now());
        slot._reported_at = slot.count;
      }
    }
    this._writeToDisk(chunk);
    this.lastFlushMs = Date.now();
    this.flushCount++;
    if (this.opts.onFlush) try { this.opts.onFlush(reason, chunk.length); } catch (e) { /* nop */ }
  };

  NdjsonWriter.prototype._summariesDue = function () {
    for (var key in this.missCounters) if (Object.prototype.hasOwnProperty.call(this.missCounters, key)) {
      var slot = this.missCounters[key];
      if (slot.count > DEDUPE_FULL && (!slot._reported_at || slot.count > slot._reported_at + 20)) return true;
    }
    return false;
  };

  NdjsonWriter.prototype.stats = function () {
    var totalMisses = 0;
    for (var k in this.missCounters) if (Object.prototype.hasOwnProperty.call(this.missCounters, k)) totalMisses += this.missCounters[k].count;
    return {
      seq: this.seq,
      buffered: this.buffer.length,
      flushCount: this.flushCount,
      lastFlushMs: this.lastFlushMs,
      totalMisses: totalMisses
    };
  };

  NdjsonWriter.prototype.close = function () {
    if (this._flushTimer) { clearInterval(this._flushTimer); this._flushTimer = null; }
    this.flushBuffered('close');
  };

  function captureCallsite() {
    // top CALLSITE_MAX_FRAMES frames of Error.stack, skipping this fn and
    // the caller (interceptor internals). Node/V8 stack line format is
    // roughly `    at Fn (url:line:col)`. Returned as an array of strings.
    var err = new Error();
    var stack = err && err.stack ? String(err.stack) : '';
    var lines = stack.split(/\r?\n/);
    var frames = [];
    for (var i = 0; i < lines.length && frames.length < CALLSITE_MAX_FRAMES + 3; i++) {
      var l = lines[i].replace(/^\s+|\s+$/g, '');
      if (!l) continue;
      if (l.indexOf('captureCallsite') !== -1) continue;
      if (l.indexOf('interceptor.js') !== -1) continue;
      if (l.indexOf('ndjson.js') !== -1) continue;
      if (l.indexOf('Error') === 0) continue;
      frames.push(l);
      if (frames.length >= CALLSITE_MAX_FRAMES) break;
    }
    return frames;
  }

  // Public surface — mounted on globalThis for runner + interceptor
  // + wasm-probe to share a single writer instance.
  globalThis.UnityDemosNdjson = {
    Writer: NdjsonWriter,
    captureCallsite: captureCallsite,
    SYNC_KINDS: SYNC_KINDS,
    BUFFERED_KINDS: BUFFERED_KINDS
  };
})();

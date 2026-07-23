/* Unity Demos harness — picker page.
 *
 * Reads recent NDJSON logs from sdmc:/switch/brewser/logs/unity-demos/
 * to compute the most-recent verdict badge for each row, then lets the
 * user launch runner.html?demo=<slug>.
 *
 * STALLED inference (Phase 1 amendment F): if the newest log for a row
 * has heartbeat records that stopped landing without a verdict:final,
 * we classify STALLED with elapsed-since-last-heartbeat +
 * elapsed-since-last-milestone attached so the badge doesn't misread
 * a legitimately long wasm-compile as a hang.
 *
 * Row metadata is intentionally duplicated between this file and
 * demo.json (per row); the picker uses these bare fields to render even
 * before builds are vendored, and demo.json is authoritative once a row
 * is populated.
 */
(function () {
  'use strict';

  var HEARTBEAT_GRACE_MS = 15000; // heartbeat cadence is 5s; 3× as slack

  // Slugs 1-2 use `-webgl1` (release) because deml.io does not publish
  // WebGL1 debug variants — see README §"Symbols". The vendor script
  // Brotli-decodes them at vendor time and marks symbols=stripped in
  // demo.json; the picker surfaces that per row so shallow stacks on
  // release rows are recognized, not misread as harness failure.
  var MATRIX = [
    { slug: '2021.3.45f2-webgl1',          unity: '2021.3.45f2', pipeline: 'birp', gl: 'webgl1', wasm_hint: '~9 MB',   row: 1, expected_symbols: 'stripped' },
    { slug: '2022.3.62f3-webgl1',          unity: '2022.3.62f3', pipeline: 'birp', gl: 'webgl1', wasm_hint: '~10 MB',  row: 2, expected_symbols: 'stripped' },
    { slug: '2022.3.62f3-webgl2-debug',    unity: '2022.3.62f3', pipeline: 'birp', gl: 'webgl2', wasm_hint: '~15 MB',  row: 3, expected_symbols: 'full' },
    { slug: '2023.2.20f1-webgl2-debug',    unity: '2023.2.20f1', pipeline: 'birp', gl: 'webgl2', wasm_hint: '~16 MB',  row: 4, expected_symbols: 'full' }
  ];

  function logDir() {
    return 'sdmc:/switch/brewser/logs/unity-demos';
  }

  // Persistent picker-side log so we can see whether taps fire + what
  // navigation attempts do. Same directory as demo runs; picker events
  // get a stable filename so re-taps append to the same file across
  // sessions.
  var PICKER_LOG = 'sdmc:/switch/brewser/logs/unity-demos/_picker.log';
  function plog(msg) {
    var line = new Date().toISOString() + ' ' + msg + '\n';
    try { console.log('[picker] ' + msg); } catch (e) {}
    if (typeof Switch !== 'undefined' && Switch) {
      try {
        try { Switch.mkdirSync('sdmc:/switch/brewser/logs'); } catch (e) {}
        try { Switch.mkdirSync('sdmc:/switch/brewser/logs/unity-demos'); } catch (e) {}
        if (typeof Switch.appendFileSync === 'function') Switch.appendFileSync(PICKER_LOG, line);
        else if (typeof Switch.writeFileSync === 'function') Switch.writeFileSync(PICKER_LOG, line);
      } catch (e) { /* nop */ }
    }
  }

  // Same-app navigation: webglconformtest hardware-entry.html:509
  // shows that `window.location.href = './results.html'` works from a
  // keyboard handler, and its <a href="./file.html"> anchors work as
  // taps. Both mechanisms are used here for redundancy — the anchor
  // is the primary path (shell tap-navigate pipeline), the JS click
  // handler is a backup.
  function launchUrlFor(slug) {
    return './runner.html?demo=' + encodeURIComponent(slug);
  }

  function listRecentLogs(slug) {
    // Best-effort directory listing. If the runtime doesn't expose a
    // readdir shim, the picker falls back to "never-run" badges — the
    // launcher still works, we just can't render prior verdicts.
    var results = [];
    if (typeof Switch === 'undefined' || !Switch) return results;
    var reader = null;
    if (typeof Switch.readdirSync === 'function') reader = Switch.readdirSync;
    else if (typeof Switch.readDirSync === 'function') reader = Switch.readDirSync;
    if (!reader) return results;
    try {
      var entries = reader(logDir());
      for (var i = 0; i < entries.length; i++) {
        var name = entries[i];
        if (typeof name !== 'string') name = name.name || String(name);
        if (name.indexOf(slug + '_') === 0 && /\.ndjson$/.test(name)) results.push(name);
      }
      results.sort(); // lexicographic sort works for _YYYYMMDDTHHMMSSZ suffix
    } catch (e) { /* directory missing yet — no runs */ }
    return results;
  }

  function readLog(filename) {
    if (typeof Switch === 'undefined' || !Switch || typeof Switch.readFileSync !== 'function') return null;
    try {
      var text = Switch.readFileSync(logDir() + '/' + filename);
      if (text instanceof Uint8Array || text instanceof ArrayBuffer) {
        var td = new TextDecoder();
        text = td.decode(text);
      }
      return String(text);
    } catch (e) { return null; }
  }

  function parseNdjsonTail(text, maxLines) {
    // Read from the end backwards; NDJSON is one record per line.
    // Take up to maxLines records — enough to find verdict, heartbeat,
    // milestone, and header without dragging in every console spam line.
    var lines = String(text || '').split(/\r?\n/);
    var records = [];
    var count = 0;
    for (var i = lines.length - 1; i >= 0 && count < maxLines; i--) {
      var l = lines[i]; if (!l) continue;
      try { records.push(JSON.parse(l)); count++; }
      catch (e) { /* skip broken tail line — could be a mid-write crash */ }
    }
    return records; // newest-first
  }

  function summarize(records) {
    var verdict = null, verdict_t = null;
    var lastHeartbeat = null, lastHeartbeatT = null;
    var lastMilestone = null, lastMilestoneT = null;
    var header = null;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (!r || !r.kind) continue;
      if (!verdict && (r.kind === 'verdict:final' || r.kind === 'verdict:updated' || r.kind === 'verdict:preliminary')) {
        verdict = r.verdict; verdict_t = r.t;
      }
      if (!lastHeartbeat && r.kind === 'heartbeat') { lastHeartbeat = r; lastHeartbeatT = r.t; }
      if (!lastMilestone && r.kind === 'milestone') { lastMilestone = r.name; lastMilestoneT = r.t; }
      if (r.kind === 'header') header = r;
    }
    // STALLED inference — heartbeat cessation with no verdict:final.
    var now = Date.now();
    var stallHint = null;
    if (verdict && !/^COMPLETED|WASM-UNAVAILABLE|CAPACITY|CRASHED/.test(String(verdict))) verdict = null;
    if (!verdict && lastHeartbeatT && (now - lastHeartbeatT) > HEARTBEAT_GRACE_MS) {
      verdict = 'STALLED(' + (lastMilestone || 'unknown') + ')';
      stallHint = {
        elapsed_since_last_heartbeat_ms: now - lastHeartbeatT,
        elapsed_since_last_milestone_ms: lastMilestoneT ? (now - lastMilestoneT) : null
      };
    }
    return { verdict: verdict, verdict_t: verdict_t, header: header, stallHint: stallHint };
  }

  function badgeClass(verdict) {
    if (!verdict) return 'never';
    if (/^COMPLETED/.test(verdict)) return 'completed';
    if (/^CRASHED/.test(verdict)) return 'crashed';
    if (/^STALLED/.test(verdict)) return 'stalled';
    if (/^WASM-UNAVAILABLE/.test(verdict)) return 'wasm';
    if (/^CAPACITY/.test(verdict)) return 'capacity';
    return 'never';
  }

  function relativeTs(t) {
    if (!t) return '—';
    var d = new Date(t);
    var yy = d.getUTCFullYear();
    var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    var dd = String(d.getUTCDate()).padStart(2, '0');
    var hh = String(d.getUTCHours()).padStart(2, '0');
    var mn = String(d.getUTCMinutes()).padStart(2, '0');
    return yy + '-' + mm + '-' + dd + ' ' + hh + ':' + mn + 'Z';
  }

  function render(rows) {
    var tbody = document.getElementById('demo-rows');
    tbody.innerHTML = '';
    var focusedIdx = 0;
    var rowEls = [];
    for (var i = 0; i < rows.length; i++) {
      var m = rows[i];
      var tr = document.createElement('tr');
      // brewser-runtime doesn't shim HTMLElement.dataset — hitting
      // .dataset throws TypeError and silently kills this loop. Slug
      // capture is done via closure on the Launch button below; the
      // tr itself doesn't need to remember its slug.
      if (i === focusedIdx) tr.className = 'focused';

      tr.appendChild(cell('' + m.row));
      tr.appendChild(cell(m.slug, 'slug'));
      tr.appendChild(cell(m.unity));
      tr.appendChild(cell(m.pipeline.toUpperCase()));
      tr.appendChild(cell(m.gl));
      tr.appendChild(cell(m.wasm_hint, 'size'));

      var symCell = document.createElement('td');
      var symBadge = document.createElement('span');
      symBadge.className = 'sym-badge ' + m.expected_symbols;
      symBadge.textContent = m.expected_symbols;
      symBadge.title = m.expected_symbols === 'stripped'
        ? 'release build — stack traces will be shallow; not a harness failure'
        : 'debug build — full stack traces + readable symbols';
      symCell.appendChild(symBadge);
      tr.appendChild(symCell);

      var badgeCell = document.createElement('td');
      var badge = document.createElement('span');
      badge.className = 'badge ' + badgeClass(m.summary.verdict);
      badge.textContent = m.summary.verdict || 'never-run';
      badgeCell.appendChild(badge);
      tr.appendChild(badgeCell);

      tr.appendChild(cell(relativeTs(m.summary.verdict_t), 'timestamp'));

      var actionCell = document.createElement('td');
      actionCell.className = 'action';
      // Wrap the whole element-creation in an IIFE so `launchA` and
      // `slug` are captured per-iteration. Without this, the mousedown
      // handler's `launchA` reference is the LAST iteration's element
      // and pressing row 1's Launch flashes row 7's button.
      (function (slug) {
        var launchA = document.createElement('a');
        launchA.className = 'launch';
        launchA.textContent = 'Launch';
        var url = launchUrlFor(slug);
        // Use setAttribute — findTapIntent in the runtime reads
        // n.getAttribute('href'), which in a shim'd DOM may not
        // observe assignments to the JS `.href` property. Also set
        // .href for good measure (some code paths use one or the other).
        launchA.setAttribute('href', url);
        try { launchA.href = url; } catch (e) {}
        // Press-color feedback (backup for the CSS :active state).
        launchA.addEventListener('mousedown', function () {
          launchA.className = 'launch pressing';
          plog('mousedown slug=' + slug + ' href=' + url +
               ' attr=' + launchA.getAttribute('href') +
               ' prop=' + launchA.href);
          setTimeout(function () { launchA.className = 'launch'; }, 250);
        });
        launchA.addEventListener('click', function (ev) {
          plog('click slug=' + slug + ' attr=' + launchA.getAttribute('href') +
               ' — attempting location.href fallback');
          try { window.location.href = url; } catch (e) { plog('location.href threw: ' + (e && e.message || e)); }
        });
        actionCell.appendChild(launchA);
      })(m.slug);
      tr.appendChild(actionCell);

      tbody.appendChild(tr);
      rowEls.push(tr);
    }

    // Controller navigation — up/down/A per Brewser convention.
    // Uses direct .className rewrite instead of .classList.toggle
    // because brewser-runtime doesn't shim DOMTokenList.
    function focus(idx) {
      idx = Math.max(0, Math.min(rows.length - 1, idx));
      for (var i = 0; i < rowEls.length; i++) rowEls[i].className = (i === idx ? 'focused' : '');
      focusedIdx = idx;
    }
    // Keyboard navigation. Enter/A on the focused row navigates
    // directly via window.location.href — proven to work in
    // webglconformtest hardware-entry.html:509 from a keydown handler.
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { focus(focusedIdx + 1); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { focus(focusedIdx - 1); ev.preventDefault(); }
      else if (ev.key === 'Enter' || ev.key === 'a' || ev.key === 'A') {
        var slug = rows[focusedIdx].slug;
        var url = launchUrlFor(slug);
        plog('keydown key=' + ev.key + ' slug=' + slug + ' href=' + url);
        try { window.location.href = url; } catch (e) { plog('keydown location.href threw: ' + (e && e.message || e)); }
      }
    });
  }

  function cell(text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
  }

  function start() {
    plog('picker start — location.href=' + String(location.href || ''));
    var status = document.getElementById('status');
    var enriched = MATRIX.map(function (m) {
      var files = listRecentLogs(m.slug);
      var newest = files.length ? files[files.length - 1] : null;
      var summary = { verdict: null, verdict_t: null };
      if (newest) {
        var text = readLog(newest);
        if (text) summary = summarize(parseNdjsonTail(text, 200));
      }
      return Object.assign({}, m, { summary: summary, log: newest });
    });
    var withLogs = enriched.filter(function (m) { return m.summary.verdict; }).length;
    status.textContent = 'Ready — ' + enriched.length + ' rows, ' + withLogs + ' with recent verdicts. Logs at ' + logDir() + '/';
    render(enriched);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

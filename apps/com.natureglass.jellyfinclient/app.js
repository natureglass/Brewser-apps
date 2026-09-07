/**
 * Jellyfin client app — plain JavaScript, no build step.
 * Screens: connect -> auth -> library (shared folders) -> browse (folder
 * navigation with thumbnails) -> detail (pre-launch view) -> player.
 * Settings holds the app log, quality policy, bitrate test and sign-out.
 */
(function () {
  'use strict';
  const JF = globalThis.JF;

  // Detect the brewser runtime. `globalThis.Switch` is NOT exposed to
  // sandboxed pages (it read false in brewser all along — the source of the
  // 4K-Auto saga), so key off the `Brewser/<ver>` product token the engine
  // appends to the page User-Agent. Keep the Switch check as a harmless
  // secondary signal. False on a real browser → the web target.
  const _ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isBrewser = _ua.indexOf('Brewser/') >= 0 || typeof globalThis.Switch !== 'undefined';
  const storage = JF.localStorageAdapter();
  const identity = {
    clientName: 'BrewserJellyfin',
    clientVersion: '0.2.0',
    deviceName: isBrewser ? 'Nintendo Switch (Brewser)' : 'Browser',
    deviceId: JF.createOrRestoreDeviceId(storage),
  };

  let client = null;
  let measuredBitrate;
  let qcCancelled = false;

  // ---- helpers -------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const logEl = $('log');

  function log(msg, isErr) {
    const line = document.createElement('div');
    if (isErr) line.className = 'e';
    line.textContent = new Date().toTimeString().slice(0, 8) + '  ' + msg;
    logEl.appendChild(line);
    while (logEl.childNodes.length > 400) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function fail(e, where) {
    const m = e instanceof JF.JellyfinError ? e.message + ' (' + e.status + ')' : String(e && e.message || e);
    log(where + ': ' + m, true);
    // Never leave the player's loading veil stuck if a load step threw.
    // (hideLoading is a hoisted declaration; the refs it reads are set by
    // the time any failure actually fires at runtime.)
    try { hideLoading(); } catch (_) { /* defined later in scope; ignore pre-init */ }
    return m;
  }

  const SCREENS = ['connect', 'auth', 'library', 'browse', 'detail', 'player', 'settings'];
  let currentScreen = 'connect';
  let settingsReturnTo = 'library';

  function go(name) {
    for (const s of SCREENS) $('screen-' + s).classList.toggle('hidden', s !== name);
    if (name !== 'settings') settingsReturnTo = name;
    currentScreen = name;
    document.body.style.overflow = name === 'player' ? 'hidden' : '';
    window.scrollTo(0, 0);
  }

  const el = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  // Missing or 404ing artwork falls back to the bundled placeholder.
  const PLACEHOLDER = 'assets/default.png';
  function setThumb(img, url) {
    img.onerror = function () { img.onerror = null; img.src = PLACEHOLDER; };
    img.src = url || PLACEHOLDER;
  }

  function thumbClass(item) {
    if (item.Type === 'Episode' || item.Type === 'CollectionFolder') return 'thumb landscape';
    if (item.MediaType === 'Audio' || item.Type === 'MusicAlbum' || item.Type === 'MusicArtist') return 'thumb square';
    return 'thumb';
  }

  function card(item, onClick) {
    const c = el('button', 'card');
    const img = document.createElement('img');
    img.className = thumbClass(item);
    img.loading = 'lazy';
    img.alt = '';
    const w = img.className.indexOf('landscape') >= 0 ? 440 : 300;
    setThumb(img, JF.imageUrl(client, item, { fillWidth: w }));
    c.appendChild(img);
    c.appendChild(el('div', 'label', item.Name || '?'));
    const sub = subLabel(item);
    if (sub) c.appendChild(el('div', 'sub', sub));
    c.onclick = onClick;
    return c;
  }

  function subLabel(item) {
    if (item.Type === 'Episode') {
      const s = item.ParentIndexNumber != null ? 'S' + item.ParentIndexNumber : '';
      const e = item.IndexNumber != null ? 'E' + item.IndexNumber : '';
      return [item.SeriesName, (s + e) || null].filter(Boolean).join(' · ');
    }
    if (item.ProductionYear) return String(item.ProductionYear);
    return '';
  }

  function runtimeText(ticks) {
    if (!ticks) return null;
    const secs = JF.ticksToSeconds(ticks);
    if (secs < 60) return Math.round(secs) + 's';
    const mins = Math.round(secs / 60);
    if (mins < 60) return mins + 'm';
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  }

  /** Precise clock duration: 1:23:45 or 4:05. */
  function clockText(ticks) {
    if (!ticks) return null;
    let s = Math.round(JF.ticksToSeconds(ticks));
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  function sizeText(bytes) {
    if (!bytes || bytes <= 0) return null;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
  }

  function endsAtText(remainingTicks) {
    if (!remainingTicks) return null;
    const t = new Date(Date.now() + JF.ticksToSeconds(remainingTicks) * 1000);
    let h = t.getHours(), m = t.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return 'Ends at ' + h + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;
  }

  // ---- connect -------------------------------------------------------------
  function setStatus(id, msg, isErr) {
    const n = $(id);
    n.textContent = msg || '';
    n.className = 'form-status' + (isErr ? ' err' : '');
  }

  $('btn-connect').onclick = async () => {
    const url = $('server-url').value;
    if (!url.trim()) { setStatus('connect-status', 'Enter your server address', true); return; }
    setStatus('connect-status', 'Connecting…');
    try {
      client = new JF.JellyfinClient({ baseUrl: url, identity: identity, storage: storage });
      const info = await JF.getPublicSystemInfo(client);
      log('connected: ' + client.baseUrl + ' (' + info.ServerName + ' v' + info.Version + ')');
      setStatus('connect-status', '');
      $('auth-server-name').textContent = 'Sign in to ' + (info.ServerName || 'Jellyfin');
      const qc = await JF.isQuickConnectEnabled(client);
      $('btn-qc').classList.toggle('hidden', !qc);
      if (!qc) log('Quick Connect is disabled on this server');
      go('auth');
    } catch (e) {
      fail(e, 'connect');
      const timedOut = e && e.name === 'TimeoutError';
      setStatus('connect-status',
        timedOut
          ? 'No response from that address — check the port and that the server is running.'
          : 'Could not reach a Jellyfin server there. Check the address (scheme, host, port).', true);
    }
  };
  $('server-url').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('btn-connect').click(); });

  // ---- auth ----------------------------------------------------------------
  $('btn-login').onclick = async () => {
    if (!client) return;
    setStatus('auth-status', 'Signing in…');
    try {
      await JF.authenticateByName(client, $('auth-user').value, $('auth-pass').value);
      log('signed in as ' + client.userName);
      onAuthed();
    } catch (e) {
      fail(e, 'login');
      setStatus('auth-status', e instanceof JF.JellyfinError && e.status === 401
        ? 'Wrong username or password.' : 'Sign-in failed. See the log in Settings.', true);
    }
  };
  $('auth-pass').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('btn-login').click(); });

  $('btn-qc').onclick = async () => {
    if (!client) return;
    qcCancelled = false;
    try {
      const init = await JF.initiateQuickConnect(client);
      $('qc-code').textContent = init.Code || '?';
      $('auth-choices').classList.add('hidden');
      $('qc-panel').classList.remove('hidden');
      setStatus('auth-status', '');
      log('quick connect code ' + init.Code + '; waiting for approval');
      await JF.waitForQuickConnect(client, init.Secret, { shouldCancel: () => qcCancelled });
      log('quick connect approved; signed in as ' + client.userName);
      onAuthed();
    } catch (e) {
      if (!qcCancelled) {
        fail(e, 'quick connect');
        setStatus('auth-status', 'Quick Connect failed or expired. Try again.', true);
      }
    } finally {
      $('qc-panel').classList.add('hidden');
      $('auth-choices').classList.remove('hidden');
    }
  };
  $('btn-qc-cancel').onclick = () => { qcCancelled = true; };
  $('btn-change-server').onclick = () => { qcCancelled = true; go('connect'); };

  function onAuthed() {
    setStatus('auth-status', '');
    loadLibraries().catch((e) => fail(e, 'libraries'));
  }

  // ---- libraries (shared folders) -----------------------------------------
  async function loadLibraries() {
    const views = await JF.getViews(client);
    const grid = $('views-grid');
    grid.innerHTML = '';
    for (const v of views.Items || []) {
      grid.appendChild(card(Object.assign({}, v, { Type: 'CollectionFolder' }), () => {
        openFolder(v, true);
      }));
    }
    log('libraries: ' + (views.Items || []).map((v) => v.Name).join(', '));
    go('library');
  }

  // ---- browse (folder navigation) -----------------------------------------
  // Stack of { id, name, sortBy, startIndex } — back pops one level.
  let browseStack = [];

  function openFolder(item, resetStack) {
    if (resetStack) browseStack = [];
    const sortBy = (item.Type === 'Series' || item.Type === 'Season' || item.Type === 'MusicAlbum')
      ? 'IndexNumber,SortName' : 'SortName';
    browseStack.push({ id: item.Id, name: item.Name || '?', sortBy: sortBy, startIndex: 0 });
    loadFolder(true).catch((e) => fail(e, 'browse'));
  }

  const PAGE = 60;

  async function loadFolder(reset) {
    const top = browseStack[browseStack.length - 1];
    const grid = $('items-grid');
    if (reset) { grid.innerHTML = ''; top.startIndex = 0; }
    $('browse-title').textContent = top.name;
    go('browse');

    const page = await JF.getItems(client, {
      parentId: top.id,
      recursive: false, // natural hierarchy: folders stay folders
      sortBy: top.sortBy,
      startIndex: top.startIndex,
      limit: PAGE,
    });
    const items = page.Items || [];
    for (const item of items) grid.appendChild(card(item, () => onItemClick(item)));
    top.startIndex += items.length;
    const total = page.TotalRecordCount || 0;
    $('btn-more').classList.toggle('hidden', top.startIndex >= total);
    $('browse-empty').classList.toggle('hidden', total > 0);
    log('browse "' + top.name + '": ' + top.startIndex + '/' + total);
  }

  function onItemClick(item) {
    if (item.MediaType === 'Video' || item.MediaType === 'Audio') {
      openDetail(item.Id).catch((e) => fail(e, 'detail'));
    } else {
      openFolder(item, false);
    }
  }

  $('btn-more').onclick = () => { loadFolder(false).catch((e) => fail(e, 'browse')); };

  $('btn-browse-back').onclick = () => {
    browseStack.pop();
    if (browseStack.length === 0) { go('library'); return; }
    loadFolder(true).catch((e) => fail(e, 'browse'));
  };

  // ---- pre-launch detail ---------------------------------------------------
  let detailItem = null;

  async function openDetail(itemId) {
    const item = await JF.getItem(client, itemId);
    detailItem = item;

    setThumb($('detail-thumb'),
      JF.imageUrl(client, item, { fillWidth: 600 }) ||
      JF.imageUrl(client, item, { type: 'Backdrop', fillWidth: 600 }));
    $('detail-title').textContent = item.Name || '?';

    const meta = $('detail-meta');
    meta.innerHTML = '';
    const bits = [];
    if (item.SeriesName) bits.push(item.SeriesName);
    if (item.ProductionYear) bits.push(String(item.ProductionYear));
    const rt = runtimeText(item.RunTimeTicks);
    if (rt) bits.push(rt);
    const resumeTicks = (item.UserData && item.UserData.PlaybackPositionTicks) || 0;
    const ends = endsAtText((item.RunTimeTicks || 0) - resumeTicks);
    if (ends) bits.push(ends);
    for (const b of bits) meta.appendChild(el('span', null, b));

    // Stream rows, jellyfin-web style: "Video   720p H264 SDR"
    const streams = $('detail-streams');
    streams.innerHTML = '';
    const source = item.MediaSources && item.MediaSources[0];
    if (source && source.MediaStreams) {
      const v = source.MediaStreams.find((s) => s.Type === 'Video');
      const a = source.MediaStreams.find((s) => s.Type === 'Audio');
      const sub = source.MediaStreams.filter((s) => s.Type === 'Subtitle');
      if (v) addKv(streams, 'Video', [
        v.Height ? v.Height + 'p' : null,
        v.Codec ? v.Codec.toUpperCase() : null,
        v.VideoRange || 'SDR',
      ].filter(Boolean).join(' '));
      if (a) addKv(streams, 'Audio', [
        a.Codec ? a.Codec.toUpperCase() : null,
        a.Channels ? a.Channels + 'ch' : null,
        a.Language || null,
      ].filter(Boolean).join(' '));
      if (sub.length) addKv(streams, 'Subtitles', sub.map((s) => s.Language || s.DisplayTitle || '?').join(', '));
      addKv(streams, 'Duration', clockText(source.RunTimeTicks || item.RunTimeTicks));
      addKv(streams, 'Size', sizeText(source.Size));
      if (source.Container) addKv(streams, 'Container', source.Container);
    }
    if (item.Genres && item.Genres.length) addKv(streams, 'Genre', item.Genres.join(', '));

    $('detail-overview').textContent = item.Overview || '';

    // Resume / Play buttons
    const hasResume = resumeTicks > 0;
    $('btn-resume').classList.toggle('hidden', !hasResume);
    if (hasResume) {
      const s = JF.ticksToSeconds(resumeTicks);
      const mm = Math.floor(s / 60), ss = Math.floor(s % 60);
      $('resume-label').textContent = 'Resume from ' + mm + ':' + (ss < 10 ? '0' + ss : ss);
      $('btn-play').classList.add('secondary');
      $('play-label').textContent = 'Play from beginning';
    } else {
      $('btn-play').classList.remove('secondary');
      $('play-label').textContent = 'Play';
    }

    go('detail');

    // More Like This (after showing the screen; non-blocking)
    const simGrid = $('similar-grid');
    simGrid.innerHTML = '';
    $('similar-h').classList.add('hidden');
    JF.getSimilarItems(client, item.Id, 8).then((sim) => {
      const arr = sim.Items || [];
      if (!arr.length) return;
      $('similar-h').classList.remove('hidden');
      for (const s of arr) simGrid.appendChild(card(s, () => onItemClick(s)));
    }).catch((e) => fail(e, 'similar'));
  }

  function addKv(parent, k, v) {
    if (!v) return;
    const row = el('div', 'kv-row');
    row.appendChild(el('span', 'k', k));
    row.appendChild(el('span', 'v', v));
    parent.appendChild(row);
  }

  $('btn-detail-back').onclick = () => {
    go(browseStack.length ? 'browse' : 'library');
  };
  $('btn-play').onclick = () => { if (detailItem) play(detailItem, 0).catch((e) => fail(e, 'play')); };
  $('btn-resume').onclick = () => {
    if (detailItem) {
      const t = (detailItem.UserData && detailItem.UserData.PlaybackPositionTicks) || 0;
      play(detailItem, t).catch((e) => fail(e, 'play'));
    }
  };

  // ---- player --------------------------------------------------------------
  const video = $('player-video');
  let progress = null;
  let progressTimer = null;

  // Player chrome = the top overlay (Back + title) AND the bottom HTML control
  // bar. Both fade out together 5s after playback starts/resumes, stay put
  // while paused, and any pointer activity brings them back.
  const overlay = $('player-overlay');
  const ctrlBar = $('ctrl-bar');
  let overlayTimer = null;
  function loadingVisible() {
    return loadingEl && !loadingEl.classList.contains('hidden');
  }
  function chromeVisible() { return !overlay.classList.contains('faded'); }
  function setChromeFaded(faded) {
    overlay.classList.toggle('faded', faded);
    if (ctrlBar) ctrlBar.classList.toggle('faded', faded);
  }
  function wakeOverlay() {
    setChromeFaded(false);
    if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
    // Keep the chrome (Back) visible while the loading veil is up — a long
    // transcode start can exceed the fade timeout, and faded chrome is
    // pointer-events:none, which would trap the user with no way to exit.
    if (!video.paused && !video.ended && !loadingVisible()) {
      overlayTimer = setTimeout(() => { setChromeFaded(true); }, 5000);
    }
  }
  video.addEventListener('play', wakeOverlay);
  video.addEventListener('pause', wakeOverlay);
  // Pointer MOVE reveals the chrome (web mouse hover); brewser touch has no
  // hover, so there the frame hit-catcher (#ctrl-hit, below) drives reveal on
  // tap. We deliberately do NOT wake on pointerdown here — that would un-fade
  // the chrome before the frame-tap handler could tell a reveal-tap from a
  // pause-tap.
  $('screen-player').addEventListener('pointermove', wakeOverlay);

  // ---- HTML control bar (drives the <video> element API) -----------------
  // One control UI for both targets: on brewser the frame is engine-blitted and
  // this bar paints over it (above-composite pass, z:3); on the web it's a
  // normal overlay on the native <video>. No engine `controls`, no
  // `brewservideosettings` event — the bar reads/writes currentTime, paused,
  // play()/pause(), duration, muted directly.
  const ctrlPlay = $('ctrl-play');
  const iPlay = $('i-play');
  const iPause = $('i-pause');
  const ctrlMute = $('ctrl-mute');
  const iVol = $('i-vol');
  const iMute = $('i-mute');
  const ctrlCur = $('ctrl-cur');
  const ctrlDur = $('ctrl-dur');
  const ctrlTrack = $('ctrl-track');
  const ctrlFill = $('ctrl-fill');
  const ctrlKnob = $('ctrl-knob');
  let uiTimer = 0;
  let itemDurationSec = 0;    // fallback duration (item RunTimeTicks) when the
                              // decoder reports 0 (common for HLS transcodes)
  const uiLast = { pct: '', cur: '', dur: '', play: null, mute: null }; // change gate

  function formatSecs(s) {
    if (!Number.isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); const sec = s - m * 60;
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return h > 0 ? h + ':' + pad(m) + ':' + pad(sec) : m + ':' + pad(sec);
  }
  function effectiveDuration() {
    const d = video.duration;
    if (Number.isFinite(d) && d > 0) return d;
    return itemDurationSec > 0 ? itemDurationSec : 0;
  }
  function setIconPair(showFirst, first, second) {
    if (first) first.classList.toggle('hidden', !showFirst);
    if (second) second.classList.toggle('hidden', showFirst);
  }
  // Repaint the bar from the current <video> state. Only touches the DOM when a
  // value actually changed, so brewser doesn't re-dirty/repaint every tick.
  function updateControls() {
    const playState = !!(video.paused || video.ended);
    if (playState !== uiLast.play) { setIconPair(playState, iPlay, iPause); uiLast.play = playState; } // paused → ▶
    const muteState = !video.muted;
    if (muteState !== uiLast.mute) { setIconPair(muteState, iVol, iMute); uiLast.mute = muteState; }
    const dur = effectiveDuration();
    const cur = video.currentTime || 0;
    const ratio = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
    const pct = (ratio * 100).toFixed(2) + '%';
    if (pct !== uiLast.pct) {
      if (ctrlFill) ctrlFill.style.width = pct;
      if (ctrlKnob) ctrlKnob.style.left = pct;
      uiLast.pct = pct;
    }
    const curT = formatSecs(cur);
    if (curT !== uiLast.cur) { if (ctrlCur) ctrlCur.textContent = curT; uiLast.cur = curT; }
    const durT = dur > 0 ? formatSecs(dur) : '--:--';
    if (durT !== uiLast.dur) { if (ctrlDur) ctrlDur.textContent = durT; uiLast.dur = durT; }
  }
  function startUiLoop() {
    if (uiTimer) return;
    updateControls();
    uiTimer = setInterval(() => {
      if (currentScreen !== 'player') { stopUiLoop(); return; }
      updateControls();
    }, 250);
  }
  function stopUiLoop() {
    if (uiTimer) { clearInterval(uiTimer); uiTimer = 0; }
    // Force the next updateControls to repaint (state may be stale next open).
    uiLast.pct = ''; uiLast.cur = ''; uiLast.dur = ''; uiLast.play = null; uiLast.mute = null;
  }

  if (ctrlPlay) ctrlPlay.onclick = () => {
    if (video.paused || video.ended) video.play().catch(() => {}); else video.pause();
    wakeOverlay();
  };
  if (ctrlMute) ctrlMute.onclick = () => { video.muted = !video.muted; updateControls(); wakeOverlay(); };
  if ($('ctrl-gear')) $('ctrl-gear').onclick = () => { openSettingsModal(); wakeOverlay(); };

  // Progress seek. brewser's touch→DOM delivery during a drag is unreliable
  // (the engine has a native scrub path for its OWN drawn bar, which we don't
  // use), so we seek on every signal we might get — pointerdown, pointermove-
  // while-pressed, and click — throttled so a web drag / transcode re-request
  // doesn't thrash. getBoundingClientRect + clientX is correct for the fixed
  // player (its layout box == screen coords: viewport 0, no scroll).
  let seekPressed = false;
  let lastSeekAt = 0;
  function ratioFromEvent(ev) {
    if (!ctrlTrack) return -1;
    const r = ctrlTrack.getBoundingClientRect();
    if (!r || !r.width) return -1;
    return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
  }
  function seekToRatio(ratio, force) {
    if (ratio < 0) return;
    const now = performance.now();
    if (!force && now - lastSeekAt < 200) return; // throttle live drags
    lastSeekAt = now;
    const dur = effectiveDuration();
    if (dur > 0) { video.currentTime = ratio * dur; updateControls(); }
  }
  if (ctrlTrack) {
    ctrlTrack.addEventListener('pointerdown', (ev) => {
      seekPressed = true;
      seekToRatio(ratioFromEvent(ev), true);
      try { ctrlTrack.setPointerCapture(ev.pointerId); } catch (_) { /* optional */ }
      ev.preventDefault(); ev.stopPropagation();
      wakeOverlay();
    });
    ctrlTrack.addEventListener('pointermove', (ev) => {
      if (!seekPressed) return;
      seekToRatio(ratioFromEvent(ev), false);
      ev.preventDefault();
    });
    const release = () => { seekPressed = false; };
    ctrlTrack.addEventListener('pointerup', release);
    ctrlTrack.addEventListener('pointercancel', release);
    document.addEventListener('pointerup', release);
    // Tap-to-seek fallback: the engine dispatches `click` on a tap even when it
    // doesn't deliver pointer up/move to a plain element.
    ctrlTrack.onclick = (ev) => { seekToRatio(ratioFromEvent(ev), true); ev.stopPropagation(); };
  }

  // Frame tap (the transparent hit-catcher over the video, NOT the <video> —
  // see #ctrl-hit): chrome hidden → reveal it; chrome shown → toggle play/
  // pause. `click` is reliably dispatched on a tap; the chrome only un-fades on
  // pointer MOVE (web hover) — never on this tap — so a first tap reveals
  // without also pausing. Paused always resumes.
  const ctrlHit = $('ctrl-hit');
  if (ctrlHit) ctrlHit.onclick = () => {
    if (video.paused || video.ended) { video.play().catch(() => {}); wakeOverlay(); }
    else if (!chromeVisible()) { wakeOverlay(); } // reveal only
    else { video.pause(); wakeOverlay(); }        // pause, keep chrome up
  };

  // --- Video stats overlay ("Show video stats" setting) --------------------
  // Top-right HUD: negotiated play method + source stream info + the ACTUAL
  // decoded resolution (video.videoWidth/Height — reveals whether a source is
  // being downscaled by the server or direct-played at full res) + a live
  // render fps (rAF-counted = the shell's present rate, i.e. 60 vs 30). Paints
  // over the blitted frame via the same above-composite pass as the top bar
  // (z-index:2). Refreshed ~2x/s while active.
  const statsEl = $('video-stats');
  let currentPlaySrc = null; // last resolved { playMethod, protocol, source }
  let currentPlayCaps = null; // last resolved quality caps (for the overlay)
  let currentPlayItem = null; // the item currently playing (for the settings modal)
  let playAudioIndex = null; // requested audio stream index (null = server default)
  let playSubtitleIndex = null; // requested subtitle stream index (null=default, -1=off)
  let statsActive = false;
  let statsFrames = 0, statsLastT = 0, statsFps = 0;
  function statsEnabled() {
    return !!($('show-stats') && $('show-stats').checked);
  }
  function renderStats() {
    if (!statsEl) return;
    const s = currentPlaySrc;
    const streams = s && s.source && s.source.MediaStreams;
    const vs = streams ? streams.find((m) => m.Type === 'Video') : null;
    const lines = [];
    lines.push('Play   : ' + (s ? s.playMethod + ' (' + s.protocol + ')' : '—'));
    if (vs) {
      const fps = vs.RealFrameRate || vs.AverageFrameRate;
      lines.push('Source : ' + (vs.Width || '?') + '×' + (vs.Height || '?')
        + (vs.Codec ? ' ' + vs.Codec : '')
        + (fps ? ' @' + (Math.round(fps * 100) / 100) : '')
        + (vs.BitRate ? ' · ' + (vs.BitRate / 1e6).toFixed(1) + ' Mb/s' : ''));
    }
    const dw = video.videoWidth || 0, dh = video.videoHeight || 0;
    lines.push('Decoded: ' + (dw && dh ? dw + '×' + dh : '—'));
    lines.push('Render : ' + (statsFps || '—') + ' fps');
    // Requested resolution cap — the resolution the app asked the server for.
    if (currentPlayCaps) {
      lines.push('Cap    : ' + (currentPlayCaps.maxWidth || 0) + '×'
        + (currentPlayCaps.maxHeight || 0));
    }
    statsEl.textContent = lines.join('\n');
  }
  function statsLoop() {
    if (!statsActive) return; // stopStats() clears the flag; loop stops here
    statsFrames++;
    const now = performance.now();
    if (!statsLastT) statsLastT = now;
    else if (now - statsLastT >= 500) {
      statsFps = Math.round((statsFrames * 1000) / (now - statsLastT));
      statsFrames = 0; statsLastT = now;
      renderStats();
    }
    requestAnimationFrame(statsLoop);
  }
  function startStats() {
    if (statsActive || !statsEl) return;
    statsActive = true;
    statsFrames = 0; statsLastT = 0; statsFps = 0;
    statsEl.classList.remove('hidden');
    renderStats();
    requestAnimationFrame(statsLoop);
  }
  function stopStats() {
    statsActive = false;
    if (statsEl) statsEl.classList.add('hidden');
  }

  // Loading veil: shown from the moment we start opening a stream (before the
  // PlaybackInfo round-trip has even resolved a URL) until the first frame is
  // on screen — so the user sees "Loading stream, please wait…" instead of the
  // engine's big play-triangle (which reads as a "tap me" button during the
  // several-second transcode ramp-up). The dots animate via setInterval, which
  // both signals progress and keeps the shell repainting while nothing else on
  // the (otherwise static) loading screen changes.
  const loadingEl = $('player-loading');
  const loadingMsg = $('player-loading-msg');
  let loadingDotsTimer = null;
  let loadingGiveUp = null;
  function showLoading() {
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (loadingDotsTimer) { clearInterval(loadingDotsTimer); loadingDotsTimer = null; }
    let dots = 0;
    loadingDotsTimer = setInterval(() => {
      dots = (dots + 1) % 4;
      if (loadingMsg) loadingMsg.textContent = 'Loading stream, please wait' + '.'.repeat(dots);
    }, 400);
    // Never stick forever: if the first frame never arrives (silent decode
    // stall, no error event), drop the veil after a generous window so the
    // player is at least escapable / shows whatever the engine has.
    if (loadingGiveUp) { clearTimeout(loadingGiveUp); }
    loadingGiveUp = setTimeout(hideLoading, 45000);
  }
  function hideLoading() {
    if (loadingDotsTimer) { clearInterval(loadingDotsTimer); loadingDotsTimer = null; }
    if (loadingGiveUp) { clearTimeout(loadingGiveUp); loadingGiveUp = null; }
    if (loadingEl) loadingEl.classList.add('hidden');
    // Veil is down now → (re)start the top-bar fade cycle it was suppressing.
    wakeOverlay();
  }
  // First visible frame → drop the veil (engine dispatches `playing` then).
  // `ended`/`error` are safety nets so the veil never sticks.
  video.addEventListener('playing', hideLoading);
  video.addEventListener('ended', hideLoading);
  video.addEventListener('error', hideLoading);

  function qualityPolicy() {
    // In brewser the <select>.value can come back '' / the label / undefined when
    // the active choice is the default `selected` option (the live-DOM doesn't
    // reflect the selected attribute into .value). That used to fall through to
    // { maxHeight: Number(v) } → Number('')=0 / Number('Auto')=NaN → a 0×0
    // resolution cap on Auto (the whole 4K-Auto bug). So: recognise the explicit
    // qualities and DEFAULT everything else (incl. 'auto', '', unknown) to Auto.
    const v = ($('quality') && $('quality').value) || '';
    if (v === 'source') return { mode: 'source' };
    if (v === '480') return { mode: { maxHeight: 480, maxFps: 30 } };
    if (v === '1080' || v === '720') return { mode: { maxHeight: Number(v) } };
    return { mode: 'auto' };
  }

  async function play(item, resumeTicks, opts) {
    opts = opts || {};
    currentPlayItem = item;
    await stopPlayback();
    $('player-title').textContent = item.Name || '';
    // Fallback duration for the progress bar when the decoder reports 0 (HLS
    // transcodes often do): the item's own runtime.
    itemDurationSec = JF.ticksToSeconds(item.RunTimeTicks || 0);
    wakeOverlay();
    go('player');
    startUiLoop();

    if (item.MediaType === 'Audio') {
      const url = JF.audioUniversalUrl(client, item.Id);
      log('audio universal -> ' + url);
      video.src = url;
      video.play().catch(() => { /* user gesture needed; fine */ });
      return;
    }

    // Video: show the loading veil now, before the PlaybackInfo round-trip +
    // transcode ramp-up. Dropped on the first frame (`playing`) or on error.
    showLoading();

    // Screen size drives the 'auto' resolution cap. innerWidth/innerHeight report
    // brewser's fixed 1280×720 canvas fine; floor the result defensively so a bad
    // reading can never collapse the cap to 0 (which would stop the server
    // downscaling and leave the A57 decoding 4K → slow motion). Explicit
    // qualities (720p/480p/…) ignore the screen size entirely.
    const _dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
    const _iw = (typeof innerWidth === 'number' && innerWidth > 0) ? innerWidth : 1280;
    const _ih = (typeof innerHeight === 'number' && innerHeight > 0) ? innerHeight : 720;
    let _sw = Math.round(_iw * _dpr);
    let _sh = Math.round(_ih * _dpr);
    if (!Number.isFinite(_sw) || _sw < 640) _sw = 1280;
    if (!Number.isFinite(_sh) || _sh < 360) _sh = 720;
    const caps = JF.resolveQualityCaps(qualityPolicy(), {
      screenWidth: _sw,
      screenHeight: _sh,
      measuredBitrate: measuredBitrate,
      isBrewser: isBrewser,
    });
    currentPlayCaps = caps; // feeds the video-stats overlay
    log('caps: ' + caps.maxWidth + 'x' + caps.maxHeight +
      (caps.maxFps ? '@' + caps.maxFps : '') +
      ' <= ' + (caps.maxStreamingBitrate / 1e6).toFixed(1) + ' Mbps');

    playAudioIndex = (opts.audioStreamIndex != null) ? opts.audioStreamIndex : null;
    playSubtitleIndex = (opts.subtitleStreamIndex != null) ? opts.subtitleStreamIndex : null;
    const profile = isBrewser ? JF.buildBrewserDeviceProfile(caps) : JF.buildWebDeviceProfile(caps);
    const info = await JF.getPlaybackInfo(client, item.Id, {
      deviceProfile: profile,
      maxStreamingBitrate: caps.maxStreamingBitrate,
      startTimeTicks: resumeTicks,
      audioStreamIndex: opts.audioStreamIndex,
      subtitleStreamIndex: opts.subtitleStreamIndex,
    });
    const src = JF.resolveVideoSource(client, item.Id, info, caps);
    currentPlaySrc = src; // feeds the video-stats overlay
    log('play method: ' + src.playMethod + ' (' + src.protocol + ')');
    log('src: ' + src.url);

    // Attach + start playback. Brewser demuxes HLS/files natively; on the web,
    // transcoded HLS goes through hls.js (MSE), direct-play MP4 / Safari-HLS use
    // the native <video>. Also (web) adds native subtitle <track>s.
    attachSource(src, resumeTicks);
    if (statsEnabled()) startStats();

    progress = {
      itemId: item.Id,
      mediaSourceId: src.mediaSourceId,
      playSessionId: src.playSessionId,
      playMethod: src.playMethod,
    };
    await JF.reportPlaybackStart(client, progress, resumeTicks);
    progressTimer = setInterval(() => {
      if (!client || !progress) return;
      JF.reportPlaybackProgress(client, progress, JF.secondsToTicks(video.currentTime), video.paused)
        .catch((e) => fail(e, 'progress'));
    }, 10000);
  }

  async function stopPlayback() {
    hideLoading();
    stopStats();
    stopUiLoop();
    seekPressed = false;
    closeSettingsModal();
    currentPlaySrc = null;
    if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; }
    setChromeFaded(false);
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    if (client && progress) {
      try {
        await JF.reportPlaybackStopped(client, progress, JF.secondsToTicks(video.currentTime));
        log('stopped @ ' + video.currentTime.toFixed(0) + 's (resume point saved)');
      } catch (e) { fail(e, 'stop report'); }
      progress = null;
    }
    detachHls();
    clearSubtitleTracks();
    video.removeAttribute('src');
    video.load();
    // Clear the picture transform (both engine data-* and web CSS) for the
    // next item.
    resetVideoCss();
    video.removeAttribute('data-aspect');
    video.removeAttribute('data-crop');
    video.setAttribute('data-zoom', '1');
    displayTransform = { aspect: '', zoom: '1', crop: '' };
  }

  async function exitPlayer() {
    await stopPlayback();
    if (detailItem) {
      // Re-open detail so the resume position reflects what just happened.
      openDetail(detailItem.Id).catch((e) => fail(e, 'detail'));
    } else {
      go(browseStack.length ? 'browse' : 'library');
    }
  }

  $('btn-player-back').onclick = () => { exitPlayer(); };
  video.addEventListener('ended', () => { exitPlayer(); });

  // ---- source attach (hls.js on web) --------------------------------------
  let currentHls = null;       // active hls.js instance (web transcode only)
  let hlsLoaderPromise = null; // memoised lazy <script> load

  // hls.js is only needed on the WEB target for transcoded HLS in non-Safari
  // browsers; load it lazily so brewser (native HLS) never pays for it.
  function ensureHls() {
    if (globalThis.Hls) return Promise.resolve(globalThis.Hls);
    if (hlsLoaderPromise) return hlsLoaderPromise;
    hlsLoaderPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'hls.min.js';
      s.onload = () => resolve(globalThis.Hls);
      s.onerror = () => { hlsLoaderPromise = null; reject(new Error('failed to load hls.min.js')); };
      document.head.appendChild(s);
    });
    return hlsLoaderPromise;
  }
  function detachHls() {
    if (currentHls) { try { currentHls.destroy(); } catch (_) { /* ignore */ } currentHls = null; }
  }

  function attachSource(src, resumeTicks) {
    detachHls();
    clearSubtitleTracks();
    const url = src.url;
    const isHls = src.protocol === 'hls' || /\.m3u8(\?|$)/i.test(url);
    const doResume = () => {
      if (resumeTicks > 0 && src.playMethod === 'DirectPlay') {
        // Direct play seeks locally; transcodes already start at startTimeTicks.
        video.currentTime = JF.ticksToSeconds(resumeTicks);
        log('resuming at ' + JF.ticksToSeconds(resumeTicks).toFixed(0) + 's');
      }
    };

    if (isBrewser) {
      // Engine <video> demuxes HLS + files natively via libav.
      video.src = url;
      doResume();
      video.play().catch(() => { /* user gesture needed; fine */ });
      return;
    }

    // Web: native subtitle tracks (the web profile requests External delivery).
    addWebSubtitleTracks(src);

    const nativeHls = video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl');
    if (isHls && !nativeHls) {
      ensureHls().then((Hls) => {
        if (Hls && Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
          currentHls = hls;
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (data && data.fatal) log('hls.js fatal: ' + data.type + ' / ' + data.details, true);
          });
          hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
          hls.loadSource(url);
          hls.attachMedia(video);
        } else {
          video.src = url; video.play().catch(() => {});
        }
      }).catch((e) => { fail(e, 'hls.js'); video.src = url; video.play().catch(() => {}); });
      return;
    }

    // Safari native HLS, or direct-play MP4.
    video.src = url;
    doResume();
    video.play().catch(() => {});
  }

  // ---- web subtitles (native <track>/WebVTT) ------------------------------
  // On the web the server delivers subtitles as external tracks (see
  // buildWebDeviceProfile's External SubtitleProfiles); brewser burns them in.
  let subtitleTracks = []; // <track> elements added on the web
  function clearSubtitleTracks() {
    for (const t of subtitleTracks) { try { t.remove(); } catch (_) { /* ignore */ } }
    subtitleTracks = [];
  }
  function addWebSubtitleTracks(src) {
    const streams = (src.source && src.source.MediaStreams) || [];
    const subs = streams.filter((m) =>
      m.Type === 'Subtitle' && m.DeliveryUrl && (m.DeliveryMethod === 'External' || m.IsExternal));
    if (!subs.length) return;
    // Cross-origin text tracks require the media element in anonymous CORS mode
    // (Jellyfin sends CORS headers). Only set when we actually add tracks.
    try { video.crossOrigin = 'anonymous'; } catch (_) { /* ignore */ }
    for (const m of subs) {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.src = JF.subtitleTrackUrl(client, m.DeliveryUrl);
      if (m.Language) track.srclang = m.Language;
      track.label = m.DisplayTitle || m.Language || ('Subtitle ' + m.Index);
      track.setAttribute('data-index', String(m.Index));
      video.appendChild(track);
      subtitleTracks.push(track);
    }
    // Re-apply the current selection (survives an audio-change reload).
    showSubtitleTrack(playSubtitleIndex != null ? playSubtitleIndex : -1);
  }
  function showSubtitleTrack(index) {
    const tracks = video.textTracks;
    for (let i = 0; i < subtitleTracks.length; i++) {
      const el = subtitleTracks[i];
      const on = parseInt(el.getAttribute('data-index'), 10) === index;
      const tt = tracks && tracks[i];
      if (tt) tt.mode = on ? 'showing' : 'disabled';
    }
  }

  // ---- web display transform (CSS) ----------------------------------------
  // Brewser applies aspect/zoom/crop as a real per-frame transform via data-*
  // attrs (engine); the web replicates it with CSS on the <video>.
  function resetVideoCss() {
    const s = video.style;
    s.transform = ''; s.transformOrigin = ''; s.objectFit = ''; s.objectPosition = '';
    s.width = ''; s.height = ''; s.left = ''; s.top = ''; s.right = ''; s.bottom = '';
  }
  function sizeBoxToAR(ar, fit) {
    const cw = window.innerWidth || 0, ch = window.innerHeight || 0;
    if (!ar || !cw || !ch) return;
    let w = cw, h = cw / ar;
    if (h > ch) { h = ch; w = ch * ar; }
    const s = video.style;
    s.width = w + 'px'; s.height = h + 'px';
    s.left = ((cw - w) / 2) + 'px'; s.top = ((ch - h) / 2) + 'px';
    s.right = 'auto'; s.bottom = 'auto';
    s.objectFit = fit;
  }
  function applyWebTransform(aspect, crop, zoom) {
    resetVideoCss();
    if (crop) {
      // Center-crop the source to the crop AR (cover fills the box + clips).
      sizeBoxToAR(parseFloat(crop), 'cover');
    } else if (aspect) {
      // Force a display AR (stretch the source into that AR box).
      sizeBoxToAR(parseFloat(aspect), 'fill');
    }
    if (zoom && zoom !== 1) {
      video.style.transformOrigin = 'center center';
      video.style.transform = 'scale(' + zoom + ')';
    }
  }

  // ---- playback settings modal (opened by the control-bar gear) -----------
  // Aspect/Zoom/Crop map a dropdown to the display transform (brewser: engine
  // data-* attrs; web: CSS on the <video>). Applied live for instant preview.
  // Audio re-requests the stream on both targets. Subtitle: web toggles a
  // native <track>; brewser re-requests (burned in server-side). Chapter + Jump
  // seek in real time.
  const ASPECT_OPTS = [
    ['Default', ''], ['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['16:10', 1.6],
    ['2.21:1', 2.21], ['2.35:1', 2.35], ['2.39:1', 2.39], ['5:4', 1.25],
  ];
  const ZOOM_OPTS = [
    ['1:4 Quarter', 0.25], ['1:2 Half', 0.5], ['1:1 Original', 1], ['2:1 Double', 2],
  ];
  const CROP_OPTS = [
    ['Default', ''], ['16:10', 1.6], ['16:9', 16 / 9], ['4:3', 4 / 3], ['1.85:1', 1.85],
    ['2.21:1', 2.21], ['2.35:1', 2.35], ['2.39:1', 2.39], ['5:3', 5 / 3], ['5:4', 1.25], ['1:1', 1],
  ];
  let settingsSnapshot = null; // { aspect, zoom, crop, audioIndex, subtitleIndex } at open
  // Current picture transform, tracked explicitly (not read back from data-*)
  // so it's target-agnostic — the web path applies CSS, not data-* attrs.
  let displayTransform = { aspect: '', zoom: '1', crop: '' };

  function fillSelect(sel, opts, selectedValue) {
    if (!sel) return;
    sel.innerHTML = '';
    for (const pair of opts) {
      const o = document.createElement('option');
      o.value = String(pair[1]);
      o.textContent = pair[0];
      sel.appendChild(o);
    }
    sel.value = String(selectedValue); // set explicitly (engine doesn't reflect `selected`)
  }

  // Read the aspect/zoom/crop selects and apply the transform for the current
  // target: brewser sets data-* attrs (engine frame transform); web sets CSS.
  function applyDisplayTransform() {
    const aspect = $('vs-aspect').value || '';
    const crop = $('vs-crop').value || '';
    const z = parseFloat($('vs-zoom').value);
    const zoom = Number.isFinite(z) && z > 0 ? z : 1;
    displayTransform = { aspect: aspect, zoom: String(zoom), crop: crop };
    if (isBrewser) {
      const setRatio = (name, v) => {
        if (v === '' || v == null) video.removeAttribute(name); else video.setAttribute(name, String(v));
      };
      setRatio('data-aspect', aspect);
      setRatio('data-crop', crop);
      video.setAttribute('data-zoom', String(zoom));
    } else {
      applyWebTransform(aspect, crop, zoom);
    }
  }

  function currentTransform() {
    return { aspect: displayTransform.aspect, zoom: displayTransform.zoom, crop: displayTransform.crop };
  }

  function streamsOfType(type) {
    const s = currentPlaySrc && currentPlaySrc.source && currentPlaySrc.source.MediaStreams;
    return (s || []).filter((m) => m.Type === type);
  }
  function streamLabel(m, fallback) {
    return (m.DisplayTitle || ((m.Language || fallback) + ' ' + (m.Codec || ''))).trim() || fallback;
  }

  function openSettingsModal() {
    const modal = $('settings-modal');
    if (!modal) return;
    // Audio tracks.
    const audio = streamsOfType('Audio');
    const audioOpts = audio.length
      ? audio.map((m) => [streamLabel(m, 'Audio'), m.Index])
      : [['Default', -1]];
    const src = currentPlaySrc && currentPlaySrc.source;
    const curAudio = (playAudioIndex != null) ? playAudioIndex
      : (src && src.DefaultAudioStreamIndex != null ? src.DefaultAudioStreamIndex : audioOpts[0][1]);
    fillSelect($('vs-audio'), audioOpts, curAudio);
    // Subtitles (Off + each track).
    const subs = streamsOfType('Subtitle');
    const subOpts = [['Off', -1]].concat(subs.map((m) => [streamLabel(m, 'Subtitle'), m.Index]));
    const curSub = (playSubtitleIndex != null) ? playSubtitleIndex : -1;
    fillSelect($('vs-subtitle'), subOpts, curSub);
    // Chapters.
    const chapters = (currentPlayItem && currentPlayItem.Chapters) || [];
    const chapOpts = [['— Jump to chapter —', -1]].concat(chapters.map((c, i) => {
      const secs = JF.ticksToSeconds(c.StartPositionTicks || 0);
      const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
      return [(c.Name || ('Chapter ' + (i + 1))) + '  ' + m + ':' + (s < 10 ? '0' : '') + s, i];
    }));
    fillSelect($('vs-chapter'), chapOpts, -1);
    // Aspect / Zoom / Crop from the current transform.
    const t = currentTransform();
    fillSelect($('vs-aspect'), ASPECT_OPTS, t.aspect);
    fillSelect($('vs-zoom'), ZOOM_OPTS, t.zoom);
    fillSelect($('vs-crop'), CROP_OPTS, t.crop);
    settingsSnapshot = {
      aspect: t.aspect, zoom: t.zoom, crop: t.crop,
      audioIndex: curAudio, subtitleIndex: curSub,
    };
    modal.classList.remove('hidden');
  }

  function closeSettingsModal() {
    const modal = $('settings-modal');
    if (modal) modal.classList.add('hidden');
  }

  function reloadStreamWith(opts) {
    if (!currentPlayItem) return;
    const t = video.currentTime || 0;
    log('reload stream audio=' + opts.audioStreamIndex + ' sub=' + opts.subtitleStreamIndex +
      ' @' + t.toFixed(0) + 's');
    play(currentPlayItem, JF.secondsToTicks(t), opts).catch((e) => fail(e, 'reload stream'));
  }

  // Aspect/Zoom/Crop: live preview on change.
  ['vs-aspect', 'vs-zoom', 'vs-crop'].forEach((id) => {
    if ($(id)) $(id).onchange = applyDisplayTransform;
  });
  // Chapter: jump immediately (real time).
  if ($('vs-chapter')) $('vs-chapter').onchange = () => {
    const i = parseInt($('vs-chapter').value, 10);
    const chapters = (currentPlayItem && currentPlayItem.Chapters) || [];
    if (i >= 0 && chapters[i]) {
      video.currentTime = JF.ticksToSeconds(chapters[i].StartPositionTicks || 0);
    }
  };
  // Jump buttons: real-time ±10s.
  if ($('vs-jump-back')) $('vs-jump-back').onclick = () => {
    video.currentTime = Math.max(0, (video.currentTime || 0) - 10);
  };
  if ($('vs-jump-fwd')) $('vs-jump-fwd').onclick = () => {
    const d = video.duration || 0;
    let t = (video.currentTime || 0) + 10;
    if (d > 0) t = Math.min(t, d - 0.5);
    video.currentTime = t;
  };
  // Reset to Defaults: clear picture transform + default audio + subtitles off.
  if ($('vs-reset')) $('vs-reset').onclick = () => {
    $('vs-aspect').value = '';
    $('vs-zoom').value = '1';
    $('vs-crop').value = '';
    applyDisplayTransform();
    const a = $('vs-audio');
    if (a && a.options.length) a.value = a.options[0].value;
    if ($('vs-subtitle')) $('vs-subtitle').value = '-1';
  };
  // Cancel: revert the live picture transform to the open-time snapshot; drop
  // any staged audio/subtitle change.
  if ($('vs-cancel')) $('vs-cancel').onclick = () => {
    if (settingsSnapshot) {
      $('vs-aspect').value = settingsSnapshot.aspect;
      $('vs-zoom').value = settingsSnapshot.zoom;
      $('vs-crop').value = settingsSnapshot.crop;
      applyDisplayTransform();
    }
    closeSettingsModal();
  };
  // Save: keep the picture transform; apply audio/subtitle.
  if ($('vs-save')) $('vs-save').onclick = () => {
    applyDisplayTransform();
    const snap = settingsSnapshot || {};
    const newAudio = parseInt($('vs-audio').value, 10);
    const newSub = parseInt($('vs-subtitle').value, 10);
    const audioChanged = Number.isFinite(newAudio) && newAudio >= 0 && newAudio !== snap.audioIndex;
    const subChanged = newSub !== snap.subtitleIndex;
    closeSettingsModal();
    // Web with native subtitle tracks: switch the <track> without re-fetching;
    // only an audio change needs a reload (which re-adds + re-selects tracks).
    if (!isBrewser && subtitleTracks.length) {
      if (subChanged) { playSubtitleIndex = newSub; showSubtitleTrack(newSub); }
      if (audioChanged) {
        reloadStreamWith({
          audioStreamIndex: newAudio,
          subtitleStreamIndex: playSubtitleIndex, // preserved across the reload
        });
      }
      return;
    }
    // Brewser (burn-in) / web-without-external-subs: any audio or subtitle
    // change re-requests the stream.
    if (audioChanged || subChanged) {
      reloadStreamWith({
        audioStreamIndex: (Number.isFinite(newAudio) && newAudio >= 0) ? newAudio : undefined,
        subtitleStreamIndex: newSub, // -1 = off
      });
    }
  };
  // (The control-bar gear button — wired in the control-bar block above —
  // calls openSettingsModal() directly; no engine `brewservideosettings`
  // event is used any more.)

  // ---- settings ------------------------------------------------------------
  function openSettings() {
    $('set-server').textContent = client ? client.baseUrl : '-';
    $('set-user').textContent = client ? (client.userName || client.userId || '-') : '-';
    $('set-platform').textContent = (isBrewser ? 'Brewser / Switch' : 'Browser') +
      ' · device ' + identity.deviceId.slice(0, 8);
    go('settings');
    logEl.scrollTop = logEl.scrollHeight;
  }
  $('btn-settings').onclick = openSettings;
  $('btn-settings-2').onclick = openSettings;
  $('btn-settings-back').onclick = () => { go(settingsReturnTo); };

  $('quality').onchange = () => { storage.set('quality', $('quality').value); };

  $('show-stats').onchange = () => {
    storage.set('showStats', $('show-stats').checked ? '1' : '');
    // Toggling mid-playback: show immediately (a source is active) or hide.
    if ($('show-stats').checked) { if (currentPlaySrc) startStats(); }
    else stopStats();
  };

  $('btn-bitrate').onclick = async () => {
    if (!client) return;
    $('set-bitrate').textContent = 'measuring…';
    try {
      measuredBitrate = await JF.detectBitrate(client);
      $('set-bitrate').textContent = (measuredBitrate / 1e6).toFixed(1) + ' Mbps';
      log('bitrate test: ' + (measuredBitrate / 1e6).toFixed(1) + ' Mbps');
    } catch (e) {
      $('set-bitrate').textContent = 'failed';
      fail(e, 'bitrate test');
    }
  };

  $('btn-exit').onclick = () => {
    stopPlayback();
    try {
      const S = globalThis.Switch;
      // Brewser/nx.js exit hook — if the runtime names it differently,
      // this is the one line to change.
      if (S && typeof S.exit === 'function') { S.exit(); return; }
    } catch (e) { /* fall through */ }
    try { window.close(); } catch (e) { /* browsers may block this */ }
    log('exit not supported on this platform');
  };

  $('btn-signout').onclick = async () => {
    try { if (client) await JF.logout(client); } catch (e) { fail(e, 'logout'); }
    client = null;
    browseStack = [];
    detailItem = null;
    go('connect');
  };

  // ---- boot ----------------------------------------------------------------
  const savedQuality = storage.get('quality');
  // Set .value explicitly (defaulting to 'auto') so the select carries a known
  // value even if the engine never applied the option's `selected` attribute.
  $('quality').value = savedQuality || 'auto';
  $('show-stats').checked = storage.get('showStats') === '1';

  log('platform: ' + (isBrewser ? 'Brewser/Switch' : 'browser') + ' · deviceId ' + identity.deviceId.slice(0, 8) + '…');

  const restored = JF.restoreSession(storage, identity);
  if (restored) {
    client = restored;
    $('server-url').value = client.baseUrl;
    log('restored session for ' + (client.userName || client.userId));
    loadLibraries().catch((e) => {
      // Token revoked or server gone: fall back to the connect screen.
      fail(e, 'session restore');
      client = null;
      go('connect');
    });
  } else {
    go('connect');
  }

  // Devtools hook.
  globalThis.jf = { get client() { return client; } };
})();

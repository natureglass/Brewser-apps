/**
 * jellyfin-core — plain JavaScript, no build step.
 * Classic script: include with <script src="core.js"></script>, everything is
 * exposed on the global `JF` namespace. Assumes fetch, URL, localStorage and
 * a <video> element — nothing else.
 *
 * Endpoint paths, methods, auth header format and field names verified
 * against @jellyfin/sdk 0.13.0 (Jellyfin 10.11 OpenAPI). Targets Jellyfin
 * >= 10.9; userId rides as a query param for compatibility.
 */
(function (global) {
  'use strict';

  // ---- fetch with timeout --------------------------------------------------
  // A wrong host/port makes fetch() hang on the TCP connect (the UI just sat on
  // "Connecting…" forever). Bound every request so failures surface as an error
  // instead of hanging. Aborts the socket when AbortController is available;
  // otherwise a Promise.race still rejects so the UI can react (the orphaned
  // fetch finishes in the background).
  const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
  function fetchWithTimeout(url, init, ms) {
    let controller = null;
    try {
      if (typeof AbortController !== 'undefined') controller = new AbortController();
    } catch (e) { controller = null; }
    const opts = Object.assign({}, init);
    if (controller) opts.signal = controller.signal;
    let timer = null;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        if (controller) { try { controller.abort(); } catch (e) { /* ignore */ } }
        const err = new Error('Request timed out after ' + ms + 'ms');
        err.name = 'TimeoutError';
        reject(err);
      }, ms);
    });
    return Promise.race([fetch(url, opts), timeout]).then(
      (res) => { if (timer) clearTimeout(timer); return res; },
      (err) => { if (timer) clearTimeout(timer); throw err; },
    );
  }

  // ---- time ----------------------------------------------------------------
  // Jellyfin time unit: 1 tick = 100ns, so 10,000,000 ticks = 1 second.
  const TICKS_PER_SECOND = 10000000;
  const secondsToTicks = (s) => Math.round(s * TICKS_PER_SECOND);
  const ticksToSeconds = (t) => t / TICKS_PER_SECOND;

  // ---- storage -------------------------------------------------------------
  // Small adapter so the core never touches localStorage directly; swap in a
  // different backend (Switch.writeFileSync etc.) without touching the rest.

  function localStorageAdapter(prefix) {
    prefix = prefix || 'jf.';
    return {
      get(k) { try { return global.localStorage.getItem(prefix + k); } catch (e) { return null; } },
      set(k, v) { try { global.localStorage.setItem(prefix + k, v); } catch (e) { /* session just won't persist */ } },
      remove(k) { try { global.localStorage.removeItem(prefix + k); } catch (e) { /* ignore */ } },
    };
  }

  function memoryAdapter() {
    const m = new Map();
    return {
      get: (k) => (m.has(k) ? m.get(k) : null),
      set: (k, v) => { m.set(k, v); },
      remove: (k) => { m.delete(k); },
    };
  }

  // ---- client --------------------------------------------------------------

  class JellyfinError extends Error {
    constructor(message, status, url, body) {
      super(message);
      this.name = 'JellyfinError';
      this.status = status;
      this.url = url;
      this.body = body;
    }
  }

  const SESSION_KEY = 'session';

  /**
   * opts: { baseUrl, identity: { clientName, clientVersion, deviceName, deviceId }, storage? }
   */
  class JellyfinClient {
    constructor(opts) {
      this.baseUrl = normalizeBaseUrl(opts.baseUrl);
      this.identity = opts.identity;
      this.storage = opts.storage || memoryAdapter();
      this.accessToken = null;
      this.userId = null;
      this.userName = null;
    }

    get isAuthenticated() { return this.accessToken != null && this.userId != null; }

    // Authorization header, exact format used by the official clients:
    //   MediaBrowser Client="..", Device="..", DeviceId="..", Version="..", Token=".."
    authHeader() {
      const id = this.identity;
      return [
        'MediaBrowser Client="' + encodeURIComponent(id.clientName) + '"',
        'Device="' + encodeURIComponent(id.deviceName) + '"',
        'DeviceId="' + encodeURIComponent(id.deviceId) + '"',
        'Version="' + encodeURIComponent(id.clientVersion) + '"',
        'Token="' + encodeURIComponent(this.accessToken || '') + '"',
      ].join(', ');
    }

    /** Absolute URL for an API path; query values of undefined are skipped. */
    url(path, query) {
      const u = new URL(this.baseUrl + (path.charAt(0) === '/' ? path : '/' + path));
      if (query) {
        for (const k of Object.keys(query)) {
          if (query[k] !== undefined) u.searchParams.set(k, String(query[k]));
        }
      }
      return u.toString();
    }

    /**
     * URL for endpoints consumed by <video>/<audio>/<img>, where we can't
     * send headers — the token rides along as api_key instead (same
     * mechanism jellyfin-web uses for media elements).
     */
    mediaUrl(path, query) {
      const q = Object.assign({}, query);
      if (this.accessToken) q.api_key = this.accessToken;
      return this.url(path, q);
    }

    /**
     * opts: { method?, query?, body?, empty?, timeoutMs? } — empty for
     * 204/report endpoints; timeoutMs overrides the default request timeout.
     */
    async request(path, opts) {
      opts = opts || {};
      const url = this.url(path, opts.query);
      const headers = { Authorization: this.authHeader() };
      let body;
      if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }
      const res = await fetchWithTimeout(
        url,
        { method: opts.method || 'GET', headers: headers, body: body },
        opts.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
      );
      if (!res.ok) {
        let detail;
        try { detail = await res.text(); } catch (e) { /* body unreadable */ }
        throw new JellyfinError((opts.method || 'GET') + ' ' + path + ' -> ' + res.status, res.status, url, detail);
      }
      if (opts.empty || res.status === 204) return undefined;
      const text = await res.text();
      return text ? JSON.parse(text) : undefined;
    }

    setSession(accessToken, userId, userName) {
      this.accessToken = accessToken;
      this.userId = userId;
      this.userName = userName || null;
      this.storage.set(SESSION_KEY, JSON.stringify({
        serverUrl: this.baseUrl, accessToken: accessToken, userId: userId, userName: userName || undefined,
      }));
    }

    clearSession() {
      this.accessToken = null;
      this.userId = null;
      this.userName = null;
      this.storage.remove(SESSION_KEY);
    }
  }

  /**
   * Rebuild a client from a persisted session, or null. The token may have
   * been revoked server-side — treat the first 401 as "session expired".
   */
  function restoreSession(storage, identity) {
    const raw = storage.get(SESSION_KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      if (!s.serverUrl || !s.accessToken || !s.userId) return null;
      const client = new JellyfinClient({ baseUrl: s.serverUrl, identity: identity, storage: storage });
      client.accessToken = s.accessToken;
      client.userId = s.userId;
      client.userName = s.userName || null;
      return client;
    } catch (e) { return null; }
  }

  /** Stable per-install device id, persisted via the storage adapter. */
  function createOrRestoreDeviceId(storage) {
    const existing = storage.get('deviceId');
    if (existing) return existing;
    let id = '';
    const c = global.crypto;
    if (c && typeof c.randomUUID === 'function') {
      id = c.randomUUID().replace(/-/g, '');
    } else {
      for (let i = 0; i < 32; i++) id += Math.floor(Math.random() * 16).toString(16);
    }
    storage.set('deviceId', id);
    return id;
  }

  function normalizeBaseUrl(input) {
    let s = String(input).trim();
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s; // LAN default
    return s.replace(/\/+$/, '');
  }

  // ---- auth ----------------------------------------------------------------

  /** Unauthenticated ping — verifies the URL points at a Jellyfin server. Uses
   * a shorter timeout than normal requests so a wrong host/port reports back
   * quickly at the interactive connect step. */
  function getPublicSystemInfo(client, opts) {
    return client.request('/System/Info/Public', Object.assign({ timeoutMs: 8000 }, opts));
  }

  async function authenticateByName(client, username, password) {
    const res = await client.request('/Users/AuthenticateByName', {
      method: 'POST', body: { Username: username, Pw: password },
    });
    adoptAuthResult(client, res);
    return res;
  }

  // Quick Connect — the controller-friendly flow:
  //   1. initiateQuickConnect() -> { Code, Secret }; show Code on screen
  //   2. user enters Code in their phone/web Jellyfin under Quick Connect
  //   3. waitForQuickConnect(secret) polls until approved, then exchanges the
  //      secret for a real session.

  async function isQuickConnectEnabled(client) {
    try { return await client.request('/QuickConnect/Enabled'); } catch (e) { return false; }
  }

  function initiateQuickConnect(client) {
    return client.request('/QuickConnect/Initiate', { method: 'POST' });
  }

  /**
   * Poll GET /QuickConnect/Connect?secret= until Authenticated, then exchange.
   * Server returns 404 once a code expires (surfaced as JellyfinError.status).
   * opts: { intervalMs?, timeoutMs?, onPoll?, shouldCancel? }
   */
  async function waitForQuickConnect(client, secret, opts) {
    opts = opts || {};
    const interval = opts.intervalMs || 1500;
    const deadline = Date.now() + (opts.timeoutMs || 120000);
    while (Date.now() < deadline) {
      if (opts.shouldCancel && opts.shouldCancel()) throw new Error('Quick Connect cancelled');
      const state = await client.request('/QuickConnect/Connect', { query: { secret: secret } });
      if (opts.onPoll) opts.onPoll(state);
      if (state.Authenticated) {
        const res = await client.request('/Users/AuthenticateWithQuickConnect', {
          method: 'POST', body: { Secret: secret },
        });
        adoptAuthResult(client, res);
        return res;
      }
      await sleep(interval);
    }
    throw new Error('Quick Connect timed out');
  }

  async function logout(client) {
    try {
      await client.request('/Sessions/Logout', { method: 'POST', empty: true });
    } catch (e) {
      // Token already invalid is fine — we're logging out anyway.
      if (!(e instanceof JellyfinError && (e.status === 401 || e.status === 403))) throw e;
    } finally {
      client.clearSession();
    }
  }

  function adoptAuthResult(client, res) {
    if (!res || !res.AccessToken || !res.User || !res.User.Id) {
      throw new Error('Authentication response missing AccessToken/User');
    }
    client.setSession(res.AccessToken, res.User.Id, res.User.Name);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- library -------------------------------------------------------------

  const BROWSE_FIELDS = 'PrimaryImageAspectRatio,Overview';

  /** GET /UserViews — the user's top-level libraries. */
  function getViews(client) {
    return client.request('/UserViews', { query: { userId: client.userId || undefined } });
  }

  /**
   * GET /Items — the workhorse browse/search endpoint, paged.
   * q: { parentId?, startIndex?, limit?, sortBy?, sortOrder?, includeItemTypes?, recursive?, searchTerm? }
   */
  function getItems(client, q) {
    q = q || {};
    return client.request('/Items', {
      query: {
        userId: client.userId || undefined,
        parentId: q.parentId,
        startIndex: q.startIndex || 0,
        limit: q.limit || 50,
        sortBy: q.sortBy || 'SortName',
        sortOrder: q.sortOrder || 'Ascending',
        includeItemTypes: q.includeItemTypes,
        recursive: q.recursive,
        searchTerm: q.searchTerm,
        fields: BROWSE_FIELDS,
      },
    });
  }

  /** GET /UserItems/Resume — the "Continue watching" row. */
  function getResumeItems(client, opts) {
    opts = opts || {};
    return client.request('/UserItems/Resume', {
      query: {
        userId: client.userId || undefined,
        limit: opts.limit || 12,
        mediaTypes: opts.mediaTypes,
        fields: BROWSE_FIELDS,
      },
    });
  }

  /** GET /Items/{id} — full detail (UserData for resume position + Chapters for
   * the player's chapter menu). */
  function getItem(client, itemId) {
    return client.request('/Items/' + itemId, {
      query: { userId: client.userId || undefined, fields: 'Chapters,MediaStreams' },
    });
  }

  /** GET /Items/{id}/Similar — the "More Like This" row. */
  function getSimilarItems(client, itemId, limit) {
    return client.request('/Items/' + itemId + '/Similar', {
      query: { userId: client.userId || undefined, limit: limit || 8, fields: BROWSE_FIELDS },
    });
  }

  /**
   * Server-resized artwork URL, or null if the item has no such image.
   * opts: { type?: 'Primary'|'Backdrop'|'Thumb'|'Logo', fillWidth?, fillHeight?, quality? }
   * Request exactly the pixels you render — the server does the resizing.
   */
  function imageUrl(client, item, opts) {
    opts = opts || {};
    const type = opts.type || 'Primary';
    const tag = type === 'Backdrop'
      ? (item.BackdropImageTags && item.BackdropImageTags[0])
      : (item.ImageTags && item.ImageTags[type]);
    if (!tag || !item.Id) return null;
    return client.mediaUrl('/Items/' + item.Id + '/Images/' + type, {
      tag: tag, fillWidth: opts.fillWidth, fillHeight: opts.fillHeight, quality: opts.quality || 90,
    });
  }

  // ---- quality -------------------------------------------------------------
  // The StreamCast pattern, translated to Jellyfin. StreamCast picks from
  // Twitch's variant ladder after the fact ('auto' = highest bandwidth with
  // fps <= 30 on Switch, or an explicit '480p30'-style override). Jellyfin
  // publishes no ladder — the client declares caps up front via
  // DeviceProfile + PlaybackInfo, and the server produces one stream that
  // fits. Same policy, applied one step earlier.

  const DEFAULT_BITRATE = 20000000;  // assume LAN when unmeasured
  const SOURCE_BITRATE = 120000000;  // effectively uncapped
  const BITRATE_SAFETY = 0.8;        // headroom below the measured link rate

  /**
   * policy: { mode: 'auto' | 'source' | { maxHeight, maxFps? } }
   * ctx:    { screenWidth, screenHeight, measuredBitrate?, isBrewser }
   * returns { maxWidth, maxHeight, maxFps?, maxStreamingBitrate }
   */
  function resolveQualityCaps(policy, ctx) {
    const bitrate = Math.round((ctx.measuredBitrate || DEFAULT_BITRATE) * BITRATE_SAFETY);

    if (policy.mode === 'source') {
      return { maxWidth: 4096, maxHeight: 2160, maxStreamingBitrate: SOURCE_BITRATE };
    }
    if (typeof policy.mode === 'object') {
      const h = policy.mode.maxHeight;
      return {
        maxWidth: Math.round((h * 16) / 9),
        maxHeight: h,
        maxFps: policy.mode.maxFps,
        maxStreamingBitrate: bitrate,
      };
    }
    // 'auto': never ask for more pixels than the screen shows. Allow 60fps,
    // but only within the Switch's software-decode budget: 720p60 is HW-proven
    // smooth, whereas higher-res 60fps (1080p/4K) is decode-bound on the
    // A57 (no hw decode on Tegra X1) and plays in slow motion — so cap those to
    // 30fps. brewser renders at 720p, so a 60fps source plays at 720p60 while
    // 30fps sources stay 30 (the engine keys the 60 Hz present off content fps).
    return {
      maxWidth: ctx.screenWidth,
      maxHeight: ctx.screenHeight,
      maxFps: ctx.isBrewser ? (ctx.screenHeight <= 720 ? 60 : 30) : undefined,
      maxStreamingBitrate: bitrate,
    };
  }

  /**
   * Measure downstream bandwidth with the server's own test endpoint
   * (GET /Playback/BitrateTest?size=N returns N random bytes). Returns
   * bits/sec. A single ~3MB read is a good spike-grade LAN estimate.
   */
  async function detectBitrate(client, sizeBytes) {
    sizeBytes = sizeBytes || 3000000;
    const url = client.url('/Playback/BitrateTest', { size: sizeBytes });
    const started = Date.now();
    const res = await fetch(url, { headers: { Authorization: client.authHeader() } });
    if (!res.ok) throw new Error('BitrateTest -> ' + res.status);
    const buf = await res.arrayBuffer();
    const seconds = (Date.now() - started) / 1000;
    if (seconds <= 0) return DEFAULT_BITRATE;
    return Math.round((buf.byteLength * 8) / seconds);
  }

  // ---- device profiles -----------------------------------------------------

  /**
   * Brewser profile: the <video> element is libavformat/libavcodec underneath
   * (proven by StreamCast playing Twitch HLS H.264/AAC), so container/codec
   * support is broad — the real constraint is software-decode budget on
   * 4x Cortex-A57, expressed as CodecProfile conditions from the caps.
   * Sources exceeding a condition get transcoded down instead of
   * direct-played. Transcode target is HLS/ts H.264+AAC — the exact shape
   * Twitch serves, i.e. known-good on the Switch. The DirectPlay list is
   * deliberately optimistic; measure on device and trim (HEVC especially).
   */
  function buildBrewserDeviceProfile(caps) {
    return {
      Name: 'Brewser (Switch)',
      MaxStreamingBitrate: caps.maxStreamingBitrate,
      MusicStreamingTranscodingBitrate: 320000,
      DirectPlayProfiles: [
        { Container: 'mp4,m4v,mkv,ts,webm,avi,mov', Type: 'Video', VideoCodec: 'h264,hevc,mpeg2video,mpeg4,vp8,vp9', AudioCodec: 'aac,mp3,ac3,eac3,flac,opus,vorbis' },
        { Container: 'mp3', Type: 'Audio' },
        { Container: 'flac', Type: 'Audio' },
        { Container: 'ogg', Type: 'Audio', AudioCodec: 'opus,vorbis' },
        { Container: 'm4a,m4b', Type: 'Audio', AudioCodec: 'aac' },
        { Container: 'wav', Type: 'Audio' },
      ],
      TranscodingProfiles: [
        { Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '2', MinSegments: 1, BreakOnNonKeyFrames: true },
        { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Protocol: 'http', Context: 'Streaming', MaxAudioChannels: '2' },
      ],
      CodecProfiles: [
        { Type: 'Video', Conditions: videoConditions(caps) },
      ],
      // No client-side text renderer yet: ask the server to burn subtitles in.
      SubtitleProfiles: [
        { Format: 'subrip', Method: 'Encode' },
        { Format: 'ass', Method: 'Encode' },
        { Format: 'ssa', Method: 'Encode' },
        { Format: 'vtt', Method: 'Encode' },
        { Format: 'pgssub', Method: 'Encode' },
        { Format: 'dvdsub', Method: 'Encode' },
      ],
    };
  }

  /**
   * Browser profile: conservative baseline every evergreen browser handles.
   * A later player-web can probe canPlayType/MediaSource and widen this
   * (see jellyfin-web's browserDeviceProfile.js for the full treatment).
   */
  function buildWebDeviceProfile(caps) {
    return {
      Name: 'Web',
      MaxStreamingBitrate: caps.maxStreamingBitrate,
      MusicStreamingTranscodingBitrate: 320000,
      DirectPlayProfiles: [
        { Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3' },
        { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'opus,vorbis' },
        { Container: 'mp3', Type: 'Audio' },
        { Container: 'flac', Type: 'Audio' },
        { Container: 'ogg', Type: 'Audio', AudioCodec: 'opus,vorbis' },
        { Container: 'm4a,m4b', Type: 'Audio', AudioCodec: 'aac' },
        { Container: 'wav', Type: 'Audio' },
      ],
      TranscodingProfiles: [
        { Container: 'mp4', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '2', MinSegments: 1, BreakOnNonKeyFrames: true },
        { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Protocol: 'http', Context: 'Streaming', MaxAudioChannels: '2' },
      ],
      CodecProfiles: [
        { Type: 'Video', Conditions: videoConditions(caps) },
      ],
      // A real browser renders WebVTT via native <track> — far cheaper than
      // burning subtitles into the video. Deliver text subs externally as vtt
      // (Jellyfin converts subrip/ass/ssa on the fly); the app adds a <track>
      // per external stream and toggles it in the settings modal. Image-based
      // subs (PGS/DVD) can't be text/vtt, so those still burn in.
      // (Brewser has no text-subtitle renderer and uses buildBrewserDeviceProfile,
      // which keeps Encode — see that profile above.)
      SubtitleProfiles: [
        { Format: 'vtt', Method: 'External' },
        { Format: 'pgssub', Method: 'Encode' },
        { Format: 'dvdsub', Method: 'Encode' },
      ],
    };
  }

  function videoConditions(caps) {
    // Width/Height are IsRequired:true so the server treats them as a hard cap
    // for direct-play/-stream eligibility: an over-cap source (e.g. a 4K source
    // under this 720p profile) MUST be transcoded down, never direct-played.
    // Without this the server was direct-streaming full 4K to the device, which
    // the A57 can't software-decode in real time (~27fps → slow motion).
    const conds = [
      { Condition: 'LessThanEqual', Property: 'Width', Value: String(caps.maxWidth), IsRequired: true },
      { Condition: 'LessThanEqual', Property: 'Height', Value: String(caps.maxHeight), IsRequired: true },
    ];
    if (caps.maxFps != null) {
      conds.push({ Condition: 'LessThanEqual', Property: 'VideoFramerate', Value: String(caps.maxFps), IsRequired: false });
    }
    return conds;
  }

  // ---- playback ------------------------------------------------------------

  /**
   * POST /Items/{id}/PlaybackInfo — the negotiation step. Server inspects the
   * item against our DeviceProfile and answers with MediaSources carrying
   * SupportsDirectPlay / a ready TranscodingUrl, plus the PlaySessionId used
   * in all progress reports.
   * opts: { deviceProfile, maxStreamingBitrate, startTimeTicks?, mediaSourceId?,
   *         audioStreamIndex?, subtitleStreamIndex? }
   */
  function getPlaybackInfo(client, itemId, opts) {
    return client.request('/Items/' + itemId + '/PlaybackInfo', {
      method: 'POST',
      query: {
        userId: client.userId || undefined,
        startTimeTicks: opts.startTimeTicks || 0,
        maxStreamingBitrate: opts.maxStreamingBitrate,
        mediaSourceId: opts.mediaSourceId,
        audioStreamIndex: opts.audioStreamIndex,
        subtitleStreamIndex: opts.subtitleStreamIndex,
        // Forbid video stream-copy: the server was copying the source video
        // through the transcode (keeping 4K, only cutting bitrate), which the
        // A57 can't decode. Forcing a re-encode makes the transcode honor the
        // profile's Width/Height cap (downscale to <=720p). Only affects the
        // transcode/direct-stream path; DirectPlay (native <=720p) is untouched.
        allowVideoStreamCopy: false,
        autoOpenLiveStream: true,
      },
      body: { DeviceProfile: opts.deviceProfile },
    });
  }

  /**
   * Turn a PlaybackInfo response into one URL for the video element.
   * Preference: direct play (server does zero work, libav demuxes whatever
   * it is) -> server transcode.
   * returns { url, playMethod: 'DirectPlay'|'Transcode', protocol,
   *           mediaSourceId, playSessionId, source }
   */
  function resolveVideoSource(client, itemId, info, caps) {
    if (info.ErrorCode) throw new Error('PlaybackInfo error: ' + info.ErrorCode);
    const source = info.MediaSources && info.MediaSources[0];
    if (!source || !source.Id) throw new Error('PlaybackInfo returned no media sources');

    if (source.SupportsDirectPlay || source.SupportsDirectStream) {
      const container = source.Container || 'mp4';
      return {
        url: client.mediaUrl('/Videos/' + itemId + '/stream.' + container, {
          static: true,
          mediaSourceId: source.Id,
          deviceId: client.identity.deviceId,
          Tag: source.ETag || undefined,
        }),
        playMethod: 'DirectPlay',
        protocol: container,
        mediaSourceId: source.Id,
        playSessionId: info.PlaySessionId || null,
        source: source,
      };
    }

    if (source.TranscodingUrl) {
      // TranscodingUrl is a server-relative path with its params baked in;
      // ensure api_key is present since media elements can't send headers.
      const url = new URL(client.baseUrl + source.TranscodingUrl);
      if (!url.searchParams.has('api_key') && client.accessToken) {
        url.searchParams.set('api_key', client.accessToken);
      }
      // Force the transcode to DOWNSCALE. The DeviceProfile's CodecProfile
      // Width/Height conditions gate direct-play eligibility but did NOT cap the
      // transcode OUTPUT — the server cut bitrate but kept full 4K, which the
      // A57 can't decode in real time (slow motion). Overriding maxWidth/
      // maxHeight (+ a bitrate ceiling) directly on the transcode URL makes the
      // server scale down; case-insensitive params, honored by the HLS endpoint.
      if (caps) {
        // Strip any server-supplied size caps (any casing; they arrived as
        // 0 = "no limit") so our values aren't shadowed by a duplicate the
        // server resolves to 0, then set ours.
        for (const k of Array.from(url.searchParams.keys())) {
          const lk = k.toLowerCase();
          if (lk === 'maxwidth' || lk === 'maxheight') url.searchParams.delete(k);
        }
        if (caps.maxWidth) url.searchParams.set('maxWidth', String(caps.maxWidth));
        if (caps.maxHeight) url.searchParams.set('maxHeight', String(caps.maxHeight));
      }
      return {
        url: url.toString(),
        playMethod: 'Transcode',
        protocol: source.TranscodingSubProtocol || 'hls',
        mediaSourceId: source.Id,
        playSessionId: info.PlaySessionId || null,
        source: source,
      };
    }

    throw new Error('Media source is neither direct-playable nor transcodable under this profile');
  }

  /**
   * Music the easy way: GET /Audio/{id}/universal picks direct play when the
   * container list matches and transcodes to mp3 otherwise. One URL, no
   * negotiation round-trip. opts: { maxBitrate? }
   */
  function audioUniversalUrl(client, itemId, opts) {
    opts = opts || {};
    return client.mediaUrl('/Audio/' + itemId + '/universal', {
      userId: client.userId || undefined,
      deviceId: client.identity.deviceId,
      container: 'mp3,flac,wav,ogg,m4a',
      transcodingContainer: 'mp3',
      transcodingProtocol: 'http',
      audioCodec: 'mp3',
      maxStreamingBitrate: opts.maxBitrate || 320000,
    });
  }

  /**
   * Absolute URL for an external subtitle track, from a Subtitle MediaStream's
   * server-relative DeliveryUrl. api_key is appended if missing — a <track>
   * element can't send an Authorization header. Used only by the web target
   * (native WebVTT <track>); brewser burns subtitles in server-side.
   */
  function subtitleTrackUrl(client, deliveryUrl) {
    if (!deliveryUrl) return '';
    const abs = /^https?:\/\//i.test(deliveryUrl) ? deliveryUrl : (client.baseUrl + deliveryUrl);
    const u = new URL(abs);
    if (!u.searchParams.has('api_key') && client.accessToken) {
      u.searchParams.set('api_key', client.accessToken);
    }
    return u.toString();
  }

  // Progress reporting — what lights up "Continue watching" and resume
  // points. Cadence used by official clients: start once, progress every
  // ~10s and on pause/seek, stopped on exit (stopped persists resume).
  // ctx: { itemId, mediaSourceId, playSessionId, playMethod }

  function reportPlaybackStart(client, ctx, positionTicks) {
    return client.request('/Sessions/Playing', {
      method: 'POST', empty: true, body: reportBody(ctx, positionTicks || 0, false),
    });
  }

  function reportPlaybackProgress(client, ctx, positionTicks, isPaused) {
    return client.request('/Sessions/Playing/Progress', {
      method: 'POST', empty: true, body: reportBody(ctx, positionTicks, isPaused),
    });
  }

  function reportPlaybackStopped(client, ctx, positionTicks) {
    return client.request('/Sessions/Playing/Stopped', {
      method: 'POST', empty: true, body: reportBody(ctx, positionTicks, false),
    });
  }

  function reportBody(ctx, positionTicks, isPaused) {
    return {
      ItemId: ctx.itemId,
      MediaSourceId: ctx.mediaSourceId,
      PlaySessionId: ctx.playSessionId || undefined,
      PlayMethod: ctx.playMethod,
      PositionTicks: Math.max(0, Math.round(positionTicks)),
      IsPaused: isPaused,
      CanSeek: true,
    };
  }

  // ---- export --------------------------------------------------------------

  global.JF = {
    TICKS_PER_SECOND, secondsToTicks, ticksToSeconds,
    localStorageAdapter, memoryAdapter,
    JellyfinError, JellyfinClient, restoreSession, createOrRestoreDeviceId,
    getPublicSystemInfo, authenticateByName,
    isQuickConnectEnabled, initiateQuickConnect, waitForQuickConnect, logout,
    getViews, getItems, getResumeItems, getItem, getSimilarItems, imageUrl,
    resolveQualityCaps, detectBitrate,
    buildBrewserDeviceProfile, buildWebDeviceProfile,
    getPlaybackInfo, resolveVideoSource, audioUniversalUrl, subtitleTrackUrl,
    reportPlaybackStart, reportPlaybackProgress, reportPlaybackStopped,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

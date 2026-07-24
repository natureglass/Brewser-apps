/*!
 * brewser.js — tiny save/load SDK for Brewser apps.
 *
 * Whole-save (one blob):
 *     brewser.save(anything);            // overwrite the save, instant
 *     const data = brewser.load();       // your data back, or null
 *
 * Records (convenience CRUD over a blob that is an array of records; the SDK
 * assigns each record a unique `id` plus `createdAt` / `updatedAt` — you never
 * set those):
 *     const id = brewser.put({ name: "Alice", score: 1200 });  // -> new id
 *     brewser.get(id);                    // one record, or null
 *     brewser.update(id, { score: 1300 });// merge fields, bumps updatedAt
 *     brewser.remove(id);                 // delete one record
 *     brewser.list({ sortBy: "score", desc: true });  // all records, sorted
 *
 * Cross-device:
 *     brewser.pull({ adopt: true });      // fetch the account copy (other
 *                                         // devices / Switch) into this browser
 *     brewser.sync();                     // force an immediate account push
 *
 * How it works (you don't have to care, but here it is):
 *   - save() writes to this browser instantly (localStorage) and returns
 *     immediately. It also pushes to your Brewser account in the background,
 *     so the save is available on other devices / the Switch. Works offline;
 *     the push just happens later.
 *   - load() returns this browser's copy instantly. localStorage always wins
 *     (you might have saved offline, or a device clock might be wrong).
 *   - To pull a save made on another device, call brewser.pull() — e.g. when
 *     the user returns and localStorage is empty.
 *
 * Identity: cross-device sync needs the user signed in (Brewser Auth). Signed
 * out, saves are still instant and local; they sync once the user signs in.
 */
(function (global) {
	'use strict';

	// --- Configuration (auto-detected, override via brewser.configure) ------

	var config = {
		// Package id for this app. Auto-derived from the URL path
		// (.../apps/{group}/{id}/...), or set it explicitly via configure().
		packageId: null,
		// Where the authenticated save API lives.
		apiBase: 'https://brewser.tech/wp-json/brewser/v1',
		// localStorage key prefix.
		nsPrefix: 'brewser_save_',
		// Debounce for background server pushes (ms).
		pushDebounceMs: 1500,
		// Optional: called with (status) on sync events — 'pushing','synced','offline','unauth','error'.
		onSync: null
	};

	function derivePackageId() {
		try {
			var m = location.pathname.match(/\/apps\/[^/]+\/([^/]+)\//);
			if (m && m[1]) { return decodeURIComponent(m[1]); }
		} catch (e) {}
		return null;
	}
	config.packageId = derivePackageId();

	// --- Auth token access ---------------------------------------------------
	// The navigator (play.brewser.tech) exposes window.__brewserAuthToken().
	// Inside the player iframe, the app can't see that directly, so the SDK
	// also accepts a token handed in via configure({ token }) or postMessage.

	var handedToken = null;

	function authToken() {
		if (handedToken) { return handedToken; }
		try {
			if (typeof global.__brewserAuthToken === 'function') {
				return global.__brewserAuthToken();
			}
		} catch (e) {}
		return null;
	}

	// If embedded in the Brewser player, it may postMessage a token to us.
	try {
		global.addEventListener('message', function (event) {
			// Only accept from the Brewser origin.
			if (event.origin !== 'https://brewser.tech' && event.origin !== 'https://play.brewser.tech') { return; }
			var d = event.data;
			if (d && d.type === 'brewser-token' && typeof d.token === 'string') {
				handedToken = d.token;
			}
		});
	} catch (e) {}

	// --- localStorage tier ---------------------------------------------------

	// Coerce a loaded blob into an array of records. If the app has been using
	// plain save() with a non-array blob, records helpers start fresh rather
	// than throwing.
	function asRecords(blob) {
		return Array.isArray(blob) ? blob : [];
	}

	// Short, collision-resistant id. Random base36 + a bit of entropy; retried
	// against the current set so a within-blob clash is impossible, and random
	// enough that two offline devices won't mint the same id.
	function genId(existing) {
		function rnd() {
			return (
				Math.random().toString(36).slice(2, 8) +
				Math.random().toString(36).slice(2, 5)
			);
		}
		var taken = {};
		for (var i = 0; i < existing.length; i++) {
			if (existing[i] && existing[i].id) { taken[existing[i].id] = true; }
		}
		var id = rnd();
		while (taken[id]) { id = rnd(); }
		return id;
	}

	function shallowClone(obj) {
		var out = {};
		if (obj && typeof obj === 'object') {
			for (var k in obj) {
				if (Object.prototype.hasOwnProperty.call(obj, k)) { out[k] = obj[k]; }
			}
		}
		return out;
	}

	function shallowMerge(base, changes) {
		var out = shallowClone(base);
		for (var k in changes) {
			if (Object.prototype.hasOwnProperty.call(changes, k)) { out[k] = changes[k]; }
		}
		return out;
	}

	function lsKey() {
		return config.nsPrefix + (config.packageId || 'unknown');
	}

	function readLocal() {
		try {
			var raw = localStorage.getItem(lsKey());
			if (!raw) { return null; }
			return JSON.parse(raw); // { data, updatedAt }
		} catch (e) { return null; }
	}

	function writeLocal(record) {
		try {
			localStorage.setItem(lsKey(), JSON.stringify(record));
			return true;
		} catch (e) { return false; }
	}

	// --- Server tier ---------------------------------------------------------

	function emit(status, extra) {
		if (typeof config.onSync === 'function') {
			try { config.onSync(status, extra || {}); } catch (e) {}
		}
	}

	function pushToServer(record) {
		var token = authToken();
		if (!token) { emit('unauth'); return Promise.resolve({ ok: false, reason: 'unauth' }); }
		if (!config.packageId) { return Promise.resolve({ ok: false, reason: 'no-package' }); }

		emit('pushing');
		return fetch(config.apiBase + '/save', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
			body: JSON.stringify({
				packageId: config.packageId,
				data: record.data,
				updatedAt: record.updatedAt
			})
		}).then(function (res) {
			return res.json().catch(function () { return {}; }).then(function (body) {
				if (res.ok && body.ok) { emit('synced', { updatedAt: body.updatedAt }); return { ok: true, body: body }; }
				emit('error', { error: (body && body.error) || ('HTTP ' + res.status) });
				return { ok: false, reason: 'server', status: res.status, body: body };
			});
		}).catch(function () {
			emit('offline');
			return { ok: false, reason: 'offline' };
		});
	}

	function fetchFromServer() {
		var token = authToken();
		if (!token) { return Promise.resolve({ ok: false, reason: 'unauth' }); }
		if (!config.packageId) { return Promise.resolve({ ok: false, reason: 'no-package' }); }

		return fetch(config.apiBase + '/save?packageId=' + encodeURIComponent(config.packageId), {
			headers: { 'Authorization': 'Bearer ' + token }
		}).then(function (res) {
			if (res.status === 401) { return { ok: false, reason: 'unauth' }; }
			return res.json().then(function (body) {
				if (body && body.ok) {
					return { ok: true, data: (body.data === undefined ? null : body.data), updatedAt: body.updatedAt || null };
				}
				return { ok: false, reason: 'server' };
			});
		}).catch(function () { return { ok: false, reason: 'offline' }; });
	}

	// --- Debounced background push ------------------------------------------

	var pushTimer = null;
	function schedulePush(record) {
		if (pushTimer) { clearTimeout(pushTimer); }
		pushTimer = setTimeout(function () {
			pushTimer = null;
			pushToServer(record);
		}, config.pushDebounceMs);
	}

	// --- Public API ----------------------------------------------------------

	var brewser = {
		/**
		 * Save data for this app. Instant (localStorage) + background sync.
		 * @param {*} data Any JSON-serializable value (Model A: one blob).
		 * @returns {boolean} true if the local write succeeded.
		 */
		save: function (data) {
			var record = { data: data, updatedAt: Date.now() };
			var ok = writeLocal(record);
			schedulePush(record);
			return ok;
		},

		/**
		 * Load this app's data from this browser (instant). localStorage wins.
		 * @returns {*} the saved data, or null if nothing is saved here.
		 */
		load: function () {
			var record = readLocal();
			return record ? record.data : null;
		},

		/**
		 * Metadata about the local save: { updatedAt } or null.
		 */
		info: function () {
			var record = readLocal();
			return record ? { updatedAt: record.updatedAt } : null;
		},

		/**
		 * Pull the account copy from the server (other devices / Switch).
		 * Does NOT overwrite local automatically — returns the server copy so
		 * the app decides. Pass { adopt: true } to also write it to this
		 * browser (use when local is empty or the user chose "load from cloud").
		 * @returns {Promise<{ok, data, updatedAt, reason?}>}
		 */
		pull: function (opts) {
			opts = opts || {};
			return fetchFromServer().then(function (res) {
				if (res.ok && opts.adopt && res.data !== null) {
					writeLocal({ data: res.data, updatedAt: res.updatedAt || Date.now() });
				}
				return res;
			});
		},

		/**
		 * Force an immediate server push of the current local save (bypass the
		 * debounce). Useful for a "Sync now" button.
		 * @returns {Promise}
		 */
		sync: function () {
			var record = readLocal();
			if (!record) { return Promise.resolve({ ok: false, reason: 'nothing-local' }); }
			if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
			return pushToServer(record);
		},

		/**
		 * Clear this app's local save (does not touch the server copy).
		 */
		clearLocal: function () {
			try { localStorage.removeItem(lsKey()); return true; } catch (e) { return false; }
		},

		/* ------------------------------------------------------------------ *
		 * Record helpers (convenience layer over the one-blob save).
		 *
		 * These treat the save blob as an array of records. Each record gets an
		 * auto-assigned unique `id` (short random string) plus `createdAt` and
		 * `updatedAt` timestamps (epoch ms) — you never set these yourself.
		 * All of them go through save(), so the instant-local + background-sync
		 * behavior applies automatically.
		 * ------------------------------------------------------------------ */

		/**
		 * Add a new record. The SDK assigns id/createdAt/updatedAt.
		 * @param {object} record Your fields (any JSON object).
		 * @returns {string} the new record's id.
		 */
		put: function (record) {
			var records = asRecords(brewser.load());
			var now = Date.now();
			var item = shallowClone(record);
			item.id = genId(records);
			item.createdAt = now;
			item.updatedAt = now;
			records.push(item);
			brewser.save(records);
			return item.id;
		},

		/**
		 * Get one record by id.
		 * @returns {object|null}
		 */
		get: function (id) {
			var records = asRecords(brewser.load());
			for (var i = 0; i < records.length; i++) {
				if (records[i] && records[i].id === id) { return records[i]; }
			}
			return null;
		},

		/**
		 * Patch fields of an existing record (merge). Refreshes updatedAt.
		 * @returns {object|null} the updated record, or null if id not found.
		 */
		update: function (id, changes) {
			var records = asRecords(brewser.load());
			for (var i = 0; i < records.length; i++) {
				if (records[i] && records[i].id === id) {
					var merged = shallowMerge(records[i], changes || {});
					merged.id = id;                       // identity is immutable
					merged.createdAt = records[i].createdAt;
					merged.updatedAt = Date.now();
					records[i] = merged;
					brewser.save(records);
					return merged;
				}
			}
			return null;
		},

		/**
		 * Remove one record by id.
		 * @returns {boolean} true if a record was removed.
		 */
		remove: function (id) {
			var records = asRecords(brewser.load());
			var kept = [];
			var removed = false;
			for (var i = 0; i < records.length; i++) {
				if (records[i] && records[i].id === id) { removed = true; }
				else { kept.push(records[i]); }
			}
			if (removed) { brewser.save(kept); }
			return removed;
		},

		/**
		 * List all records. Optionally sort: { sortBy:'createdAt'|'updatedAt'|<field>, desc:true }.
		 * @returns {object[]}
		 */
		list: function (opts) {
			opts = opts || {};
			var records = asRecords(brewser.load()).slice();
			if (opts.sortBy) {
				var key = opts.sortBy;
				records.sort(function (a, b) {
					var av = a ? a[key] : undefined, bv = b ? b[key] : undefined;
					if (av === bv) { return 0; }
					if (av === undefined) { return 1; }
					if (bv === undefined) { return -1; }
					return av < bv ? -1 : 1;
				});
				if (opts.desc) { records.reverse(); }
			}
			return records;
		},

		/**
		 * Whether a cross-device sync is currently possible (user signed in).
		 */
		canSync: function () { return !!authToken(); },

		/* ------------------------------------------------------------------ *
		 * Leaderboards — a SEPARATE entity from saves.
		 *
		 * Saves are private (one blob per user, only you can read yours).
		 * A leaderboard is a public, ranked, cross-user list of scores that
		 * your app submits to on purpose. They share nothing.
		 *
		 *     brewser.leaderboards.config({ order: "desc" });  // high wins (default)
		 *     brewser.leaderboards.config({ order: "asc"  });  // low wins (times)
		 *
		 *     brewser.leaderboards.submit(1200, { name: "Alice" })
		 *         .then(function (r) { r.rank; r.best; r.updated; });
		 *
		 *     brewser.leaderboards.list(10)        // -> { order, count, top:[…] }
		 *     brewser.leaderboards.aroundMe(3)     // -> { …, me, window:[…] }
		 *     brewser.leaderboards.me()            // -> { rank, score } or null
		 *     brewser.leaderboards.remove()        // delete YOUR own entry
		 *
		 * Best-kept: submitting a worse score never lowers your standing — the
		 * server keeps your best. Submit needs the user signed in (a score must
		 * be attributable). list() is public and works signed-out; it just
		 * can't flag which row is "you".
		 * ------------------------------------------------------------------ */
		leaderboards: (function () {
			// Direction is declared per app and remembered so submit() can send
			// it; the server is the source of truth and stores it per package.
			var order = 'desc';

			function lbFetch(method, params, body) {
				if (!config.packageId) { return Promise.resolve({ ok: false, reason: 'no-package' }); }
				var url = config.apiBase + '/leaderboard';
				var opts = { method: method, headers: {} };
				var token = authToken();
				if (token) { opts.headers['Authorization'] = 'Bearer ' + token; }
				if (body) {
					opts.headers['Content-Type'] = 'application/json';
					opts.body = JSON.stringify(body);
				}
				if (params) {
					var qs = [];
					for (var k in params) {
						if (Object.prototype.hasOwnProperty.call(params, k) && params[k] != null) {
							qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
						}
					}
					if (qs.length) { url += '?' + qs.join('&'); }
				}
				return fetch(url, opts).then(function (res) {
					return res.json().catch(function () { return {}; }).then(function (b) {
						if (res.ok && b && b.ok) { return b; }
						return { ok: false, reason: (res.status === 401 ? 'unauth' : 'server'), status: res.status, error: b && b.error };
					});
				}).catch(function () { return { ok: false, reason: 'offline' }; });
			}

			return {
				/**
				 * Declare this app's ranking direction. Call once at startup.
				 * @param {{order:'desc'|'asc'}} opts 'desc' high-wins (default),
				 *        'asc' low-wins (e.g. lap times).
				 */
				config: function (opts) {
					opts = opts || {};
					if (opts.order === 'asc' || opts.order === 'desc') { order = opts.order; }
					return brewser.leaderboards;
				},

				/** The direction currently declared on the client. */
				order: function () { return order; },

				/**
				 * Submit a score. Authenticated; best-kept (a worse score never
				 * lowers your standing). Sends the declared order so the server
				 * records it for this app.
				 * @param {number} score
				 * @param {{name?:string}} [opts]
				 * @returns {Promise<{ok, best, rank, updated, onBoard}>}
				 */
				submit: function (score, opts) {
					opts = opts || {};
					if (typeof score !== 'number' || !isFinite(score)) {
						return Promise.resolve({ ok: false, reason: 'bad-score' });
					}
					if (!authToken()) { return Promise.resolve({ ok: false, reason: 'unauth' }); }
					return lbFetch('POST', null, {
						packageId: config.packageId,
						score: score,
						name: opts.name || '',
						order: order
					});
				},

				/**
				 * Top N of the board (public; signed-out safe). Signed in, each
				 * row carries isMe.
				 * @param {number} [n=10]
				 * @returns {Promise<{ok, order, count, top:Array, me?}>}
				 */
				list: function (n) {
					return lbFetch('GET', { packageId: config.packageId, limit: n || 10, token: authToken() || null });
				},

				/**
				 * The window of rows around the current user (n above, n below),
				 * for when they're outside the top slice. Needs sign-in.
				 * @param {number} [n=3]
				 * @returns {Promise<{ok, order, count, top, me, window:Array}>}
				 */
				aroundMe: function (n) {
					if (!authToken()) { return Promise.resolve({ ok: false, reason: 'unauth' }); }
					return lbFetch('GET', { packageId: config.packageId, around: n || 3, limit: 1, token: authToken() });
				},

				/**
				 * The current user's { rank, score } or null if unranked.
				 * Needs sign-in.
				 * @returns {Promise<{ok, me}>}
				 */
				me: function () {
					if (!authToken()) { return Promise.resolve({ ok: false, reason: 'unauth' }); }
					return lbFetch('GET', { packageId: config.packageId, limit: 1, token: authToken() }).then(function (r) {
						if (r.ok) { return { ok: true, me: (r.me || null) }; }
						return r;
					});
				},

				/**
				 * Remove the current user's OWN entry from the board.
				 * @returns {Promise<{ok}>}
				 */
				remove: function () {
					if (!authToken()) { return Promise.resolve({ ok: false, reason: 'unauth' }); }
					return lbFetch('DELETE', null, { packageId: config.packageId });
				}
			};
		})(),

		/**
		 * Override configuration: { packageId, apiBase, token, onSync, ... }.
		 */
		configure: function (opts) {
			opts = opts || {};
			if (opts.token) { handedToken = opts.token; }
			for (var k in opts) {
				if (k !== 'token' && Object.prototype.hasOwnProperty.call(config, k)) {
					config[k] = opts[k];
				}
			}
			return brewser;
		}
	};

	global.brewser = brewser;
})(typeof window !== 'undefined' ? window : this);

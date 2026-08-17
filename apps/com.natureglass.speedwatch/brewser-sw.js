/* Brewser PWA — injected app service worker (runs on the app's OWN origin, e.g.
 * play.brewser.io/apps/<pkg>/). Placed at the app root so its default scope is the app.
 *
 * The plugin substitutes the CACHE name, the precache list and the start URL at publish.
 * Unlike the WordPress wrapper SW, the app bundle is STATIC and immutable per version, so
 * this is offline-first: precache the whole app on install, then serve cache-first. On the
 * Switch runtime there is no serviceWorker API, so this file is simply never registered.
 */
'use strict';

var CACHE    = 'brewser-app-com-natureglass-speedwatch-31edd150e698';
var PRECACHE = [".\/","app.webmanifest","brewser-pwa.js","pwa\/icon-192.png","pwa\/icon-512.png","pwa\/icon-maskable.png","pwa\/apple-touch-icon.png","README.md","index.html","manifest.json"];   // JSON array of app-relative URLs
var START    = 'index.html';    // navigation fallback (the app entry)

self.addEventListener('install', function (event) {
	event.waitUntil((async function () {
		var cache = await caches.open(CACHE);
		// Resilient precache: a single missing file must not abort the whole install.
		await Promise.all(PRECACHE.map(function (u) {
			return cache.add(new Request(u, { cache: 'reload' })).catch(function () {});
		}));
		await self.skipWaiting();
	})());
});

self.addEventListener('activate', function (event) {
	event.waitUntil((async function () {
		try {
			var keys = await caches.keys();
			await Promise.all(keys.map(function (k) {
				// Drop this app's stale-version caches; leave everything else alone.
				return (k.indexOf('brewser-app-') === 0 && k !== CACHE) ? caches.delete(k) : Promise.resolve();
			}));
		} catch (e) {}
		await self.clients.claim();
	})());
});

self.addEventListener('fetch', function (event) {
	var req = event.request;
	if (req.method !== 'GET') { return; }

	var url;
	try { url = new URL(req.url); } catch (e) { return; }

	// Cross-origin (fonts, CDNs, APIs the app calls): pass through untouched.
	if (url.origin !== self.location.origin) { return; }

	// Navigations: network-first, fall back to the precached entry when offline.
	if (req.mode === 'navigate') {
		event.respondWith((async function () {
			try {
				return await fetch(req);
			} catch (e) {
				var cache = await caches.open(CACHE);
				return (await cache.match(req)) ||
					(await cache.match(START)) ||
					(await cache.match('./')) ||
					Response.error();
			}
		})());
		return;
	}

	// Same-origin sub-resources: cache-first (the bundle is immutable per version), with a
	// network fill for anything not precached.
	event.respondWith((async function () {
		var cache = await caches.open(CACHE);
		var hit = await cache.match(req);
		if (hit) { return hit; }
		try {
			var res = await fetch(req);
			if (res && res.ok && res.type === 'basic') {
				try { cache.put(req, res.clone()); } catch (e) {}
			}
			return res;
		} catch (e) {
			return (await cache.match(req)) || Response.error();
		}
	})());
});

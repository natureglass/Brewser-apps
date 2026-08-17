/* Brewser PWA — injected register + install UX (runs on the app's own origin).
 *
 * Referenced from the app's index.html as <script src="brewser-pwa.js" defer>. Registers
 * the app's own service worker and, in a real browser, offers a flat "Install app" button
 * (Chrome/Edge/Android) or an iOS Add-to-Home hint. On the Switch runtime there is no
 * serviceWorker/beforeinstallprompt, so every branch is inert.
 */
(function () {
	'use strict';

	// The SW sits next to this script at the app root; scope is the app directory. Register
	// it even when embedded (it pre-warms the cache on the app's origin).
	if ('serviceWorker' in navigator) {
		window.addEventListener('load', function () {
			navigator.serviceWorker.register('brewser-sw.js', { scope: './' })
				.catch(function () { /* never let SW registration break the app */ });
		});
	}

	// Install UX only makes sense on the TOP-LEVEL app tab. When the app is embedded in the
	// brewser.io catalogue iframe, beforeinstallprompt won't fire anyway and an iOS hint would
	// wrongly appear inside the embed — so skip the button + hint when framed. A cross-origin
	// framing throws on window.top access, which we also treat as embedded.
	var embedded = true;
	try { embedded = (window.top !== window.self); } catch (e) { embedded = true; }
	if (embedded) { return; }

	var deferred = null;
	var btn = null;

	function button() {
		if (btn) { return btn; }
		btn = document.createElement('button');
		btn.type = 'button';
		btn.textContent = 'Install app';
		btn.hidden = true;
		btn.setAttribute('style',
			'position:fixed;right:14px;bottom:14px;z-index:2147483000;margin:0;' +
			'padding:10px 18px;border:0;border-radius:9px;cursor:pointer;' +
			'font:600 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
			'color:#07050e;background:#22d3ee;');
		btn.addEventListener('click', function () {
			if (!deferred) { return; }
			deferred.prompt();
			var choice = deferred.userChoice;
			var done = function () { deferred = null; if (btn) { btn.hidden = true; } };
			if (choice && typeof choice.then === 'function') { choice.then(done, done); } else { done(); }
		});
		document.body.appendChild(btn);
		return btn;
	}

	window.addEventListener('beforeinstallprompt', function (e) {
		e.preventDefault();
		deferred = e;
		button().hidden = false;
	});
	window.addEventListener('appinstalled', function () {
		if (btn) { btn.hidden = true; }
		deferred = null;
	});

	/* iOS Safari: no beforeinstallprompt — show an Add-to-Home hint unless already installed. */
	function isStandalone() {
		return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
			window.navigator.standalone === true;
	}
	function isIOS() {
		var ua = window.navigator.userAgent || '';
		return /iPad|iPhone|iPod/.test(ua) ||
			(window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
	}
	function iosHint() {
		if (!isIOS() || isStandalone()) { return; }
		var hint = document.createElement('div');
		hint.setAttribute('role', 'note');
		hint.setAttribute('style',
			'position:fixed;left:14px;right:14px;bottom:14px;z-index:2147483000;' +
			'padding:12px 40px 12px 14px;border-radius:10px;text-align:center;' +
			'font:500 14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
			'color:#e6e1f5;background:#0e0a1d;border:1px solid #5b21b6;');
		hint.textContent = 'To install: tap Share, then “Add to Home Screen”.';
		var close = document.createElement('button');
		close.type = 'button';
		close.textContent = '×';
		close.setAttribute('aria-label', 'Dismiss');
		close.setAttribute('style',
			'position:absolute;top:6px;right:8px;padding:2px 8px;border:0;background:transparent;' +
			'color:#d2cde5;font:600 18px/1 system-ui,sans-serif;cursor:pointer;');
		close.addEventListener('click', function () { hint.remove(); });
		hint.appendChild(close);
		document.body.appendChild(hint);
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', iosHint);
	} else {
		iosHint();
	}
})();

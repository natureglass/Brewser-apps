/* Brewser PWA — injected service-worker registration (runs on the app's own origin).
 *
 * Referenced from the app's index.html as <script src="pwa/brewser-pwa.js" defer>. It only
 * registers the app's own service worker so the app is installable + offline-capable. There
 * is deliberately NO in-app install button — the browser's native install control
 * (Chrome/Edge omnibox icon / menu) is the install affordance. iOS Safari has no such
 * control, so a small dismissible "Add to Home Screen" hint is shown there only. On the
 * Switch runtime there is no serviceWorker API, so every branch is inert.
 */
(function () {
	'use strict';

	// The SW lives at the app ROOT (a worker can only control its own folder + below, and
	// GitHub Pages can't send Service-Worker-Allowed to widen a pwa/-hosted worker's scope).
	// register() resolves the script + scope against the PAGE (index.html at the root), so
	// this stays correct even though this script itself lives in pwa/.
	if ('serviceWorker' in navigator) {
		window.addEventListener('load', function () {
			navigator.serviceWorker.register('brewser-sw.js', { scope: './' })
				.catch(function () { /* never let SW registration break the app */ });
		});
	}

	// Install UX only makes sense on the TOP-LEVEL app tab; skip when embedded in the
	// brewser.io catalogue iframe (a cross-origin frame throws on window.top — treat as embedded).
	var embedded = true;
	try { embedded = (window.top !== window.self); } catch (e) { embedded = true; }
	if (embedded) { return; }

	// iOS Safari has no native install control, so — and ONLY there — show a small
	// dismissible Add-to-Home hint. Not shown when already installed (standalone).
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
		if (document.querySelector('.bw-ios-hint')) { return; }
		var hint = document.createElement('div');
		hint.className = 'bw-ios-hint';
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

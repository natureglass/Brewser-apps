# DOM HTML CSS

_v1.0.3_

**DOM HTML CSS** is a suite of self-contained fixtures for the Brewser rendering engine. Each page opens on its own and exercises exactly one part of the pipeline — document structure, the CSS cascade, embedded media, canvas and WebGL, the Web API surface, or raw paint performance — so you can see precisely how the runtime handles each feature.

 **How it works.** The landing page is a plain hyperlinked index grouped by topic; following a link loads a small, framework-free page that draws or measures one thing and reports what the engine did. Nothing needs a server or a network — every fixture, asset and sample file ships inside the app and runs offline.

 **What's inside:**

 - **Document & text** — back/forward navigation, iframes, the modal layer, `<pre>` whitespace, typography, line-height and emoji.
- **CSS cascade & layout** — specificity, inheritance, selectors, alignment, `display:none`, borders, `border-radius` and cursors, plus external stylesheets.
- **Media** — block and inline images, inline SVG shapes, paths and transforms, and `<video>` layout.
- **Tables, lists & widgets** — `colspan`/`rowspan` tables, list styles, `<details>`/`<meter>`/`<progress>`, and CSS-only tabs.
- **Forms** — form controls and constraint validation that blocks navigation when input is invalid.
- **Canvas & WebGL** — script-less placeholder paint, inline 2D primitives, a responsive canvas, and a WebGL context probe.
- **Web API probes** — feature detection, Web Audio test tones, Web Workers, WebAssembly, MutationObserver and CSS variables.
- **Performance audits** — scroll and repaint timing, parallel image decode, latency probes and rAF cadence under live-DOM image load.
- **Game demo** — a brick-breaker built on the full Web API stack.

 A reference and diagnostic tool for developers building and testing web apps on Brewser.

---

- **Developer:** natureglass
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

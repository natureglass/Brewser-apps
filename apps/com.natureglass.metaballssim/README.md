# Metaballs sim

_v1.0.1_

**Metaballs sim** is a relaxing fluid sandbox where dozens of soft water blobs fall, pool and merge into one gooey, rolling surface.

 **How it works.** Two things run at once. Behind the scenes a lightweight particle simulation gives every blob *gravity*, plus *viscosity* and *cohesion* forces that pull neighbours together and let overlaps relax apart, so the crowd flows and settles like a thick liquid. On screen it uses the classic *metaball* trick: in a first pass each blob splats a soft circular *field* into an offscreen texture using *additive blending*, so wherever two blobs sit close their fields add up; a second full-screen pass then *thresholds* that combined field into flat colour bands — edge, fill and a bright dense core — making separate circles visually fuse into a single liquid shape. Everything is drawn with WebGL2 in just a couple of draw calls.

 **How you interact:**

 - **Drag** — swirl the pool; blobs near your finger get pulled along with it.
- **Tap the top** — pours fresh blobs in from above that drip down and merge into the water.
- **Cycle** — hold to roll the colour smoothly through the spectrum, release to keep whatever hue it lands on.
- **Size + / Size -** — makes newly poured blobs bigger or smaller.
- **Reset** — clears everything back to the neat starting grid and the default blue.
- **Full screen** — fills the display for the full effect.

 A self-contained demo that runs completely offline.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

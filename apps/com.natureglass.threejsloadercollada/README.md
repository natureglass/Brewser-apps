# ThreeJS Loader Collada

_v1.0.0_

**ThreeJS Loader Collada** loads a textured Elf Girl character from a Collada file and turns her slowly on the spot for a clean, close-up look.

 **How it works.** The demo hands a *.dae* file to three.js's *ColladaLoader*, which parses the XML-based *COLLADA* interchange format — geometry, materials and its separate JPEG textures for body, face and hair — and assembles the finished scene. A *LoadingManager* waits until every asset has arrived before adding the model, so nothing pops in half-loaded. Two lights do the shading: a flat *ambient* fill plus a single *directional light* to pick out form. A frame *timer* then advances a steady rotation each tick, spinning the elf in place while an on-screen stats panel tracks the frame rate.

 **What you'll see:**

 - **A rotating character** — the elf turns continuously at a gentle, even pace.
- **Live performance stats** — an overlay reports frames per second in real time.
- **Full screen** — fills the display.

 A hands-off three.js WebGL2 showcase running entirely on the Switch GPU, offline.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

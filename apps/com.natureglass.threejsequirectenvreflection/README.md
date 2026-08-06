# ThreeJS Equirect Env Reflection

_v1.0.0_

**ThreeJS Equirect Env Reflection** is a glossy image-based-lighting demo in which a slowly spinning torus knot draws its colour and reflections entirely from a single wrap-around photograph of its surroundings.

 **How it works.** The scene is lit by an *equirectangular environment map* — one panoramic image, stretched 360° like a flattened world map, that stands in for the sky and everything around the object. Before it can be used for realistic shading, three.js runs it through a *PMREM* step that pre-blurs the panorama into a stack of progressively rougher versions, letting the material look mirror-sharp when smooth and softly diffuse when rough. This is the heart of *image-based lighting (IBL)*: rather than placing individual lamps, the whole environment becomes the light source. The demo carries two such probes — a high-dynamic-range *EXR* lightprobe and an ordinary *PNG* — and *ACES filmic tone mapping* maps their brightness onto the display.

 **How you interact:**

 - **Orbit and zoom** — drag to circle the torus knot; pinch or scroll to move within a fixed near-to-far range.
- **Swap environments** — a control panel switches the map between the EXR and PNG probes.
- **Shape the material** — sliders set the surface roughness, metalness and exposure.
- **Reveal the floor** — a debug toggle drops in a ground plane that mirrors the same environment.

 One of a set of three.js examples rendered live on the Switch's GPU inside the brewser browser, running entirely offline.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

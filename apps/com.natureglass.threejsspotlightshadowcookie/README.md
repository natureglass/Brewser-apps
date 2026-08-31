# ThreeJS Spotlight Shadow Cookie

_v1.0.2_

**ThreeJS Spotlight Shadow Cookie** lights a marble angel with a single moving spotlight that projects a patterned texture and casts a soft, shifting shadow across the floor.

 **How it works.** A lone spotlight sweeps a slow circle above the scene, and every frame the renderer draws the view from its position into a *shadow map* so the statue blocks the light realistically. The beam also carries a projected texture — a *cookie* (or gobo) — that stencils a pattern into the light itself, while *penumbra* and *PCF filtering* feather the shadow edges into soft gradients. The centrepiece is the Stanford *Lucy* angel, a dense hundred-thousand-triangle mesh streamed from a binary PLY file, standing on a plane that catches the shadow. *Neutral tone mapping* keeps the bright highlights under control.

 **How you interact:**

 - **Orbit the camera** — drag to rotate around the statue within set zoom and tilt limits.
- **Swap the cookie** — pick the projected texture from a swirl, colour swatches, a UV grid, or none at all.
- **Tune the light** — sliders for colour, intensity, angle, penumbra, decay, focus and shadow strength.
- **Show helpers** — reveal the light cone and shadow-camera outline.
- **Full screen** — fills the display.

 A three.js WebGL2 demo rendering live on the Switch GPU, completely offline.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

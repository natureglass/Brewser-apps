# nxjs WebGL1 Test

_v1.0.0_

**nxjs WebGL1 Test** is a WebGL1 showpiece for the nx.js runtime — a moonlit ocean at night, rendered in real time, with the nx.js logo riding a cube that bobs on the swell.

 **How it works.** It is really a stress test of nx.js's WebGL1 path dressed up as a seascape. Four separate *GLSL programs* — sky, moon, water and cube — are marked *raw passthrough* so the engine hands them straight to the console's native graphics chip instead of emulating them. The ocean is a dense grid of roughly ninety thousand triangles whose heights are pushed around by summed *sine waves*, and the same wave maths runs on the processor so the cube can float, tilt and roll exactly with the surface beneath it. The moon is a hand-shaded billboard with *procedural* craters and glow, the stars are scattered by a hash function, and the logo is uploaded as a *texture* onto the cube's metallic faces, complete with reflections, foam and an underwater glow.

 **What you'll see:**

 - **Moonlit sky** — a graded night sky dusted with a field of stars.
- **Procedural moon** — a softly shaded moon with maria, craters and a cool halo.
- **Living ocean** — rolling waves with foam crests, glints and a mirrored moonpath.
- **Floating cube** — a metallic nx.js-logo cube bobbing and turning on the water, glowing beneath the surface.
- **Orbit the camera** — drag the screen or push the right stick to look around; the left stick zooms in and out.

 Runs entirely offline.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

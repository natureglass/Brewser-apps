# nxjs WebGL2 Test

_v1.0.2_

**nxjs WebGL2 Test** is a WebGL2 showpiece for the nx.js runtime — a procedural sunset sea, drawn entirely inside a single shader, with the nx.js logo on a cube drifting on the tide.

 **How it works.** The whole scene is painted by one *fragment shader* in the ShaderToy style: a single full-screen triangle is drawn with no geometry data at all, and for every pixel the shader casts a *ray* out into an imagined world. It *ray-marches* a rippling wave surface, builds the dusk sky, sun, clouds and stars from *noise* functions, and intersects a ray against a box to place the cube. Each frame the cube's pose — its bob, spin and roll on the waves — is worked out on the processor and passed in as small *matrices*, while the marked *raw passthrough* shader runs natively on the console's graphics chip. A final cinematic *tonemap*, vignette and dither give it a filmic finish.

 **What you'll see:**

 - **Sunset sky** — a layered dusk gradient with a low sun, drifting clouds and stars coming out.
- **Ray-marched sea** — a rippling ocean with fresnel reflections, sun glitter and sparkling glints.
- **Floating cube** — an nx.js-logo cube bobbing and turning on the swell, casting a shadow and a reflected streak across the water.
- **Orbit the camera** — drag the screen or push the right stick to change your view.

 Runs entirely offline.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

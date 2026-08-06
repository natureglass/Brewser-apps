# Aether

_v1.0.0_

**AETHER** turns a written phrase into a fullscreen animated field. Describe a world, watch it assemble, then open the console and take it apart.

 **How it works**

 Type something like *stormy alien ocean at dusk* and press Render. AETHER reads the phrase against a vocabulary of 168 words covering subjects, moods, colours, materials, styles and times of day. Every word it recognises contributes to a set of 40 numbers — field scale, warp depth, symmetry, palette, motion, atmosphere and finish — which are weighted and averaged into a single parameter set.

 That set drives a WebGL2 fragment shader that renders the whole scene in one pass, at 60fps, with no textures and no geometry. Nothing is pre-rendered: every pixel is computed from the parameters each frame.

 The **Director read** panel shows which words landed and which were ignored, so you can see exactly how your phrase was interpreted rather than guessing.

 The morph

 A new phrase doesn't cut to the result. The image and the console sliders travel to their new values together over about a second, so you can watch which parameters your words actually moved.

 Seven field types

 - **Smooth** — marbled, cloud-like domain warping
- **Bands** — topographic contour lines
- **Rings** — concentric ripples
- **Veins** — wood and marble grain
- **Terrace** — stepped plateaus
- **Streaks** — directional strata
- **Cells** — cracked, crystalline Worley noise

 Combined with 14 palettes and optional kaleidoscopic folding, the same phrase vocabulary reaches a wide range of looks rather than recolouring one texture.

 Controls

 - **Render** — interpret whatever is in the prompt box
- **New prompt** — deal from a bank of 50 written phrases *(P)*
- **Surprise me** — ignore language, roll the parameters directly *(space)*
- **Console** — slide out the full 40-parameter panel *(H)*
- **Save frame** — export the current image as a PNG *(S)*
- **Copy / Load JSON** — move parameter sets in and out by hand

 Render scale is adjustable if you want to trade sharpness for framerate on slower hardware. Gamepad and keyboard are both supported, and the console hides completely for fullscreen viewing.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

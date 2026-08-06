# ThreeJS Postprocessing Pixelation

_v1.0.0_

**ThreeJS Postprocessing Pixelation** renders a tiny 3D diorama and then crushes the whole picture down into chunky retro pixels, like a modern scene squeezed through an old console's video output.

 **How it works.** The scene — two tilted cubes, a checkerboard floor and a glowing blue crystal that gently bobs and pulses — is drawn through an *effect composer*, a pipeline that post-processes the rendered image before it reaches the screen. A *pixelation pass* renders everything at a low internal resolution and snaps it onto a coarse grid of square pixels, then optionally traces crisp single-pixel outlines by comparing the surface *normals* and *depth* of neighbouring pixels so edges read cleanly. A pixel-aligned camera keeps the grid locked in place as you move, so the pixels stay steady instead of shimmering.

 **How you interact:**

 - **Orbit the scene** — drag to rotate and pinch or scroll to zoom the diorama.
- **Pixel size** — a slider scales the pixels from fine (1) to blocky (16).
- **Edge outlines** — separate normal-edge and depth-edge sliders control how strongly the retro outlines are drawn.
- **Pixel-aligned panning** — toggle whether the camera snaps to the pixel grid.
- **Full screen** — fills the display.

 A self-contained three.js post-processing demo, rendered live on the Switch GPU completely offline.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

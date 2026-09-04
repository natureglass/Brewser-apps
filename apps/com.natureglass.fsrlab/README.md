# FSR LAB

_v1.0.0_

**FSR LAB** renders a scene small and upscales it smart \\u2014 the same trick commercial Switch games use, running live in a WebGL2 context. Drag the wipe across the screen and compare a plain bilinear stretch against AMD's FidelityFX Super Resolution 1.0 \\u2014 or a temporal (FSR 2-style) upscaler that accumulates sub-pixel detail across frames \\u2014 on real hardware, with a live frame-time readout.

 **How it works.** Each frame, a synthwave test scene \\u2014 thin grid lines, sub-pixel stars, ridge silhouettes, a striped sun \\u2014 is rendered into an off-screen buffer at a reduced internal resolution. FSR 1.0's two passes then rebuild it at native size: *EASU* (edge-adaptive spatial upsampling) analyses local edge direction and resamples along it, and *RCAS* (robust contrast-adaptive sharpening) restores fine contrast. Both passes were ported to GLSL ES 3.00 from AMD's MIT-licensed reference \\u2014 WebGL2 has no `textureGather`, so EASU's 12-texel footprint is fetched directly.

 **The lab part.**

 - **Output modes** \\u2014 bilinear stretch, FSR 1.0, FSR 1.0 + RCAS, temporal (FSR 2-style), and a full native render as the ground-truth reference.
- **Internal resolution** \\u2014 FSR's official quality presets, from Ultra Quality (77%) down to Performance (50%).
- **Split compare** \\u2014 the left side of the wipe is always the raw bilinear stretch; move it with the stick, shoulders, or by dragging.
- **Freeze frame** \\u2014 stop the motion and study a single frame up close.
- **Frame-time readout** \\u2014 smoothed milliseconds, fps, worst frame over the last 60, and how many pixels you're actually shading.

 **Temporal mode (FSR 2-style).** FSR 1.0 is spatial: it can only sharpen what survived the downsample. The fifth mode does what FSR 2 and DLSS do instead \\u2014 each frame renders with a sub-pixel jitter, and an accumulation pass reprojects the previous frames and folds them in, weighted by per-sample confidence. Over an 8-frame jitter cycle it genuinely collects native-resolution information: sub-pixel stars come back, 1px windows resolve, staircase edges smooth out. Freeze the frame and the history converges to an effectively supersampled image in well under a second. Motion is handled with exact analytic reprojection (a luxury of a procedural scene; real engines render motion vectors), neighbourhood clamping rejects ghosting, and fast-scrolling regions gracefully fall back toward single-frame quality \\u2014 honest TAA behaviour, visible live on the wipe. A simplified single-pass design in the spirit of FSR 2, not AMD's implementation.

 **Look closer.** A pixel zoom (1\\u00d7 / 2\\u00d7 / 4\\u00d7) magnifies both sides of the wipe nearest-neighbour around the screen centre, so you can inspect exactly what each upscaler did to individual pixels \\u2014 from the couch. Every detail in the scene (grid lines, city windows, rim lights) is drawn at widths calibrated in *native* pixels, so a reduced internal resolution genuinely under-samples the same world instead of redrawing it thicker \\u2014 the comparison behaves like real game geometry.

 Because the wipe is live, the EASU pass only computes the visible side of the divider (scissored, so the comparison doesn't pay double). Use it to eyeball how much sharpness FSR buys back at each preset \\u2014 and how much frame time a lower internal resolution frees up for other Brewser apps.

 Gamepad, keyboard, touch and mouse are all supported, and the interface hides completely for fullscreen viewing.

---

- **Developer:** natureglass
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

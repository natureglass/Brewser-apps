# ThreeJS Selective Unreal Bloom

_v1.0.0_

**ThreeJS Selective Unreal Bloom** shows off an animated sci-fi engine — a detailed "Primary Ion Drive" model whose hot, glowing core blazes with a soft cinematic halo while the rest of the hull stays sharp.

 **How it works.** The model is drawn through an *effect composer* that lays an *Unreal-style bloom* pass over the rendered frame. Bloom works from a brightness *threshold*: only pixels brighter than the cut-off — here the emissive engine parts — are picked out, blurred across several progressively smaller buffers and added back as a glow, so the light appears to bleed selectively from just the brightest surfaces. *ACES filmic tone mapping* then compresses the high dynamic range into natural on-screen colour, while the model plays a looping animation throughout.

 **How you interact:**

 - **Orbit the model** — drag to rotate and zoom within a fixed distance range so the engine stays framed.
- **Threshold** — raise or lower which brightness levels are allowed to glow, changing how selective the bloom is.
- **Strength and radius** — sliders set how intense the glow is and how far it spreads.
- **Exposure** — adjusts the overall tone-mapped brightness.
- **Full screen** — fills the display.

 A self-contained three.js post-processing demo, rendered live on the Switch GPU and running fully offline.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

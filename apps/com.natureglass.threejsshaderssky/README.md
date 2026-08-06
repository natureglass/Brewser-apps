# ThreeJS Shaders Sky

_v1.0.1_

**ThreeJS Shaders Sky** is an interactive atmosphere — a procedurally generated sky where you can move the sun from dawn to dusk and watch the colours, haze and drifting clouds respond.

 **How it works.** There is no sky photograph here; every pixel is computed by a shader based on the *Preetham analytic daylight model*, a physics-inspired formula for how sunlight scatters through the air. Two effects do most of the work: *Rayleigh scattering*, which spreads short blue wavelengths across the dome, and *Mie scattering*, which throws a whitish haze around the sun. Raising the *turbidity* thickens the atmosphere for a hazier, sunset feel, while the sun's *elevation* and *azimuth* decide where it sits and how the whole sky is tinted. This version layers on animated *fractal-noise clouds* that drift overhead as time advances, with their own coverage, density and height controls, and *ACES filmic tone mapping* keeps the fierce sun disc in check.

 **What you can adjust:**

 - **Move the sun** — elevation and azimuth sliders sweep it across the sky, repainting the atmosphere in real time.
- **Atmosphere sliders** — turbidity, Rayleigh, Mie coefficient, Mie directional-G and exposure fine-tune the haze, colour and brightness.
- **Clouds folder** — separate coverage, density and elevation controls shape the drifting cloud layer.
- **Sun disc toggle** — show or hide the bright solar disc.
- **Look around** — drag to rotate the view; zoom and panning are disabled.

 One of a set of three.js examples rendered live on the Switch's GPU inside the brewser browser, running entirely offline.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

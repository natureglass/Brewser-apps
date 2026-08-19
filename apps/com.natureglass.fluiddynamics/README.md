# Fluid dynamics

_v1.0.4_

**Fluid dynamics** is a real-time fluid simulation you paint with your finger. Under the hood it solves the same equations that describe real smoke and water — the Navier–Stokes equations — entirely on the GPU using WebGL2, so thick, swirling dye reacts to every stroke at full frame rate.

 **How it works.** Every frame the app runs a chain of GPU shader passes over floating-point textures. It first computes the fluid's *curl* and adds a vorticity force to keep the motion lively and turbulent, then makes the flow *incompressible* by solving for pressure over roughly twenty iterations and subtracting its gradient from the velocity field. The velocity and the coloured dye are then *advected* — carried along the flow — and both fade slightly each step so trails dissipate naturally. The simulation runs on a compact velocity grid while the dye is rendered at much higher resolution for crisp detail, with a lighting pass that shades the fluid from its own density gradients to give it depth.

 **How you interact:**

 - **Draw** — drag anywhere to inject dye and push the fluid; the *direction and speed* of your stroke become the force applied, and the colour drifts through the rainbow as you move. *Multi-touch is supported*, so several fingers stir at once.
- **Burst** — fires several randomly aimed splats of colour and force into the field for an instant explosion of motion.
- **Particles** — toggles a layer of ~16,000 GPU particles that ride the velocity field, brightening where the flow moves fastest, then wrap and respawn to keep coverage even.
- **Full screen** — expands the canvas edge-to-edge.

 Everything runs locally with no network access, and the app automatically probes the device for the best supported float texture formats so it degrades gracefully across GPUs.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

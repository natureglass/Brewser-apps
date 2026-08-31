# ThreeJS GPGPU Water

_v1.0.2_

**ThreeJS GPGPU Water** is a reflective pool you can stir with a fingertip — press and drag across the surface and ripples spread out, run to the rim and slowly settle.

 **How it works.** The surface is a grid of heights held in a texture and simulated entirely on the graphics card — this is the *GPGPU* (general-purpose GPU) technique, where a shader is used for maths rather than for drawing. Each frame a *compute shader* looks at every cell and its four neighbours and applies a simple *wave equation*: the new height is the neighbours' average minus the previous height, damped by a *viscosity* factor so waves travel and gradually die away. Your pointer presses a dimple into the field to launch fresh ripples. That height texture then drives the water's vertices and surface normals, so a mirrored HDR sunrise sky reflects and warps across the moving surface.

 **How you interact:**

 - **Disturb the water** — press and drag on the surface to raise ripples wherever you touch.
- **Orbit the camera** — drag off the water to rotate and zoom around the pool.
- **Mouse size and depth** — sliders set how large and how deep each disturbance is.
- **Viscosity and speed** — tune how quickly ripples fade and how many simulation steps run per frame.
- **Wireframe and shadows** — toggles reveal the underlying mesh or add cast shadows.
- **Full screen** — fills the display.

 A self-contained three.js GPU-compute demo, simulated and rendered live on the Switch GPU with no network needed.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

# ThreeJS Rapier3d Physics

_v1.0.1_

**ThreeJS Rapier3d Physics** is a self-running rigid-body playground: colourful boxes, spheres and rounded blocks rain down onto a grid floor, bounce, tumble and pile up under gravity.

 **How it works.** A full physics engine — *Rapier*, written in Rust and compiled to *WebAssembly* so it runs at near-native speed in the browser — steps the world forward every frame, pulling bodies down with gravity and resolving collisions between shapes using their mass and *restitution* (bounciness). three.js simply mirrors each body's computed position and rotation onto its matching mesh, while thin outlines drawn around every collider reveal the physics shapes the engine actually sees. A new random shape is dropped in automatically once a second, and any body that falls past the floor's edge is quietly removed so the scene never overflows.

 **What you'll see:**

 - **Automatic spawning** — a fresh box, sphere or rounded box in a random colour drops from above every second.
- **Bouncy collisions** — bodies land with springy restitution, so they bounce and jostle before settling into a heap.
- **Orbit the scene** — drag to rotate and scroll to zoom, with smooth damped camera motion.
- **Full screen** — fills the display.

 A mostly hands-off three.js physics showcase, computed and rendered live on the Switch GPU entirely offline.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

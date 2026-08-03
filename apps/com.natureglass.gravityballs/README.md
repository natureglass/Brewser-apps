# Gravity Balls

_v1.0.1_

**Gravity Balls** is a relaxing physics sandbox where a set of colourful balls fall, bounce and jostle against each other and the walls — and gravity points wherever you tilt.

 **How it works.** A proper physics engine runs behind the scenes. Each frame is broken into several small sub-steps, and within each step the app nudges every ball's velocity by gravity, then repeatedly resolves collisions — ball-against-wall and ball-against-ball — using impulses that account for each ball's mass (bigger balls are heavier), bounciness and friction. This *iterative* approach lets balls pile up and settle into stable stacks instead of jittering or sinking through one another. Drawing is just as efficient: a single instanced WebGL2 draw call renders every ball from one shared shape, and a shader turns each into a crisp, smoothly anti-aliased disc.

 **How you interact:**

 - **Tilt to steer gravity** — on a device with a motion sensor, physically tilting it pulls the balls in that direction (the display reads *IMU LIVE*).
- **Drag** — with no motion sensor, dragging on the screen points gravity toward your finger instead.
- **Full screen** — fills the display for the full effect.

 A lightweight, self-contained demo that runs completely offline.

---

- **Developer:** Alex Daskalakis
- **License:** MIT
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

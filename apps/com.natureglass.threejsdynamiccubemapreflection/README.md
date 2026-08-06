# ThreeJS Dynamic Cubemap Reflection

_v1.0.1_

**ThreeJS Dynamic Cubemap Reflection** is a shimmering showcase built around a chrome sphere that mirrors everything happening around it in real time — a tumbling cube and a twisting torus knot sweep past while the whole scene is reflected on its polished surface.

 **How it works.** The mirror-ball trick relies on a technique called *dynamic cube-mapping*. Every frame a special six-sided camera — a *CubeCamera* — sits at the centre of the sphere and photographs the scene in all six directions, stitching the results into a *cube map*, a tiny 360° snapshot of the surroundings. That snapshot is wrapped back onto the sphere as its *environment map*, so its near-mirror finish (very low roughness, full metalness) reflects the orbiting shapes and the surrounding sky exactly as they move. The backdrop itself is a high-dynamic-range *HDR panorama* of a quarry, and *ACES filmic tone mapping* keeps the bright highlights from blowing out.

 **How you interact:**

 - **Orbit the camera** — drag to swing the view around the sphere; it also drifts on its own with gentle auto-rotation.
- **Zoom** — pinch or scroll to move in close and inspect the reflections.
- **Tune the surface** — an on-screen panel of sliders adjusts the sphere's roughness and metalness along with the overall exposure.

 One of a set of three.js examples rendered live on the Switch's GPU inside the brewser browser, running entirely offline.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

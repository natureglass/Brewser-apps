# ThreeJS Loader GLTF

_v1.0.3_

**ThreeJS Loader GLTF** displays the battle-scarred Damaged Helmet — a benchmark physically based model — lit and reflected by a real-world HDR sky.

 **How it works.** The *GLTFLoader* reads a glTF 2.0 model together with its binary geometry buffer and a full *physically based* texture set — base colour, normal, metal-roughness, ambient occlusion and emissive maps — so the metal, glass and scorched paint each respond to light correctly. An *UltraHDR* equirectangular photograph of the Royal Esplanade serves as both the backdrop and the *image-based lighting*, its surroundings mirrored across the shiny surfaces. *ACES filmic tone mapping* grades the high-dynamic-range result, the camera auto-frames the model, and shaders are compiled asynchronously so it appears without a stutter.

 **How you interact:**

 - **Orbit the model** — drag to spin around the helmet with smooth damping and zoom limits.
- **Blur the backdrop** — a slider softens the environment behind the model.
- **Model menu** — a dropdown selects the sample on show.
- **Full screen** — fills the display.

 A three.js WebGL2 demo rendering live on the Switch GPU, completely offline.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

# Fractal Zoom

_v1.0.6_

**Fractal Zoom** is a GPU-powered explorer for six infinitely detailed fractals. Dive endlessly into these mathematical worlds, panning and zooming smoothly to reveal intricate structure at every scale, all rendered in real time with WebGL2.

 **How it works.** Most of the fractals — the *Mandelbrot*, *Julia*, *Burning Ship*, *Phoenix* and *Koch* sets — are drawn by a fragment shader covering the whole screen: for every pixel it treats the point as a complex number and repeatedly applies the fractal's formula (up to around 700 times) to see how quickly the value "escapes". The number of steps is coloured through a smooth cosine palette, and the iteration count automatically scales up as you zoom in so detail keeps resolving no matter how deep you go. The *Barnsley Fern* works differently: thousands of points are stepped through a chaos game on the CPU and accumulated into a brightness buffer, then tone-mapped for a soft, photographic look.

 **How you interact:**

 - **Zoom & pan** — drag, hold, or use the scroll wheel to zoom continuously toward wherever you point; a heads-up display shows the current fractal name and zoom factor.
- **Fractal** — cycles through the six different fractal types.
- **Cycle** — hold to animate the colour palette, sending waves of colour through the image.
- **Reset** — recenters and returns to the starting view.
- **Full screen** — maximises the canvas for the best detail.

 Rendered entirely on the GPU with dithering to hide colour banding, and it needs no internet connection.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

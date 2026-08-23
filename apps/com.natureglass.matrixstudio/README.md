# Matrix Studio

_v1.0.11_

**Matrix Studio** is a design-and-control studio for addressable-LED matrix panels. Draw straight onto a glowing on-screen grid, stir it like fluid, or run built-in animations — then stream the picture live to a real ESP32-driven panel over USB serial or Bluetooth.

 **How it works.** The whole canvas is a WebGL “LED wall”: every pixel is drawn as a rounded, softly glowing dot on a dark grid, so the preview reads like the real panel. Everything you paint lives in a single framebuffer that the app maps onto your strip’s exact wiring — you describe the panel’s width, height and per-panel height, whether it is wired in columns or rows, whether it snakes back and forth (*serpentine*), and any X/Y flips, and the app computes the pixel→LED order for you. An **IDENTIFY** pattern marks the corners (red = top-left, green = top-right, blue = bottom-left) and sweeps left→right so you can dial in the wiring until the on-screen layout matches the hardware. When you connect, each frame is packed into a compact binary packet and pushed to the panel, while the data pin, LED count and brightness are sent as a config packet on connect and whenever you save.

 **Connecting to hardware.** There are two paths, and the app is fully functional offline — a link only mirrors the canvas to the panel. *Web Serial over USB* comfortably runs 30–60 fps at high baud, while *Web Bluetooth* (using the Nordic UART service) tops out around 10–15 fps for a 512-LED frame. Brightness is applied on-device for power limiting — 512 LEDs at full white pull about 30 A. A matching ESP32 sketch is bundled in the app’s assets so you can flash your own controller.

 **How you interact:**

 - **Draw** — pick a colour and brush size, then paint on the grid; strokes interpolate into smooth lines.
- **Fluid** — a real-time stable-fluid mode where dragging injects colour and motion that swirls and dissipates.
- **Demo** — cycle through built-in animations (Rainbow, Plasma, Fire, Rain and Bounce) that you can also poke to disturb.
- **Clear** — wipe the grid back to black.
- **Settings** — set the matrix layout, wiring and flips, the ESP32 data pin and brightness, and the connection type, baud and max send rate; run **IDENTIFY** to verify the mapping, and **SAVE** to persist it all.
- **Full screen** — expands the canvas edge-to-edge.

 Runs entirely on-device with your layout and preferences remembered between sessions. Bring your own ESP32 and addressable-LED panel to see your artwork light up for real.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

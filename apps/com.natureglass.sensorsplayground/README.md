# Sensors Playground

_v1.0.1_

**Sensors Playground** is a hardware diagnostics dashboard that surfaces the sensors and capabilities of your device. Each panel probes a real piece of hardware through a standard web API and shows a live readout, so you can see — and feel — exactly what your device exposes.

 **How it works.** The dashboard is a grid of independent "diagnostic cards", each wired to a browser API and updating live from that hardware's own events rather than constant polling. The motion card is the centrepiece: it listens to the device's orientation and motion sensors and feeds the readings into a small hand-written 3D cube that tilts and turns in real time to mirror how you're holding the device, idly auto-rotating when no sensor data is coming in. Where a given browser or device lacks a sensor, that card simply reports *n/a* instead of breaking. Because motion sensors and the camera are privacy-sensitive, they require a secure connection and, on some devices, a tap to grant permission.

 **What you can explore:**

 - **Motion & orientation** — live accelerometer and orientation values driving the 3D cube; tap the card to start sampling (and grant permission where prompted).
- **Battery** — charge level, charging state and estimated time to full or empty.
- **Network**— a live preview to confirm the network works.
- **Vibration & rumble** — fire *Light*, *Pulse*, *Ocean Wave* and *Heavy Burst* haptic patterns, with animated bars showing the waveform.
- **Display & storage** — screen orientation, connection type and online status, plus how much storage the app can use.

 Originally a Nintendo Switch demo, ported so each native call maps to its web equivalent — a handy tool for checking what a browser really exposes.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

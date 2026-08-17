# Compass

_v1.0.3_

**Compass** is a working magnetic compass rendered entirely in WebGL. It reads your device's orientation sensors to point at magnetic north, showing a precise heading in degrees and the cardinal direction you're facing — on a hand-drawn dial that swings smoothly like the real thing.

 **How it works.** Every part of the dial — the graduated ring, the tick marks, the degree numbers, the cardinal letters and the needle — is built from scratch as WebGL geometry, with the text baked into a small glyph atlas so it stays crisp at any size. The app listens to your device's *absolute* orientation sensor (falling back to relative orientation, or Safari's compass heading on iOS) and corrects for however the screen itself is rotated, then eases the dial toward that heading with a damped spring so the needle settles naturally instead of snapping. When no compass hardware is feeding it — on a desktop, say — it drifts gently in a demo mode, and you can grab the dial and spin it yourself. Because orientation sensors are privacy-sensitive, some devices show an *Enable compass* button to grant permission first.

 **How you interact:**

 - **Point** — hold the device flat and turn; the dial rotates to keep north fixed while the readout shows your live heading and cardinal direction.
- **Enable compass** — on devices that ask, tap once to grant sensor permission (the status switches from *DEMO* to *LIVE*).
- **Drag** — with no live sensor connected, drag the dial to spin it by hand.
- **Day / Night** — toggle the light and dark themes with the button, or the *N*, *D* and space keys; it also picks one automatically based on the time of day.

 A compact, framework-free compass that works fully offline and falls back gracefully wherever a sensor or WebGL isn't available.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

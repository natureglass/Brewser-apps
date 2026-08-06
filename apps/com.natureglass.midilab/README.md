# MIDI Lab

_v1.0.0_

**MIDI Lab** is a universal MIDI-controller tester, synthesizer and visual playground. Plug in a keyboard, pad grid or knob controller and the app builds an on-screen mirror of your exact device, then lights up every note, pad and dial as you play it — while turning your performance into sound and reactive graphics.

 **How it works.** The app connects to your hardware two ways, with an automatic fallback. First it tries the browser's built-in *Web MIDI* support; if that isn't available it falls back to *WebUSB*, claiming the controller directly and decoding its raw USB-MIDI packets itself. It then matches your device's name against a bundled database of known controllers to draw the right layout of pads, keys, faders and knobs (unknown gear gets a sensible generic panel). Every incoming message flows through one pipeline: it's logged in the monitor, played through the synth, and used to drive the visuals. The synthesizer is built with Web Audio — each note stacks two oscillators through a filter and envelope, then a chain of drive, bit-crushing, reverb and delay — and your knobs and faders are mapped straight onto its parameters like filter cutoff, resonance and reverb. Meanwhile a WebGL2 feedback background bursts and glows in time with your notes.

 **How you interact:**

 - **Enable Audio** — unlocks sound (browsers require one tap first); do this before playing.
- **Pair MIDI / Pair USB** — connect your controller through Web MIDI or, as a fallback, WebUSB.
- **Play** — the on-screen widgets respond live; on devices with lights, tapping an on-screen pad even sends a signal back to illuminate the real hardware.
- **Monitor** — a collapsible panel logs every incoming message as decoded, timestamped data, with a one-tap clear.
- **Full screen** — expands the interface for performance.

 Self-contained and offline, with the layout adapting automatically to whatever controller you connect.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

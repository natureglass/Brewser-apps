# MIDI Surface

_v1.0.3_

**MIDI Surface** is a touch-driven MIDI control surface and sample instrument. It draws your controller as an on-screen grid of glowing pads, knobs and faders that light up as you play the real hardware — and, on devices with lit pads, tapping the screen sends the signal back to illuminate the hardware in return. Every pad can also fire a looping audio sample shaped by live effects.

 **How it works.** The app connects to your controller through the browser's *Web MIDI* and reads a bundled profile (shipping with an AKAI LPD8 preset) that describes the grid and one or more channel *banks* of pads, knobs and faders. Incoming notes and CC messages light the matching control on screen; touching a control sends MIDI straight back out on the same channel the hardware speaks on, so the device's LEDs stay in sync. Each pad holds a looping sample played through a Web Audio engine, and every pad carries its own effect chain — volume, pitch, reverb and chorus. Knobs and faders are assigned to drive an effect on a chosen pad, so a dial becomes, say, the reverb on pad 3. Pads can be momentary or sticky (*switch*) toggles, and speak either notes or CC for controllers running in CC mode.

 **How you interact:**

 - **Enable audio** — tap once to unlock sound (browsers require a first tap) before you play.
- **Play the grid** — tap pads to trigger their samples and drag a knob or fader up and down to sweep its effect; hardware and touch stay mirrored.
- **Channel banks** — switch between mapping banks with the CH buttons in the header.
- **REC learn** — arm a trigger, then hit a pad or turn a knob on your controller to assign its note or CC automatically.
- **Stop all** — release every held pad and silence all audio in a single press.
- **Settings** — pick a controller, edit each trigger's type and note, assign or browse local samples, map knobs to pad effects, and Load or Export the whole setup as JSON.

 Self-contained and offline — plug in a USB MIDI controller, or play the surface entirely by touch.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

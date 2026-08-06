# Spectra Play

_v1.0.0_

**Spectra Play** is a modern music player with GPU-accelerated visuals. Point it at your own audio and watch it come alive with a choice of nine real-time visualizers rendered in WebGL2.

 **How it works.** You pick a folder of music and the app lists everything inside it — loading a whole directory at once and remembering it for next time. As a track plays through the audio engine, the app continuously analyses the sound, splitting it into a live *frequency spectrum* (how much bass, mid and treble there is right now) and a *waveform* (the raw shape of the sound). Those two streams of data feed the visualizers: ribbons, bars, orbits, particle fields and nebulae that are rebuilt every frame and coloured by a shader, so the graphics pulse and flow in perfect time with the music. Track titles and artists are read straight out of the files' own tags.

 **How you interact:**

 - **Load a folder** — choose a directory of music to build your library; click any row to play it.
- **Playback controls** — play/pause, previous/next, a seek bar and volume, plus *shuffle* and a *repeat* mode (off, all, or one).
- **Switch visualizers** — step through the nine animated scenes with the arrows.
- **Keyboard shortcuts** — space to play/pause, arrows to seek, and N / P to skip tracks.

 Plays common formats including MP3, FLAC, AAC, WAV, OGG and Opus, and runs entirely on-device.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

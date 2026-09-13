# ARTISTE - Multiplayer Paint

_v1.0.1_

**Multi Paint** is a collaborative drawing board. Everyone in the same room paints on one shared canvas at the same time - you see each person's cursor move and their strokes appear as they draw them, not after they finish.

 **How it works.** The app opens a WebSocket to the Brewser relay and joins a room (the default is *paint*, or pass *?room=* in the URL to start your own). While you draw, your stroke is streamed out as small batches of points every 40 ms, so remote clients follow your line live rather than waiting for you to lift the pen. Every client keeps the same ordered log of strokes and repaints the canvas from it, which is what keeps the picture identical on every screen and makes undo reliable: undo simply marks a stroke hidden and replays the log, so it lands in the right order even when someone else has drawn over the top. You only ever undo your own strokes. The canvas itself is a fixed 1280x720 surface that scales to the screen, with a second overlay canvas on top for cursors and for strokes still in flight.

 There are three tools. The **pen** and **eraser** are hard-edged single passes - the eraser just paints in the paper colour. The **brush** is feathered: it is built from five translucent passes, widest and faintest first, with their alphas solved so the composite edge follows a smooth ramp instead of ending on a hard rim. Because a soft stroke has to be laid down as one whole polyline (drawing it segment by segment would re-blend every joint into a dark blob), an in-progress brush stroke lives on the overlay and is committed to the canvas once, when the stroke ends. The nib preview in the header feathers the same way, so what you see is what you get.

 **How you interact:**

 - **Draw** - press and drag on the board with the touchscreen or the pointer.
- **Pen, Brush, Eraser** - pick a tool in the header; picking a colour while erasing switches you back to the pen.
- **Pen size** - 2 to 64 px; the brush lays down twice that width.
- **Brush hardness** - 0% feathers across the whole width, 100% collapses to a hard edge.
- **Colours** - a 16 swatch palette, from ink and paper through to the full spectrum.
- **Undo / Redo** - steps back and forward through your own strokes, for everyone.
- **Clear canvas** - wipes the board and the history for the whole room.

 The status light in the sidebar shows the connection: amber while connecting, green once you are in the room, red if the link drops - in which case it reconnects on its own and you carry on drawing. A remote stroke that goes quiet, because that person dropped mid-line, is committed after a couple of seconds rather than left hovering. An internet connection is required.

---

- **Live app:** [ARTISTE - Multiplayer Paint](https://brewser.io/artiste-multiplayer-paint/)
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

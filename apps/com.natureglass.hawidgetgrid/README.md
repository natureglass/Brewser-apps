# HA Widget Grid

_v1.0.1_

**HA Widget Grid** is a fast, single-canvas dashboard for **Home Assistant**. Point it at your instance with a long-lived access token and it discovers your entities, groups them by area, and paints a live grid of tiles you can tap, drag and rearrange — lights, switches, fans, dimmers, sensors and door/motion contacts, all updating in real time.

 **How it works.** The whole grid is drawn on one `<canvas>` as a retained scene of tiles, with a flat-fill palette (no gradients or shadows) so it stays smooth even on a software GPU. It talks to Home Assistant over the native WebSocket API: it authenticates with your token, pulls the state, entity, device and area registries once to work out what each entity is and where it lives, then subscribes to compressed state diffs so dozens of entities stay current without polling. Controls are optimistic — a tap flips the tile immediately and quietly reverts if Home Assistant never confirms — and the socket reconnects on its own with backoff if the connection drops. A built-in *demo mode* runs the entire interface against a fake home, so you can try it with no server at all, and a *same-origin* mode lets it run as a page served straight from Home Assistant.

 **What lands on the grid:**

 - **Lights & switches** — on/off tiles for `light`, `switch`, `input_boolean` and `fan`; tap to toggle.
- **Dimmers** — lights that report brightness get a slider; drag across the tile to set the level.
- **Sensors** — numeric sensors show the current value, unit, and a rolling sparkline of recent history.
- **Contacts** — binary sensors read out in plain words (Open/Closed, Motion/Clear, Home/Away…) chosen from their device class.

 **How you interact:**

 - **Tap** — toggle a light or switch, or drag a dimmer to set brightness.
- **Edit** — press-and-hold or hit the ✎ button to drag cards into any order (they reflow live) and remove ones you don't want with the × badge.
- **Entities** — the ☰ manager lists everything discovered so you can show or hide cards, filter by name, and reset the order.
- **Connect** — the ⚙ panel holds the host, HTTPS toggle and access token (stored in this browser only), plus the demo and same-origin switches.

 Your layout and hidden cards are remembered separately from your credentials, so clearing one never wipes the other. Framework-free, offline-capable in demo mode, and reconnect-safe.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

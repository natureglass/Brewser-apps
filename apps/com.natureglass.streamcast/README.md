# Stream Cast

_v1.0.0_

**Stream Cast** brings live Twitch streaming to the Switch browser. A "Live now" sidebar lists popular channels while the main stage swaps between a search screen and full-screen video.

 **How it works.** The app talks to Twitch's own web service to do everything the site does: it fetches the directory of top live channels, looks up a stream's title, viewer count and uptime, and requests a signed playback token for the channel you choose. With that token it builds the stream's live video playlist, reads the list of available quality variants, and picks one according to your preference before handing it to the video player to decode and play. On the Switch this plays the real Twitch video feed directly; on ordinary desktop browsers, where that isn't permitted, it gracefully falls back to Twitch's official embedded player instead.

 **How you interact:**

 - **Browse live** — the sidebar shows channels that are live now; tap one to watch, and reveal more with a click.
- **Channel lookup** — type any channel name and hit Watch to jump straight to its stream.
- **Quality selection** — choose *source*, *auto*, or a specific resolution to suit your connection.
- **Recents** — recently watched channels are saved as quick pills for next time.
- **Back** — the B button or Escape returns you from a stream to the search screen.

 Requires an internet connection. Built for the Switch platform.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

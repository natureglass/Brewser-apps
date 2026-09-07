# Jellyfin Client

_v1.0.8_

**Jellyfin Client** connects to your own Jellyfin media server and streams your movies, shows and music. Sign in, browse your libraries with cover art, and pick up right where you left off — the same app runs on the Nintendo Switch and in an ordinary web browser.

 **How it works.** Point it at your server's address and sign in with a password or Quick Connect (enter the on-screen code in your phone or web Jellyfin). The app talks to Jellyfin's own web API to list your libraries and folders, fetch each title's artwork, details and stream info, and negotiate playback: when a file already fits the device it plays directly, and when it doesn't the server transcodes a compatible stream on the fly. An *Auto* quality mode sizes the stream to your screen and connection, or you can force a specific resolution and run a quick bandwidth test. As you watch, your position is reported back to the server so titles resume and appear in *Continue Watching*. On the Switch the video is decoded and drawn by the Brewser engine with subtitles burned in by the server; in a browser it uses the native video element (with hls.js for transcoded streams) and native WebVTT subtitle tracks.

 **How you interact:**

 - **Connect & sign in** — enter a LAN address like 192.168.1.100:8096 or a full https:// URL, then use your password or Quick Connect.
- **Browse** — move through your libraries and folders and open a title for its artwork, details and streams.
- **Player controls** — play and pause, drag the progress bar to seek, and mute, with a gear button for playback settings.
- **Playback settings** — switch audio track, subtitles and chapters, change the aspect ratio, zoom and crop, or jump back and forward ten seconds.
- **Quality** — choose *Auto*, *Source*, 1080p, 720p or 480p, and measure your bandwidth to size the stream to your connection.
- **Resume** — stop any time and the title reappears in *Continue Watching* at the right spot.

 Requires your own Jellyfin server (version 10.9 or newer) reachable on the local network.

---

- **Live app:** [Jellyfin Client](https://brewser.io/jellyfin-client/)
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

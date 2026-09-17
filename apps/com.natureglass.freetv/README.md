# Free TV

_v1.0.8_

Free TV plays the live channels that broadcasters and free ad-supported streaming services publish openly. Pick a source, pick a country, pick a channel. Nothing to sign up for, no account, no key.

 Sources

 - **Broadcasters** - channels the broadcasters stream themselves, from over 200 countries and territories.
- **Pluto**, **Samsung TV Plus**, **Rakuten TV**, **Plex** - the free ad-supported line-ups, per country.
- **Favorites** - everything you starred, gathered from every source.

 Channel lists come from the community-maintained `iptv-org/iptv` index, are fetched on demand and cached on the device for 24 hours; **Refresh** pulls them again. The streams themselves are served by the broadcasters and providers, so which channels work varies by region and by hour - Free TV hosts nothing and proxies nothing.

 In the channel list

 - Type to filter by name; chips narrow a list to a single country of origin when one list mixes several.
- **Favorites only**, **720p or lower** (kinder to the console decoder) and **Hide unavailable** toggles.
- A channel that fails to start is remembered as unavailable and hidden until it plays again.

 Playback is HLS. The console's built-in player handles it natively; in a desktop browser hls.js is loaded from a CDN as a fallback.

 Controls: D-pad or stick to move, **A** select, **B** back, **Y** favourite, **X** fullscreen. Keyboard and mouse work throughout - arrows, Enter, Esc, `F` to favourite, `X` for fullscreen.

 Favourites and the unavailable list are kept on the device. Nothing is sent anywhere.

---

- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

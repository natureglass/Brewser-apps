# Speed Test

_v1.0.2_

**Speed Test** checks how fast your internet connection really is, measuring against Cloudflare's global network and showing the results on an animated needle gauge with live metric tiles and a diagnostics log.

 **How it works.** Tapping start runs three phases in turn. First it measures *latency* by timing several tiny round-trips to the server and averaging them. Then it measures *download* speed by streaming a large file and recomputing the rate on every chunk that arrives — which is what drives the needle live — discarding a short warm-up so the connection has time to reach full speed. Finally it measures *upload* by sending batches of random data and timing how quickly each one completes. All of this talks directly to Cloudflare's public speed-test endpoints, and speeds are reported in megabits per second (Mbps) just like other mainstream speed tests.

 **It reports:**

 - **Download speed** — how quickly data reaches your device.
- **Upload speed** — how quickly you can send data out.
- **Latency** — the round-trip responsiveness of your connection.

 One tap on **Start speed test** (or a click on the gauge) runs the full measurement. Requires an internet connection.

---

- **Developer:** natureglass
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

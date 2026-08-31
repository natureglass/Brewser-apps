# Speed Watch

_v1.0.5_

**Speed Watch** turns your device into a GPS speedometer with a live map and automatic speed-limit alerts — a full driving head-up dashboard in a single page, with no libraries, no API keys, and no account.

 **How it works**  
A large canvas speedometer is the hero: your live speed swings an eased needle around a 270° dial styled after European road signage, with a big digital readout and a green "legal" zone that turns red past the posted limit.

 Speed comes straight from the device's GPS through the standard geolocation API — and where the hardware doesn't report speed directly, the app derives it from how far you've moved between fixes, smoothing the reading so a parked device settles to zero instead of creeping.

 Alongside the dial, a hand-written renderer paints OpenStreetMap tiles directly onto a canvas (no mapping library) and marks your position with a heading arrow and a GPS-accuracy ring; you can drag, pinch and zoom it, or let it follow you and tap **Re-center** to snap back.

 The posted speed limit is looked up live from OpenStreetMap's Overpass service for the road you are actually on — matched by both distance and heading so a parallel side-street doesn't fool it — and shown as a speed-sign roundel on the gauge. When you go over the limit (plus your chosen tolerance), a "speed robot" chirps a warning, keeps nagging until you slow down, and flashes a **SLOW DOWN** banner.

 **What it gives you:**  
**Live speedometer** — an eased needle and digital readout on a road-sign-style dial, in km/h or mph.  
**Automatic speed limits** — the posted limit for your current road, pulled live from OpenStreetMap (no API key) and drawn as a European limit roundel. -   
**Over-limit alerts** — audible beeps with an adjustable tolerance (0, +3, +5, +10) and hysteresis, so it warns you without chattering at the threshold.  
**Live map** — a canvas OpenStreetMap view with your heading arrow and accuracy ring; drag, pinch-zoom, follow, and re-center.  
**Night mode** — a dark theme with an inverted map for comfortable driving after dark.

 **Keep-awake** — an optional screen Wake Lock so the display stays on while you drive.

 **Demo drive** — a fake-GPS circuit that ramps up and down over a limit, so you can try everything from your desk with no movement required.

 Your preferences (units, alert tolerance, night mode, sound) are remembered on the device. **Requires location (GPS) access and an internet connection** — the map tiles and speed-limit lookups both come from OpenStreetMap. It's happiest on a phone mounted in a vehicle; flip on **Demo drive** in Settings to explore it while stationary.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.io/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

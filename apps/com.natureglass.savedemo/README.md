# Save Demo

_v1.0.0_

**Save Demo** is a hands-on test harness for the Brewser save system — the same building blocks any app can use to remember data across sessions and devices. Sign in with your Google/Brewser account and exercise every part of the API from one screen.

 **How it works.** The app uses a two-tier persistence model. When you save, your data is written *instantly* to this browser's local storage, then a background sync quietly uploads it to your account a moment later, so the interface never waits on the network. When you load, the local copy always wins for speed, while *Pull* fetches the authoritative copy from the server. Signing in opens a Google sign-in popup that hands back a secure token, which the app then attaches to each request to the Brewser cloud. On top of the basic save blob it layers two higher-level tools: *records*, a simple add/update/remove/list database of individual entries, and *leaderboards*, a shared public scoreboard that keeps each player's best result.

 **What you can try:**

 - **Save & load** — edit a JSON blob and Save, Load, *Sync now*, *Pull from account*, or Clear local.
- **Records** — Put (add), Update or Remove a selected entry, and List them all.
- **Leaderboard** — submit a score, then view the Top 10, your own rank, or the scores around you, and remove your entry.
- **State panels** — two live views compare what's stored in this browser versus what's on the server, each with a status indicator.
- **Activity log** — every operation is timestamped so you can watch the sync happen.

 A reference app for developers building save-enabled experiences on Brewser.

---

- **Developer:** Alex Daskalakis
- **Brewser profile:** [natureglass](https://brewser.tech/profile?publisher=natureglass)
- **License:** [MIT](https://choosealicense.com/licenses/mit)
- **Website:** [https://github.com/natureglass](https://github.com/natureglass)

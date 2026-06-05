# Brewser App Submission Info

Thank you for your interest in submitting an app for Brewser.

Brewser is a homebrew app hub/runtime for Nintendo Switch that allows users to run web-powered apps built with familiar web technologies such as HTML, CSS, JavaScript, WebGL, and WASM.

This document explains how to submit your app or app repository for review.

---

## Important: how Brewser app submissions work

Brewser uses a curated submission model.

Developers do **not** directly publish apps into Brewser. Instead, developers submit an issue with their app information and source repository. The Brewser maintainer reviews the app and decides whether it can be added to the official Brewser app catalog.

The official app catalog is maintained separately and is controlled only by the Brewser maintainer.

```text
Developer app/repo
   ↓
Submission issue
   ↓
Review
   ↓
Accepted / Changes requested / Rejected
   ↓
Maintainer adds accepted app to the official Brewser catalog
   ↓
Users can download the app from inside Brewser
```

Please do **not** open pull requests against the official Brewser app catalog unless specifically asked.

---

## App channels

Submitted apps may be accepted into one of the following channels.

### Featured

Featured apps are promoted by Brewser.

These apps are expected to be polished, stable, useful, and fully reviewed.

Featured apps are selected by the Brewser maintainer. You may request Featured consideration, but most apps should first be submitted for Community or Experimental review.

### Community

Community apps are reviewed and accepted apps from developers.

These apps should be functional, safe, properly licensed, and suitable for normal Brewser users.

Community apps are expected to follow the full submission requirements in this document.

### Experimental

Experimental apps are apps that may be useful, interesting, early, unstable, technically unusual, or less polished.

Experimental apps may request more advanced permissions or use technologies that need extra caution.

Users will see stronger warnings before running Experimental apps.

Experimental does **not** mean anything is allowed. Experimental apps must still follow the rules in this document.

---

## Recommended app structure

Your app repository should be easy to review.

Recommended structure:

```text
my-brewser-app/
  manifest.json
  index.html
  app.js
  style.css
  assets/
    icon.png
    screenshot-1.png
  LICENSE
  README.md
```

Larger apps may use subdirectories:

```text
my-brewser-app/
  manifest.json
  src/
    index.html
    js/
    css/
  assets/
  LICENSE
  README.md
```

Your `manifest.json` must clearly point to the entry file.

---

## Required files

Your app should include:

| File | Required | Purpose |
|---|---:|---|
| `manifest.json` | Yes | Describes the app, permissions, entry point, and metadata |
| `index.html` or equivalent entry file | Yes | Main app entry point |
| `LICENSE` | Yes | License for your code |
| `README.md` | Strongly recommended | Explains what the app does and how to test it |
| App icon | Strongly recommended | Used in Brewser UI |
| Screenshots | Recommended | Helps review and presentation |

---

## Manifest file

Each app must include a `manifest.json`.

Example:

```json
{
  "id": "com.example.notes",
  "name": "Example Notes",
  "version": "1.0.0",
  "description": "A simple notes app for Brewser.",
  "entry": "index.html",
  "developer": {
    "name": "Example Developer",
    "url": "https://github.com/example"
  },
  "license": "MIT",
  "category": "utility",
  "icons": {
    "128": "assets/icon-128.png",
    "512": "assets/icon-512.png"
  },
  "permissions": {
    "storage": true,
    "network": false,
    "webgl": false,
    "wasm": false,
    "gamepad": true
  },
  "network": {
    "allowed_origins": []
  },
  "source": "https://github.com/example/brewser-notes"
}
```

---

## Manifest field requirements

### `id`

A unique reverse-domain style identifier.

Good examples:

```text
com.example.notes
dev.username.clock
tech.brewser.demo
```

Avoid:

```text
notes
my app
test
```

The ID should be lowercase and stable. Do not change it between versions unless it is a completely different app.

### `name`

The user-facing app name shown in Brewser.

Do not use names that impersonate official companies, platforms, games, or services.

### `version`

Use semantic versioning when possible:

```text
1.0.0
1.1.0
2.0.0
```

### `description`

A short, accurate description of what your app does.

Avoid misleading claims.

### `entry`

The first file Brewser should open.

Example:

```json
"entry": "index.html"
```

The entry file must exist in your app folder.

### `developer`

Information about the developer or project.

Example:

```json
"developer": {
  "name": "Example Developer",
  "url": "https://github.com/example"
}
```

### `license`

The license for your app code.

Examples:

```text
MIT
Apache-2.0
GPL-3.0
BSD-3-Clause
```

You must have the right to submit the app and its assets.

### `permissions`

Brewser apps must declare special permissions.

Supported permissions may include:

| Permission | Meaning |
|---|---|
| `storage` | App wants to save data locally |
| `network` | App wants to connect to the internet |
| `webgl` | App wants to use WebGL |
| `wasm` | App wants to use WebAssembly |
| `gamepad` | App wants to use controller/gamepad input |
| `sensors` | App wants to use console sensors |

Users will be asked to opt in before an app starts when special permissions are required.

Only request permissions your app actually needs.

### `network.allowed_origins`

If your app uses network access, list every domain it connects to.

Example:

```json
"network": {
  "allowed_origins": [
    "https://api.example.com",
    "https://cdn.example.com"
  ]
}
```

Do not use broad or unclear network access unless absolutely necessary.

### `source`

A public source repository URL.

Example:

```json
"source": "https://github.com/example/brewser-notes"
```

---

## Permission prompts

Brewser may show users permission prompts before launching your app.

For example, if your app requests storage, users may see a message like:

```text
Example Notes wants to use local storage.

This allows the app to save data on your device.

[Allow Once] [Always Allow] [Deny]
```

Experimental apps and local apps may show stronger warnings.

Please make permission usage clear in your README and submission issue.

---

## Allowed app types

Brewser is intended for web-powered apps and experiments.

Generally allowed:

- HTML apps
- CSS/JavaScript apps
- WebGL demos
- WASM apps, if clearly disclosed and reviewable
- Media tools
- Utility apps
- Homebrew-focused tools
- Games or demos made with web technologies
- Apps that use network APIs with clearly declared domains

---

## Not allowed

Do not submit apps that include, link to, or provide:

- Nintendo software
- Nintendo firmware
- ROMs
- Game dumps
- Encryption keys
- Copyrighted game assets you do not have permission to use
- Piracy tools
- Exploit chains
- Instructions for bypassing technological protection measures
- Malware
- Credential theft
- Hidden telemetry
- Undisclosed tracking
- Obfuscated code intended to hide behavior
- Content that impersonates official companies, games, platforms, or services
- Trademarked logos or branding without permission
- Apps that violate third-party terms in a way that creates risk for Brewser

Brewser is an independent homebrew project and is not affiliated with, endorsed by, sponsored by, licensed by, or approved by Nintendo.

---

## Third-party services and logos

If your app connects to a third-party service, clearly explain what it does.

Examples:

```text
This app connects to https://api.example.com to fetch public data.
```

Do not imply that your app is official unless you have permission.

Be careful with names, icons, logos, screenshots, and branding from companies such as Nintendo, TikTok, Twitch, YouTube, Discord, Spotify, or other third-party platforms.

If your app is an unofficial client, launcher, wrapper, or demo, say so clearly.

---

## App review expectations

Review may include:

- Checking the manifest
- Checking requested permissions
- Checking network domains
- Checking licensing
- Checking assets
- Testing the app locally in Brewser
- Reviewing source code
- Asking for changes
- Moving the app to Community or Experimental
- Rejecting the submission if it is unsafe, unclear, or unsuitable

Review is manual and maintained by a single developer, so please keep submissions clean and easy to understand.

---

## How to submit an app

Open a new issue in the Brewser submissions repository.

Use the app submission issue template if available.

Include the following information.

### Required submission information

```text
App name:
App ID:
Version:
Requested channel: Community or Experimental
Developer name:
Source repository:
License:
Short description:
Entry file:
Requested permissions:
Network domains:
Assets/copyright confirmation:
Testing notes:
```

### Optional but helpful

```text
Screenshots:
Icon:
Demo video:
Known issues:
Reason for requested channel:
Special technical notes:
```

---

## Example submission

```text
App name:
Example Notes

App ID:
com.example.notes

Version:
1.0.0

Requested channel:
Community

Developer name:
Example Developer

Source repository:
https://github.com/example/brewser-notes

License:
MIT

Short description:
A simple local notes app for Brewser.

Entry file:
index.html

Requested permissions:
- Storage
- Gamepad/controller input

Network domains:
None

Assets/copyright confirmation:
All code and assets were created by me and are released under the MIT license.

Testing notes:
Tested as a local Brewser app by copying the folder to:
/switch/brewser/local-apps/example-notes/

Known issues:
None currently.
```

---

## Update submissions

If your app is already published in Brewser and you want to submit an update, open an update issue.

Include:

```text
App name:
App ID:
Current published version:
New version:
Source repository:
Summary of changes:
Changed permissions:
Changed network domains:
Migration notes:
Testing notes:
```

Important: clearly mention any new permissions or new network domains.

If your app starts requesting storage, network, WebGL, WASM, or additional domains, users may see new warnings or permission prompts.

---

## Reporting problems with published apps

If you find a problem with a published app, open an issue and include:

```text
App name:
App ID, if known:
Problem type:
Steps to reproduce:
Expected behavior:
Actual behavior:
Screenshots/logs, if available:
```

For security-sensitive reports, do not publish exploit details publicly unless the project provides a private reporting method.

---

## Tips for faster review

To make your app easier to review:

- Keep the app small and focused.
- Include a clear README.
- Use readable source code.
- Avoid unnecessary minification.
- Avoid unnecessary dependencies.
- Declare all permissions honestly.
- Declare all network domains.
- Include a valid license.
- Explain any unusual behavior.
- Test the app locally before submitting.
- Do not submit copyrighted or trademarked assets unless you have permission.

---

## Local testing before submission

Before submitting, test your app locally in Brewser.

Copy your app folder to:

```text
/switch/brewser/local-apps/
```

Example:

```text
/switch/brewser/local-apps/example-notes/
  manifest.json
  index.html
  app.js
  style.css
  assets/
```

Then open Brewser and launch it from the Local Apps or Developer Apps section.

Local testing does not require approval, hashes, signatures, or catalog inclusion.

---

## What happens after submission?

After you submit an issue, one of the following may happen:

### Accepted

The app may be added to the official Brewser app catalog.

The maintainer chooses the final channel: Featured, Community, or Experimental.

### Changes requested

You may be asked to update your manifest, permissions, license, README, assets, or code.

### Accepted as Experimental

If the app is interesting but unstable, early, risky, or uses unusual permissions, it may be accepted as Experimental.

### Rejected

The app may be rejected if it is unsafe, legally risky, unclear, broken, misleading, or outside the scope of Brewser.

---

## Final checklist before submitting

Before opening an issue, confirm:

```text
[ ] My app has a manifest.json
[ ] My app has a clear entry file
[ ] My app has a license
[ ] My app has a README or clear description
[ ] I own or have permission to use all included assets
[ ] My app does not include ROMs, firmware, keys, exploits, or copyrighted game assets
[ ] My app declares all permissions
[ ] My app declares all network domains
[ ] My app does not impersonate an official product or service
[ ] I have tested the app locally in Brewser
```

---

## Maintainer discretion

Submitting an app does not guarantee inclusion in Brewser.

Brewser is currently maintained by a single developer, so review times and decisions may vary. The maintainer may accept, reject, reclassify, remove, or request changes to apps at their discretion to protect users, the project, and the broader homebrew community.

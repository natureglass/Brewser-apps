# Brewser Apps

Official app catalog repository for **Brewser**.

Brewser is a homebrew app hub/runtime for Nintendo Switch that lets users discover and run web-powered apps built with familiar technologies such as **HTML**, **CSS**, **JavaScript**, **WebGL**, and **WASM**.

This repository contains the public app catalog and app files used by Brewser.

---

## What is Brewser?

Brewser is designed to make Switch homebrew app development more approachable by allowing developers to build apps with web technologies instead of requiring a full native homebrew development workflow.

The goal is to create a lightweight platform where users can discover apps, demos, tools, games, and experiments, while developers can prototype and publish creative ideas with less friction.

---

## About this repository

This repository is maintained by the Brewser developer and is used as the source for apps shown inside Brewser.

Apps may be organized into channels such as:

- **Featured** — curated and highlighted apps
- **Community** — reviewed community apps
- **Experimental** — early, unstable, risky, or less-reviewed apps that may show stronger warnings

Brewser may use this repository to display available apps and download app files.

---

## Can I submit my own app?

Yes.

Developers can submit their app or app repository for review.

For now, app submissions are handled through [GitHub issues](https://github.com/natureglass/Brewser-apps/issues). Please do **not** directly open pull requests that modify the official app catalog unless specifically asked.

To submit an app, read the full submission guide here:

[Read the app submission guide](https://github.com/natureglass/Brewser-apps/blob/main/submission_info.md)

The submission guide explains:

- Required app structure
- Required `manifest.json` fields
- Supported permissions
- Channel differences
- Local testing
- What is allowed and not allowed
- How to open an app submission issue
- How app updates should be submitted

---

## Local app testing

Developers can test apps locally before submitting them.

A local app can be copied directly to the device and run through Brewser without needing catalog approval.

Example local app structure:

```text
/switch/brewser/local-apps/my-test-app/
  manifest.json
  index.html
  app.js
  style.css
  assets/
```

Local apps are intended for development and testing. They are not reviewed by Brewser and may show warnings before launch.

---

## Basic app requirements

A Brewser app should generally include:

```text
my-brewser-app/
  manifest.json
  index.html
  app.js
  style.css
  assets/
  LICENSE
  README.md
```

At minimum, submitted apps should include:

- A valid `manifest.json`
- A clear entry file, usually `index.html`
- A license
- A short description
- Declared permissions
- Declared network domains, if network access is used
- Confirmation that the developer owns or has permission to use all included assets

See the [submission guide](https://github.com/natureglass/Brewser-apps/blob/main/submission_info.md) for the full requirements.

---

## Permissions

Brewser apps must declare special permissions.

Examples may include:

- Storage
- Network access
- WebGL
- WASM
- Gamepad/controller input

When an app requests special permissions, Brewser may ask the user to opt in before the app starts.

Experimental and local apps may show stronger warnings.

---

## Important rules

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
- Apps impersonating official companies, platforms, games, or services

Brewser is intended for legal, creative, and community-friendly homebrew development.

---

## Review process

Submitting an app does not guarantee inclusion.

The maintainer may:

- Accept the app
- Request changes
- Move the app to a different channel
- Mark the app as Experimental
- Reject the app
- Remove an app later if needed

Brewser is currently maintained by a single developer, so review times may vary.

---

## Project status

Brewser is currently in development.

The app catalog, submission rules, supported permissions, and review process may change as the project evolves.

---

## Disclaimer

Brewser is an independent homebrew project and is not affiliated with, endorsed by, sponsored by, licensed by, or approved by Nintendo.

Brewser does not include, distribute, or provide Nintendo software, firmware, games, ROMs, encryption keys, copyrighted assets, exploits, or tools/instructions for bypassing technological protection measures. Users and contributors are responsible for complying with applicable laws and third-party terms.

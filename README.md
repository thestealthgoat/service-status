# Service Status

A live **“where are we in the service?”** screen for the production booth, iPads and phones — built at The Family Church (Lafayette, LA) and free for any church that runs **ProPresenter 7** (and optionally **Planning Center Services**).

- **The message:** which point the pastor is on, % through, a timeline with the points marked, projected finish vs. your message timer.
- **Songs:** which section the band is in (Verse 1, Chorus, Bridge…) from your ProPresenter slide groups, and time vs. planned.
- **Order of service:** follows whatever playlist is open in ProPresenter, matched to the Planning Center plan. Live “vs plan”, projected end, item descriptions (e.g. the lead singer), and it learns how long your items really take.
- **Phones/iPads:** any device on the same network opens the address shown in the app (Now / Full order views).
- **Read-only:** it never changes anything in ProPresenter or Planning Center.

## Install (Mac)
1. Download **Service Status Installer.pkg** from [Releases](https://github.com/thestealthgoat/service-status/releases) — one installer for Intel and Apple Silicon.
2. Open it. The first time, macOS may say it can’t check it: System Settings → Privacy & Security → **Open Anyway**.
3. The app opens when it’s done. Its welcome screen asks for ProPresenter’s network port and (optionally) a Planning Center Personal Access Token.

## Updates
The app checks this repo (`update/latest.json`) every few hours and from **Service Status → Check for Updates…**. New code downloads in the background, is checked against its SHA-256, and is used after the next restart — no reinstall. To publish: edit `src/`, run `python3 tools/publish_update.py <version> "notes"`, commit and push.

## Build the installer
On a Mac, put the packaged app zips next to `installer/Build Installers.command` and double-click it (uses Apple’s `codesign`, `pkgbuild`, `productbuild`). The app is ad-hoc signed, not notarized.

## Layout
- `src/` — the app (Electron shell `main.js`, status engine `server.js`, page `index.html`)
- `installer/` — installer build script, welcome/finish pages, artwork
- `update/` — the update feed and versioned app code
- `tools/publish_update.py` — publish a new version to the updater

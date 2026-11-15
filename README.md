# Service Status

A live **“where are we in the service?”** screen for the production booth, iPads and phones — built at The Family Church (Lafayette, LA) and free for any church that runs **ProPresenter 7** (and optionally **Planning Center Services**).

- **The message:** which point the pastor is on, % through, a timeline with the points marked, projected finish vs. your message timer.
- **Songs:** which section the band is in (Verse 1, Chorus, Bridge…) from your ProPresenter slide groups, and time vs. planned.
- **Order of service:** follows whatever playlist is open in ProPresenter, matched to the Planning Center plan. Live “vs plan”, projected end, item descriptions (e.g. the lead singer), and it learns how long your items really take. With two services on one plan (9AM / 11AM), it switches to the next one 15 minutes before it starts.
- **Pick the plan by hand:** Settings → **Plan to show → Pick one** lets the booth choose the service type, plan and service time from Planning Center instead of matching ProPresenter. Every screen shows a **Manual** tag, and it goes back to Automatic at midnight.
- **Confidence monitor:** the live slide’s words as big as they fit, with the next slide underneath, plus the clock and your timer. It’s a tab on phones and iPads, and a full-screen view at `/stage` for any TV or monitor.
- **Phones, iPads and TVs:** any device on the same network opens the address shown at the bottom of the app: `/mobile` (Now · Full order · Confidence monitor) on phones and iPads, `/tv` for a room screen, `/stage` for the confidence monitor. Each device keeps its own display settings.
- **Easy to read in a dark booth:** checked against WCAG 2.2 AA (contrast, keyboard, 44 px tap targets, Reduce Motion).
- **Read-only:** it never changes anything in ProPresenter or Planning Center.

## Install (Mac)
1. Download **Service Status Installer.pkg** from the [latest release](https://github.com/thestealthgoat/service-status/releases/latest). It's one installer for Intel and Apple Silicon, signed and notarized by Apple, so it opens with no security warning.
2. Open it and follow the steps. The app opens when it's done; its welcome screen asks for ProPresenter's network port and, optionally, a Planning Center Personal Access Token.
3. That's it. It starts with the Mac (Settings → **Launch at login**) and keeps itself up to date.

Already on 2.0? It keeps updating itself as before. Install 2.1 when convenient to get overnight updates, Launch at login and the Beta channel; your settings and history carry over.

## Updates
The app checks this repo every few hours (and from **Service Status → Check for Updates…**). New code downloads in the background and is checked against its SHA-256. On 2.1 it installs itself overnight, between 3 and 5 AM and never within 2 hours of a service, without bringing the window forward. You can also press **Restart** to use it right away.

**Settings → Updates:** **Stable** (the default) or **Beta**. Put one booth computer on Beta: new versions reach it first, and everyone else gets them once they're promoted.

To publish (needs Node and `npm install --no-save esbuild` in the repo, for the older-phone step):
- run the tests: `node --test tests/`
- Beta first: `python3 tools/publish_update.py <version> "notes" --beta`, then commit and push
- when it's proven: `python3 tools/promote.py` (copies Beta to Stable), then commit and push
- `python3 tools/publish_update.py <version> "notes"` without `--beta` publishes straight to Stable.

## Build the installer
Only needed when the app shell changes (`src/main.js`, `src/shell.js`, Electron). Run `tools/build_installer.sh <electron version>` on a Mac with:
- `npm install --no-save @electron/packager@20.3.0`
- the Developer ID Application and Developer ID Installer certificates (plus Apple's Developer ID G2 intermediate) in the login keychain
- a notary login saved as keychain profile `service-status` (`xcrun notarytool store-credentials`)

It packages both architectures, signs with the hardened runtime (`installer/entitlements.plist`), notarizes and staples the apps and the installer, and runs Apple's checks. The output is in `dist/<version>/`.

## Layout
- `src/`: the app (Electron shell `main.js` + `shell.js`, status engine `server.js`, page `index.html`)
- `installer/`: welcome and finish pages, artwork, entitlements
- `update/`: the update feeds (`latest.json` Stable, `beta.json` Beta) and versioned app code
- `tools/`: `publish_update.py` publishes a version (with `compat.js` as its older-browser step); `promote.py` moves Beta to Stable; `build_installer.sh` (with `package_app.mjs`) builds the signed installer
- `tests/` — unit tests (`node --test tests/`)
- `docs/superpowers/` — design notes and plans for larger changes

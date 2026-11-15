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
1. Download **Service Status Installer.pkg** from [Releases](https://github.com/thestealthgoat/service-status/releases) — one installer for Intel and Apple Silicon.
2. Open it. The first time, macOS may say it can’t check it: System Settings → Privacy & Security → **Open Anyway**.
3. The app opens when it’s done. Its welcome screen asks for ProPresenter’s network port and (optionally) a Planning Center Personal Access Token.
4. The installer may be an older version than the newest app code. That’s fine: a few seconds after it opens, the app downloads the newest code by itself. Restart it once (Cmd+Q, then open it again) to use it.

## Updates
The app checks this repo (`update/latest.json`) every few hours and from **Service Status → Check for Updates…**. New code downloads in the background, is checked against its SHA-256, and is used after the next restart — no reinstall.

To publish: edit `src/`, run the tests (`node --test tests/`), then `python3 tools/publish_update.py <version> "notes"`, commit and push. The publish step rewrites the page for older phone browsers with esbuild, so it needs Node and `npm install --no-save esbuild` in the repo first. Without them it warns and ships the page unconverted, which older Android phones can’t run.

## Build the installer
On a Mac, put the packaged app zips next to `installer/Build Installers.command` and double-click it (uses Apple’s `codesign`, `pkgbuild`, `productbuild`). The app is ad-hoc signed, not notarized.

## Layout
- `src/` — the app (Electron shell `main.js`, status engine `server.js`, page `index.html`)
- `installer/` — installer build script, welcome/finish pages, artwork
- `update/` — the update feed and versioned app code
- `tools/publish_update.py` — publish a new version to the updater (`tools/compat.js` is its older-browser step)
- `tests/` — unit tests (`node --test tests/`)
- `docs/superpowers/` — design notes and plans for larger changes

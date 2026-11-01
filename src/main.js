// Service Status — Electron shell. Starts the status service and shows the page in a window.
// Also the updater: new app code (server.js + index.html) is downloaded from the public GitHub repo,
// checked against its SHA-256, kept in the app's support folder, and used from the next start —
// no reinstall. The app bundle itself is never modified, so its signature stays valid.
'use strict';
const { app, BrowserWindow, dialog, powerSaveBlocker, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const FEED = 'https://raw.githubusercontent.com/thestealthgoat/service-status/main/update/latest.json';
const RELEASES = 'https://github.com/thestealthgoat/service-status/releases';
const CODE_FILES = ['server.js', 'index.html'];

let service = null, win = null, port = null;
const update = { shell: app.getVersion(), running: app.getVersion(), status: 'idle', latest: null, ready: null, error: null, checked: null, notes: null };

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// ---------------------------------------------------------------- versions + code folder
const newer = (a, b) => {          // is version a newer than b?
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0), pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
};
const codeRoot = () => path.join(app.getPath('userData'), 'code');
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// Pick the code to run: a downloaded update if it's newer than the bundled code and complete, else the bundled code.
function chooseCode() {
  const cur = readJSON(path.join(codeRoot(), 'current.json'));
  if (cur && newer(cur.version, app.getVersion()) && !cur.bad) {
    const dir = path.join(codeRoot(), cur.version);
    if (CODE_FILES.every(f => fs.existsSync(path.join(dir, f)))) return { dir, version: cur.version };
  }
  return { dir: __dirname, version: app.getVersion() };
}
function markBad(version) {
  const f = path.join(codeRoot(), 'current.json'), cur = readJSON(f);
  if (cur && cur.version === version) { cur.bad = true; try { fs.writeFileSync(f, JSON.stringify(cur)); } catch {} }
}

// ---------------------------------------------------------------- updater
async function getBuf(url) {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
async function checkForUpdate(manual) {
  if (update.status === 'checking' || update.status === 'downloading') return;
  update.status = 'checking'; update.error = null;
  try {
    const feed = JSON.parse((await getBuf(FEED + '?t=' + Date.now())).toString('utf8'));
    update.latest = feed.version; update.notes = feed.notes || null; update.checked = new Date().toISOString();
    if (!newer(feed.version, update.running) || (update.ready && !newer(feed.version, update.ready))) {
      update.status = update.ready ? 'ready' : 'current';
    } else if (feed.min_shell && newer(feed.min_shell, update.shell)) {
      update.status = 'reinstall';      // this update needs a new installer (e.g. a new Electron)
    } else {
      update.status = 'downloading';
      const dir = path.join(codeRoot(), feed.version), tmp = dir + '.part';
      fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
      for (const f of CODE_FILES) {
        const spec = feed.files && feed.files[f];
        if (!spec) throw new Error('update is missing ' + f);
        const buf = await getBuf(spec.url);
        const sum = crypto.createHash('sha256').update(buf).digest('hex');
        if (sum !== spec.sha256) throw new Error(f + ' failed its checksum');
        fs.writeFileSync(path.join(tmp, f), buf);
      }
      try { fs.copyFileSync(path.join(__dirname, 'icon.png'), path.join(tmp, 'icon.png')); } catch {}
      fs.rmSync(dir, { recursive: true, force: true }); fs.renameSync(tmp, dir);
      fs.writeFileSync(path.join(codeRoot(), 'current.json'), JSON.stringify({ version: feed.version, at: new Date().toISOString() }));
      update.ready = feed.version; update.status = 'ready';
    }
  } catch (e) {
    update.status = 'error'; update.error = e.message;
  }
  if (manual) {
    const msg = { current: `You're up to date (${update.running}).`, ready: `Version ${update.ready} is downloaded. Restart Service Status to use it.`,
      reinstall: `Version ${update.latest} needs the new installer.`, error: `Couldn't check for updates: ${update.error}` }[update.status];
    if (msg) {
      const btns = update.status === 'ready' ? ['Restart now', 'Later'] : update.status === 'reinstall' ? ['Get installer', 'Later'] : ['OK'];
      const r = await dialog.showMessageBox(win, { message: 'Service Status', detail: msg, buttons: btns });
      if (update.status === 'ready' && r.response === 0) restartApp();
      if (update.status === 'reinstall' && r.response === 0) shell.openExternal(RELEASES);
    }
  }
}
function restartApp() { app.relaunch(); app.exit(0); }

// ---------------------------------------------------------------- window
function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 860, minWidth: 380, minHeight: 500,
    title: 'Service Status', backgroundColor: '#0e0f12',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('context-menu', (_e, p) => {
    if (p.isEditable) Menu.buildFromTemplate([{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' }]).popup();
  });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(async () => {
  const cfgPath = path.join(app.getPath('userData'), 'config.json');
  let code = chooseCode(), StatusService;
  try { ({ StatusService } = require(path.join(code.dir, 'server.js'))); }
  catch (e) { markBad(code.version); code = { dir: __dirname, version: app.getVersion() }; ({ StatusService } = require('./server')); }
  update.running = code.version;
  service = new StatusService(cfgPath, path.join(code.dir, 'index.html'));
  service.update = update;                                   // shown in Settings
  service.onUpdateAction = a => { if (a === 'restart') restartApp(); else if (a === 'check') checkForUpdate(false); else if (a === 'installer') shell.openExternal(RELEASES); };
  try {
    port = await service.start();
  } catch (e) {
    dialog.showErrorBox('Service Status', `Couldn't start the status page (${e.code || e.message}).`);
    app.quit();
    return;
  }
  powerSaveBlocker.start('prevent-app-suspension');   // keep serving phones while the window is in the background
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about' },
      { label: 'Check for Updates…', click: () => checkForUpdate(true) },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' }, { role: 'windowMenu' }]));
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
  // check shortly after launch, then every 6 hours; updates download quietly and apply on the next start
  setTimeout(() => checkForUpdate(false), 15000);
  setInterval(() => checkForUpdate(false), 6 * 3600 * 1000);
});

// Closing the window keeps the app (and the phone page) running; Cmd+Q quits.
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (service) service.stop(); });

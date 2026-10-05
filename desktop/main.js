/**
 * Everloom for Windows: a small Electron shell around the normal Everloom server.
 *
 * The server runs as a child process on a bundled Node runtime (resources/node/node.exe), so its
 * native modules are ordinary Windows Node builds and never need rebuilding for Electron. This
 * process only owns the window, the tray, the port, updates and a clean shutdown.
 *
 * Data lives in %APPDATA%\Everloom (or next to the exe for the portable zip), never with the
 * program files, so updates and reinstalls keep it.
 */
'use strict';
const { app, BrowserWindow, Tray, Menu, shell, dialog, net: enet } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const REPO = 'pander0212/everloom';
const DEFAULT_PORT = 8787;
const exeDir = path.dirname(process.execPath);
const portable = !!process.env.PORTABLE_EXECUTABLE_DIR || fs.existsSync(path.join(exeDir, 'portable.txt'));
const dataDir = portable ? path.join(process.env.PORTABLE_EXECUTABLE_DIR || exeDir, 'data') : path.join(app.getPath('appData'), 'Everloom');
const headless = process.argv.includes('--headless');
const res = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'stage');

fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
// Electron's own cache and storage stay inside the data folder, apart from Everloom's files.
app.setPath('userData', path.join(dataDir, 'app'));
app.setAppUserModelId('app.everloom.desktop');

const configFile = path.join(dataDir, 'desktop.json');
function readConfig() {
  try {
    return { lan: false, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) };
  } catch {
    return { lan: false };
  }
}
function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.writeFileSync(configFile, JSON.stringify(next, null, 2));
  return next;
}

const logFile = path.join(dataDir, 'logs', 'desktop.log');
function log(...args) {
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.1`);
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${args.join(' ')}\n`);
  } catch {
    /* logging is best effort */
  }
}

// ------------------------------------------------------------------ one copy only

if (!app.requestSingleInstanceLock()) {
  // Another copy is running: it gets our arguments (--quit, or just "show yourself").
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--quit')) void quitGracefully();
    else showWindow();
  });
  if (process.argv.includes('--quit')) app.exit(0);
  else app.whenReady().then(start).catch((e) => fatal(e));
}

// ------------------------------------------------------------------ the server

let server = null; // { child, port, host, token }
let quitting = false;
let win = null;
let tray = null;

function portFree(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}
async function pickPort(host) {
  for (let p = DEFAULT_PORT; p < DEFAULT_PORT + 60; p++) if (await portFree(p, host)) return p;
  throw new Error('No free port between 8787 and 8846');
}

function request(method, port, urlPath, { token, body, timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, timeout, headers: { ...(token ? { 'x-desktop-token': token } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* not json */
        }
        resolve({ status: r.statusCode, json, text });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const control = (urlPath, body) => request(body === undefined ? 'GET' : 'POST', server.port, urlPath, { token: server.token, body });

async function startServer() {
  const cfg = readConfig();
  const host = cfg.lan ? '0.0.0.0' : '127.0.0.1';
  const port = await pickPort(host);
  const token = crypto.randomBytes(24).toString('hex');
  const serverLog = fs.openSync(path.join(dataDir, 'logs', 'server.log'), 'a');
  const nodeExe = path.join(res, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
  const entry = path.join(res, 'server', 'index.js');
  // A minimal environment: the server gets what it needs and nothing else from this process.
  const env = {
    PATH: process.env.PATH || '',
    SystemRoot: process.env.SystemRoot || '',
    TEMP: process.env.TEMP || os.tmpdir(),
    TMP: process.env.TMP || os.tmpdir(),
    APPDATA: process.env.APPDATA || '',
    LOCALAPPDATA: process.env.LOCALAPPDATA || '',
    USERPROFILE: process.env.USERPROFILE || os.homedir(),
    HOME: os.homedir(),
    NODE_ENV: 'production',
    EVERLOOM_DATA_DIR: dataDir,
    EVERLOOM_WEB_DIR: path.join(res, 'web'),
    EVERLOOM_IMPORT_ROOTS: os.homedir(),
    EVERLOOM_DESKTOP: '1',
    EVERLOOM_DESKTOP_TOKEN: token,
    PORT: String(port),
    HOST: host,
  };
  log(`starting server on ${host}:${port}`);
  const child = spawn(nodeExe, [entry], { cwd: path.join(res, 'server'), env, stdio: ['ignore', serverLog, serverLog], windowsHide: true });
  server = { child, port, host, token };
  child.on('exit', (code) => {
    log(`server exited (${code})`);
    if (server && server.child === child) server = null;
    if (!quitting && !restarting) {
      dialog
        .showMessageBox({ type: 'error', title: 'Everloom', message: 'Everloom’s server stopped.', detail: `Its log is in ${path.join(dataDir, 'logs', 'server.log')}.`, buttons: ['Restart', 'Quit'], defaultId: 0 })
        .then((r) => (r.response === 0 ? startServer().then(() => win && win.loadURL(appUrl())) : quitGracefully()))
        .catch(() => undefined);
    }
  });
  // Wait for /api/health (first start runs database migrations, which can take a moment).
  const t0 = Date.now();
  for (;;) {
    if (!server || server.child !== child) throw new Error('The server stopped while starting; see logs/server.log');
    try {
      const r = await request('GET', port, '/api/health', { timeout: 2000 });
      if (r.status === 200) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > 90_000) throw new Error('The server did not start within 90 seconds; see logs/server.log');
    await new Promise((r) => setTimeout(r, 300));
  }
  fs.writeFileSync(path.join(dataDir, 'desktop-state.json'), JSON.stringify({ port, host, pid: child.pid, startedAt: Date.now(), version: app.getVersion() }, null, 2));
  log('server ready');
}

const appUrl = () => `http://127.0.0.1:${server.port}/`;

/** Stop the server cleanly (it closes the database), then kill it only if it doesn't stop. */
async function stopServer() {
  if (!server) return;
  const { child } = server;
  const done = new Promise((resolve) => child.once('exit', resolve));
  try {
    await control('/api/desktop/shutdown', {});
  } catch {
    /* already gone */
  }
  const ok = await Promise.race([done.then(() => true), new Promise((r) => setTimeout(() => r(false), 15_000))]);
  if (!ok) {
    log('server did not stop in time; killing it');
    child.kill();
    await done;
  }
  server = null;
}

let restarting = false;
async function restartServer() {
  restarting = true;
  try {
    await stopServer();
    await startServer();
  } finally {
    restarting = false;
  }
  if (win) await win.loadURL(appUrl());
  buildTray();
}

async function quitGracefully() {
  if (quitting) return;
  quitting = true;
  log('quitting');
  try {
    await stopServer();
  } finally {
    if (tray) tray.destroy();
    app.exit(0);
  }
}

// ------------------------------------------------------------------ window and tray

function showWindow() {
  if (headless || !server) return;
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 360,
    minHeight: 560,
    title: 'Everloom',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f6f5f2',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  // Links to other sites open in the browser; the window only ever shows Everloom.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${server && server.port}/`)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  let told = false;
  win.on('close', (e) => {
    if (quitting) return;
    // Closing the window keeps Everloom running in the tray (Quit is in the tray menu).
    e.preventDefault();
    win.hide();
    if (!told && tray) {
      told = true;
      tray.displayBalloon?.({ title: 'Everloom is still running', content: 'It’s in the tray. Right-click its icon to quit.', iconType: 'info' });
    }
  });
  void win.loadURL(appUrl());
}

function buildTray() {
  if (headless) return;
  const cfg = readConfig();
  if (!tray) {
    tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
    tray.setToolTip('Everloom');
    tray.on('click', showWindow);
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Everloom', click: showWindow },
      { label: 'Open in browser', click: () => server && shell.openExternal(appUrl()) },
      { label: 'Lock vault', click: () => lockVault() },
      { type: 'separator' },
      { label: 'Use from my phone on Wi-Fi', type: 'checkbox', checked: !!cfg.lan, click: (item) => void toggleLan(item.checked) },
      { label: 'Phone address and QR code…', enabled: !!cfg.lan, click: () => void showLan() },
      { type: 'separator' },
      { label: 'Check for updates…', click: () => void checkForUpdates(true) },
      { label: 'Open data folder', click: () => shell.openPath(dataDir) },
      { type: 'separator' },
      { label: 'Quit Everloom', click: () => void quitGracefully() },
    ]),
  );
}

async function lockVault() {
  try {
    const r = await control('/api/desktop/lock', {});
    const text = r.json && r.json.locked ? 'The vault is locked.' : r.json && r.json.enabled === false ? 'The vault is off (Settings › Privacy turns it on).' : 'The vault was already locked.';
    if (tray) tray.displayBalloon?.({ title: 'Everloom', content: text, iconType: 'info' });
    if (win) win.webContents.reload();
  } catch (e) {
    log('lock failed', e && e.message);
  }
}

// ------------------------------------------------------------------ phone on Wi-Fi

async function toggleLan(on) {
  if (on) {
    const st = await control('/api/desktop/state').catch(() => null);
    if (st && st.json && st.json.noPassword) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Set a password first',
        message: 'Other devices need a password to get in.',
        detail: 'In Everloom, open Settings › Account & security, turn off “No password on this PC” and choose a password. Then turn this on again.',
      });
      buildTray();
      return;
    }
    const ok = await dialog.showMessageBox({
      type: 'question',
      title: 'Use Everloom from your phone',
      message: 'Let other devices on your Wi-Fi open Everloom?',
      detail:
        'Everloom will listen on your local network, so anyone on the same Wi-Fi can reach the sign-in page (they still need your password).\n\nWindows may ask whether to allow Everloom through the firewall: allow it on Private networks only.',
      buttons: ['Turn on', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    if (ok.response !== 0) return buildTray();
  }
  writeConfig({ lan: on });
  await restartServer();
  if (on) await showLan();
}

async function showLan() {
  const r = await control('/api/desktop/lan').catch(() => null);
  const info = (r && r.json) || { urls: [], svg: '' };
  const lw = new BrowserWindow({ width: 420, height: 560, title: 'Everloom on your phone', autoHideMenuBar: true, resizable: false, icon: path.join(__dirname, 'build', 'icon.ico'), webPreferences: { contextIsolation: true, sandbox: true, javascript: false } });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const html = `<!doctype html><meta charset="utf-8"><title>Everloom on your phone</title><style>
    body{margin:0;padding:24px;font:15px/1.5 system-ui,sans-serif;background:#f6f5f2;color:#18191b}
    @media (prefers-color-scheme: dark){body{background:#111214;color:#ececec}.qr{background:#fff}}
    h1{font-size:18px;margin:0 0 8px}.qr{width:240px;margin:16px auto;padding:12px;border-radius:12px;background:#fff}
    .qr svg{width:100%;height:auto;display:block}code{display:block;text-align:center;font-size:15px;margin:4px 0}
    p{color:#595c62}@media (prefers-color-scheme: dark){p{color:#a6a8ad}}</style>
    <h1>Open Everloom on your phone</h1><p>Connect the phone to the same Wi-Fi, then scan this or type the address.</p>
    <div class="qr">${info.svg || ''}</div>${(info.urls || []).map((u) => `<code>${esc(u)}</code>`).join('')}
    <p>Sign in with your Everloom password. If the page doesn't open, allow Everloom in the Windows Firewall prompt (Private networks).</p>`;
  await lw.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

// ------------------------------------------------------------------ updates

function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function checkForUpdates(manual) {
  try {
    const r = await enet.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    const rel = await r.json();
    if (!newer(rel.tag_name, app.getVersion())) {
      if (manual) await dialog.showMessageBox({ type: 'info', title: 'Everloom', message: `You have the latest version (${app.getVersion()}).` });
      return;
    }
    const asset = (rel.assets || []).find((a) => /^Everloom-Setup-.*\.exe$/.test(a.name));
    if (portable || !asset) {
      const r2 = await dialog.showMessageBox({ type: 'info', title: 'Update available', message: `Everloom ${rel.tag_name} is available.`, detail: portable ? 'This is the portable version: download the new zip and unpack it over this folder (your data folder stays).' : 'Download it from the release page.', buttons: ['Open the release page', 'Later'] });
      if (r2.response === 0) void shell.openExternal(rel.html_url);
      return;
    }
    const ok = await dialog.showMessageBox({ type: 'question', title: 'Update available', message: `Install Everloom ${rel.tag_name}?`, detail: `${(rel.body || '').slice(0, 800)}\n\nA backup of your data is made first. Everloom restarts when it's done.`, buttons: ['Install', 'Later'], defaultId: 0, cancelId: 1 });
    if (ok.response !== 0) return;
    // A backup first; if it fails, nothing is installed.
    const b = await control('/api/desktop/backup', {});
    if (b.status !== 200) throw new Error((b.json && b.json.error) || 'The backup failed, so the update was not installed');
    const file = path.join(os.tmpdir(), asset.name);
    const dl = await enet.fetch(asset.browser_download_url);
    if (!dl.ok) throw new Error(`Download failed (${dl.status})`);
    fs.writeFileSync(file, Buffer.from(await dl.arrayBuffer()));
    log(`installing ${asset.name}`);
    await stopServer();
    // The installer replaces the program files only (data stays in %APPDATA%) and starts the new version.
    spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    quitting = true;
    app.exit(0);
  } catch (e) {
    log('update check failed', e && e.message);
    if (manual) await dialog.showMessageBox({ type: 'error', title: 'Everloom', message: 'Couldn’t check for updates.', detail: String((e && e.message) || e) });
  }
}

// ------------------------------------------------------------------ start

async function start() {
  try {
    await startServer();
  } catch (e) {
    return fatal(e);
  }
  if (headless) return log('headless: server only');
  createWindow();
  buildTray();
  setTimeout(() => void checkForUpdates(false), 15_000);
}

function fatal(e) {
  log('fatal', e && (e.stack || e.message));
  if (!headless) dialog.showErrorBox('Everloom couldn’t start', `${(e && e.message) || e}\n\nLogs: ${path.join(dataDir, 'logs')}`);
  app.exit(1);
}

app.on('before-quit', (e) => {
  if (!quitting) {
    e.preventDefault();
    void quitGracefully();
  }
});
app.on('window-all-closed', () => {
  /* keep running in the tray */
});

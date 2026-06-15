// 摸鱼监控 — Electron control panel.
// A tiny hand-drawn window that starts/stops the monitor engine (SalaryCat + hardware dashboard
// streamed to the TURZX bar screen), toggles launch-at-login / minimize-to-tray, and checks
// GitHub Releases for updates. The heavy USB/render loop runs in a separate utilityProcess.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, utilityProcess } = require('electron');

const ICON_PATH = path.join(__dirname, 'ui', 'icon.png');
const ENGINE_ENTRY = path.join(__dirname, '..', 'src', 'engine-entry.js');

// ---- settings (a small JSON file in userData) ------------------------------------------
const DEFAULTS = { minimizeToTray: true, launchAtLogin: false, fps: 12 };
let settings = { ...DEFAULTS };
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; }
  catch { settings = { ...DEFAULTS }; }
}
function saveSettings() { try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch {} }

let mainWindow = null;
let tray = null;
let engine = null;
let lastStatus = { state: 'stopped', message: '未运行' };
let quitting = false;

const isRunning = () => lastStatus.state === 'running' || lastStatus.state === 'starting';
function iconImage() {
  try { return nativeImage.createFromBuffer(fs.readFileSync(ICON_PATH)); }
  catch { return nativeImage.createEmpty(); }
}

// ---- engine (utilityProcess: native modules load against Electron, loop never blocks UI) --
function ensureEngine() {
  if (engine) return engine;
  engine = utilityProcess.fork(ENGINE_ENTRY, [], { serviceName: 'moyu-engine' });
  engine.on('message', (msg) => {
    if (!msg || msg.type !== 'status') return;
    lastStatus = { state: msg.state, message: msg.message };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('engine:status', lastStatus);
    updateTrayMenu();
  });
  engine.on('exit', () => { engine = null; });
  return engine;
}
function engineStart() { ensureEngine().postMessage({ type: 'start', fps: settings.fps }); }
function engineStop() { if (engine) engine.postMessage({ type: 'stop' }); }

// ---- window -----------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380, height: 660,
    resizable: false, maximizable: false, fullscreenable: false,
    frame: false, show: false, backgroundColor: '#FBF7EF', title: '摸鱼监控',
    icon: iconImage(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      // the preload reads the cat GIF + Excalifont off disk via fs; a sandboxed preload
      // can't require('fs'), so disable the sandbox (we only ever load local files).
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (e) => {
    if (!quitting && settings.minimizeToTray) { e.preventDefault(); mainWindow.hide(); }
  });
}
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else { mainWindow.show(); mainWindow.focus(); }
}

// ---- tray -------------------------------------------------------------------------------
function updateTrayMenu() {
  if (!tray) return;
  const running = isRunning();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: showWindow },
    { type: 'separator' },
    { label: '启动', enabled: !running, click: engineStart },
    { label: '停止', enabled: running, click: engineStop },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
  tray.setToolTip(`摸鱼监控 · ${running ? '运行中' : '未运行'}`);
}
function createTray() {
  tray = new Tray(iconImage().resize({ width: 16, height: 16 }));
  tray.on('click', showWindow);
  updateTrayMenu();
}

// ---- update check (GitHub Releases, no extra dependency) --------------------------------
function repoSlug() {
  try {
    const pkg = require(path.join(app.getAppPath(), 'package.json'));
    const url = (pkg.repository && (pkg.repository.url || pkg.repository)) || '';
    const m = String(url).match(/github\.com[/:]([^/]+\/[^/.]+)/i);
    if (m) return m[1];
  } catch {}
  return 'Utter-pulsar/meow-monitor';
}
function cmpVer(a, b) { // 1 if a>b, -1 if a<b, 0 if equal (semver major.minor.patch)
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y ? 1 : -1; }
  return 0;
}
function checkUpdate() {
  return new Promise((resolve) => {
    const req = https.request({
      host: 'api.github.com', path: `/repos/${repoSlug()}/releases/latest`, method: 'GET',
      headers: { 'User-Agent': 'meow-monitor', Accept: 'application/vnd.github+json' },
    }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          if (res.statusCode === 404) return resolve({ status: 'none', message: '仓库还没有发布版本' });
          if (res.statusCode !== 200) return resolve({ status: 'error', message: `检查失败 (${res.statusCode})` });
          const j = JSON.parse(body);
          const latest = String(j.tag_name || '').replace(/^v/i, '');
          if (latest && cmpVer(latest, app.getVersion()) > 0) resolve({ status: 'update', latest, url: j.html_url });
          else resolve({ status: 'latest', latest: latest || app.getVersion() });
        } catch { resolve({ status: 'error', message: '解析失败' }); }
      });
    });
    req.on('error', () => resolve({ status: 'error', message: '网络错误' }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 'error', message: '请求超时' }); });
    req.end();
  });
}

// ---- IPC --------------------------------------------------------------------------------
ipcMain.handle('engine:start', () => { engineStart(); return true; });
ipcMain.handle('engine:stop', () => { engineStop(); return true; });
ipcMain.handle('engine:status', () => lastStatus);
ipcMain.handle('settings:get', () => ({ ...settings, version: app.getVersion() }));
ipcMain.handle('settings:setMinimize', (_e, v) => { settings.minimizeToTray = !!v; saveSettings(); return settings.minimizeToTray; });
ipcMain.handle('settings:setAutoLaunch', (_e, v) => {
  settings.launchAtLogin = !!v; saveSettings();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  return settings.launchAtLogin;
});
ipcMain.handle('update:check', () => checkUpdate());
ipcMain.handle('app:openExternal', (_e, url) => shell.openExternal(url));
ipcMain.on('window:minimize', () => { if (settings.minimizeToTray) mainWindow.hide(); else mainWindow.minimize(); });
ipcMain.on('window:close', () => { if (settings.minimizeToTray) mainWindow.hide(); else app.quit(); });

// ---- lifecycle --------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    loadSettings();
    if (process.platform === 'win32') app.setAppUserModelId('com.moyu.monitor');
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    createWindow();
    createTray();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!settings.minimizeToTray) app.quit(); });

  // Quit cleanly: hold the quit, tell the engine to release the USB panel, and only then exit.
  // A kill() fallback guarantees we still quit if the device teardown ever hangs.
  let shuttingDown = false;
  app.on('before-quit', (e) => {
    quitting = true; // let the window 'close' handler stop re-hiding to tray
    if (shuttingDown || !engine) return; // cleanup done/none -> allow the quit to proceed
    shuttingDown = true;
    e.preventDefault();
    engine.once('exit', () => app.quit());
    try { engine.postMessage({ type: 'shutdown' }); } catch { app.quit(); }
    setTimeout(() => { try { engine && engine.kill(); } catch {} }, 3000);
  });
}

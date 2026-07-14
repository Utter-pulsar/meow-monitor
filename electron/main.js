// 摸鱼监控 — Electron control panel.
// A tiny hand-drawn window that starts/stops either the monitor engine (SalaryCat + hardware
// dashboard streamed to the TURZX bar screen) or the "extend screen" engine (TURZX becomes a real
// Windows extended desktop), toggles launch-at-login / minimize-to-tray, and checks GitHub Releases
// for updates. The dashboard USB/render loop runs in a separate utilityProcess; the extend-screen
// capture runs in the main process (it needs Chromium's desktopCapturer).
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, utilityProcess, screen, powerMonitor } = require('electron');
const os = require('node:os');
const { ExtendEngine } = require('../src/extend');
const vdd = require('../src/vdd');
const { PANELS_META, DEFAULT_ORDER, normalizeOrder } = require('../src/panels');

// Log main-process crashes to a file (Electron's GUI stdout doesn't reach the terminal on Windows).
const MAIN_ERR_LOG = path.join(os.tmpdir(), 'moyu-main-error.log');
function logMainErr(tag, e) { try { fs.appendFileSync(MAIN_ERR_LOG, `[${new Date().toISOString()}] ${tag}: ${(e && e.stack) || e}\n`); } catch {} }
process.on('uncaughtException', (e) => logMainErr('uncaughtException', e));
process.on('unhandledRejection', (e) => logMainErr('unhandledRejection', e));

const ICON_PATH = path.join(__dirname, 'ui', 'icon.png');
const ENGINE_ENTRY = path.join(__dirname, '..', 'src', 'engine-entry.js');

// ---- settings (a small JSON file in userData) ------------------------------------------
const DEFAULTS = { minimizeToTray: true, launchAtLogin: false, fps: 12, mode: 'dashboard', extendQuality: 150, dashOrder: DEFAULT_ORDER };
let settings = { ...DEFAULTS };
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; }
  catch { settings = { ...DEFAULTS }; }
}
function saveSettings() { try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch {} }

let mainWindow = null;
let tray = null;
let engine = null;          // dashboard utilityProcess
let extend = null;          // ExtendEngine (extend-screen mode)
let lastStatus = { state: 'stopped', message: '未运行' };
let quitting = false;
let manualBlackout = false;
let sessionLocked = false;
let unlockRecoveryTimer = null;
let unlockRecovery = null;

const isBlackedOut = () => manualBlackout || sessionLocked;
function sendBlackout() {
  const state = { active: isBlackedOut(), manual: manualBlackout, locked: sessionLocked };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('display:blackout', state);
  return state;
}
async function applyBlackout() {
  const value = isBlackedOut();
  if (engine) { try { engine.postMessage({ type: 'blank', value }); } catch {} }
  if (extend) { try { await extend.setBlank(value); } catch (e) { logMainErr('setBlank', e); } }
  return sendBlackout();
}

// Windows invalidates DXGI Desktop Duplication while the session is locked. Restoring brightness
// alone then reveals the last captured black frame, so rebuild the extend capture/USB session after
// unlock. Keep the VDD devnode alive throughout: Windows display topology never changes.
function recoverAfterUnlock() {
  clearTimeout(unlockRecoveryTimer);
  unlockRecoveryTimer = setTimeout(() => {
    unlockRecoveryTimer = null;
    if (sessionLocked || quitting || settings.mode !== 'extend' || !extendRunning()) {
      applyBlackout();
      return;
    }
    if (unlockRecovery) return;
    unlockRecovery = (async () => {
      try {
        await extend.stop({ turnOffScreen: false });
        if (!sessionLocked && !quitting && settings.mode === 'extend') await extendStart();
        await applyBlackout();
      } catch (e) { logMainErr('recoverAfterUnlock', e); }
      finally { unlockRecovery = null; }
    })();
  }, 700);
}

const isRunning = () => lastStatus.state === 'running' || lastStatus.state === 'starting';
function iconImage() {
  try { return nativeImage.createFromBuffer(fs.readFileSync(ICON_PATH)); }
  catch { return nativeImage.createEmpty(); }
}

function setStatus(state, message) {
  lastStatus = { state, message };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('engine:status', lastStatus);
  updateTrayMenu();
}

// ---- auto update (electron-updater): download with progress, then install + relaunch -----
autoUpdater.autoDownload = false;        // we download only after the user clicks 检查更新
autoUpdater.autoInstallOnAppQuit = true;
function sendUpd(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
autoUpdater.on('download-progress', (p) => sendUpd('update:progress', Math.max(0, Math.min(100, Math.round(p.percent || 0)))));
autoUpdater.on('update-downloaded', () => { sendUpd('update:downloaded'); setTimeout(() => { try { autoUpdater.quitAndInstall(); } catch {} }, 1000); });
autoUpdater.on('error', (e) => sendUpd('update:error', String((e && e.message) || e)));

// ---- dashboard engine (utilityProcess) --------------------------------------------------
function ensureEngine() {
  if (engine) return engine;
  engine = utilityProcess.fork(ENGINE_ENTRY, [], { serviceName: 'moyu-engine' });
  engine.on('message', (msg) => {
    if (!msg || msg.type !== 'status') return;
    setStatus(msg.state, msg.message);
  });
  engine.on('exit', () => { engine = null; });
  return engine;
}
function engineStart() { ensureEngine().postMessage({ type: 'start', fps: settings.fps, order: normalizeOrder(settings.dashOrder), blanked: isBlackedOut() }); }
function engineStop() { if (engine) engine.postMessage({ type: 'stop' }); }

// ---- extend-screen engine (main process) ------------------------------------------------
function getExtend() { if (!extend) extend = new ExtendEngine(); return extend; }
async function extendStart() { engineStop(); await getExtend().start({ fps: settings.fps, target: settings.extendQuality, blanked: isBlackedOut(), onStatus: setStatus }); }
async function extendStop() { if (extend) await extend.stop({ turnOffScreen: true }); }
const extendRunning = () => !!(extend && (extend.running || extend.dev));

// ---- window -----------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    // generous starting height; the renderer measures its content and calls window:fit to shrink
    // the window to the exact height (no scrollbar). Starting tall avoids a scrollbar flash before
    // that fit lands. If the renderer never fits (old build), it just leaves a little blank space.
    width: 380, height: settings.mode === 'extend' ? 760 : 820,
    resizable: false, maximizable: false, fullscreenable: false,
    frame: false, show: false, backgroundColor: '#FBF7EF', title: '摸鱼监控',
    icon: iconImage(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      // the preload reads the cat GIF + fonts off disk via fs; a sandboxed preload can't
      // require('fs'), so disable the sandbox (we only ever load local files).
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
function resizeForMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // coarse generous size for the new mode; the renderer refits to the exact height right after
  try { mainWindow.setContentSize(380, mode === 'extend' ? 760 : 820); } catch {}
}

// ---- tray -------------------------------------------------------------------------------
function updateTrayMenu() {
  if (!tray) return;
  const running = isRunning();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: showWindow },
    { type: 'separator' },
    { label: '启动', enabled: !running, click: () => onStart() },
    { label: '停止', enabled: running, click: () => onStop() },
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

// ---- start/stop routed by the active mode -----------------------------------------------
async function onStart() {
  if (settings.mode === 'extend') await extendStart();
  else { if (extendRunning()) await extendStop(); engineStart(); }
}
async function onStop() {
  if (settings.mode === 'extend') await extendStop();
  else engineStop();
}

// ---- update check (electron-updater: check -> download -> install -> relaunch) ----------
function cmpVer(a, b) { // 1 if a>b, -1 if a<b, 0 if equal (semver major.minor.patch)
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y ? 1 : -1; }
  return 0;
}
async function checkUpdate() {
  if (!app.isPackaged) return { status: 'dev' }; // electron-updater only works in the installed app
  try {
    const r = await autoUpdater.checkForUpdates();
    const v = r && r.updateInfo && r.updateInfo.version;
    if (v && cmpVer(v, app.getVersion()) > 0) { autoUpdater.downloadUpdate(); return { status: 'update', version: v }; }
    return { status: 'latest', version: app.getVersion() };
  } catch (e) { return { status: 'error', message: String((e && e.message) || e) }; }
}

// ---- IPC --------------------------------------------------------------------------------
ipcMain.handle('engine:start', async () => { await onStart(); return true; });
ipcMain.handle('engine:stop', async () => { await onStop(); return true; });
ipcMain.handle('engine:status', () => lastStatus);
ipcMain.handle('display:getBlackout', () => sendBlackout());
ipcMain.handle('display:setBlackout', async (_e, value) => { manualBlackout = !!value; return applyBlackout(); });
ipcMain.handle('settings:get', () => ({ ...settings, version: app.getVersion() }));
ipcMain.handle('settings:setMinimize', (_e, v) => { settings.minimizeToTray = !!v; saveSettings(); return settings.minimizeToTray; });
ipcMain.handle('settings:setAutoLaunch', (_e, v) => {
  settings.launchAtLogin = !!v; saveSettings();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  return settings.launchAtLogin;
});

// mode + extend-screen arrangement
ipcMain.handle('mode:get', () => settings.mode);
ipcMain.handle('mode:set', async (_e, m) => {
  const next = m === 'extend' ? 'extend' : 'dashboard';
  if (next !== settings.mode) {
    if (extendRunning()) await extendStop();
    engineStop();
    settings.mode = next; saveSettings();
    setStatus('stopped', '未运行');
  }
  resizeForMode(next);
  return settings.mode;
});
ipcMain.handle('vdd:ready', () => vdd.isReady());
ipcMain.handle('vdd:displays', () => {
  const prim = screen.getPrimaryDisplay().id;
  const v = vdd.findDisplay();
  return {
    displays: screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, label: d.label, primary: d.id === prim })),
    virtualId: v ? v.id : null,
  };
});
ipcMain.handle('vdd:setPosition', async (_e, x, y) => { await vdd.setPosition(x, y); return true; });
// dashboard panel arrangement: the control panel shows a drag-to-reorder grid; the new order is
// persisted and pushed to the running engine live (next frame reflects it, no restart).
ipcMain.handle('dash:getPanels', () => PANELS_META);
ipcMain.handle('dash:getOrder', () => normalizeOrder(settings.dashOrder));
ipcMain.handle('dash:setOrder', (_e, order) => {
  const next = normalizeOrder(order);
  settings.dashOrder = next; saveSettings();
  if (engine) { try { engine.postMessage({ type: 'order', order: next }); } catch {} }
  return next;
});

ipcMain.handle('extend:getQuality', () => settings.extendQuality);
ipcMain.handle('extend:setQuality', (_e, kb) => {
  const v = Math.max(8, Math.min(512, Number(kb) || 56));
  settings.extendQuality = v; saveSettings();
  if (extend) extend.setQuality(v);
  return v;
});

ipcMain.handle('update:check', () => checkUpdate());
ipcMain.handle('app:openExternal', (_e, url) => shell.openExternal(url));
// minimize always minimizes to the taskbar; close hides to tray (background) only when the
// "minimize to tray" setting is on, otherwise it quits.
ipcMain.on('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('window:close', () => { if (settings.minimizeToTray) mainWindow.hide(); else app.quit(); });
// renderer-driven exact-fit: size the window to its measured content height so there's no
// scrollbar, clamped to the display work area (on a short screen it stays scrollable instead).
ipcMain.handle('window:fit', (_e, h) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const want = Math.round(Number(h) || 0);
  if (!want) return false;
  let maxH = 4000;
  try { maxH = screen.getDisplayMatching(mainWindow.getBounds()).workArea.height; } catch {}
  const clamped = Math.max(360, Math.min(want, maxH));
  try { mainWindow.setContentSize(380, clamped); } catch {}
  return true;
});

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
    powerMonitor.on('lock-screen', () => {
      sessionLocked = true;
      clearTimeout(unlockRecoveryTimer);
      unlockRecoveryTimer = null;
      applyBlackout();
    });
    powerMonitor.on('unlock-screen', () => { sessionLocked = false; recoverAfterUnlock(); });
    // Some sleep/wake paths deliver resume without a separate unlock notification.
    powerMonitor.on('resume', () => { if (!sessionLocked) recoverAfterUnlock(); });
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!settings.minimizeToTray) app.quit(); });

  // Quit cleanly: stop the extend engine (release USB + turn the virtual screen off) and tell the
  // dashboard engine to release the panel, only then exit. kill() fallbacks guarantee we still quit.
  let shuttingDown = false;
  app.on('before-quit', (e) => {
    quitting = true;
    if (shuttingDown) return;
    if (!engine && !extendRunning()) return; // nothing to clean up -> let the quit proceed
    shuttingDown = true;
    e.preventDefault();
    (async () => {
      if (extendRunning()) { try { await extend.stop({ turnOffScreen: true }); } catch {} }
      if (engine) {
        engine.once('exit', () => app.quit());
        try { engine.postMessage({ type: 'shutdown' }); } catch { app.quit(); }
        setTimeout(() => { try { engine && engine.kill(); } catch {} }, 3000);
      } else { app.quit(); }
    })();
  });
}

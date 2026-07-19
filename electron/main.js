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
const { createCyberServer, cyberPipePath } = require('../src/cyber-bridge');
const { CyberStore } = require('../src/cyber-store');
const vdd = require('../src/vdd');
const { PANELS_META, DEFAULT_ORDER, normalizeOrder } = require('../src/panels');

// Log main-process crashes to a file (Electron's GUI stdout doesn't reach the terminal on Windows).
const MAIN_ERR_LOG = path.join(os.tmpdir(), 'moyu-main-error.log');
function logMainErr(tag, e) { try { fs.appendFileSync(MAIN_ERR_LOG, `[${new Date().toISOString()}] ${tag}: ${(e && e.stack) || e}\n`); } catch {} }
process.on('uncaughtException', (e) => logMainErr('uncaughtException', e));
process.on('unhandledRejection', (e) => logMainErr('unhandledRejection', e));

const ICON_PATH = path.join(__dirname, 'ui', 'icon.png');
const ENGINE_ENTRY = path.join(__dirname, '..', 'src', 'engine-entry.js');
const WINDOW_W = 380;
const DEFAULT_WINDOW_H = 820;
const MIN_WINDOW_H = 360;

// ---- settings (a small JSON file in userData) ------------------------------------------
const DEFAULTS = {
  minimizeToTray: true,
  launchAtLogin: false,
  fps: 12,
  mode: 'dashboard',
  extendQuality: 150,
  dashOrder: DEFAULT_ORDER,
  dashLeftMode: 'cat',
  cyberBurstEnabled: true,
  windowHeight: DEFAULT_WINDOW_H,
};
let settings = { ...DEFAULTS };
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
    delete settings.windowWidth; // migrate the short-lived build that persisted a resizable width
  }
  catch { settings = { ...DEFAULTS }; }
}
function saveSettings() { try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch {} }

const cyberStorePath = () => path.join(app.getPath('userData'), 'cyber-feed.json');
let cyberStore = null;
function ensureCyberStore() {
  if (cyberStore) return cyberStore;
  cyberStore = new CyberStore(cyberStorePath());
  cyberStore.load();
  return cyberStore;
}

let mainWindow = null;
let tray = null;
let engine = null;          // dashboard utilityProcess
let extend = null;          // ExtendEngine (extend-screen mode)
let cyberServer = null;     // local meow CLI transport
let runningMode = null;     // actual active engine, separate from the selected UI tab
let lastStatus = { source: null, state: 'stopped', message: '未运行' };
let quitting = false;
let manualBlackout = false;
let sessionLocked = false;
let unlockRecoveryTimer = null;
let unlockRecovery = null;
let windowHeightSaveTimer = null;

const isBlackedOut = () => manualBlackout || sessionLocked;
function sendBlackout() {
  const state = { active: isBlackedOut(), manual: manualBlackout, locked: sessionLocked };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('display:blackout', state);
  return state;
}
function cyberVisibility() {
  if (runningMode !== 'dashboard') return { visible: false, code: 'mode', message: 'The dashboard is not the active running mode right now.' };
  if (settings.dashLeftMode !== 'cyber') return { visible: false, code: 'left-mode', message: 'The cyber rail is stored, but the left side is currently showing Salary Cat.' };
  if (!(lastStatus.source === 'dashboard' && (lastStatus.state === 'running' || lastStatus.state === 'starting'))) {
    return { visible: false, code: 'not-running', message: 'The message was stored, but the dashboard is not running right now.' };
  }
  if (isBlackedOut()) return { visible: false, code: 'blacked-out', message: 'The message was stored, but the display is currently blanked or locked.' };
  return { visible: true, code: 'visible', message: 'The cyber rail is visible on the dashboard right now.' };
}
function cyberSnapshot() {
  return ensureCyberStore().snapshot();
}
function cyberPayload() {
  const snap = cyberSnapshot();
  return {
    leftMode: settings.dashLeftMode === 'cyber' ? 'cyber' : 'cat',
    burstEnabled: !!settings.cyberBurstEnabled,
    visible: cyberVisibility().visible,
    unseenCount: snap.unseenCount,
    updatedAt: snap.updatedAt,
    messages: snap.messages,
    version: snap.nextSeq,
  };
}
function cyberUiState() {
  const snap = cyberSnapshot();
  const vis = cyberVisibility();
  return {
    leftMode: settings.dashLeftMode === 'cyber' ? 'cyber' : 'cat',
    burstEnabled: !!settings.cyberBurstEnabled,
    selectedMode: settings.mode,
    runningMode,
    visibility: vis,
    messages: snap.messages,
    unseenCount: snap.unseenCount,
    messageCount: snap.messages.length,
    updatedAt: snap.updatedAt,
    pipe: cyberPipePath(),
  };
}
function sendCyberState() {
  const state = cyberUiState();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cyber:state', state);
  return state;
}
function pushCyberToEngine() {
  if (engine) { try { engine.postMessage({ type: 'cyber', cyber: cyberPayload() }); } catch {} }
}
function markCyberSeenIfVisible() {
  if (!cyberVisibility().visible) return;
  if (ensureCyberStore().markSeen()) sendCyberState();
}
async function applyBlackout() {
  const value = isBlackedOut();
  if (engine) { try { engine.postMessage({ type: 'blank', value }); } catch {} }
  if (extend) { try { await extend.setBlank(value); } catch (e) { logMainErr('setBlank', e); } }
  const state = sendBlackout();
  markCyberSeenIfVisible();
  pushCyberToEngine();
  sendCyberState();
  return state;
}

// Windows invalidates DXGI Desktop Duplication while the session is locked. Restoring brightness
// alone then reveals the last captured black frame, so rebuild the extend capture/USB session after
// unlock. Keep the VDD devnode alive throughout: Windows display topology never changes.
function recoverAfterUnlock() {
  clearTimeout(unlockRecoveryTimer);
  unlockRecoveryTimer = setTimeout(() => {
    unlockRecoveryTimer = null;
    if (sessionLocked || quitting || runningMode !== 'extend' || !extendRunning()) {
      applyBlackout();
      return;
    }
    if (unlockRecovery) return;
    unlockRecovery = (async () => {
      try {
        await extend.stop({ turnOffScreen: false });
        if (!sessionLocked && !quitting && runningMode === 'extend') await extendStart();
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

function setStatus(state, message, source = runningMode) {
  lastStatus = { source: source || null, state, message };
  if (state === 'running' && source) runningMode = source;
  if (state === 'starting' && source && !runningMode) runningMode = source;
  if (state === 'stopped' && source && runningMode === source) runningMode = null;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('engine:status', { ...lastStatus, runningMode, selectedMode: settings.mode });
  updateTrayMenu();
  markCyberSeenIfVisible();
  pushCyberToEngine();
  sendCyberState();
}

function setDashLeftMode(mode) {
  settings.dashLeftMode = mode === 'cyber' ? 'cyber' : 'cat';
  saveSettings();
  markCyberSeenIfVisible();
  pushCyberToEngine();
  return sendCyberState();
}
function setCyberBurstEnabled(v) {
  settings.cyberBurstEnabled = !!v;
  saveSettings();
  pushCyberToEngine();
  return sendCyberState();
}
function addCyberMessage(identity, message) {
  const item = ensureCyberStore().add(identity, message, { seen: false });
  const vis = cyberVisibility();
  if (vis.visible) ensureCyberStore().markSeen();
  pushCyberToEngine();
  sendCyberState();
  return {
    ok: true,
    action: 'message',
    item,
    disposition: vis.visible ? 'visible' : 'stored_hidden',
    message: vis.visible
      ? `Delivered to the cyber rail: ${item.identity}`
      : 'Message stored, but the cyber rail is not visible right now, so the user will not see it.',
    visibility: vis,
  };
}
function clearCyberFeed() {
  ensureCyberStore().clear();
  pushCyberToEngine();
  sendCyberState();
  return cyberUiState();
}
function clearCyberMessages() {
  clearCyberFeed();
  return {
    ok: true,
    action: 'clear',
    disposition: cyberVisibility().visible ? 'visible' : 'stored_hidden',
    message: 'Cyber rail cleared.',
    visibility: cyberVisibility(),
  };
}
async function handleCyberRequest(req) {
  const cmd = req && req.type;
  if (cmd === 'clear') return clearCyberMessages();
  if (cmd !== 'message') return { ok: false, code: 'bad_command', message: 'Only `meow <identity> <message>` and `meow clear` are supported.' };
  const identity = String(req.identity || '').trim();
  const message = String(req.message || '').trim();
  if (!identity || !message) return { ok: false, code: 'bad_args', message: 'Both identity and message are required.' };
  return addCyberMessage(identity, message);
}
function startCyberServer() {
  if (cyberServer) return;
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(cyberPipePath()); } catch {}
  }
  cyberServer = createCyberServer(handleCyberRequest);
  cyberServer.on('error', (e) => logMainErr('cyberServer', e));
  cyberServer.listen(cyberPipePath());
}
function stopCyberServer() {
  if (!cyberServer) return;
  try { cyberServer.close(); } catch {}
  cyberServer = null;
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(cyberPipePath()); } catch {}
  }
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
    setStatus(msg.state, msg.message, 'dashboard');
  });
  engine.on('exit', () => {
    engine = null;
    if (runningMode === 'dashboard') runningMode = null;
    sendCyberState();
    updateTrayMenu();
  });
  return engine;
}
function engineStart() {
  ensureEngine().postMessage({
    type: 'start',
    fps: settings.fps,
    order: normalizeOrder(settings.dashOrder),
    blanked: isBlackedOut(),
    cyber: cyberPayload(),
  });
}
function engineStop() { if (engine) engine.postMessage({ type: 'stop' }); }

// ---- extend-screen engine (main process) ------------------------------------------------
function getExtend() { if (!extend) extend = new ExtendEngine(); return extend; }
async function extendStart() {
  await getExtend().start({
    fps: settings.fps,
    target: settings.extendQuality,
    blanked: isBlackedOut(),
    onStatus: (state, message) => setStatus(state, message, 'extend'),
  });
}
async function extendStop() {
  if (extend) await extend.stop({ turnOffScreen: true });
  if (runningMode === 'extend') runningMode = null;
}
const extendRunning = () => !!(extend && (extend.running || extend.dev));

// ---- window -----------------------------------------------------------------------------
function initialWindowHeight() {
  let maxH = 4000;
  try { maxH = screen.getPrimaryDisplay().workArea.height; } catch {}
  return Math.max(MIN_WINDOW_H, Math.min(Math.round(Number(settings.windowHeight) || DEFAULT_WINDOW_H), maxH));
}

function rememberWindowHeight() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    settings.windowHeight = Math.max(MIN_WINDOW_H, mainWindow.getSize()[1]);
    clearTimeout(windowHeightSaveTimer);
    windowHeightSaveTimer = setTimeout(() => {
      windowHeightSaveTimer = null;
      saveSettings();
    }, 180);
  } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // Width is part of the compact control-panel layout. Height belongs to the user: content
    // changes only affect the inner scroll area and must never resize the native window.
    width: WINDOW_W, height: initialWindowHeight(),
    minWidth: WINDOW_W,
    maxWidth: WINDOW_W,
    minHeight: MIN_WINDOW_H,
    resizable: true, maximizable: false, fullscreenable: false,
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
  mainWindow.on('resize', rememberWindowHeight);
  mainWindow.on('close', (e) => {
    rememberWindowHeight();
    clearTimeout(windowHeightSaveTimer);
    windowHeightSaveTimer = null;
    saveSettings();
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
  const activeLabel = runningMode === 'extend' ? '扩展屏' : runningMode === 'dashboard' ? '仪表盘' : '未运行';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: showWindow },
    { type: 'separator' },
    { label: '启动', enabled: !running, click: () => onStart() },
    { label: '停止', enabled: running, click: () => onStop() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
  tray.setToolTip(`摸鱼监控 · ${running ? `运行中（${activeLabel}）` : '未运行'}`);
}
function createTray() {
  tray = new Tray(iconImage().resize({ width: 16, height: 16 }));
  tray.on('click', showWindow);
  updateTrayMenu();
}

// ---- start/stop routed by the active mode -----------------------------------------------
async function onStart() {
  const target = settings.mode === 'extend' ? 'extend' : 'dashboard';
  if (target === 'extend') {
    if (runningMode === 'dashboard') engineStop();
    await extendStart();
  } else {
    if (extendRunning()) await extendStop();
    engineStart();
  }
}
async function onStop() {
  if (runningMode === 'extend') await extendStop();
  else if (runningMode === 'dashboard') engineStop();
  else setStatus('stopped', '已停止', null);
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
ipcMain.handle('engine:status', () => ({ ...lastStatus, runningMode, selectedMode: settings.mode }));
ipcMain.handle('display:getBlackout', () => sendBlackout());
ipcMain.handle('display:setBlackout', async (_e, value) => { manualBlackout = !!value; return applyBlackout(); });
ipcMain.handle('settings:get', () => ({ ...settings, version: app.getVersion(), runningMode }));
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
    settings.mode = next; saveSettings();
  }
  sendCyberState();
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
ipcMain.handle('dash:getLeftMode', () => settings.dashLeftMode === 'cyber' ? 'cyber' : 'cat');
ipcMain.handle('dash:setLeftMode', (_e, mode) => setDashLeftMode(mode));
ipcMain.handle('cyber:getState', () => cyberUiState());
ipcMain.handle('cyber:setBurst', (_e, v) => setCyberBurstEnabled(v));
ipcMain.handle('cyber:clear', () => clearCyberFeed());
ipcMain.handle('cyber:add', (_e, identity, message) => addCyberMessage(identity, message));

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

// ---- lifecycle --------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    loadSettings();
    ensureCyberStore();
    startCyberServer();
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
    stopCyberServer();
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

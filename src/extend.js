// src/extend.js — "extend screen" engine for the control panel.
//
// Turns the TURZX panel into a live mirror of the MttVDD virtual display: makes sure the virtual
// 1920x464 screen is on (vdd.on), opens the panel, and streams captured frames (rotated to the
// panel-native 464x1920) to it. Runs in the Electron MAIN process because desktopCapturer /
// getUserMedia need Chromium. Mutually exclusive with the dashboard engine (only one owns the USB).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BrowserWindow, desktopCapturer, ipcMain } = require('electron');
const { TurzxDevice } = require('./turzx');
const vdd = require('./vdd');

const EXT_LOG = path.join(os.tmpdir(), 'moyu-extend.log');
function extLog(m) { try { fs.appendFileSync(EXT_LOG, `[${new Date().toISOString()}] ${m}\n`); } catch {} }
ipcMain.on('extend:rlog', (_e, m) => extLog('R: ' + m));
ipcMain.on('extend:rerr', (_e, m) => extLog('Rerr: ' + m));

const FRAME_CHANNEL = 'extend:frame';

function captureHtml() {
  let app = null;
  try { app = require('electron').app; } catch {}
  return app && app.isPackaged
    ? path.join(process.resourcesPath, 'vdd', 'capture.html')
    : path.join(__dirname, '..', 'scripts', 'vdd', 'capture.html');
}

class ExtendEngine {
  constructor() {
    this.dev = null; this.win = null; this.running = false; this.busy = false;
    this.frames = 0; this.onStatus = () => {}; this._onFrame = null;
  }

  async start({ fps = 12, target, onStatus = () => {} } = {}) {
    if (this.running) return;
    this.running = true; this.onStatus = onStatus; this.frames = 0;
    this.targetKB = Number(target) || Number(process.env.MOYU_TARGET_KB) || 56;
    const efps = Math.min(fps || 12, 10); // desktop frames are large; cap fps for stability
    try {
      this.onStatus('starting', '启动中…');
      const r = await vdd.on();
      const disp = r && r.display;
      if (!disp) throw new Error('扩展屏创建失败（驱动是否已安装？）');

      const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
      const src = srcs.find((s) => s.display_id === String(disp.id));
      if (!src) throw new Error('找不到扩展屏的画面源');

      this.onStatus('starting', '连接面板…');
      this.dev = new TurzxDevice();
      await this.dev.open();
      await this.dev.startImage({ fps: efps, firstImage: null });

      this._onFrame = async (_e, u8, lvl) => {
        if (!this.running || this.busy || !this.dev) return;
        this.busy = true;
        try {
          // Back-pressure: only send when the panel's frame queue (0x7A reply[8]) reports empty.
          // The renderer already caps each PNG near the dashboard's proven ~56 KB so cmd 0x66
          // doesn't get truncated (which showed as 花屏).
          const r = await this.dev.poll7a();
          const depth = r && r.length > 8 ? r[8] : 0;
          if (depth === 0) {
            await this.dev.sendImage(Buffer.from(u8));
            this.frames++;
            if (this.frames === 1 || this.frames % 30 === 0) extLog(`frames=${this.frames} frameKB=${Math.round(u8.length / 1024)} reduceLvl=${lvl}`);
          }
        } catch (e) { extLog('send err ' + ((e && e.message) || e)); }
        this.busy = false;
      };
      ipcMain.on(FRAME_CHANNEL, this._onFrame);

      this.win = new BrowserWindow({
        show: false, width: 1920, height: 464,
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
      });
      await this.win.loadFile(captureHtml(), { query: { sid: src.id, fps: String(efps), channel: FRAME_CHANNEL, target: String(this.targetKB) } });

      this.onStatus('running', '运行中');
    } catch (e) {
      this.running = false;
      await this._teardown({ turnOffScreen: true });
      this.onStatus('error', (e && e.message) ? e.message : String(e));
    }
  }

  async stop({ turnOffScreen = true } = {}) {
    this.running = false;
    await this._teardown({ turnOffScreen });
    this.onStatus('stopped', '已停止');
  }

  // live quality change (TARGET PNG size in KB): higher = sharper but bigger frames (lower fps,
  // and 花屏 if it exceeds the panel's buffer). Applied to the running capture window immediately.
  setQuality(kb) {
    this.targetKB = Number(kb) || this.targetKB;
    if (this.win && !this.win.isDestroyed()) {
      try { this.win.webContents.send('extend:target', this.targetKB); } catch {}
    }
  }

  async _teardown({ turnOffScreen }) {
    if (this._onFrame) { try { ipcMain.removeListener(FRAME_CHANNEL, this._onFrame); } catch {} this._onFrame = null; }
    if (this.win && !this.win.isDestroyed()) { try { this.win.destroy(); } catch {} }
    this.win = null;
    if (this.dev) { try { await this.dev.stopLive(); } catch {} try { await this.dev.close(); } catch {} this.dev = null; }
    if (turnOffScreen) { try { await vdd.off(); } catch {} }
  }
}

module.exports = { ExtendEngine };

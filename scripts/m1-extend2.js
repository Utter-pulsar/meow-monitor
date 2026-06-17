// M1 v2: mirror the MttVDD virtual 1920x464 display to the TURZX panel using a continuous
// getUserMedia stream in a hidden renderer (far faster than v1's per-frame getSources polling).
//
//   FPS=12 DURATION=240 electron scripts/m1-extend2.js
//
// Renderer captures + rotates + PNG-encodes each frame and sends it here; main pushes it to the
// panel via src/turzx.js (cmd 0x66), dropping frames while a send is in flight. Clean shutdown via
// the STOP file / SIGINT / DURATION (releases the USB panel before exit).
const { app, desktopCapturer, screen, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { TurzxDevice } = require('../src/turzx');

const FPS = Number(process.env.FPS || 12);
const DURATION = Number(process.env.DURATION || 240);
const BASE = process.env.M1_BASE || path.join(os.tmpdir(), 'moyu-m0');
const STOP_FILE = path.join(BASE, 'STOP');
const LOG = path.join(BASE, 'm1v2.log');
const W = 1920, H = 464;

function log(m) { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`); } catch {} }

app.disableHardwareAcceleration();

let dev = null, win = null, stopping = false, busy = false, frames = 0, t0 = 0;

async function release(code) {
  if (stopping && code === 0) {} // idempotent-ish
  stopping = true;
  if (dev) { try { await dev.stopLive(); } catch {} try { await dev.close(); } catch {} dev = null; }
  if (win && !win.isDestroyed()) { try { win.destroy(); } catch {} }
  try { app.quit(); } catch {}
  setTimeout(() => process.exit(code), 300);
}

ipcMain.on('frame', async (_e, u8) => {
  if (stopping || busy || !dev) return;
  busy = true;
  try { await dev.sendImage(Buffer.from(u8)); frames++; await dev.poll7a(); }
  catch (err) { log('send err ' + ((err && err.message) || err)); }
  busy = false;
  if (frames > 0 && frames % 30 === 0) log(`frames=${frames} fps~${(frames / ((Date.now() - t0) / 1000)).toFixed(1)}`);
});
ipcMain.on('rerr', (_e, m) => log('renderer ERR: ' + m));
ipcMain.on('rlog', (_e, m) => log('renderer: ' + m));

app.whenReady().then(async () => {
  try { fs.mkdirSync(BASE, { recursive: true }); } catch {}
  try { fs.unlinkSync(STOP_FILE); } catch {}
  try { fs.writeFileSync(LOG, ''); } catch {}

  const all = screen.getAllDisplays();
  const disp = all.find((d) => d.label && d.label.includes('VDD by MTT'))
            || all.find((d) => d.bounds.width === W && d.bounds.height === H);
  if (!disp) { log('ERR: virtual 1920x464 display not found'); return release(2); }
  const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  const src = srcs.find((s) => s.display_id === String(disp.id));
  if (!src) { log('ERR: no capturer source for display ' + disp.id); return release(2); }
  log(`target display ${disp.id} -> source ${src.id} (${JSON.stringify(disp.bounds)})`);

  try {
    dev = new TurzxDevice();
    log('opening TURZX (close official app if this fails)...');
    await dev.open();
    await dev.startImage({ fps: FPS, firstImage: null });
    log('image mode on');
  } catch (e) { log('ERR TURZX: ' + ((e && e.message) || e)); return release(3); }

  t0 = Date.now();
  win = new BrowserWindow({
    show: false, width: W, height: H,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, 'm1-extend2.html'), { query: { sid: src.id, fps: String(FPS) } });
  log(`renderer launched; streaming @ target ${FPS}fps for ${DURATION}s`);

  // DEBUG=1 : show the capture window OFF-SCREEN (also dodges hidden-window throttling, so fps
  // jumps) and open the renderer DevTools so you can see getUserMedia/canvas logs and errors.
  if (process.env.DEBUG) {
    try {
      win.setPosition(-4000, 0);
      win.showInactive();
      win.webContents.openDevTools({ mode: 'detach' });
      log('DEBUG on: window shown off-screen + DevTools open');
    } catch (e) { log('DEBUG setup failed: ' + ((e && e.message) || e)); }
  }

  const timer = setInterval(() => {
    if (stopping) return;
    if (fs.existsSync(STOP_FILE)) { log(`STOP seen. frames=${frames} avgFps~${(frames / ((Date.now() - t0) / 1000)).toFixed(1)}`); clearInterval(timer); return release(0); }
    if (Date.now() > t0 + DURATION * 1000) { log(`DURATION reached. frames=${frames} avgFps~${(frames / ((Date.now() - t0) / 1000)).toFixed(1)}`); clearInterval(timer); return release(0); }
  }, 400);
}).catch((e) => { log('FATAL ' + ((e && e.stack) || e)); release(1); });

process.on('SIGINT', () => release(0));
process.on('SIGTERM', () => release(0));
app.on('window-all-closed', () => {}); // we manage our own lifetime

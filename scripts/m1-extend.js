// M1 prototype: mirror the MttVDD virtual 1920x464 display onto the TURZX bar panel.
//
// Pipeline (all in the Electron main process):
//   desktopCapturer thumbnail of the virtual display (1920x464 landscape)
//     -> scale to fill 1920x464 -> rotate 90deg cw into the panel-native 464x1920 (same as dashboard)
//     -> PNG -> src/turzx.js sendImage (cmd 0x66)  ->  TURZX panel
//
// Run with the project's electron, NOT plain node (needs desktopCapturer). The official TURZX app
// must be closed (it holds the USB device exclusively).
//
//   FPS=12 DURATION=240 electron scripts/m1-extend.js
//
// Clean shutdown: create the STOP file, or send SIGINT, or wait for DURATION — the loop then
// releases the panel (stopLive + close) before exiting, so the USB endpoints aren't wedged.
const { app, desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { TurzxDevice } = require('../src/turzx');

const FPS = Number(process.env.FPS || 12);
const DURATION = Number(process.env.DURATION || 240); // seconds, then auto-stop cleanly
const BASE = process.env.M1_BASE || path.join(os.tmpdir(), 'moyu-m0');
const STOP_FILE = path.join(BASE, 'STOP');
const LOG = path.join(BASE, 'm1.log');

const W = 1920, H = 464;        // virtual display (landscape)
const DEV_W = 464, DEV_H = 1920; // panel native (portrait)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(m) {
  const line = `[${new Date().toISOString()}] ${m}`;
  try { fs.appendFileSync(LOG, line + '\n'); } catch {}
}

app.disableHardwareAcceleration();

let dev = null;
let stopping = false;

// reused canvases (avoid per-frame allocation)
const land = createCanvas(W, H), lc = land.getContext('2d');
const devc = createCanvas(DEV_W, DEV_H), dc = devc.getContext('2d');

async function grabRotated(targetId) {
  const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: W, height: H } });
  const s = srcs.find((x) => x.display_id === targetId);
  if (!s || !s.thumbnail || s.thumbnail.isEmpty()) return null;
  const img = await loadImage(s.thumbnail.toPNG());
  lc.drawImage(img, 0, 0, W, H);          // scale capture to fill landscape
  dc.save();
  dc.translate(DEV_W, 0); dc.rotate(Math.PI / 2); // cw, same as dashboard ROT default
  dc.drawImage(land, 0, 0);
  dc.restore();
  return devc.toBuffer('image/png');
}

async function release(code) {
  if (dev) { try { await dev.stopLive(); } catch {} try { await dev.close(); } catch {} dev = null; }
  try { app.quit(); } catch {}
  setTimeout(() => process.exit(code), 250);
}

app.whenReady().then(async () => {
  try { fs.mkdirSync(BASE, { recursive: true }); } catch {}
  try { fs.unlinkSync(STOP_FILE); } catch {}
  try { fs.writeFileSync(LOG, ''); } catch {}

  const all = screen.getAllDisplays();
  const disp = all.find((d) => d.label && d.label.includes('VDD by MTT'))
            || all.find((d) => d.bounds.width === W && d.bounds.height === H);
  if (!disp) { log('ERR: virtual 1920x464 display not found — is the driver installed?'); return release(2); }
  const targetId = String(disp.id);
  log(`target display id=${targetId} bounds=${JSON.stringify(disp.bounds)} label="${disp.label}"`);

  try {
    dev = new TurzxDevice();
    log('opening TURZX (close the official app if this hangs/fails)...');
    await dev.open();
    log('TURZX opened; entering image mode');
    const first = await grabRotated(targetId);
    await dev.startImage({ fps: FPS, firstImage: first || null });
    log(`streaming virtual screen -> panel @ target ${FPS}fps for ${DURATION}s`);
  } catch (e) {
    log('ERR opening/starting TURZX: ' + (e && e.message ? e.message : String(e)));
    return release(3);
  }

  const interval = 1000 / FPS;
  const tEnd = Date.now() + DURATION * 1000;
  const t0 = Date.now();
  let frames = 0;
  while (!stopping) {
    if (fs.existsSync(STOP_FILE)) { log('STOP file seen'); break; }
    if (Date.now() > tEnd) { log('DURATION reached'); break; }
    const tick = Date.now();
    try {
      const png = await grabRotated(targetId);
      if (png) { await dev.sendImage(png); frames++; }
    } catch (e) { log('frame error: ' + (e && e.message ? e.message : String(e))); }
    for (let p = 0; p < 2 && !stopping; p++) { try { await dev.poll7a(); } catch {} }
    const wait = interval - (Date.now() - tick);
    if (wait > 0) await sleep(wait);
    if (frames > 0 && frames % 30 === 0) {
      log(`frames=${frames} actualFps~${(frames / ((Date.now() - t0) / 1000)).toFixed(1)}`);
    }
  }
  log(`done. frames=${frames} avgFps~${(frames / ((Date.now() - t0) / 1000)).toFixed(1)}`);
  await release(0);
}).catch((e) => { log('FATAL ' + (e && e.stack ? e.stack : String(e))); release(1); });

const onSig = () => { stopping = true; };
process.on('SIGINT', onSig);
process.on('SIGTERM', onSig);
app.on('before-quit', (e) => { if (dev) { e.preventDefault(); stopping = true; } });

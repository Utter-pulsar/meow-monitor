// 摸鱼监控 engine — SalaryCat + live hardware dashboard streamed to the TURZX 8.8" bar screen.
// Cat animation on the left, GPU/RAM/CPU metrics with Task-Manager line charts on the right,
// all in the hand-drawn Excalifont + Xiaolai fonts. Streams via the cmd-0x66 image path.
//
// Exposed as a controllable runner so the Electron GUI can start/stop it and read status;
// also runs as a standalone CLI:  node src/monitor.js   (Ctrl+C to stop, FPS=NN to retune).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadImage } = require('@napi-rs/canvas');
const { TurzxDevice } = require('./turzx');
const { Metrics } = require('./metrics');
const { Dashboard } = require('./dashboard');
const unpacked = require('./asar');

const ROOT = path.join(__dirname, '..');
const GIF = unpacked(path.join(ROOT, 'assets', 'cat.GIF')); // ffmpeg reads this off disk
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve ffmpeg: prefer a local TURZX install, else the bundled @ffmpeg-installer binary.
// Inside a packaged Electron app that binary lives under app.asar.unpacked, so fix the path.
function ffmpegPath() {
  if (fs.existsSync('C:/TURZX-V3.09/ffmpeg.exe')) return 'C:/TURZX-V3.09/ffmpeg.exe';
  return unpacked(require('@ffmpeg-installer/ffmpeg').path);
}

async function loadCatFrames() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-cat-'));
  try {
    execFileSync(ffmpegPath(), ['-hide_banner', '-y', '-i', GIF, path.join(tmp, 'f_%03d.png')], { stdio: 'ignore' });
    const files = fs.readdirSync(tmp).filter((f) => f.endsWith('.png')).sort();
    const imgs = [];
    for (const f of files) imgs.push(await loadImage(fs.readFileSync(path.join(tmp, f))));
    return imgs;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Start streaming the dashboard to the panel. Returns a handle { stopped, stop() } immediately;
 * the render loop runs in the background and reports progress through onStatus(state, message),
 * where state is one of: 'starting' | 'running' | 'error' | 'stopped'.
 */
async function runMonitor({ fps = 12, order, onStatus = () => {} } = {}) {
  let stopping = false;
  let dev = null;
  let metrics = null;
  let dash = null;          // created during startup below
  let pendingOrder = order; // remembered until dash exists (covers a reorder mid-startup)
  const status = (state, message) => { try { onStatus(state, message); } catch {} };

  // The detached loop below is the SOLE owner of teardown (in its finally), so the device is
  // never closed mid-transfer. stop() just raises the flag and waits for that teardown to finish.
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  const handle = {
    stopped: false,
    // live panel reorder pushed from the control panel; applies to the next rendered frame
    setOrder(o) { pendingOrder = o; if (dash) dash.setOrder(o); },
    async stop() { stopping = true; await done; },
  };

  (async () => {
    try {
      status('starting', '正在加载小猫…');
      const cats = await loadCatFrames();
      if (stopping) return;
      metrics = new Metrics().start(1000);
      dash = new Dashboard(pendingOrder);
      if (stopping) return;
      status('starting', '正在连接屏幕…');
      dev = new TurzxDevice();
      await dev.open();
      if (stopping) return;
      await dev.startImage({ fps, firstImage: dash.render(metrics, cats[0]) });
      status('running', `运行中 · ${cats.length} 帧 @ ${fps}fps`);
      const interval = 1000 / fps;
      let i = 0;
      while (!stopping) {
        const tick = Date.now();
        await dev.sendImage(dash.render(metrics, cats[i % cats.length]));
        i++;
        for (let p = 0; p < 2 && !stopping; p++) await dev.poll7a(); // light flow-control
        const wait = interval - (Date.now() - tick);
        if (wait > 0) await sleep(wait);
      }
    } catch (e) {
      if (!stopping) status('error', e && e.message ? e.message : String(e));
    } finally {
      // tear down whatever was acquired — even if stop() landed mid-startup
      if (metrics) { try { metrics.stop(); } catch {} }
      if (dev) { try { await dev.stopLive(); } catch {} try { await dev.close(); } catch {} }
      handle.stopped = true;
      status('stopped', '已停止');
      resolveDone();
    }
  })();

  return handle;
}

module.exports = { runMonitor };

// ---- Standalone CLI ----------------------------------------------------------------------
if (require.main === module) {
  const fps = Number(process.env.FPS || 12);
  let handle = null;
  runMonitor({
    fps,
    onStatus: (state, message) => {
      console.log(`[${state}] ${message}`);
      if (state === 'error') process.exitCode = 1;
      if (state === 'stopped') process.exit(process.exitCode || 0);
    },
  }).then((h) => { handle = h; });

  const bye = async () => { if (handle) await handle.stop(); process.exit(process.exitCode || 0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  if (process.env.DURATION) setTimeout(bye, Number(process.env.DURATION) * 1000);
}

// Engine worker — runs inside an Electron utilityProcess so the heavy USB/render loop never
// blocks the GUI, and so the N-API native modules (usb, @napi-rs/canvas) load against Electron.
// Talks to the main process over parentPort:
//   in : { type: 'start', fps, order } | { type: 'stop' } | { type: 'order', order }
//   out: { type: 'status', state, message }
const { runMonitor } = require('./monitor');

let handle = null;

function send(state, message) {
  try { process.parentPort.postMessage({ type: 'status', state, message }); } catch {}
}

process.parentPort.on('message', async (e) => {
  const msg = (e && e.data) || {};
  if (msg.type === 'start') {
    if (handle && !handle.stopped) return; // already running
    handle = await runMonitor({ fps: msg.fps || 12, order: msg.order, onStatus: send });
  } else if (msg.type === 'order') {
    if (handle && !handle.stopped) handle.setOrder(msg.order); // live reorder
  } else if (msg.type === 'stop') {
    if (handle) { await handle.stop(); handle = null; }
    else send('stopped', '已停止');
  } else if (msg.type === 'shutdown') {
    // clean stop (release the USB panel), then let the process exit
    if (handle) { try { await handle.stop(); } catch {} handle = null; }
    process.exit(0);
  }
});

// 摸鱼监控 renderer — wires the little control panel to the main process (window.moyu, from preload).
const $ = (sel) => document.querySelector(sel);
let curMode = 'dashboard';

// Inject Excalifont + 小赖 (from preload) and paint the cat into the title bar + hero.
(function brand() {
  const api = window.moyu || {};
  if (api.excalifont) {
    const style = document.createElement('style');
    style.textContent =
      `@font-face{font-family:'Excalifont';src:url(${api.excalifont}) format('woff2');` +
      `font-weight:normal;font-style:normal;font-display:swap;}`;
    document.head.appendChild(style);
  }
  // 小赖 covers the Chinese glyphs Excalifont lacks; load from raw bytes (FontFace bypasses CSP).
  if (typeof api.xiaolai === 'function') {
    try {
      const bytes = api.xiaolai();
      if (bytes && bytes.byteLength) {
        const face = new FontFace('Xiaolai', bytes, { weight: 'normal', style: 'normal', display: 'swap' });
        face.load().then((f) => document.fonts.add(f)).catch(() => {});
      }
    } catch {}
  }
  const gif = api.catGif || '';
  $('#bar-cat').src = gif;
  $('#hero-cat').src = gif;
})();

const LABELS = { running: '运行中', starting: '正在启动…', stopped: '未运行', error: '出错了' };

function paintSwitch(input) { input.closest('.switch').classList.toggle('on', input.checked); }

function renderStatus(s) {
  const meta = LABELS[s.state] ? s.state : 'stopped';
  $('#status').className = 'status-card ' + meta;
  $('#status-text').textContent = s.message || LABELS[meta];
  // reflect run state in the on/off switch (setting .checked in JS does NOT fire 'change')
  const busy = s.state === 'running' || s.state === 'starting';
  const sw = $('#sw-run');
  sw.checked = busy;
  sw.disabled = s.state === 'starting';
  paintSwitch(sw);
}

function applyModeUI(mode) {
  curMode = mode === 'extend' ? 'extend' : 'dashboard';
  $('#mode-dash').classList.toggle('seg-on', curMode === 'dashboard');
  $('#mode-ext').classList.toggle('seg-on', curMode === 'extend');
  const ext = curMode === 'extend';
  $('#arr-open').hidden = !ext;
  $('#qual-box').hidden = !ext;
  if (ext) setKnob(curKb);
}

async function init() {
  const cfg = await window.moyu.getSettings();
  $('#sw-autolaunch').checked = !!cfg.launchAtLogin;
  $('#sw-minimize').checked = !!cfg.minimizeToTray;
  paintSwitch($('#sw-autolaunch'));
  paintSwitch($('#sw-minimize'));
  $('#version').textContent = 'v' + (cfg.version || '0.0.0');
  await loadQuality();
  applyModeUI(cfg.mode || 'dashboard');
  renderStatus(await window.moyu.getStatus());
}

window.moyu.onStatus(renderStatus);

// the run on/off switch IS the start/stop control
$('#sw-run').addEventListener('change', (e) => {
  if (e.target.checked) window.moyu.start();
  else window.moyu.stop();
});

// mode toggle (仪表盘 / 扩展屏)
$('#mode-dash').addEventListener('click', async () => { applyModeUI(await window.moyu.setMode('dashboard')); });
$('#mode-ext').addEventListener('click', async () => {
  applyModeUI(await window.moyu.setMode('extend'));
  const ready = await window.moyu.vddReady();
  if (!ready) $('#status-text').textContent = '扩展屏驱动尚未安装（需先安装一次）';
});

$('#arr-open').addEventListener('click', () => window.moyu.openExternal('ms-settings:display'));

// extend-screen clarity slider — drag to find the sharp-but-not-garbled sweet spot (applies live)
const KB_MIN = 40, KB_MAX = 480;
let curKb = 150;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const kbToPos = (kb) => clamp01((kb - KB_MIN) / (KB_MAX - KB_MIN));
const posToKb = (pos) => Math.round(KB_MIN + clamp01(pos) * (KB_MAX - KB_MIN));
function setKnob(kb) {
  const pos = kbToPos(kb);
  $('#qual-knob').style.left = (pos * 100) + '%';
  $('#qual-fill').style.width = (pos * 100) + '%';
  $('#qual-val').textContent = kb + ' KB';
}
async function loadQuality() { try { curKb = await window.moyu.extendGetQuality(); setKnob(curKb); } catch {} }
(function setupQualSlider() {
  const track = $('#qual-track'); if (!track) return;
  let dragging = false, lastSent = 0;
  const posOf = (e) => { const r = track.getBoundingClientRect(); return (e.clientX - r.left) / r.width; };
  function apply(e, force) {
    curKb = posToKb(posOf(e)); setKnob(curKb);
    const now = Date.now();
    if (force || now - lastSent > 120) { lastSent = now; window.moyu.extendSetQuality(curKb); }
  }
  track.addEventListener('mousedown', (e) => { dragging = true; apply(e, false); });
  window.addEventListener('mousemove', (e) => { if (dragging) apply(e, false); });
  window.addEventListener('mouseup', (e) => { if (dragging) { dragging = false; apply(e, true); } });
})();

// settings switches + window controls
$('#sw-autolaunch').addEventListener('change', (e) => { paintSwitch(e.target); window.moyu.setAutoLaunch(e.target.checked); });
$('#sw-minimize').addEventListener('change', (e) => { paintSwitch(e.target); window.moyu.setMinimize(e.target.checked); });
$('#btn-min').addEventListener('click', () => window.moyu.minimizeWindow());
$('#btn-close').addEventListener('click', () => window.moyu.closeWindow());

$('#btn-update').addEventListener('click', async () => {
  const msg = $('#update-msg');
  msg.className = 'update-msg';
  msg.textContent = '正在检查…';
  const r = await window.moyu.checkUpdate();
  if (r.status === 'update') {
    msg.classList.add('ok');
    msg.textContent = `发现新版本 v${r.latest} · `;
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = '前往下载';
    a.addEventListener('click', (e) => { e.preventDefault(); window.moyu.openExternal(r.url); });
    msg.appendChild(a);
  } else if (r.status === 'latest') {
    msg.classList.add('ok');
    msg.textContent = `已是最新版本（v${r.latest}）`;
  } else if (r.status === 'none') {
    msg.textContent = r.message;
  } else {
    msg.classList.add('err');
    msg.textContent = r.message || '检查更新失败';
  }
});

init();

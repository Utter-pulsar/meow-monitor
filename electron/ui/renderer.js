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

function renderBlackout(s) {
  const sw = $('#sw-blackout');
  sw.checked = !!s.manual;
  sw.disabled = !!s.locked;
  paintSwitch(sw);
}

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
  $('#arr-box').hidden = ext; // the panel arranger is dashboard-only
  if (ext) setKnob(curKb);
}

// ---- dashboard panel arranger (drag the cards to reorder the metric panels, live) ----------
// Each card is the whole draggable target (no handle); it shows only the panel's name. Dropping
// reorders the grid (3 cols x 2 rows, same layout as the bar screen) and pushes the new order to
// the engine, which re-renders the next frame in that order.
let panelMeta = {}; // key -> { label, color }

function makeTile(key) {
  const m = panelMeta[key] || { label: key, color: '#888' };
  const el = document.createElement('div');
  el.className = 'arr-tile';
  el.draggable = true;
  el.dataset.key = key;
  el.style.setProperty('--accent', m.color);
  el.textContent = m.label;
  return el;
}

function persistOrder(grid) {
  const order = [...grid.querySelectorAll('.arr-tile')].map((el) => el.dataset.key);
  window.moyu.dashSetOrder(order);
}

// Swap two sibling tiles in place (handles both adjacent and far-apart pairs).
function swapTiles(a, b) {
  const parent = a.parentNode;
  const aNext = a.nextSibling === b ? a : a.nextSibling;
  parent.insertBefore(a, b);
  parent.insertBefore(b, aNext);
}

// FLIP: run the DOM change, then animate every tile sliding from where it WAS to where it now is,
// so the user sees the other cards get pushed aside. The dragged tile (`.dragging`) is skipped —
// the OS already renders it following the cursor as a drag ghost, so it shouldn't slide too.
function animateReorder(grid, mutate) {
  const tiles = [...grid.querySelectorAll('.arr-tile')];
  const first = tiles.map((t) => t.getBoundingClientRect()); // First: positions before the move
  mutate();                                                   // Last: positions after the move
  tiles.forEach((t, i) => {
    if (t.classList.contains('dragging')) return;
    const a = first[i], b = t.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) return;
    t.style.transition = 'none';                  // Invert: jump it back to the old spot...
    t.style.transform = `translate(${dx}px, ${dy}px)`;
    void t.offsetWidth;                           // ...commit that, then
    // keep box-shadow/opacity in the transition too so hover still animates after a drag
    t.style.transition = 'transform 170ms cubic-bezier(.2,.8,.25,1), box-shadow 0.08s ease, opacity 0.12s ease';
    t.style.transform = '';                       // Play: glide to the natural position
  });
}

// Index of the fixed grid slot whose center is nearest the cursor. Uses slot rects captured at
// dragstart, so it is IMMUNE to the FLIP transforms that slide tiles around mid-animation — those
// used to move a sliding tile under the cursor, re-trigger a swap, and make the cards flicker.
function slotAt(x, y, rects) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function setupSortable(grid) {
  let dragging = null;
  let slotRects = null; // the 6 grid cells, measured once at dragstart (they don't move as tiles swap)
  grid.addEventListener('dragstart', (e) => {
    const t = e.target.closest('.arr-tile');
    if (!t) return;
    dragging = t;
    const tiles = [...grid.querySelectorAll('.arr-tile')];
    // finalize any leftover FLIP transform so the slot rectangles measure clean (no transform)
    tiles.forEach((el) => { el.style.transition = 'none'; el.style.transform = ''; });
    void grid.offsetWidth;
    slotRects = tiles.map((el) => el.getBoundingClientRect());
    tiles.forEach((el) => { el.style.transition = ''; });
    // defer the class so the drag image is the solid tile, not the dimmed one
    requestAnimationFrame(() => t.classList.add('dragging'));
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', t.dataset.key); } catch {}
  });
  // Pick the swap target from the FIXED slot the cursor is over — never from e.target, which the
  // sliding animation keeps changing. A swap only happens when the cursor reaches a different slot,
  // so each card animates once per crossing and nothing flickers in place. Swapping (vs insert-by-x)
  // behaves the same in every direction on the 2-row grid; crossing several slots cascades into a
  // clean shift, and the dragged tile always ends up under the cursor so it never oscillates.
  grid.addEventListener('dragover', (e) => {
    if (!dragging || !slotRects) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tiles = [...grid.querySelectorAll('.arr-tile')];
    const from = tiles.indexOf(dragging);
    const to = slotAt(e.clientX, e.clientY, slotRects);
    if (to < 0 || to >= tiles.length || to === from) return;
    const target = tiles[to];
    if (!target || target === dragging) return;
    animateReorder(grid, () => swapTiles(dragging, target));
  });
  grid.addEventListener('drop', (e) => { if (dragging) e.preventDefault(); });
  grid.addEventListener('dragend', () => {
    if (!dragging) return;
    dragging.classList.remove('dragging');
    dragging.style.transition = ''; dragging.style.transform = '';
    dragging = null;
    slotRects = null;
    persistOrder(grid);
  });
  // Once a FLIP slide finishes, drop the inline transition/transform so later hovers use the crisp
  // 0.08s CSS timing instead of the lingering 170ms slide timing (transitionend bubbles to the grid).
  grid.addEventListener('transitionend', (e) => {
    const t = e.target;
    if (e.propertyName === 'transform' && t.classList && t.classList.contains('arr-tile') && t !== dragging) {
      t.style.transition = ''; t.style.transform = '';
    }
  });
}

async function buildArranger() {
  const grid = $('#arr-grid');
  if (!grid) return;
  try {
    const metas = await window.moyu.dashGetPanels();
    panelMeta = {};
    metas.forEach((m) => { panelMeta[m.key] = m; });
    const order = await window.moyu.dashGetOrder();
    grid.innerHTML = '';
    for (const key of order) grid.appendChild(makeTile(key));
    setupSortable(grid);
  } catch {}
}

// ---- auto-fit the window to its content so there's no scrollbar by default ------------------
// Measure the natural content height (titlebar + content box, bottom of the last visible section)
// and ask the main process to size the window to exactly that. Works whether the window is
// currently too tall (blank space) or too short (overflowing) because it reads geometry, not the
// scroll box. If the screen can't fit it, main clamps the height and the styled scrollbar appears.
function naturalHeight() {
  const content = document.querySelector('.content');
  const titlebar = document.querySelector('.titlebar');
  if (!content) return 0;
  // Measure from the top so off-screen children read true positions. We don't restore the old
  // scroll offset: a refit follows immediately, and on a short screen the old offset could be out
  // of range for the new layout and snap-jump — top is the correct resting place after a refit.
  content.scrollTop = 0;
  const kids = [...content.children].filter((k) => {
    if (k.hidden) return false;
    const cs = getComputedStyle(k);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  });
  const cRect = content.getBoundingClientRect();
  const cs = getComputedStyle(content);
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const titleH = titlebar ? titlebar.offsetHeight : 0;
  let bottom = cRect.top + (parseFloat(cs.paddingTop) || 0);
  if (kids.length) bottom = kids[kids.length - 1].getBoundingClientRect().bottom;
  return Math.ceil(titleH + (bottom - cRect.top) + padBottom) + 1; // +1px guards a hairline scrollbar
}

let fitScheduled = false;
function fitWindow() {
  if (fitScheduled || !window.moyu.fitWindow) return;
  fitScheduled = true;
  requestAnimationFrame(() => {            // let layout settle after any show/hide first
    fitScheduled = false;
    const h = naturalHeight();
    if (h > 0) window.moyu.fitWindow(h);
  });
}

async function init() {
  const cfg = await window.moyu.getSettings();
  $('#sw-autolaunch').checked = !!cfg.launchAtLogin;
  $('#sw-minimize').checked = !!cfg.minimizeToTray;
  paintSwitch($('#sw-autolaunch'));
  paintSwitch($('#sw-minimize'));
  $('#version').textContent = 'v' + (cfg.version || '0.0.0');
  await loadQuality();
  await buildArranger();
  applyModeUI(cfg.mode || 'dashboard');
  renderStatus(await window.moyu.getStatus());
  renderBlackout(await window.moyu.getBlackout());
  // size to fit once the (large, async) Xiaolai font has settled so the measurement is final
  try { await document.fonts.ready; } catch {}
  fitWindow();
}

window.moyu.onStatus(renderStatus);
window.moyu.onBlackout(renderBlackout);

// the run on/off switch IS the start/stop control
$('#sw-run').addEventListener('change', (e) => {
  if (e.target.checked) window.moyu.start();
  else window.moyu.stop();
});

// mode toggle (仪表盘 / 扩展屏) — each mode has different content height, so refit afterwards
$('#mode-dash').addEventListener('click', async () => { applyModeUI(await window.moyu.setMode('dashboard')); fitWindow(); });
$('#mode-ext').addEventListener('click', async () => {
  applyModeUI(await window.moyu.setMode('extend'));
  fitWindow();
  const ready = await window.moyu.vddReady();
  if (!ready) $('#status-text').textContent = '扩展屏驱动尚未安装（需先安装一次）';
});

$('#arr-open').addEventListener('click', () => window.moyu.openExternal('ms-settings:display'));

// extend-screen clarity slider — drag to find the sharp-but-not-garbled sweet spot (applies live)
const KB_MIN = 40, KB_MAX = 340;
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
$('#sw-blackout').addEventListener('change', async (e) => renderBlackout(await window.moyu.setBlackout(e.target.checked)));
$('#btn-min').addEventListener('click', () => window.moyu.minimizeWindow());
$('#btn-close').addEventListener('click', () => window.moyu.closeWindow());

$('#btn-update').addEventListener('click', async () => {
  const msg = $('#update-msg');
  msg.className = 'update-msg';
  msg.textContent = '正在检查…';
  $('#dl-fill').style.width = '0';
  $('#dl-bar').hidden = true;
  const r = await window.moyu.checkUpdate();
  if (r.status === 'update') {
    msg.classList.add('ok');
    msg.textContent = `发现新版本 v${r.version}，正在下载…`;
    $('#dl-bar').hidden = false;
  } else if (r.status === 'latest') {
    msg.classList.add('ok');
    msg.textContent = `已是最新版本（v${r.version}）`;
  } else if (r.status === 'dev') {
    msg.textContent = '开发模式不检查更新（打包后可用）';
  } else {
    msg.classList.add('err');
    msg.textContent = r.message || '检查更新失败';
  }
});

// auto-update download progress / install (electron-updater)
window.moyu.onUpdateProgress((pct) => {
  $('#dl-bar').hidden = false;
  $('#dl-fill').style.width = pct + '%';
  const m = $('#update-msg'); m.className = 'update-msg ok'; m.textContent = `下载中… ${pct}%`;
});
window.moyu.onUpdateDownloaded(() => {
  $('#dl-fill').style.width = '100%';
  const m = $('#update-msg'); m.className = 'update-msg ok'; m.textContent = '下载完成，正在安装并重启…';
});
window.moyu.onUpdateError((msg) => {
  $('#dl-bar').hidden = true;
  const m = $('#update-msg'); m.className = 'update-msg err'; m.textContent = '更新出错：' + msg;
});

init();

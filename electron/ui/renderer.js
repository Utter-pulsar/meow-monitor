// 摸鱼监控 renderer — wires the little control panel to the main process (window.moyu, from preload).
const $ = (sel) => document.querySelector(sel);
let curMode = 'dashboard';
let curKb = 150;
let cyberState = null;

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
let cyberPinned = false;
let cyberHover = false;

function paintSwitch(input) { input.closest('.switch').classList.toggle('on', input.checked); }
function syncCyberCard() {
  const box = $('#cyber-box');
  if (!box) return;
  const open = cyberPinned || cyberHover;
  box.classList.toggle('collapsed', !open);
  box.classList.toggle('open', open && !cyberPinned);
  box.classList.toggle('pinned', cyberPinned);
  $('#cyber-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  $('#cyber-pin').textContent = cyberPinned ? '已固定' : '点击固定';
  clearTimeout(syncCyberCard._layoutTimer);
  syncCyberCard._layoutTimer = setTimeout(refreshScrollLayout, open ? 360 : 280);
}
function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderBlackout(s) {
  const sw = $('#sw-blackout');
  sw.checked = !!s.manual;
  sw.disabled = !!s.locked;
  paintSwitch(sw);
}

function renderStatus(s) {
  const meta = LABELS[s.state] ? s.state : 'stopped';
  $('#status').className = 'status-card ' + meta;
  let text = s.message || LABELS[meta];
  if (s.runningMode === 'dashboard') text = `${text} · 仪表盘`;
  else if (s.runningMode === 'extend') text = `${text} · 扩展屏`;
  $('#status-text').textContent = text;
  // reflect run state in the on/off switch (setting .checked in JS does NOT fire 'change')
  const busy = s.state === 'running' || s.state === 'starting';
  const sw = $('#sw-run');
  sw.checked = busy;
  sw.disabled = s.state === 'starting';
  paintSwitch(sw);
}

function renderCyber(state) {
  cyberState = state;
  const isCyber = state && state.leftMode === 'cyber';
  $('#left-cat').classList.toggle('seg-on', !isCyber);
  $('#left-cyber').classList.toggle('seg-on', isCyber);
  $('#sw-cyber-burst').checked = !!(state && state.burstEnabled);
  paintSwitch($('#sw-cyber-burst'));
  syncCyberCard();

  const list = $('#cyber-list');
  const oldScrollTop = list.scrollTop;
  const oldScrollHeight = list.scrollHeight;
  const oldClientHeight = list.clientHeight;
  const wasAtBottom = oldClientHeight === 0 || oldScrollHeight - oldScrollTop - oldClientHeight <= 20;
  const previousLatestSeq = Number(list.dataset.latestSeq) || 0;
  list.innerHTML = '';
  const messages = state && Array.isArray(state.messages) ? state.messages : [];
  $('#cyber-unseen').textContent = messages.length ? `${messages.length} 条 · 可滚动` : '0 条';
  if (!messages.length) {
    $('#cyber-preview').classList.add('empty');
    $('#cyber-empty').textContent = '目前还没有消息。';
    list.dataset.latestSeq = '0';
    list.scrollTop = 0;
  } else {
    $('#cyber-preview').classList.remove('empty');
    for (const msg of messages) {
      const item = document.createElement('div');
      item.className = 'cyber-item';
      item.innerHTML =
        `<div class="cyber-item-head"><span class="cyber-tag" style="color:${msg.accent};border-color:${msg.accent};background:${msg.accent}22">${escapeHtml(msg.identity)}</span>` +
        `<span class="cyber-item-time">${fmtTime(msg.at)}</span></div>` +
        `<div class="cyber-item-msg">${escapeHtml(msg.message)}</div>`;
      list.appendChild(item);
    }
    const latestSeq = Number(messages[messages.length - 1].seq) || 0;
    list.dataset.latestSeq = String(latestSeq);
    requestAnimationFrame(() => {
      // Stay with the reader when they have scrolled up; otherwise follow the newest message.
      list.scrollTop = !previousLatestSeq || wasAtBottom ? list.scrollHeight : oldScrollTop;
    });
  }
}

function applyModeUI(mode) {
  curMode = mode === 'extend' ? 'extend' : 'dashboard';
  $('#mode-dash').classList.toggle('seg-on', curMode === 'dashboard');
  $('#mode-ext').classList.toggle('seg-on', curMode === 'extend');
  const ext = curMode === 'extend';
  $('#arr-open').hidden = !ext;
  $('#qual-box').hidden = !ext;
  $('#arr-box').hidden = ext; // the panel arranger is dashboard-only
  $('#cyber-box').hidden = ext;
  if (ext) setKnob(curKb);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

// Content can expand, collapse, or receive messages without changing the native window height.
// Only refresh the hand-drawn scroll thumb after those layout changes.
let scrollLayoutScheduled = false;
function refreshScrollLayout() {
  if (scrollLayoutScheduled) return;
  scrollLayoutScheduled = true;
  requestAnimationFrame(() => {
    scrollLayoutScheduled = false;
    layoutScrollThumb();
  });
}

function setKnob(kb) {
  const pos = kbToPos(kb);
  $('#qual-knob').style.left = (pos * 100) + '%';
  $('#qual-fill').style.width = (pos * 100) + '%';
  $('#qual-val').textContent = kb + ' KB';
}

function setupDoodleScrollbar() {
  const host = document.querySelector('.content');
  const thumb = $('#scroll-thumb');
  if (!host || !thumb) return;
  let dragging = false;
  let dragStart = 0;
  let scrollStart = 0;
  let raf = 0;
  let suppressNative = false;

  const layout = () => {
    raf = 0;
    const overflow = host.scrollHeight - host.clientHeight;
    if (overflow <= 1) {
      thumb.classList.remove('visible');
      thumb.style.top = '0px';
      thumb.style.height = '0px';
      return;
    }
    const track = host.clientHeight - 6;
    const size = Math.max(34, Math.min(track, (host.clientHeight / host.scrollHeight) * track));
    const maxOffset = Math.max(1, track - size);
    const ratio = overflow > 0 ? (host.scrollTop / overflow) : 0;
    const offset = 3 + ratio * maxOffset;
    thumb.classList.add('visible');
    thumb.style.height = `${size}px`;
    thumb.style.top = `${offset}px`;
  };
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(layout);
  };

  layoutScrollThumb = schedule;
  host.addEventListener('scroll', () => {
    if (suppressNative) return;
    schedule();
  }, { passive: true });
  host.addEventListener('wheel', () => {
    suppressNative = false;
    schedule();
  }, { passive: true });
  window.addEventListener('resize', schedule);
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    for (const child of host.children) if (child !== thumb) observer.observe(child);
    setupDoodleScrollbar._resizeObserver = observer;
  }
  thumb.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragStart = e.clientY;
    scrollStart = host.scrollTop;
    thumb.classList.add('dragging');
    try { thumb.setPointerCapture(e.pointerId); } catch {}
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const track = host.clientHeight - 6;
    const size = thumb.getBoundingClientRect().height;
    const overflow = host.scrollHeight - host.clientHeight;
    const maxOffset = Math.max(1, track - size);
    const delta = e.clientY - dragStart;
    suppressNative = true;
    host.scrollTop = Math.max(0, Math.min(overflow, scrollStart + (delta / maxOffset) * overflow));
    schedule();
  });
  const endDrag = (e) => {
    dragging = false;
    suppressNative = false;
    thumb.classList.remove('dragging');
    try { thumb.releasePointerCapture(e.pointerId); } catch {}
    schedule();
  };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
  requestAnimationFrame(layout);
}
let layoutScrollThumb = () => {};

async function loadCyber() {
  try { renderCyber(await window.moyu.getCyberState()); } catch {}
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
  setupDoodleScrollbar();
  applyModeUI(cfg.mode || 'dashboard');
  renderStatus(await window.moyu.getStatus());
  renderBlackout(await window.moyu.getBlackout());
  await loadCyber();
  syncCyberCard();
  // Font metrics can alter overflow, but the user-selected native window height stays untouched.
  try { await document.fonts.ready; } catch {}
  refreshScrollLayout();
}

window.moyu.onStatus((s) => { renderStatus(s); refreshScrollLayout(); });
window.moyu.onBlackout(renderBlackout);
window.moyu.onCyberState((s) => { renderCyber(s); refreshScrollLayout(); });

// the run on/off switch IS the start/stop control
$('#sw-run').addEventListener('change', (e) => {
  if (e.target.checked) window.moyu.start();
  else window.moyu.stop();
});

// Mode/content changes only update the inner scroll area; they never resize the native window.
$('#mode-dash').addEventListener('click', async () => { applyModeUI(await window.moyu.setMode('dashboard')); refreshScrollLayout(); });
$('#mode-ext').addEventListener('click', async () => {
  applyModeUI(await window.moyu.setMode('extend'));
  refreshScrollLayout();
  const ready = await window.moyu.vddReady();
  if (!ready) $('#status-text').textContent = '扩展屏驱动尚未安装（需先安装一次）';
});

$('#left-cat').addEventListener('click', async () => { renderCyber(await window.moyu.dashSetLeftMode('cat')); refreshScrollLayout(); });
$('#left-cyber').addEventListener('click', async () => { renderCyber(await window.moyu.dashSetLeftMode('cyber')); refreshScrollLayout(); });
$('#cyber-clear').addEventListener('click', async () => { renderCyber(await window.moyu.clearCyber()); refreshScrollLayout(); });
$('#sw-cyber-burst').addEventListener('change', async (e) => {
  paintSwitch(e.target);
  renderCyber(await window.moyu.setCyberBurst(e.target.checked));
  refreshScrollLayout();
});
$('#cyber-box').addEventListener('mouseenter', () => { cyberHover = true; syncCyberCard(); refreshScrollLayout(); });
$('#cyber-box').addEventListener('mouseleave', () => { cyberHover = false; syncCyberCard(); refreshScrollLayout(); });
$('#cyber-toggle').addEventListener('click', () => { cyberPinned = !cyberPinned; syncCyberCard(); refreshScrollLayout(); });
$('#cyber-body').addEventListener('click', () => {
  if (!cyberPinned) {
    cyberPinned = true;
    syncCyberCard();
    refreshScrollLayout();
  }
});

$('#arr-open').addEventListener('click', () => window.moyu.openExternal('ms-settings:display'));

// extend-screen clarity slider — drag to find the sharp-but-not-garbled sweet spot (applies live)
const KB_MIN = 40, KB_MAX = 340;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const kbToPos = (kb) => clamp01((kb - KB_MIN) / (KB_MAX - KB_MIN));
const posToKb = (pos) => Math.round(KB_MIN + clamp01(pos) * (KB_MAX - KB_MIN));
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

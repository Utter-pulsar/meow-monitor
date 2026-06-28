// Renders the monitor dashboard: SalaryCat on the far left + hand-drawn metric panels with
// Task-Manager-style line charts on the right. Draws a landscape 1920x464 frame, then rotates
// it into the panel's native 464x1920 and returns a PNG buffer for cmd 0x66.
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const unpacked = require('./asar');
const { PANELS_META, DEFAULT_ORDER, normalizeOrder } = require('./panels');

const FONTS = unpacked(path.join(__dirname, '..', 'fonts')); // native font loader reads off disk
GlobalFonts.registerFromPath(path.join(FONTS, 'Excalifont-Regular.woff2'), 'Excali'); // English/numbers
GlobalFonts.registerFromPath(path.join(FONTS, 'Xiaolai-Regular.ttf'), 'Xiaolai');      // Chinese

const DEV_W = 464, DEV_H = 1920, W = 1920, H = 464; // landscape canvas
const ROT = (process.env.ROT || 'cw').toLowerCase();
const CAT_W = 380; // left strip for the cat

// panel grid on the right: 3 columns x 2 rows
const GX = CAT_W + 8, GY = 10, GW = W - GX - 12, GH = H - GY - 10;
const COLS = 3, ROWS = 2, PAD = 12;
const PW = (GW - PAD * (COLS - 1)) / COLS;
const PH = (GH - PAD * (ROWS - 1)) / ROWS;

// Per-metric render functions (big value text, small sub text, chart max), keyed by metric key.
// Label + accent color + the default display order live in ./panels (shared with the control
// panel UI so the drag-to-arrange grid stays in sync).
const RENDER = {
  gpuPower: { max: (c) => c.gpuPowerMax || 180, val: (c) => `${c.gpuPower.toFixed(0)}W`, sub: (c) => `峰值 ${(c.gpuPowerMax || 180).toFixed(0)}W` },
  vramUsed: { max: (c) => c.vramTotal || 8,     val: (c) => `${c.vramUsed.toFixed(1)}G`,  sub: (c) => `共 ${(c.vramTotal || 0).toFixed(0)}G` },
  gpuTemp:  { max: () => 100, val: (c) => `${c.gpuTemp.toFixed(0)}°`,  sub: (c) => `${c.gpuClock.toFixed(0)}MHz` },
  gpuUtil:  { max: () => 100, val: (c) => `${c.gpuUtil.toFixed(0)}%`,  sub: (c) => `风扇 ${c.gpuFan.toFixed(0)}%` },
  ramPct:   { max: () => 100, val: (c) => `${c.ramPct.toFixed(0)}%`,   sub: (c) => `${c.ramUsed.toFixed(1)}/${(c.ramTotal || 0).toFixed(0)}G` },
  cpuLoad:  { max: () => 100, val: (c) => `${c.cpuLoad.toFixed(0)}%`,   sub: (c) => `${c.cpuSpeed.toFixed(1)}GHz` },
};
// metric key -> full panel def {key, label(zh), color, max, val, sub}
const PANELS = {};
for (const m of PANELS_META) PANELS[m.key] = { ...m, ...RENDER[m.key] };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawChart(ctx, x, y, w, h, hist, max, color) {
  // baseline grid
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const gy = y + (h * i) / 4; ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }
  if (!hist || hist.length < 2) return;
  const m = Math.max(max, 1);
  const pt = (i) => [x + (w * i) / (hist.length - 1), y + h - Math.min(hist[i] / m, 1) * h];
  // filled area
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  for (let i = 0; i < hist.length; i++) { const [px, py] = pt(i); ctx.lineTo(px, py); }
  ctx.lineTo(x + w, y + h); ctx.closePath();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, hexA(color, 0.45)); g.addColorStop(1, hexA(color, 0.04));
  ctx.fillStyle = g; ctx.fill();
  // line
  ctx.beginPath();
  for (let i = 0; i < hist.length; i++) { const [px, py] = pt(i); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
}

function drawPanel(ctx, x, y, w, h, p, cur, hist) {
  // hand-drawn-ish box
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
  ctx.strokeStyle = hexA(p.color, 0.85); ctx.lineWidth = 2.5; ctx.stroke();
  // label (Chinese, Xiaolai)
  ctx.fillStyle = p.color; ctx.font = '26px Xiaolai'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(p.label, x + 16, y + 34);
  // big value (Excalifont)
  ctx.fillStyle = '#ffffff'; ctx.font = '46px Excali';
  ctx.fillText(p.val(cur), x + 14, y + 80);
  // sub text (Xiaolai, dim)
  ctx.fillStyle = 'rgba(220,230,255,0.6)'; ctx.font = '20px Xiaolai';
  const sub = p.sub(cur); const sw = ctx.measureText(sub).width;
  ctx.fillText(sub, x + w - sw - 14, y + 32);
  // chart in lower part
  drawChart(ctx, x + 12, y + 92, w - 24, h - 104, hist[p.key], p.max(cur), p.color);
}

class Dashboard {
  constructor(order) {
    this.land = createCanvas(W, H); this.lc = this.land.getContext('2d');
    this.dev = createCanvas(DEV_W, DEV_H); this.dc = this.dev.getContext('2d');
    // panel display order (array of metric keys), reorderable live from the control panel
    this.order = normalizeOrder(order || DEFAULT_ORDER);
  }

  // Live reorder: the control panel's drag-to-arrange grid pushes a new order while running;
  // the next render() picks it up. Normalized so a partial/garbled order can't break the grid.
  setOrder(order) { this.order = normalizeOrder(order); }

  render(metrics, catImg) {
    const ctx = this.lc, cur = metrics.cur, hist = metrics.hist;
    // background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b1026'); bg.addColorStop(1, '#161a3a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // cat on the left, scaled to fit the strip, vertically centered
    if (catImg) {
      const s = Math.min((CAT_W - 30) / catImg.width, (H - 90) / catImg.height);
      const cw = catImg.width * s, ch = catImg.height * s;
      ctx.drawImage(catImg, (CAT_W - cw) / 2, (H - ch) / 2 - 6, cw, ch);
    }
    ctx.fillStyle = '#cfe0ff'; ctx.font = '30px Xiaolai'; ctx.textAlign = 'center';
    ctx.fillText('摸鱼监控', CAT_W / 2, H - 22); ctx.textAlign = 'left';
    // panels — laid out row-major in the user-chosen order (3 cols x 2 rows)
    for (let i = 0; i < this.order.length; i++) {
      const p = PANELS[this.order[i]];
      if (!p) continue;
      const col = i % COLS, row = (i / COLS) | 0;
      const px = GX + col * (PW + PAD), py = GY + row * (PH + PAD);
      drawPanel(ctx, px, py, PW, PH, p, cur, hist);
    }
    // rotate landscape -> device portrait
    const d = this.dc;
    d.save();
    if (ROT === 'ccw') { d.translate(0, DEV_H); d.rotate(-Math.PI / 2); }
    else { d.translate(DEV_W, 0); d.rotate(Math.PI / 2); }
    d.drawImage(this.land, 0, 0); d.restore();
    return this.dev.toBuffer('image/png');
  }
}

module.exports = { Dashboard };

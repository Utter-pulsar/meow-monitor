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
const CAT_W = 380; // left strip for the cat / 赛博消息栏

// panel grid on the right: 3 columns x 2 rows
const GX = CAT_W + 8, GY = 10, GW = W - GX - 12, GH = H - GY - 10;
const COLS = 3, ROWS = 2, PAD = 12;
const PW = (GW - PAD * (COLS - 1)) / COLS;
const PH = (GH - PAD * (ROWS - 1)) / ROWS;
const CYBER = {
  x: 18,
  y: 18,
  w: CAT_W - 36,
  h: H - 36,
  headerTop: 12,
  headerH: 70,
  footerH: 18,
  itemGap: 8,
  itemPadX: 12,
  itemPadY: 11,
  bodyGap: 8,
  bodyLine: 21,
  maxLines: 4,
  maxVisible: 4,
  maxPlaybackLines: 80,
  scrollPauseMs: 1400,
  scrollSpeed: 21,
};

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

function fitTextTail(ctx, text, width, suffix = '…') {
  if (ctx.measureText(text).width <= width) return text;
  let out = text;
  while (out && ctx.measureText(out + suffix).width > width) out = out.slice(0, -1);
  return out + suffix;
}

function wrapText(ctx, text, width, maxLines) {
  const paras = String(text || '').split('\n');
  const lines = [];
  let truncated = false;
  outer: for (let p = 0; p < paras.length; p++) {
    const chars = Array.from(paras[p]);
    let cur = '';
    if (!chars.length) {
      if (lines.length >= maxLines) { truncated = true; break; }
      lines.push('');
      continue;
    }
    for (const rawCh of chars) {
      const ch = rawCh === '\t' ? '  ' : rawCh;
      const next = cur + ch;
      if (cur && ctx.measureText(next).width > width) {
        lines.push(cur.trimEnd());
        if (lines.length >= maxLines) { truncated = true; break outer; }
        cur = ch.trim() ? ch : '';
      } else {
        cur = next;
      }
    }
    if (lines.length >= maxLines) { truncated = true; break; }
    if (cur || !lines.length) lines.push(cur.trimEnd());
    if (lines.length >= maxLines && p < paras.length - 1) { truncated = true; break; }
  }
  if (!lines.length) lines.push('');
  if (lines.length > maxLines) { lines.length = maxLines; truncated = true; }
  if (truncated) lines[lines.length - 1] = fitTextTail(ctx, lines[lines.length - 1], width, '…');
  return { lines, truncated };
}

function fmtTime(ts, withSeconds = false) {
  const d = new Date(ts || Date.now());
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return withSeconds ? `${hhmm}:${String(d.getSeconds()).padStart(2, '0')}` : hhmm;
}

function normalizeCyber(cyber) {
  const base = {
    leftMode: 'cat',
    burstEnabled: true,
    visible: false,
    unseenCount: 0,
    updatedAt: 0,
    version: 0,
    messages: [],
  };
  const next = { ...base, ...(cyber || {}) };
  next.leftMode = next.leftMode === 'cyber' ? 'cyber' : 'cat';
  next.burstEnabled = !!next.burstEnabled;
  next.visible = !!next.visible;
  next.unseenCount = Math.max(0, Number(next.unseenCount) || 0);
  next.updatedAt = Number(next.updatedAt) || 0;
  next.version = Number(next.version) || 0;
  next.messages = Array.isArray(next.messages) ? next.messages.map((m) => ({
    seq: Number(m.seq) || 0,
    identity: String(m.identity || 'unknown').slice(0, 32),
    message: String(m.message || '').slice(0, 600),
    accent: typeof m.accent === 'string' && m.accent ? m.accent : '#7ce7ff',
    at: Number(m.at) || Date.now(),
  })).filter((m) => m.seq > 0 && m.message) : [];
  return next;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

class Dashboard {
  constructor(order, cyber) {
    this.land = createCanvas(W, H); this.lc = this.land.getContext('2d');
    this.dev = createCanvas(DEV_W, DEV_H); this.dc = this.dev.getContext('2d');
    // panel display order (array of metric keys), reorderable live from the control panel
    this.order = normalizeOrder(order || DEFAULT_ORDER);
    this.cyber = normalizeCyber(cyber);
    this.activeBurst = null;
    this._lastCyberSeq = this.cyber.messages.length ? this.cyber.messages[this.cyber.messages.length - 1].seq : 0;
    this._cyberPlayback = null; // starts when an overflowing message is first drawn
  }

  // Live reorder: the control panel's drag-to-arrange grid pushes a new order while running;
  // the next render() picks it up. Normalized so a partial/garbled order can't break the grid.
  setOrder(order) { this.order = normalizeOrder(order); }

  setCyber(cyber) {
    const wasCyber = this.cyber.leftMode === 'cyber';
    const prevSeq = this.cyber.messages.length ? this.cyber.messages[this.cyber.messages.length - 1].seq : 0;
    this.cyber = normalizeCyber(cyber);
    const nextSeq = this.cyber.messages.length ? this.cyber.messages[this.cyber.messages.length - 1].seq : 0;
    if (this.cyber.leftMode === 'cyber' && this.cyber.burstEnabled && this.cyber.visible && nextSeq > prevSeq) {
      this.activeBurst = { seq: nextSeq, startedAt: Date.now() };
    }
    if (nextSeq !== prevSeq || (!wasCyber && this.cyber.leftMode === 'cyber')) {
      this._cyberPlayback = { seq: nextSeq, startedAt: Date.now() };
    }
    this._lastCyberSeq = nextSeq;
  }

  cyberScrollOffset(maxScroll, seq, now = Date.now()) {
    if (!(maxScroll > 0)) return 0;
    if (!this._cyberPlayback || this._cyberPlayback.seq !== seq) {
      this._cyberPlayback = { seq, startedAt: now };
    }
    const pause = CYBER.scrollPauseMs;
    const travel = (maxScroll / CYBER.scrollSpeed) * 1000;
    const cycle = pause * 2 + travel * 2;
    const elapsed = Math.max(0, now - this._cyberPlayback.startedAt) % cycle;
    if (elapsed < pause) return 0;
    if (elapsed < pause + travel) return maxScroll * ((elapsed - pause) / travel);
    if (elapsed < pause * 2 + travel) return maxScroll;
    return maxScroll * (1 - (elapsed - pause * 2 - travel) / travel);
  }

  drawLeftCat(ctx, catImg) {
    // cat on the left, scaled to fit the strip, vertically centered
    if (catImg) {
      const s = Math.min((CAT_W - 30) / catImg.width, (H - 90) / catImg.height);
      const cw = catImg.width * s, ch = catImg.height * s;
      ctx.drawImage(catImg, (CAT_W - cw) / 2, (H - ch) / 2 - 6, cw, ch);
    }
    ctx.fillStyle = '#cfe0ff'; ctx.font = '30px Xiaolai'; ctx.textAlign = 'center';
    ctx.fillText('摸鱼监控', CAT_W / 2, H - 22); ctx.textAlign = 'left';
  }

  drawCyberHeader(ctx, x, y, w) {
    const stamp = this.cyber.updatedAt ? fmtTime(this.cyber.updatedAt, true) : '--:--:--';
    const count = this.cyber.messages.length;
    const countLabel = `${count} msg${count === 1 ? '' : 's'}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#7ce7ff';
    ctx.font = '28px Xiaolai';
    ctx.fillText('赛博消息栏', x, y + 26);
    ctx.strokeStyle = 'rgba(124,231,255,0.26)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 42);
    ctx.lineTo(x + w, y + 42);
    ctx.stroke();
    ctx.fillStyle = 'rgba(228,240,255,0.72)';
    ctx.font = '18px Excali';
    ctx.fillText(`[ ${stamp} / ${countLabel} ]`, x, y + 58);
  }

  layoutCyberItem(ctx, msg, width, maxLines = CYBER.maxLines) {
    const innerW = width - CYBER.itemPadX * 2;
    ctx.font = '18px Xiaolai';
    const body = wrapText(ctx, msg.message, innerW, maxLines);
    const headH = 24;
    const bodyH = body.lines.length * CYBER.bodyLine;
    return {
      msg,
      lines: body.lines,
      truncated: body.truncated,
      width,
      height: CYBER.itemPadY * 2 + headH + CYBER.bodyGap + bodyH,
    };
  }

  drawCyberItem(ctx, layout, x, y) {
    const { msg, lines, width, height } = layout;
    const innerW = width - CYBER.itemPadX * 2;
    roundRect(ctx, x, y, width, height, 16);
    ctx.fillStyle = 'rgba(6,12,28,0.58)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(124,231,255,0.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const tagText = msg.identity;
    ctx.textBaseline = 'alphabetic';
    ctx.font = '18px Excali';
    const tagW = Math.min(innerW - 72, ctx.measureText(tagText).width + 18);
    roundRect(ctx, x + CYBER.itemPadX, y + CYBER.itemPadY, tagW, 24, 12);
    ctx.fillStyle = hexA(msg.accent, 0.12);
    ctx.fill();
    ctx.strokeStyle = hexA(msg.accent, 0.54);
    ctx.stroke();
    ctx.fillStyle = msg.accent;
    ctx.fillText(fitTextTail(ctx, tagText, tagW - 12), x + CYBER.itemPadX + 8, y + CYBER.itemPadY + 17);

    ctx.fillStyle = 'rgba(228,240,255,0.46)';
    ctx.font = '16px Excali';
    const time = fmtTime(msg.at);
    const tw = ctx.measureText(time).width;
    ctx.fillText(time, x + width - CYBER.itemPadX - tw, y + CYBER.itemPadY + 17);

    const bodyTop = y + CYBER.itemPadY + 24 + CYBER.bodyGap;
    const bodyViewportH = Math.max(0, y + height - CYBER.itemPadY - bodyTop);
    const maxScroll = Math.max(0, lines.length * CYBER.bodyLine - bodyViewportH);
    const scrollY = layout.autoScroll ? this.cyberScrollOffset(maxScroll, msg.seq) : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + CYBER.itemPadX, bodyTop, innerW, bodyViewportH);
    ctx.clip();
    ctx.fillStyle = 'rgba(236,244,255,0.97)';
    ctx.font = '18px Xiaolai';
    ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x + CYBER.itemPadX, bodyTop - scrollY + i * CYBER.bodyLine);
    }
    ctx.restore();
    return {
      burstX: x + width - 18,
      burstY: y + 24,
    };
  }

  drawCyberEmpty(ctx, x, y, w, h) {
    roundRect(ctx, x, y, w, h, 18);
    ctx.fillStyle = 'rgba(8,16,38,0.42)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(124,231,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.save();
    ctx.fillStyle = 'rgba(228,240,255,0.7)';
    ctx.font = '22px Xiaolai';
    ctx.textBaseline = 'middle';
    ctx.fillText('还没有最新的汇报', x + 18, y + h / 2);
    ctx.restore();
  }

  drawCyberBurst(ctx, anchor) {
    if (!this.activeBurst || !anchor) return;
    const age = Date.now() - this.activeBurst.startedAt;
    const life = 620;
    if (age >= life) { this.activeBurst = null; return; }
    const t = Math.max(0, Math.min(1, age / life));
    const scale = 0.55 + 0.82 * easeOutBack(Math.min(t / 0.72, 1));
    const alpha = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
    const drift = 10 + 26 * t;
    ctx.save();
    ctx.translate(anchor.burstX + 44 * t, anchor.burstY - drift);
    ctx.rotate(-0.08 + 0.06 * t);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = `rgba(124,231,255,${0.55 * alpha})`;
    ctx.shadowBlur = 18;
    ctx.fillStyle = `rgba(255,244,162,${0.95 * alpha})`;
    ctx.strokeStyle = `rgba(17,22,46,${0.78 * alpha})`;
    ctx.lineWidth = 6;
    ctx.font = '34px Xiaolai';
    ctx.strokeText('叮！', 0, 0);
    ctx.fillText('叮！', 0, 0);
    ctx.restore();
  }

  drawLeftCyber(ctx) {
    const x = CYBER.x, y = CYBER.y, w = CYBER.w, h = CYBER.h;
    const bg = ctx.createLinearGradient(x, y, x, y + h);
    bg.addColorStop(0, 'rgba(18,25,53,0.96)');
    bg.addColorStop(1, 'rgba(8,14,34,0.88)');
    roundRect(ctx, x, y, w, h, 24);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(124,231,255,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const headerY = y + CYBER.headerTop;
    this.drawCyberHeader(ctx, x + 18, headerY, w - 36);
    const feedX = x + 14;
    const feedY = headerY + CYBER.headerH;
    const feedW = w - 28;
    const feedBottom = y + h - CYBER.footerH;
    const feedH = Math.max(0, feedBottom - feedY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(feedX, feedY, feedW, feedH);
    ctx.clip();

    if (!this.cyber.messages.length) {
      this.drawCyberEmpty(ctx, feedX, feedY + 4, feedW, 62);
      ctx.restore();
      return null;
    }

    const picked = [];
    const latestIndex = this.cyber.messages.length - 1;
    const latestPreview = this.layoutCyberItem(ctx, this.cyber.messages[latestIndex], feedW);
    if (latestPreview.truncated) {
      const full = this.layoutCyberItem(ctx, this.cyber.messages[latestIndex], feedW, CYBER.maxPlaybackLines);
      full.height = Math.max(0, feedH - 1);
      const bodyViewportH = full.height - CYBER.itemPadY * 2 - 24 - CYBER.bodyGap;
      full.autoScroll = full.lines.length * CYBER.bodyLine > bodyViewportH;
      picked.push(full);
    } else {
      let used = 0;
      for (let i = latestIndex; i >= 0 && picked.length < CYBER.maxVisible; i--) {
        const layout = i === latestIndex ? latestPreview : this.layoutCyberItem(ctx, this.cyber.messages[i], feedW);
        const want = layout.height + (picked.length ? CYBER.itemGap : 0);
        if (picked.length && used + want > feedH) break;
        if (used + want > feedH) break;
        picked.push(layout);
        used += want;
      }
      picked.reverse();
    }

    let yCursor = feedY;
    let burstAnchor = null;
    for (let i = 0; i < picked.length; i++) {
      const layout = picked[i];
      const anchor = this.drawCyberItem(ctx, layout, feedX, yCursor);
      if (this.activeBurst && layout.msg.seq === this.activeBurst.seq) burstAnchor = anchor;
      yCursor += layout.height + CYBER.itemGap;
    }
    ctx.restore();
    return burstAnchor;
  }

  render(metrics, catImg) {
    const ctx = this.lc, cur = metrics.cur, hist = metrics.hist;
    ctx.clearRect(0, 0, W, H);
    // background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b1026'); bg.addColorStop(1, '#161a3a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const burstAnchor = this.cyber.leftMode === 'cyber' ? this.drawLeftCyber(ctx) : null;
    if (this.cyber.leftMode !== 'cyber') this.drawLeftCat(ctx, catImg);
    // panels — laid out row-major in the user-chosen order (3 cols x 2 rows)
    for (let i = 0; i < this.order.length; i++) {
      const p = PANELS[this.order[i]];
      if (!p) continue;
      const col = i % COLS, row = (i / COLS) | 0;
      const px = GX + col * (PW + PAD), py = GY + row * (PH + PAD);
      drawPanel(ctx, px, py, PW, PH, p, cur, hist);
    }
    if (this.cyber.leftMode === 'cyber') this.drawCyberBurst(ctx, burstAnchor);
    // rotate landscape -> device portrait
    const d = this.dc;
    d.save();
    d.clearRect(0, 0, DEV_W, DEV_H);
    if (ROT === 'ccw') { d.translate(0, DEV_H); d.rotate(-Math.PI / 2); }
    else { d.translate(DEV_W, 0); d.rotate(Math.PI / 2); }
    d.drawImage(this.land, 0, 0); d.restore();
    return this.dev.toBuffer('image/png');
  }
}

module.exports = { Dashboard };

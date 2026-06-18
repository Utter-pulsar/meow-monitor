// Minimal open driver for the TURZX 8.8" USB bar screen (VID 0x1CBE / PID 0x0092, 464x1920).
//
// Reverse-engineered from the official app. Talks to the panel over
// WinUSB via node-usb (usb@2, findByIds — no Zadig/driver swap needed). Interface 0, bulk
// EP #1: 0x01 OUT (commands + frame data), 0x81 IN (replies). Every command is a 512-byte
// DES-CBC-encrypted packet; data commands append the raw body after the 512-byte header.
const usb = require('usb');
const { desCbcEncrypt } = require('./des');

const VID = 0x1cbe, PID = 0x0092;
const DES_KEY = Buffer.from('slv3tuzx', 'latin1'); // key == IV
const EP_OUT = 0x01, EP_IN = 0x81;
const IO_TIMEOUT = 2000;

// Command ids used by the live-display path.
const CMD = {
  GetVer: 0x0a,        // handshake -> "turzx_0001_0015"
  Cmd0d: 0x0d,         // startup (no param)
  Brightness: 0x0e,    // payload[8] = brightness 0..100
  SetFrameRate: 0x0f,  // payload[8] = fps
  QueryStatus: 0x11,   // startup status query
  BeginSession: 0x34,  // payload[8] = 0, right before first frame
  EnableMode: 0x33,    // payload[8..14]=date/time, payload[15]=mode (1=image, 2=video, 0=stop)
  SendImage: 0x66,     // PNG image frame: header[8..11] = BE length, PNG body appended
  SendImageJpeg: 0x65, // JPEG image frame (smaller than PNG for photographic / desktop content)
  StopPlay: 0x6f,      // stop standalone playback
  Init: 0x70,          // startup init (no param)
  StatusPoll: 0x7a,    // back-pressure poll between frames (reply[8] is the queue depth)
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TurzxDevice {
  constructor() {
    this.dev = this.iface = this.outEp = this.inEp = null;
    // The [4..7] timestamp field is real wall-clock ms since yesterday's local midnight
    // (matches the official app's reference).
    const now = new Date();
    this._refMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - 86400000;
  }

  _seq() { return (Date.now() - this._refMs) >>> 0; }

  async open({ retries = 6, retryDelay = 300 } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
      let dev = null;
      try {
        dev = usb.findByIds(VID, PID);
        if (!dev) throw new Error('TURZX 1cbe:0092 not found (plugged in? official app closed?)');
        dev.open();
        const iface = dev.interface(0);
        iface.claim();
        const outEp = iface.endpoint(EP_OUT), inEp = iface.endpoint(EP_IN);
        outEp.timeout = inEp.timeout = IO_TIMEOUT;
        // clear any stalled pipe state left by a previously aborted transfer
        await new Promise((res) => { try { outEp.clearHalt(() => res()); } catch { res(); } });
        await new Promise((res) => { try { inEp.clearHalt(() => res()); } catch { res(); } });
        this.dev = dev; this.iface = iface; this.outEp = outEp; this.inEp = inEp;
        await sleep(50);
        await this._drainIn(150); // clear any stale queued replies
        return this;
      } catch (e) {
        lastErr = e;
        try { dev && dev.close(); } catch {}
        if (attempt < retries) await sleep(retryDelay);
      }
    }
    throw new Error(`open failed after ${retries} attempts: ${lastErr && lastErr.message}`);
  }

  async close() {
    if (!this.dev) return;
    const iface = this.iface, dev = this.dev;
    this.dev = this.iface = this.outEp = this.inEp = null;
    await new Promise((res) => { try { iface.release(true, () => res()); } catch { res(); } });
    try { dev.close(); } catch {}
  }

  // Build a 512-byte encrypted command header.
  _buildCmd(cmdId, fillParams) {
    const p = Buffer.alloc(500);
    p[0] = cmdId; p[2] = 0x1a; p[3] = 0x6d;
    p.writeUInt32LE(this._seq(), 4);
    if (fillParams) fillParams(p);
    const ct = desCbcEncrypt(DES_KEY, DES_KEY, p); // 504 bytes
    const out = Buffer.alloc(512);
    ct.copy(out, 0); out[510] = 0xa1; out[511] = 0x1a;
    return out;
  }

  _writeOut(buf) { return new Promise((res, rej) => this.outEp.transfer(buf, (e) => (e ? rej(e) : res()))); }
  // Request >512 so libusb absorbs the trailing ZLP the device sends after each 512B reply.
  _readIn(len = 1024) { return new Promise((res, rej) => this.inEp.transfer(len, (e, d) => (e ? rej(e) : res(d)))); }

  // Write a packet, then read replies until the echo (resp[0]) matches `expect`, skipping
  // ZLPs and any stale/shifted replies (keeps the IN stream synchronized).
  async _roundtrip(buf, expect, maxReads = 12) {
    await this._writeOut(buf);
    let last = null;
    for (let i = 0; i < maxReads; i++) {
      let r;
      try { r = await this._readIn(); } catch (e) { if (last) return last; if (i === 0) throw e; return last || Buffer.alloc(8); }
      if (r && r.length > 0) { last = r; if (r[0] === expect) return r; }
    }
    return last || Buffer.alloc(8);
  }

  _cmd(cmdId, fillParams) { return this._roundtrip(this._buildCmd(cmdId, fillParams), cmdId); }

  async _drainIn(quietMs = 120) {
    const saved = this.inEp.timeout; this.inEp.timeout = quietMs;
    let n = 0;
    for (;;) { try { await this._readIn(); n++; if (n > 256) break; } catch { break; } }
    this.inEp.timeout = saved;
    return n;
  }

  async getVer() {
    const r = await this._cmd(CMD.GetVer);
    return { echoed: r[0], version: r.slice(8, 40).toString('utf8').replace(/\0+$/, '').trim() };
  }
  stopPlay() { return this._cmd(CMD.StopPlay, (p) => { p[8] = 0; }); }

  /** cmd 0x33 — set display mode: 1=image(0x66), 2=video(0x79), 0=stop. param = date/time + flag. */
  enableMode(flag) {
    const now = new Date(), y = now.getFullYear();
    return this._cmd(CMD.EnableMode, (p) => {
      p[8] = (y >> 8) & 0xff; p[9] = y & 0xff; p[10] = now.getMonth() + 1; p[11] = now.getDate();
      p[12] = now.getHours(); p[13] = now.getMinutes(); p[14] = now.getSeconds(); p[15] = flag;
    });
  }
  setBrightness(v) { return this._cmd(CMD.Brightness, (p) => { p[8] = v & 0xff; }); }
  setFrameRate(fps) { return this._cmd(CMD.SetFrameRate, (p) => { p[8] = fps & 0xff; }); }
  beginSession() { return this._cmd(CMD.BeginSession, (p) => { p[8] = 0; }); }
  statusPoll() { return this._cmd(CMD.QueryStatus); }
  poll7a() { return this._cmd(CMD.StatusPoll); }

  /** Send one image frame. cmd 0x66 expects PNG (cmd 0x65 would be JPEG). 512B header (BE length at [8..11]) + body. */
  async sendImage(img) {
    const header = this._buildCmd(CMD.SendImage, (p) => { p.writeUInt32BE(img.length >>> 0, 8); });
    return this._roundtrip(Buffer.concat([header, img]), CMD.SendImage);
  }

  /** Send one JPEG frame (cmd 0x65). Much smaller than PNG for photographic/desktop content. */
  async sendImageJpeg(img) {
    const header = this._buildCmd(CMD.SendImageJpeg, (p) => { p.writeUInt32BE(img.length >>> 0, 8); });
    return this._roundtrip(Buffer.concat([header, img]), CMD.SendImageJpeg);
  }

  /**
   * Image-mode startup (the path that actually displays on this panel): full init, then
   * cmd 0x33 mode=1 to enter image mode. After this, stream JPEG/PNG frames with sendImage().
   */
  async startImage({ fps = 12, firstImage = null } = {}) {
    await this.getVer();
    await this.getVer();
    await this.stopPlay();        // 0x6f
    await this._cmd(CMD.Init);    // 0x70
    await this._cmd(CMD.Cmd0d);   // 0x0d
    await this.setBrightness(0x5d); // 0x0e
    await this.beginSession();    // 0x34
    await this.enableMode(1);     // 0x33 -> image mode
    if (firstImage) await this.sendImage(firstImage); // 0x66
    await this.setFrameRate(fps); // 0x0f
    await this.statusPoll();      // 0x11
  }

  /** Leave display mode cleanly (so the next run / official app can re-init). */
  async stopLive() {
    try { await this.enableMode(0); } catch {}
    try { await this.stopPlay(); } catch {}
  }
}

module.exports = { TurzxDevice, CMD, VID, PID };

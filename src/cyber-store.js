// 赛博消息栏消息仓库：主进程是唯一写入者。
// 历史单独落盘，不和 settings.json 混在一起；消息数量始终有上限，避免配置膨胀。
const fs = require('node:fs');

const MAX_MESSAGES = 60;
const ACCENTS = ['#7ce7ff', '#ffe07a', '#7df7a6', '#ff9ad5', '#9eb3ff', '#ffb36b'];

function clampText(s, fallback) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t || fallback;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function accentForIdentity(identity) {
  return ACCENTS[hash(identity) % ACCENTS.length];
}

class CyberStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.messages = [];
    this.nextSeq = 1;
    this.unseenCount = 0;
    this.updatedAt = 0;
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.messages = Array.isArray(raw.messages) ? raw.messages.map((m) => this._normalize(m)).filter(Boolean).slice(-MAX_MESSAGES) : [];
      this.nextSeq = Math.max(1, Number(raw.nextSeq) || (this.messages.length ? (this.messages[this.messages.length - 1].seq + 1) : 1));
      this.unseenCount = Math.max(0, Math.min(this.messages.length, Number(raw.unseenCount) || 0));
      this.updatedAt = Number(raw.updatedAt) || (this.messages.length ? this.messages[this.messages.length - 1].at : 0);
    } catch {
      this.messages = [];
      this.nextSeq = 1;
      this.unseenCount = 0;
      this.updatedAt = 0;
    }
  }

  save() {
    const body = {
      nextSeq: this.nextSeq,
      unseenCount: this.unseenCount,
      updatedAt: this.updatedAt,
      messages: this.messages,
    };
    try { fs.writeFileSync(this.filePath, JSON.stringify(body, null, 2)); } catch {}
  }

  snapshot() {
    return {
      messages: this.messages.map((m) => ({ ...m })),
      unseenCount: this.unseenCount,
      updatedAt: this.updatedAt,
      nextSeq: this.nextSeq,
    };
  }

  add(identity, message, { seen = false } = {}) {
    const item = this._make(identity, message);
    this.messages.push(item);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    if (!seen) this.unseenCount = Math.min(MAX_MESSAGES, this.unseenCount + 1);
    this.updatedAt = item.at;
    this.save();
    return { ...item };
  }

  clear() {
    this.messages = [];
    this.unseenCount = 0;
    this.updatedAt = Date.now();
    this.save();
    return this.snapshot();
  }

  markSeen() {
    if (!this.unseenCount) return false;
    this.unseenCount = 0;
    this.save();
    return true;
  }

  _make(identity, message) {
    const who = clampText(identity, 'unknown').slice(0, 32);
    const body = String(message || '').replace(/\r\n?/g, '\n').trim().slice(0, 600) || '……';
    const at = Date.now();
    return {
      seq: this.nextSeq++,
      identity: who,
      message: body,
      accent: accentForIdentity(who),
      at,
    };
  }

  _normalize(m) {
    if (!m || typeof m !== 'object') return null;
    const identity = clampText(m.identity, 'unknown').slice(0, 32);
    const message = String(m.message || '').replace(/\r\n?/g, '\n').trim().slice(0, 600);
    const seq = Number(m.seq);
    if (!message || !Number.isFinite(seq)) return null;
    return {
      seq,
      identity,
      message,
      accent: typeof m.accent === 'string' && m.accent ? m.accent : accentForIdentity(identity),
      at: Number(m.at) || Date.now(),
    };
  }
}

module.exports = { CyberStore, MAX_MESSAGES, accentForIdentity };

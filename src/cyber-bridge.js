// Shared local IPC for the 赛博消息栏 CLI: the Electron app listens on a per-user endpoint,
// and the `meow` command sends one JSON request and waits for one JSON response.
const crypto = require('node:crypto');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

function cyberPipePath() {
  const seed = `${os.homedir()}|${os.userInfo().username}|moyu-cyber-bar`;
  const tag = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
  if (process.platform === 'win32') return `\\\\.\\pipe\\moyu-cyber-${tag}`;
  return path.join(os.tmpdir(), `moyu-cyber-${tag}.sock`);
}

function writeFrame(socket, payload) {
  socket.write(`${JSON.stringify(payload)}\n`);
}

function createCyberServer(onRequest) {
  const server = net.createServer((socket) => {
    let buf = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      buf = '';
      let req = null;
      try { req = JSON.parse(line); }
      catch {
        writeFrame(socket, { ok: false, code: 'bad_json', message: '赛博消息栏收到了一段坏掉的命令。' });
        socket.end();
        return;
      }
      Promise.resolve(onRequest(req)).then((res) => {
        writeFrame(socket, res || { ok: true });
        socket.end();
      }).catch((e) => {
        writeFrame(socket, { ok: false, code: 'server_error', message: String((e && e.message) || e) });
        socket.end();
      });
    });
    socket.on('error', () => {});
  });
  return server;
}

function sendCyberRequest(payload, { timeout = 2400 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(cyberPipePath());
    let settled = false;
    let buf = '';
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), timeout);
    socket.setEncoding('utf8');
    socket.on('connect', () => writeFrame(socket, payload));
    socket.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      try { finish(resolve, JSON.parse(buf.slice(0, nl))); }
      catch { finish(reject, Object.assign(new Error('bad response'), { code: 'EBADMSG' })); }
    });
    socket.on('error', (e) => finish(reject, e));
    socket.on('end', () => {
      if (!settled) finish(reject, Object.assign(new Error('closed'), { code: 'EPIPE' }));
    });
  });
}

module.exports = { cyberPipePath, createCyberServer, sendCyberRequest };

// Polls hardware metrics with no admin and no extra software:
//   GPU (power, VRAM, temp, util, fan, clock) via nvidia-smi
//   RAM, CPU load, CPU speed via the `systeminformation` npm package
// Keeps a rolling history per metric for the Task-Manager-style line charts.
const { execFile } = require('child_process');
const si = require('systeminformation');

const HIST = 90; // samples kept per metric (~90s at 1 Hz)

const NV_FIELDS = 'power.draw,power.limit,memory.used,memory.total,temperature.gpu,utilization.gpu,fan.speed,clocks.sm';

function nvidiaSmi() {
  return new Promise((resolve) => {
    execFile('nvidia-smi', [`--query-gpu=${NV_FIELDS}`, '--format=csv,noheader,nounits'], { timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const v = stdout.trim().split('\n')[0].split(',').map((s) => parseFloat(s.trim()));
      resolve({
        power: v[0], powerMax: v[1], vramUsed: v[2] / 1024, vramTotal: v[3] / 1024, // GiB
        temp: v[4], util: v[5], fanPct: v[6], clock: v[7],
      });
    });
  });
}

class Metrics {
  constructor() {
    this.cur = {
      gpuPower: 0, gpuPowerMax: 180, vramUsed: 0, vramTotal: 0, gpuTemp: 0, gpuUtil: 0, gpuFan: 0, gpuClock: 0,
      ramUsed: 0, ramTotal: 0, ramPct: 0, cpuLoad: 0, cpuSpeed: 0,
    };
    this.hist = { gpuPower: [], vramUsed: [], gpuTemp: [], gpuUtil: [], ramPct: [], cpuLoad: [] };
    this._timer = null;
  }

  _push(key, val) {
    const a = this.hist[key];
    a.push(val);
    if (a.length > HIST) a.shift();
  }

  async tick() {
    const [gpu, mem, load, speed] = await Promise.all([
      nvidiaSmi(),
      si.mem().catch(() => null),
      si.currentLoad().catch(() => null),
      si.cpuCurrentSpeed().catch(() => null),
    ]);
    const c = this.cur;
    if (gpu) {
      c.gpuPower = gpu.power; c.gpuPowerMax = gpu.powerMax || 180;
      c.vramUsed = gpu.vramUsed; c.vramTotal = gpu.vramTotal;
      c.gpuTemp = gpu.temp; c.gpuUtil = gpu.util; c.gpuFan = gpu.fanPct; c.gpuClock = gpu.clock;
    }
    if (mem) { c.ramUsed = mem.active / 1073741824; c.ramTotal = mem.total / 1073741824; c.ramPct = 100 * mem.active / mem.total; }
    if (load) c.cpuLoad = load.currentLoad;
    if (speed) c.cpuSpeed = speed.avg;

    this._push('gpuPower', c.gpuPower);
    this._push('vramUsed', c.vramUsed);
    this._push('gpuTemp', c.gpuTemp);
    this._push('gpuUtil', c.gpuUtil);
    this._push('ramPct', c.ramPct);
    this._push('cpuLoad', c.cpuLoad);
  }

  start(intervalMs = 1000) {
    this.tick();
    this._timer = setInterval(() => this.tick(), intervalMs);
    return this;
  }

  stop() { if (this._timer) clearInterval(this._timer); this._timer = null; }
}

module.exports = { Metrics };

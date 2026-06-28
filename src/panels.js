// Single source of truth for the dashboard metric panels: each panel's key, Chinese label,
// accent color, and the DEFAULT left-to-right / top-to-bottom display order. Shared by the
// engine renderer (src/dashboard.js, attaches value/chart functions by key) and the Electron
// control panel (electron/main.js -> the drag-to-arrange grid in the UI), so the labels, colors
// and ordering never drift between the two processes.
//
// The array order below IS the default display order:
//   row 1: CPU占用 · 内存占用 · 显卡占用
//   row 2: 显卡温度 · 显存占用 · 显卡功率
const PANELS_META = [
  { key: 'cpuLoad',  label: 'CPU占用',  color: '#56e0c8' },
  { key: 'ramPct',   label: '内存占用', color: '#ffd166' },
  { key: 'gpuUtil',  label: '显卡占用', color: '#c08bff' },
  { key: 'gpuTemp',  label: '显卡温度', color: '#ff7b54' },
  { key: 'vramUsed', label: '显存占用', color: '#5fd0ff' },
  { key: 'gpuPower', label: '显卡功率', color: '#9dff5a' },
];

const DEFAULT_ORDER = PANELS_META.map((p) => p.key);
const VALID = new Set(DEFAULT_ORDER);

// Coerce any stored / incoming order into exactly the known keys: drop unknown keys and
// duplicates, then append any missing keys in their default order. Guarantees the grid is
// always complete (6 tiles) and the renderer never hits a hole — even across version upgrades
// that add or rename a panel.
function normalizeOrder(order) {
  const seen = new Set();
  const out = [];
  for (const k of Array.isArray(order) ? order : []) {
    if (VALID.has(k) && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  for (const k of DEFAULT_ORDER) if (!seen.has(k)) out.push(k);
  return out;
}

module.exports = { PANELS_META, DEFAULT_ORDER, normalizeOrder };

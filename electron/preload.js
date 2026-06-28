// Bridge between the renderer and the main process. Also inlines the cat GIF and Excalifont
// as data URLs so the UI never has to resolve asset paths inside the asar archive.
const fs = require('node:fs');
const path = require('node:path');
const { contextBridge, ipcRenderer } = require('electron');

function dataUrl(rel, mime) {
  try {
    const buf = fs.readFileSync(path.join(__dirname, '..', rel));
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

function fontBytes(rel) {
  try { return fs.readFileSync(path.join(__dirname, '..', rel)); } catch { return null; }
}

contextBridge.exposeInMainWorld('moyu', {
  catGif: dataUrl('assets/cat.GIF', 'image/gif'),
  excalifont: dataUrl('fonts/Excalifont-Regular.woff2', 'font/woff2'),
  // Xiaolai (小赖) is a ~22 MB CJK TTF — too big to inline as a base64 data URL. Hand the raw
  // bytes to the renderer, which registers them via the FontFace API so the whole control panel
  // is hand-drawn (Excalifont for Latin/digits, Xiaolai for Chinese) instead of falling back to
  // the system Microsoft YaHei. Lazy: only read when the renderer asks for it.
  xiaolai: () => fontBytes('fonts/Xiaolai-Regular.ttf'),

  start: () => ipcRenderer.invoke('engine:start'),
  stop: () => ipcRenderer.invoke('engine:stop'),
  getStatus: () => ipcRenderer.invoke('engine:status'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setMinimize: (v) => ipcRenderer.invoke('settings:setMinimize', v),
  setAutoLaunch: (v) => ipcRenderer.invoke('settings:setAutoLaunch', v),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  // dashboard panel arrangement (drag-to-reorder grid)
  dashGetPanels: () => ipcRenderer.invoke('dash:getPanels'),
  dashGetOrder: () => ipcRenderer.invoke('dash:getOrder'),
  dashSetOrder: (order) => ipcRenderer.invoke('dash:setOrder', order),

  // mode + extend-screen
  getMode: () => ipcRenderer.invoke('mode:get'),
  setMode: (m) => ipcRenderer.invoke('mode:set', m),
  vddReady: () => ipcRenderer.invoke('vdd:ready'),
  vddDisplays: () => ipcRenderer.invoke('vdd:displays'),
  vddSetPosition: (x, y) => ipcRenderer.invoke('vdd:setPosition', x, y),
  extendGetQuality: () => ipcRenderer.invoke('extend:getQuality'),
  extendSetQuality: (kb) => ipcRenderer.invoke('extend:setQuality', kb),

  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  fitWindow: (h) => ipcRenderer.invoke('window:fit', h),
  onStatus: (cb) => ipcRenderer.on('engine:status', (_e, s) => cb(s)),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', () => cb()),
  onUpdateError: (cb) => ipcRenderer.on('update:error', (_e, m) => cb(m)),
});

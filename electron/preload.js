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

contextBridge.exposeInMainWorld('moyu', {
  catGif: dataUrl('assets/cat.GIF', 'image/gif'),
  excalifont: dataUrl('fonts/Excalifont-Regular.woff2', 'font/woff2'),

  start: () => ipcRenderer.invoke('engine:start'),
  stop: () => ipcRenderer.invoke('engine:stop'),
  getStatus: () => ipcRenderer.invoke('engine:status'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setMinimize: (v) => ipcRenderer.invoke('settings:setMinimize', v),
  setAutoLaunch: (v) => ipcRenderer.invoke('settings:setAutoLaunch', v),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  onStatus: (cb) => ipcRenderer.on('engine:status', (_e, s) => cb(s)),
});

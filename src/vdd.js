// src/vdd.js — control the MttVDD virtual display from the Electron main process.
//
// on/off trigger two pre-installed SYSTEM scheduled tasks (created once, elevated, by the NSIS
// installer's vendor/vdd/install-vdd.ps1 whose SDDL lets a standard user run them) via the Task
// Scheduler COM Run, so toggling needs NO elevation:
//   on  = create the Root\MttVDD devnode  -> the 1920x464 virtual screen appears
//   off = remove the devnode              -> the screen is genuinely gone (the only clean way for
//                                            an IddCx display; disable/enable leaves a phantom)
const { execFile } = require('child_process');
const path = require('path');

const W = 1920, H = 464;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ps(command) {
  return new Promise((resolve) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: 20000 },
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// Run a scheduled task through the Task Scheduler COM Run (honours the task's SDDL; non-elevated).
function runTask(name) {
  return ps(`$s=New-Object -ComObject Schedule.Service;$s.Connect();$s.GetFolder('\\').GetTask('${name}').Run($null)|Out-Null`);
}

// Has the elevated one-time setup run (tasks present)?
async function isReady() {
  const r = await ps(`try{$s=New-Object -ComObject Schedule.Service;$s.Connect();$null=$s.GetFolder('\\').GetTask('MoyuVddOn');'yes'}catch{'no'}`);
  return /yes/.test(r.stdout);
}

let _screen = null;
const screen = () => (_screen || (_screen = require('electron').screen));

// The Electron Display for the virtual panel, or null if it's currently off.
function findDisplay() {
  return screen().getAllDisplays().find((d) =>
    (d.label && d.label.includes('VDD by MTT')) || (d.bounds.width === W && d.bounds.height === H)) || null;
}

async function waitFor(present, timeoutMs = 9000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (Boolean(findDisplay()) === present) return true;
    await sleep(300);
  }
  return false;
}

async function on() {
  if (findDisplay()) return { ok: true, already: true, display: findDisplay() };
  // No active virtual display. MoyuVddOn runs `devcon install Root\MttVDD`, which ALWAYS creates a
  // NEW devnode — so a failed attempt (adapter loads but the monitor never arrives, leaving
  // findDisplay() null) used to make the next click stack yet another adapter. Dozens of stale
  // monitorless adapters + ghost monitors then wedge the IddCx subsystem so NO new monitor arrives.
  // Clear any leftover MttVDD devnodes first, so each attempt creates exactly one fresh adapter.
  await runTask('MoyuVddOff');
  await sleep(2500); // let devcon remove finish before we install (tasks run async, no display to wait on)
  await runTask('MoyuVddOn');
  const ok = await waitFor(true);
  return { ok, display: findDisplay() };
}

async function off() {
  if (!findDisplay()) return { ok: true, already: true };
  await runTask('MoyuVddOff');
  const ok = await waitFor(false);
  return { ok };
}

function scriptPath(name) {
  let app = null;
  try { app = require('electron').app; } catch {}
  return app && app.isPackaged
    ? path.join(process.resourcesPath, 'vdd', name)
    : path.join(__dirname, '..', 'scripts', 'vdd', name);
}

// Move the virtual display's top-left to (x,y) in virtual-desktop coords (for the arranger).
function setPosition(x, y) {
  const sp = scriptPath('set-position.ps1');
  return ps(`& '${sp}' -X ${Math.round(x)} -Y ${Math.round(y)} -Width ${W} -Height ${H}`);
}

module.exports = { on, off, isReady, findDisplay, setPosition, W, H };

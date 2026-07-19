#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const binDir = path.join(root, 'bin');
const shellDir = path.join(os.homedir(), '.meow-monitor');
const cmdPath = path.join(shellDir, 'meow.cmd');

fs.mkdirSync(shellDir, { recursive: true });
const content = [
  '@echo off',
  `node "${path.join(binDir, 'meow.js')}" %*`,
  '',
].join('\r\n');
fs.writeFileSync(cmdPath, content);

if (process.platform === 'win32') {
  const ps = `
    $dir = ${JSON.stringify(shellDir)}
    $cur = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    if ($cur) { $parts = $cur -split ';' | Where-Object { $_ } }
    if ($parts -notcontains $dir) {
      $next = @($parts + $dir) -join ';'
      [Environment]::SetEnvironmentVariable('Path', $next, 'User')
      Write-Output 'PATH_UPDATED'
    } else {
      Write-Output 'PATH_OK'
    }
  `;
  const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  if (res.error) console.warn('Could not update PATH automatically:', res.error.message);
  else if (res.stdout.trim()) console.log(res.stdout.trim());
  if (res.stderr.trim()) console.warn(res.stderr.trim());
}

console.log('Created dev meow launcher:');
console.log(cmdPath);
console.log('Restart your terminal if `meow` is still not found.');

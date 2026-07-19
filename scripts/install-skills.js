#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const SKILLS = path.join(ROOT, 'SKILLS');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

const targets = [
  { name: 'claude', src: path.join(SKILLS, 'claude', 'meow-monitor'), dest: path.join(os.homedir(), '.claude', 'skills', 'meow-monitor') },
  { name: 'codex', src: path.join(SKILLS, 'codex', 'meow-monitor'), dest: path.join(os.homedir(), '.agents', 'skills', 'meow-monitor') },
  { name: 'hermes', src: path.join(SKILLS, 'hermes', 'meow-monitor'), dest: path.join(os.homedir(), '.hermes', 'skills', 'meow-monitor') },
  { name: 'openclaw', src: path.join(SKILLS, 'openclaw', 'meow-monitor'), dest: path.join(os.homedir(), '.openclaw', 'skills', 'meow-monitor') },
];

for (const target of targets) {
  if (!fs.existsSync(target.src)) continue;
  copyDir(target.src, target.dest);
  console.log(`[ok] ${target.name}: ${target.dest}`);
}

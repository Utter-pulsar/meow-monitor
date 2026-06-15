// Generate the app icon from the FIRST FRAME of assets/cat.GIF.
// Produces build/icon.png (256x256, transparent padding) which electron-builder turns
// into the Windows .ico at package time, and which the window/tray use at runtime.
//   node scripts/make-icon.js     (re-run if you swap assets/cat.GIF)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const FFMPEG = require('@ffmpeg-installer/ffmpeg').path;
const ROOT = path.join(__dirname, '..');
const GIF = path.join(ROOT, 'assets', 'cat.GIF');
const OUT_DIR = path.join(ROOT, 'build');
const SIZE = 256;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-icon-'));
  const framePng = path.join(tmp, 'frame1.png');
  // -frames:v 1 -> just the first frame
  execFileSync(FFMPEG, ['-hide_banner', '-y', '-i', GIF, '-frames:v', '1', framePng], { stdio: 'ignore' });

  const img = await loadImage(fs.readFileSync(framePng));
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  // fit the frame inside ~88% of the icon, centered, on a transparent background
  const s = Math.min((SIZE * 0.88) / img.width, (SIZE * 0.88) / img.height);
  const w = img.width * s, h = img.height * s;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);

  const png = canvas.toBuffer('image/png');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png);                 // electron-builder -> .ico
  const uiDir = path.join(ROOT, 'electron', 'ui');
  fs.mkdirSync(uiDir, { recursive: true });
  fs.writeFileSync(path.join(uiDir, 'icon.png'), png);                   // runtime window/tray icon
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`wrote build/icon.png + electron/ui/icon.png (${SIZE}x${SIZE}) from the first frame of cat.GIF`);
})();

// 摸鱼监控 renderer — wires the little control panel to the main process (window.moyu, from preload).
const $ = (sel) => document.querySelector(sel);

// Inject Excalifont (data URL from preload) and paint the cat into the title bar + hero.
(function brand() {
  const api = window.moyu || {};
  if (api.excalifont) {
    const style = document.createElement('style');
    style.textContent =
      `@font-face{font-family:'Excalifont';src:url(${api.excalifont}) format('woff2');` +
      `font-weight:normal;font-style:normal;font-display:swap;}`;
    document.head.appendChild(style);
  }
  const gif = api.catGif || '';
  $('#bar-cat').src = gif;
  $('#hero-cat').src = gif;
})();

const LABELS = {
  running: '运行中',
  starting: '正在启动…',
  stopped: '未运行',
  error: '出错了',
};

function paintSwitch(input) {
  input.closest('.switch').classList.toggle('on', input.checked);
}

function renderStatus(s) {
  const meta = LABELS[s.state] ? s.state : 'stopped';
  $('#status').className = 'status-card ' + meta;
  $('#status-text').textContent = s.message || LABELS[meta];
  const busy = s.state === 'running' || s.state === 'starting';
  $('#btn-start').disabled = busy;
  $('#btn-stop').disabled = !busy;
}

async function init() {
  const cfg = await window.moyu.getSettings();
  $('#sw-autolaunch').checked = !!cfg.launchAtLogin;
  $('#sw-minimize').checked = !!cfg.minimizeToTray;
  paintSwitch($('#sw-autolaunch'));
  paintSwitch($('#sw-minimize'));
  $('#version').textContent = 'v' + (cfg.version || '0.0.0');
  renderStatus(await window.moyu.getStatus());
}

window.moyu.onStatus(renderStatus);

$('#btn-start').addEventListener('click', () => window.moyu.start());
$('#btn-stop').addEventListener('click', () => window.moyu.stop());
$('#sw-autolaunch').addEventListener('change', (e) => { paintSwitch(e.target); window.moyu.setAutoLaunch(e.target.checked); });
$('#sw-minimize').addEventListener('change', (e) => { paintSwitch(e.target); window.moyu.setMinimize(e.target.checked); });
$('#btn-min').addEventListener('click', () => window.moyu.minimizeWindow());
$('#btn-close').addEventListener('click', () => window.moyu.closeWindow());

$('#btn-update').addEventListener('click', async () => {
  const msg = $('#update-msg');
  msg.className = 'update-msg';
  msg.textContent = '正在检查…';
  const r = await window.moyu.checkUpdate();
  if (r.status === 'update') {
    msg.classList.add('ok');
    msg.textContent = `发现新版本 v${r.latest} · `;
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = '前往下载';
    a.addEventListener('click', (e) => { e.preventDefault(); window.moyu.openExternal(r.url); });
    msg.appendChild(a);
  } else if (r.status === 'latest') {
    msg.classList.add('ok');
    msg.textContent = `已是最新版本（v${r.latest}）`;
  } else if (r.status === 'none') {
    msg.textContent = r.message;
  } else {
    msg.classList.add('err');
    msg.textContent = r.message || '检查更新失败';
  }
});

init();

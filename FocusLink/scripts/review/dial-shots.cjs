// 新仪表视觉审阅：启动打包版 → 开始计时 → 逐一切换仪表样式 → 截专注页整窗。
// 用法：node scripts/review/dial-shots.cjs [exe] [outDir] [style1,style2,...]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..', '..');
const packageVersion = String(
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '',
).trim();
const releaseDirectory = `release-v${packageVersion.replace(/\./g, '')}`;
const executable = path.resolve(
  process.argv[2] || path.join(root, '..', releaseDirectory, 'win-unpacked', 'FocusLink.exe'),
);
const outputDir = path.resolve(
  process.argv[3] || path.join(os.tmpdir(), `focuslink-dial-shots-${Date.now()}`),
);
const styles = (process.argv[4] || 'counter,analog,vernier,draft').split(',');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-dial-shots-'));
const port = 9200 + Math.floor(Math.random() * 600);
fs.mkdirSync(outputDir, { recursive: true });

const app = spawn(
  executable,
  [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--hidden'],
  { stdio: 'ignore', windowsHide: true },
);

let socket;
let commandId = 0;
const pending = new Map();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPage() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find(
        (target) => target.type === 'page' && !/mini\.html/.test(target.url || ''),
      );
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* retry */
    }
    await delay(250);
  }
  throw new Error('no page');
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || 'Uncaught');
  return result?.value;
}

async function main() {
  socket = new WebSocket(await waitForPage(), { maxPayload: 512 * 1024 * 1024 });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result || {});
    }
  });
  await new Promise((resolve) => socket.on('open', resolve));
  await send('Runtime.enable');
  await evaluate('document.readyState');
  await delay(1600);
  await send('Page.bringToFront');
  await evaluate('(() => { void window.focuslink.timer.toggle(); return true; })()');
  await delay(2400);

  for (const style of styles) {
    await evaluate(`window.focuslink.settings.set({ timerStyle: '${style}' })`);
    await delay(1200);
    await send('Page.bringToFront');
    await delay(300);
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(outputDir, `focus-${style}.png`), Buffer.from(shot.data, 'base64'));
    console.log(`[dial-shots] ${style} -> focus-${style}.png`);
  }
  console.log(`[dial-shots] outputDir=${outputDir}`);
  await evaluate('(() => { void window.focuslink.timer.stop(); return true; })()');
  await delay(400);
  app.kill();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  app.kill();
  process.exit(1);
});

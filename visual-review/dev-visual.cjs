/* Temporary visual-review harness (not part of the repo test suite).
   Serves the built renderer over loopback, boots the real FocusLink Electron
   app against it with an isolated user-data dir, drives the UI via CDP,
   and captures screenshots of every view. */
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const APP_DIR = 'C:/Users/poyi/Desktop/time1/FocusLink';
const OUT_DIR = 'C:/Users/poyi/Desktop/time1/visual-review';
const CDP_PORT = 19222;
const HTTP_PORT = 18991;
const WebSocket = require(path.join(APP_DIR, 'node_modules/ws'));
const electronPath = require(path.join(APP_DIR, 'node_modules/electron'));

fs.mkdirSync(OUT_DIR, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-visual-'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(APP_DIR, 'dist', urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(path.join(APP_DIR, 'dist'))) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(APP_DIR, 'dist', 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWs() {
  let lastError;
  for (let i = 0; i < 75; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find(
        (t) => t.type === 'page' && t.url.startsWith(`http://127.0.0.1:${HTTP_PORT}`),
      );
      const version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
      if (page && version) {
        return {
          page: page.webSocketDebuggerUrl,
          pageId: page.id,
          browser: version.webSocketDebuggerUrl,
        };
      }
    } catch (err) {
      lastError = err;
    }
    await delay(400);
  }
  throw new Error(`No renderer page found: ${lastError?.message || 'timeout'}`);
}

let ws;
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'evaluate failed');
  }
  return response.result?.value;
}

async function shot(name) {
  await send('Page.bringToFront').catch(() => {});
  await delay(900);
  const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(result.data, 'base64'));
  console.log(`captured ${name}.png`);
}

async function waitFor(selector, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    const found = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (found) return;
    await delay(200);
  }
  throw new Error(`timeout waiting for ${selector}`);
}

let app;

(async () => {
  await new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', resolve));
  app = spawn(
    electronPath,
    [
      '.',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${userDataDir}`,
    ],
    {
      cwd: APP_DIR,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, VITE_DEV_SERVER_URL: `http://127.0.0.1:${HTTP_PORT}/` },
    },
  );

  const target = await getPageWs();
  ws = new WebSocket(target.page, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      if (message.error) pending.get(message.id).reject(new Error(message.error.message));
      else pending.get(message.id).resolve(message.result);
      pending.delete(message.id);
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');

  // Browser-level connection for window bounds control.
  const browserWs = new WebSocket(target.browser, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    browserWs.on('open', resolve);
    browserWs.on('error', reject);
  });
  const browserPending = new Map();
  browserWs.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && browserPending.has(message.id)) {
      browserPending.get(message.id)(message);
      browserPending.delete(message.id);
    }
  });
  const browserSend = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      browserPending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      browserWs.send(JSON.stringify({ id, method, params }));
    });
  const setBounds = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(700);
  };

  await setBounds(1280, 800);
  console.log('boot: waiting focus-console'); await waitFor('.focus-console'); console.log('boot: focus-console ready');
  await delay(1500);
  await shot('01-timer-idle-light');

  // Task picker overlay.
  await evaluate(`document.querySelector('.timer-context-action')?.click()`);
  await delay(1100);
  await shot('01b-task-picker-light');
  await evaluate(`document.querySelector('.picker-shell')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '关闭' || b.textContent.trim() === '×')?.click()`);
  await delay(500);

  await evaluate(
    `[...document.querySelectorAll('.timer-controls button')].find((b) => b.textContent.includes('开始专注'))?.click()`,
  );
  await delay(2600);
  await shot('02-timer-running-light');
  await evaluate(
    `[...document.querySelectorAll('.timer-controls button')].find((b) => b.textContent.includes('暂停专注'))?.click()`,
  );
  await delay(900);
  await shot('03-timer-paused-light');
  await evaluate(
    `[...document.querySelectorAll('.timer-controls button')].find((b) => b.textContent.includes('继续专注'))?.click()`,
  );
  await delay(1800);
  await evaluate(
    `[...document.querySelectorAll('.timer-controls button')].find((b) => b.textContent.includes('结束'))?.click()`,
  );
  await delay(1500);
  await shot('04-timer-finished-light');

  await evaluate(`document.querySelector('button[aria-label="任务"]')?.click()`);
  await delay(1500);
  await shot('05-tasks-light');
  await evaluate(
    `[...document.querySelectorAll('.task-view-list button')].find((b) => b.textContent.includes('已完成'))?.click()`,
  );
  await delay(1100);
  await shot('05b-tasks-completed-light');
  await evaluate(
    `[...document.querySelectorAll('.task-view-list button')].find((b) => b.textContent.includes('待完成'))?.click()`,
  );
  await delay(400);

  await evaluate(`document.querySelector('button[aria-label="统计"]')?.click()`);
  await delay(1700);
  await shot('06-history-light');

  await evaluate(`document.querySelector('button[aria-label="设置"]')?.click()`);
  await delay(1500);
  await shot('07-settings-light');
  await evaluate(
    `[...document.querySelectorAll('.settings-tab')].find((b) => b.textContent.includes('体验'))?.click()`,
  );
  await delay(900);
  await shot('08-settings-experience-light');

  await evaluate(`window.focuslink.settings.set({ theme: 'dark' })`);
  await delay(900);
  await shot('09-settings-dark');
  await evaluate(`document.querySelector('button[aria-label="专注"]')?.click()`);
  await delay(1200);
  await shot('10-timer-dark');
  await evaluate(`document.querySelector('button[aria-label="统计"]')?.click()`);
  await delay(1300);
  await shot('11-history-dark');
  await evaluate(`document.querySelector('button[aria-label="任务"]')?.click()`);
  await delay(1300);
  await shot('12-tasks-dark');

  // Minimum-size overflow sweep.
  await evaluate(`window.focuslink.settings.set({ theme: 'light' })`);
  await setBounds(980, 660);
  await evaluate(`document.querySelector('button[aria-label="专注"]')?.click()`);
  await delay(1100);
  await shot('13-min-timer-light');
  await evaluate(`document.querySelector('button[aria-label="任务"]')?.click()`);
  await delay(1100);
  await shot('14-min-tasks-light');
  await evaluate(`document.querySelector('button[aria-label="统计"]')?.click()`);
  await delay(1100);
  await shot('15-min-history-light');
  await evaluate(`document.querySelector('button[aria-label="设置"]')?.click()`);
  await delay(1100);
  await shot('16-min-settings-light');
  const overflow = await evaluate(`[document.body.scrollWidth, window.innerWidth, document.body.scrollHeight, window.innerHeight]`);
  console.log('min-size scroll metrics:', JSON.stringify(overflow));

  console.log('VISUAL_REVIEW_DONE');
  app.kill();
  server.close();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  if (app) app.kill();
  server.close();
  process.exit(1);
});

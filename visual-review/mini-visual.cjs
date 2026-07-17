/* Temporary mini-window visual capture. Boots the real app, shows the mini
   window, and captures expanded/collapsed in both themes. */
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
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-mini-visual-'));

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(APP_DIR, 'dist', urlPath === '/' ? 'index.html' : urlPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(APP_DIR, 'dist', 'index.html');
  }
  const ext = path.extname(filePath);
  const mime =
    ext === '.js'
      ? 'text/javascript'
      : ext === '.css'
        ? 'text/css'
        : ext === '.woff2'
          ? 'font/woff2'
          : ext === '.png'
            ? 'image/png'
            : 'text/html';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 0;
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    const pending = new Map();
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id && pending.has(message.id)) {
        if (message.error) pending.get(message.id).reject(new Error(message.error.message));
        else pending.get(message.id).resolve(message.result);
        pending.delete(message.id);
      }
    });
    ws.on('open', () => {
      resolve({
        send: (method, params = {}) =>
          new Promise((res2, rej2) => {
            const id = ++msgId;
            pending.set(id, { resolve: res2, reject: rej2 });
            ws.send(JSON.stringify({ id, method, params }));
          }),
        close: () => ws.close(),
      });
    });
    ws.on('error', reject);
  });
}

async function findTarget(urlPart, excludePart) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find(
        (t) =>
          t.type === 'page' && t.url.includes(urlPart) && (!excludePart || !t.url.includes(excludePart)),
      );
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* retry */
    }
    await delay(400);
  }
  throw new Error(`target not found: ${urlPart}`);
}

async function evaluateOn(conn, expression) {
  const response = await conn.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result?.value;
}

async function shot(conn, name) {
  await delay(700);
  const result = await conn.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(result.data, 'base64'));
  console.log(`captured ${name}.png`);
}

let app;

(async () => {
  await new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', resolve));
  app = spawn(
    electronPath,
    ['.', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`],
    {
      cwd: APP_DIR,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, VITE_DEV_SERVER_URL: `http://127.0.0.1:${HTTP_PORT}/` },
    },
  );

  const mainConn = await connect(await findTarget(`${HTTP_PORT}/`, 'mini.html'));
  await mainConn.send('Runtime.enable');
  await mainConn.send('Page.enable');
  await delay(3500);

  // Start a running session so the mini shows live state.
  await evaluateOn(
    mainConn,
    `[...document.querySelectorAll('.timer-controls button')].find((b) => b.textContent.includes('开始专注'))?.click()`,
  );
  await delay(2000);

  // Show mini window, attach to its page target.
  await evaluateOn(mainConn, `window.focuslink.mini.show()`);
  const miniConn = await connect(await findTarget('mini.html'));
  await miniConn.send('Runtime.enable');
  await miniConn.send('Page.enable');
  await delay(1800);
  await shot(miniConn, '20-mini-expanded-running-light');

  await evaluateOn(mainConn, `window.focuslink.mini.collapse()`);
  await delay(900);
  await shot(miniConn, '21-mini-collapsed-running-light');

  await evaluateOn(mainConn, `window.focuslink.mini.expand()`);
  await delay(700);
  await evaluateOn(mainConn, `window.focuslink.settings.set({ theme: 'dark' })`);
  await delay(900);
  await shot(miniConn, '22-mini-expanded-running-dark');

  await evaluateOn(mainConn, `window.focuslink.mini.collapse()`);
  await delay(900);
  await shot(miniConn, '23-mini-collapsed-running-dark');

  console.log('MINI_VISUAL_DONE');
  app.kill();
  server.close();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  if (app) app.kill();
  server.close();
  process.exit(1);
});

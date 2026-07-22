// Renders design mock HTML files in a real Electron window and captures them.
// Usage: node scripts/review/mock-shots.cjs <mockDir>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..', '..');
if (!process.argv[2]) throw new Error('mockDir is required');
const mockDir = path.resolve(process.argv[2]);
const shotsDir = path.join(mockDir, 'shots');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-mock-'));
let port = 0;

fs.mkdirSync(shotsDir, { recursive: true });

const app = spawn(
  path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  [
    path.join(root, 'scripts', 'review', 'mock-main.cjs'),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
  ],
  { stdio: 'ignore', windowsHide: true },
);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPage() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (!port) {
        const activePortFile = path.join(userDataDir, 'DevToolsActivePort');
        if (fs.existsSync(activePortFile)) {
          const [rawPort] = fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/);
          const discovered = Number.parseInt(rawPort, 10);
          if (Number.isInteger(discovered) && discovered > 0) port = discovered;
        }
      }
      if (port) {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await response.json();
        const page = targets.find(
          (target) => target.type === 'page' && !String(target.url).startsWith('devtools://'),
        );
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for mock window: ${lastError?.message || 'unknown'}`);
}

async function main() {
  const page = await waitForPage();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let commandId = 0;
  const pending = new Map();
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => {
    const id = ++commandId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  await send('Page.enable');
  await send('Runtime.enable');

  const mocks = process.argv[3]
    ? [process.argv[3]]
    : fs.readdirSync(mockDir).filter((file) => file.endsWith('.html'));

  for (const mock of mocks) {
    const url = pathToFileURL(path.join(mockDir, mock)).href;
    await send('Page.navigate', { url });
    await delay(500);
    await send('Runtime.evaluate', {
      expression: 'document.fonts ? document.fonts.ready.then(() => true) : true',
      awaitPromise: true,
      returnByValue: true,
    });
    await delay(700);
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const name = mock.replace(/\.html$/, '');
    fs.writeFileSync(path.join(shotsDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
    process.stderr.write(`[mock] ${name}\n`);
  }
  socket.close();
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await delay(300);
    if (!app.killed) app.kill();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    } catch (cleanupError) {
      process.stderr.write(`[mock] cleanup warning: ${cleanupError.message}\n`);
    }
  });

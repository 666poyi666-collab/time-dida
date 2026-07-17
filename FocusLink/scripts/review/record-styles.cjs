// Captures a burst of frames from each style mock for GIF assembly.
// Usage: node scripts/review/record-styles.cjs <mockDir> [frames] [intervalMs]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..', '..');
const mockDir = path.resolve(
  process.argv[2] || path.join(root, '..', 'visual-review', 'styles-v3'),
);
const FRAMES = Number(process.argv[3] || 26);
const INTERVAL = Number(process.argv[4] || 132);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-styles-'));
let port = 0;

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
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error('Timed out waiting for mock window');
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

  const mocks = process.argv[5]
    ? [process.argv[5]]
    : fs.readdirSync(mockDir).filter((file) => file.endsWith('.html'));
  for (const mock of mocks) {
    const name = mock.replace(/\.html$/, '');
    const framesDir = path.join(mockDir, 'frames', name);
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });
    await send('Page.navigate', { url: pathToFileURL(path.join(mockDir, mock)).href });
    await delay(600);
    await send('Runtime.evaluate', {
      expression: 'document.fonts ? document.fonts.ready.then(() => true) : true',
      awaitPromise: true,
      returnByValue: true,
    });
    await delay(900);
    for (let i = 0; i < FRAMES; i += 1) {
      const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(
        path.join(framesDir, `f${String(i).padStart(3, '0')}.png`),
        Buffer.from(shot.data, 'base64'),
      );
      await delay(INTERVAL);
    }
    process.stderr.write(`[frames] ${name} ×${FRAMES}\n`);
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
    } catch {
      // best effort
    }
  });

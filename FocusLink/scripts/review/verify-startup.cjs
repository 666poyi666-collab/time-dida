// Startup acceptance for packaged FocusLink executables.
// Usage: node scripts/review/verify-startup.cjs <path-to-exe>
// Launches the exe with an isolated user-data-dir, verifies build identity and
// the Linear Workbench shell render, then quits. Exits non-zero on any failure.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const executable = path.resolve(process.argv[2] || '');
if (!fs.existsSync(executable)) {
  process.stderr.write(`Executable not found: ${executable}\n`);
  process.exit(1);
}

const root = path.resolve(__dirname, '..', '..');
const packageVersion = String(
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '',
).trim();
const generated = fs.readFileSync(path.join(root, 'shared', 'version.generated.ts'), 'utf8');
const expectedCommit = /APP_COMMIT\s*=\s*'([^']+)'/.exec(generated)?.[1] || '';

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-startup-'));
let port = 0;
const app = spawn(
  executable,
  [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--hidden'],
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
          (target) =>
            target.type === 'page' &&
            !String(target.url).includes('mini.html') &&
            !String(target.url).startsWith('devtools://'),
        );
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for page: ${lastError?.message || 'unknown'}`);
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
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result?.value;
  };

  await send('Runtime.enable');
  await evaluate('window.focuslink.window.show()');
  await delay(2500);
  const result = await evaluate(`(() => ({
    version: document.documentElement.dataset.appVersion || '',
    commit: document.documentElement.dataset.appCommit || '',
    hasShell: Boolean(document.querySelector('.app-shell')),
    hasRail: Boolean(document.querySelector('.edge-dock')),
    hasNavButton: Boolean(document.querySelector('.edge-dock-button')),
    hasConsole: Boolean(document.querySelector('.focus-console')),
    pauseToken: getComputedStyle(document.documentElement).getPropertyValue('--app-pause').trim(),
  }))()`);

  const failures = [];
  if (result.version !== packageVersion)
    failures.push(`version ${result.version} != ${packageVersion}`);
  if (result.commit !== expectedCommit)
    failures.push(`commit ${result.commit} != ${expectedCommit}`);
  if (!result.hasShell) failures.push('missing .app-shell');
  if (!result.hasRail) failures.push('missing .edge-dock');
  if (!result.hasNavButton) failures.push('missing .edge-dock-button');
  if (!result.hasConsole) failures.push('missing .focus-console');
  if (result.pauseToken !== '210 67 57') failures.push(`pause token ${result.pauseToken}`);

  try {
    await evaluate('window.focuslink.window.quit()');
  } catch {
    // process is killed below if graceful quit fails
  }
  socket.close();

  if (failures.length > 0) throw new Error(`Startup acceptance failed: ${failures.join(', ')}`);
  process.stdout.write(`${JSON.stringify({ executable, ...result }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await delay(400);
    if (!app.killed) app.kill();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    } catch (cleanupError) {
      process.stderr.write(`[startup] cleanup warning: ${cleanupError.message}\n`);
    }
  });

// Packaged Electron regression for the optional live-focus handshake.
//
// This smoke deliberately starts an unpacked/package build with an isolated userData directory,
// enables PC live control, points it at a closed loopback port, and verifies that the first live
// handshake failure does not disable the ordinary local timer. It never attaches to or terminates
// the user's normal FocusLink process.
//
// Usage:
//   node scripts/smoke/live-fallback-packaged-smoke.cjs [path-to-FocusLink.exe]
//
// The encrypted device-sync credential is copied from the current user's profile only. The token
// is never printed or decoded by this script. If the credential cannot be decrypted by Electron's
// safeStorage under the current account, the smoke reports an explicit SKIP and exits successfully.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageVersion = String(packageJson.version || '').trim();
const releaseDirectory = `release-v${packageVersion.replace(/\./g, '')}`;
const defaultExecutableCandidates = [
  path.join(root, '..', releaseDirectory, 'win-unpacked', 'FocusLink.exe'),
  path.join(root, 'dist', 'win-unpacked', 'FocusLink.exe'),
];
const executable = path.resolve(process.argv[2] || defaultExecutableCandidates[0]);
const sourceUserData = resolveSourceUserData();
const sourceCredential = sourceUserData
  ? path.join(sourceUserData, 'focuslink-device-sync-credential.json')
  : null;
const sourceSettings = sourceUserData ? path.join(sourceUserData, 'focuslink-settings.json') : null;

let userDataDir = '';
let appProcess = null;
let socket = null;
let childStdout = '';
let childStderr = '';
let started = false;
let stopped = false;
let commandId = 0;
const pending = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeLine(message) {
  process.stdout.write(`[live-fallback] ${message}\n`);
}

function skip(reason) {
  writeLine(`SKIP: ${reason}`);
  process.exitCode = 0;
}

function resolveSourceUserData() {
  const explicit = String(
    process.env.FOCUSLINK_SOURCE_USER_DATA || process.env.FOCUSLINK_USER_DATA || '',
  ).trim();
  const candidates = explicit
    ? [explicit]
    : [
        path.join(process.env.APPDATA || '', 'focuslink'),
        path.join(process.env.APPDATA || '', 'FocusLink'),
        path.join(process.env.LOCALAPPDATA || '', 'focuslink'),
        path.join(process.env.LOCALAPPDATA || '', 'FocusLink'),
      ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, 'focuslink-device-sync-credential.json'))) {
      return resolved;
    }
  }
  return null;
}

function assertExecutable() {
  if (fs.existsSync(executable)) return;
  const alternatives = defaultExecutableCandidates.filter((candidate) => fs.existsSync(candidate));
  const hint = alternatives.length > 0 ? `; available: ${alternatives.join(', ')}` : '';
  throw new Error(`FocusLink executable not found: ${executable}${hint}`);
}

function readSettings() {
  if (!sourceSettings || !fs.existsSync(sourceSettings)) return {};
  try {
    const raw = fs
      .readFileSync(sourceSettings, 'utf8')
      .replace(/^\uFEFF/, '')
      .trim();
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new Error(
      `current FocusLink settings are unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function makeIsolatedSettings(endpoint) {
  const source = readSettings();
  return {
    ...source,
    autoStart: false,
    startMinimizedToTray: false,
    minimizeToTray: false,
    closeToTray: false,
    showMiniOnStart: false,
    taskSource: 'local',
    tomatodo: {
      ...(source.tomatodo && typeof source.tomatodo === 'object' ? source.tomatodo : {}),
      enabled: false,
      dbPath: '',
      defaultSubject: '学习',
    },
    miniWindow: {
      ...(source.miniWindow && typeof source.miniWindow === 'object' ? source.miniWindow : {}),
      autoShowOnMainHide: false,
      autoShowOnFocusStart: false,
      autoHideOnFocusEnd: false,
      showMiniOnStart: false,
      x: null,
      y: null,
      collapsed: false,
      width: 256,
      height: 70,
    },
    deviceSync: {
      ...(source.deviceSync && typeof source.deviceSync === 'object' ? source.deviceSync : {}),
      enabled: true,
      endpoint,
      // The smoke is about the live handshake, not finished-ledger uploads.
      autoSync: false,
      liveControlEnabled: true,
    },
  };
}

async function reserveClosedLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('could not reserve a loopback port');
  }
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function assertLoopbackClosed(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(`${endpoint}/v1/live`, {
      signal: controller.signal,
      redirect: 'error',
    });
    throw new Error(`loopback endpoint unexpectedly returned HTTP ${response.status}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('loopback endpoint unexpectedly')) {
      throw error;
    }
    // ECONNREFUSED and a bounded abort both prove there is no usable service for this smoke.
  } finally {
    clearTimeout(timeout);
  }
}

function writeIsolatedUserData(endpoint) {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-live-fallback-'));
  const settings = makeIsolatedSettings(endpoint);
  fs.writeFileSync(
    path.join(userDataDir, 'focuslink-settings.json'),
    `${JSON.stringify(settings)}\n`,
    'utf8',
  );
  if (!sourceCredential || !fs.existsSync(sourceCredential)) {
    throw new Error('current user has no encrypted device-sync credential');
  }
  // Copy bytes only; do not read, log, or rewrite the protected token.
  fs.copyFileSync(
    sourceCredential,
    path.join(userDataDir, 'focuslink-device-sync-credential.json'),
  );
  const sourceLocalState = path.join(sourceUserData, 'Local State');
  if (fs.existsSync(sourceLocalState)) {
    // Chromium stores the app-scoped safeStorage wrapping key in Local State. Copy
    // only this metadata file; the smoke never copies the user's SQLite/renderer data.
    fs.copyFileSync(sourceLocalState, path.join(userDataDir, 'Local State'));
  }
}

function discoverPort() {
  if (!userDataDir) return 0;
  const activePortFile = path.join(userDataDir, 'DevToolsActivePort');
  if (!fs.existsSync(activePortFile)) return 0;
  const [rawPort] = fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/);
  const discovered = Number.parseInt(rawPort, 10);
  return Number.isInteger(discovered) && discovered > 0 ? discovered : 0;
}

async function waitForPage() {
  let port = 0;
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      port ||= discoverPort();
      if (!port) throw new Error('DevToolsActivePort is not ready');
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find(
        (target) =>
          target.type === 'page' &&
          !String(target.url).includes('mini.html') &&
          !String(target.url).startsWith('devtools://'),
      );
      if (page?.webSocketDebuggerUrl) return { page, port };
    } catch (error) {
      lastError = error;
    }
    if (appProcess && appProcess.exitCode !== null) break;
    await delay(250);
  }
  const detail = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new Error(`timed out waiting for packaged Electron page: ${detail}`);
}

function attachSocket(connection) {
  connection.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message || 'CDP command failed'));
    else request.resolve(message.result);
  });
}

function send(method, params = {}) {
  const id = ++commandId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    const detail =
      response.exceptionDetails.exception?.description ||
      response.exceptionDetails.text ||
      'renderer evaluation failed';
    throw new Error(detail);
  }
  return response.result?.value;
}

async function waitForRendererApi() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (await evaluate('Boolean(window.focuslink?.timer?.startWithTask)')) return;
    } catch {
      // The document can be present before preload has finished. Keep polling.
    }
    await delay(250);
  }
  throw new Error('window.focuslink.timer API did not become available');
}

function readSmokeLog() {
  const logDir = path.join(userDataDir, 'logs');
  if (!fs.existsSync(logDir)) return '';
  let text = '';
  for (const file of fs.readdirSync(logDir)) {
    if (!file.endsWith('.log')) continue;
    try {
      text += fs.readFileSync(path.join(logDir, file), 'utf8');
    } catch {
      // The logger may still hold the file during a write; the next poll can retry.
    }
  }
  return text;
}

async function waitForHandshakeFailure() {
  const deadline = Date.now() + 6_000;
  let status = null;
  let handshakeObserved = false;
  while (Date.now() < deadline) {
    status = await evaluate('window.focuslink.deviceSync.status()');
    const log = readSmokeLog();
    handshakeObserved =
      log.includes('live connection lost; retry scheduled') || log.includes('无法连接实时同步服务');
    if (handshakeObserved) break;
    await delay(250);
  }
  if (!status || status.liveConnected !== false || status.liveState !== 'disconnected') {
    throw new Error(`unexpected live telemetry before fallback: ${JSON.stringify(status)}`);
  }
  if (!handshakeObserved) {
    throw new Error('the isolated app did not record the expected failed live handshake');
  }
  return status;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function quitPackagedApp() {
  if (socket) {
    try {
      await evaluate('window.focuslink.window.quit()');
    } catch {
      // The renderer may already be gone; process cleanup below is still isolated to appProcess.
    }
  }
  if (socket) {
    try {
      socket.close();
    } catch {
      // Ignore a socket that closed with the renderer.
    }
    socket = null;
  }
  if (!appProcess) return;
  const child = appProcess;
  await new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, 5_000);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.exitCode === null && !child.killed) {
    // This is the exact spawned PID, never a global image-name kill. The normal path above should
    // already have quit cleanly; this guard only prevents a failed smoke from leaking a process.
    child.kill();
  }
  appProcess = null;
}

function removeTempDirectory(target, label) {
  if (!target) return;
  const resolved = path.resolve(target);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.toLowerCase().startsWith(`${tempRoot.toLowerCase()}${path.sep}`)) {
    throw new Error(`refusing to remove ${label} outside the system temp directory: ${resolved}`);
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      if (!fs.existsSync(resolved)) return;
    } catch {
      // Chromium can hold a log handle for a short time after app.quit().
    }
    const waitUntil = Date.now() + 250;
    while (Date.now() < waitUntil) {
      // Synchronous bounded wait keeps cleanup deterministic in this short-lived CLI.
    }
  }
  if (fs.existsSync(resolved)) writeLine(`cleanup warning: ${label} remains at ${resolved}`);
}

async function main() {
  assertExecutable();
  if (!sourceUserData || !sourceCredential || !fs.existsSync(sourceCredential)) {
    skip('current user has no encrypted device-sync credential; configure sync once, then rerun');
    return;
  }
  const port = await reserveClosedLoopbackPort();
  const endpoint = `http://127.0.0.1:${port}`;
  await assertLoopbackClosed(endpoint);
  writeIsolatedUserData(endpoint);

  appProcess = spawn(
    executable,
    [`--remote-debugging-port=0`, `--user-data-dir=${userDataDir}`, '--hidden'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  appProcess.stdout?.on('data', (chunk) => {
    childStdout = `${childStdout}${String(chunk)}`.slice(-8_000);
  });
  appProcess.stderr?.on('data', (chunk) => {
    childStderr = `${childStderr}${String(chunk)}`.slice(-8_000);
  });
  appProcess.once('error', (error) => {
    childStderr = `${childStderr}\n${error.stack || error.message}`.slice(-8_000);
  });

  const target = await waitForPage();
  socket = new WebSocket(target.page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  attachSocket(socket);
  await send('Runtime.enable');
  await waitForRendererApi();

  const configured = await evaluate('window.focuslink.deviceSync.status()');
  if (!configured.tokenConfigured) {
    skip('copied encrypted token could not be read by the packaged app (safeStorage key mismatch)');
    return;
  }
  assert(configured.enabled === true, 'isolated settings did not enable device sync');
  assert(configured.liveControlEnabled === true, 'isolated settings did not enable live control');
  assert(configured.endpoint === endpoint, `isolated endpoint mismatch: ${configured.endpoint}`);

  const before = await waitForHandshakeFailure();
  const startedSnapshot = await evaluate(
    `window.focuslink.timer.startWithTask(${JSON.stringify('packaged-live-fallback-task')}, 'local', ${JSON.stringify('Packaged live fallback')})`,
  );
  assert(
    startedSnapshot?.state === 'running',
    `local fallback did not start: ${JSON.stringify(startedSnapshot)}`,
  );
  assert(
    startedSnapshot.currentTaskId === 'packaged-live-fallback-task',
    `local task association missing: ${JSON.stringify(startedSnapshot)}`,
  );
  assert(
    startedSnapshot.currentTaskSource === 'local',
    `local task source missing: ${JSON.stringify(startedSnapshot)}`,
  );
  started = true;
  await delay(700);
  const runningSnapshot = await evaluate('window.focuslink.timer.getSnapshot()');
  assert(
    runningSnapshot?.state === 'running',
    'local timer stopped unexpectedly after handshake failure',
  );

  const stoppedSnapshot = await evaluate('window.focuslink.timer.stop()');
  assert(
    stoppedSnapshot?.state === 'finished',
    `local timer could not stop: ${JSON.stringify(stoppedSnapshot)}`,
  );
  assert(
    stoppedSnapshot.sessionId === startedSnapshot.sessionId,
    'stop returned a different session than the local fallback start',
  );
  stopped = true;
  writeLine(
    JSON.stringify({
      status: 'passed',
      executable,
      endpoint,
      handshakeObserved: true,
      liveStateBeforeFallback: before.liveState,
      sessionId: startedSnapshot.sessionId,
      startedState: startedSnapshot.state,
      stoppedState: stoppedSnapshot.state,
    }),
  );
}

main()
  .catch((error) => {
    process.stderr.write(`[live-fallback] ${error.stack || error.message}\n`);
    if (childStdout.trim()) process.stderr.write(`[packaged stdout]\n${childStdout.trim()}\n`);
    if (childStderr.trim()) process.stderr.write(`[packaged stderr]\n${childStderr.trim()}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (started && !stopped && socket) {
      try {
        await evaluate('window.focuslink.timer.stop()');
      } catch {
        // Best-effort cleanup; the isolated database is removed below.
      }
    }
    await quitPackagedApp();
    removeTempDirectory(userDataDir, 'packaged smoke userData');
  });

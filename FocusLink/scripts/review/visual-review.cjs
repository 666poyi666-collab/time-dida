// Visual review driver: launches the locally built app (dist/ + dist-electron/)
// with CDP, walks every primary surface in both themes and captures screenshots.
// Usage: node scripts/review/visual-review.cjs [outputDir]
// Requires `npm run build` first. Never touches user data (isolated user-data-dir).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(root, '..');
const outputDir = path.resolve(
  process.argv[2] || path.join(repoRoot, 'visual-review', 'redesign-0116'),
);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-review-'));
let port = 0;

fs.mkdirSync(outputDir, { recursive: true });

const app = spawn(
  process.platform === 'win32'
    ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(root, 'node_modules', '.bin', 'electron'),
  ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--hidden'],
  { cwd: root, stdio: 'ignore', windowsHide: true },
);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function waitForTarget(predicate, label) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
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
        const target = (await listTargets()).find(predicate);
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError?.message || 'not found'}`);
}

class Cdp {
  constructor(target) {
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.commandId = 0;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (!message.id || !this.pending.has(message.id)) return;
      const request = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
  }

  send(method, params = {}) {
    const id = ++this.commandId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return response.result?.value;
  }

  async shot(name) {
    await delay(650);
    const shot = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const file = path.join(outputDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    process.stderr.write(`[review] ${name}\n`);
    return file;
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }
}

async function setTheme(session, theme) {
  await session.evaluate(
    `window.focuslink.settings.set({ theme: ${JSON.stringify(theme)}, accentColor: 'indigo' })`,
  );
  await delay(450);
}

async function goView(session, label) {
  await session.evaluate(
    `document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)})?.click()`,
  );
  await delay(650);
}

async function waitForTimerState(session, expected) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await session.evaluate(
      `document.querySelector('.focus-console')?.dataset.state || null`,
    );
    if (state === expected) return;
    await delay(120);
  }
  throw new Error(`Timer did not reach ${expected}`);
}

async function captureMainStates(session, theme) {
  await goView(session, '专注');
  await session.evaluate(`(async () => {
    const snap = await window.focuslink.timer.getSnapshot();
    if (snap.state !== 'idle') await window.focuslink.timer.reset();
  })()`);
  await waitForTimerState(session, 'idle');
  await session.shot(`${theme}-01-timer-idle`);

  await session.evaluate(`document.querySelector('.timer-context-action')?.click()`);
  await delay(700);
  await session.shot(`${theme}-01b-task-picker`);
  await session.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await delay(300);

  await session.evaluate(`(() => {
    const button = document.querySelector('.timer-controls button');
    if (button && button.textContent.includes('开始专注')) button.click();
  })()`);
  await waitForTimerState(session, 'running');
  await delay(1400);
  await session.shot(`${theme}-02-timer-running`);

  await session.evaluate(`(() => {
    const button = document.querySelector('.timer-controls button');
    if (button && button.textContent.includes('暂停专注')) button.click();
  })()`);
  await waitForTimerState(session, 'paused');
  await session.shot(`${theme}-03-timer-paused`);

  await session.evaluate(`window.focuslink.timer.stop()`);
  await waitForTimerState(session, 'finished');
  await session.shot(`${theme}-04-timer-finished`);
  await session.evaluate(`window.focuslink.timer.reset()`);

  await goView(session, '任务');
  await session.shot(`${theme}-05-tasks`);

  await goView(session, '统计');
  await delay(500);
  await session.shot(`${theme}-06-history`);

  await goView(session, '设置');
  await session.shot(`${theme}-07-settings`);
  await session.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.settings-tab')]
      .find((button) => button.textContent?.includes('体验'));
    if (tab) tab.click();
  })()`);
  await delay(500);
  await session.shot(`${theme}-08-settings-experience`);
}

async function captureMiniStates(main, mini, theme, label) {
  await mini.evaluate(`window.focuslink.mini.expand()`);
  await delay(800);
  // ensure running state driven from main session
  await main.evaluate(`(async () => {
    const snap = await window.focuslink.timer.getSnapshot();
    if (snap.state !== 'running') {
      if (snap.state !== 'idle') await window.focuslink.timer.reset();
      await window.focuslink.timer.toggle();
    }
  })()`);
  await delay(1400);
  await mini.shot(`${label}-mini-running-expanded`);
  await mini.evaluate(`document.querySelector('button[aria-label="收起"]')?.click()`);
  await delay(700);
  await mini.shot(`${label}-mini-running-collapsed`);
  await mini.evaluate(`document.querySelector('button[aria-label="展开"]')?.click()`);
  await delay(700);
  await mini.evaluate(`document.querySelector('.mini-primary-button')?.click()`);
  await delay(600);
  await mini.shot(`${label}-mini-paused-expanded`);
  await mini.evaluate(`document.querySelector('button[aria-label="收起"]')?.click()`);
  await delay(700);
  await mini.shot(`${label}-mini-paused-collapsed`);
  await mini.evaluate(`document.querySelector('button[aria-label="展开"]')?.click()`);
  await main.evaluate(`window.focuslink.timer.stop()`);
  await main.evaluate(`window.focuslink.timer.reset()`);
  await delay(400);
}

async function main() {
  process.stderr.write('[review] waiting for main renderer\n');
  const mainTarget = await waitForTarget(
    (target) =>
      target.type === 'page' &&
      /^https?:/.test(String(target.url)) &&
      !String(target.url).includes('mini.html'),
    'main renderer',
  );
  const session = new Cdp(mainTarget);
  await session.open();
  await session.evaluate('window.focuslink.window.show()');
  await delay(2800);
  await session.evaluate(
    `window.focuslink.settings.set({ theme: 'light', accentColor: 'indigo', taskSource: 'ticktick-cli' })`,
  );
  await delay(400);
  await session.evaluate(
    `document.querySelectorAll('.toast-close').forEach((button) => button.click())`,
  );
  await session.evaluate('window.resizeTo(1320, 840)');
  await delay(600);

  // reduced-motion audit: continuous animations must halt under emulation
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await delay(400);
  const reducedAudit = await session.evaluate(`(() => {
    const name = (el) => (el ? getComputedStyle(el).animationName : null);
    return {
      primary: name(document.querySelector('.ambient-glow-primary')),
      secondary: name(document.querySelector('.ambient-glow-secondary')),
    };
  })()`);
  process.stderr.write(`[review] reduced-motion audit: ${JSON.stringify(reducedAudit)}\n`);
  await session.send('Emulation.setEmulatedMedia', { features: [] });
  await delay(300);

  await setTheme(session, 'light');
  await captureMainStates(session, 'light');
  await setTheme(session, 'dark');
  await captureMainStates(session, 'dark');

  // mini window in both themes
  await session.evaluate(`(async () => {
    const current = await window.focuslink.settings.get();
    return window.focuslink.settings.set({
      theme: 'light',
      miniWindow: { ...current.miniWindow, followMainTheme: true },
    });
  })()`);
  await session.evaluate('window.focuslink.mini.show()');
  const miniTarget = await waitForTarget(
    (target) => target.type === 'page' && String(target.url).includes('mini.html'),
    'mini renderer',
  );
  const mini = new Cdp(miniTarget);
  await mini.open();
  await mini.send('Page.bringToFront');
  await delay(900);
  await captureMiniStates(session, mini, 'light', 'light');
  await setTheme(session, 'dark');
  await delay(600);
  await captureMiniStates(session, mini, 'dark', 'dark');
  mini.close();

  process.stderr.write(`[review] done -> ${outputDir}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      const mainTarget = port
        ? (await listTargets()).find(
            (target) =>
              target.type === 'page' &&
              /^https?:/.test(String(target.url)) &&
              !String(target.url).includes('mini.html'),
          )
        : null;
      if (mainTarget) {
        const session = new Cdp(mainTarget);
        await session.open();
        await session.evaluate('window.focuslink.window.quit()');
        session.close();
      }
    } catch {
      // fall through to kill
    }
    await delay(400);
    if (!app.killed) app.kill();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (cleanupError) {
      process.stderr.write(`[review] cleanup warning: ${cleanupError.message}\n`);
    }
  });

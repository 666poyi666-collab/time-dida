// Visual review driver: launches the locally built app (dist/ + dist-electron/)
// with CDP, walks every primary surface in both themes and captures screenshots.
// Usage: node scripts/review/visual-review.cjs [outputDir] [path-to-packaged-exe]
// Requires `npm run build` first. Never touches user data (isolated user-data-dir).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..', '..');
const outputDir = path.resolve(
  process.argv[2] || path.join(os.tmpdir(), 'focuslink-visual-review'),
);
const packagedExecutable = process.argv[3] ? path.resolve(process.argv[3]) : null;
const ribbonOnly = process.argv.includes('--ribbon-only');
const ribbonTheme = process.argv.includes('--dark') ? 'dark' : 'light';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-review-'));
// Electron does not consistently publish a usable DevToolsActivePort file when
// launched with port 0 on Windows. Use an isolated high loopback port, matching
// the mini-window smoke driver, so renderer discovery cannot stall on an empty
// target while still avoiding the app's normal ports.
let port = 9200 + Math.floor(Math.random() * 600);

fs.mkdirSync(outputDir, { recursive: true });

const app = spawn(
  packagedExecutable ||
    (process.platform === 'win32'
      ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
      : path.join(root, 'node_modules', '.bin', 'electron')),
  [
    ...(packagedExecutable ? [] : ['.']),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--hidden',
  ],
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
  const diagnostics = await session.evaluate(`(() => ({
    state: document.querySelector('.focus-console')?.dataset.state || null,
    activeView:
      document.querySelector('.edge-dock-button.active')?.getAttribute('aria-label') || null,
    bodyText: document.body.innerText.slice(0, 180),
  }))()`);
  throw new Error(`Timer did not reach ${expected}: ${JSON.stringify(diagnostics)}`);
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
    document.querySelector('.timer-controls .btn-main-action')?.click();
  })()`);
  await waitForTimerState(session, 'running');
  await delay(1400);
  await session.shot(`${theme}-02-timer-running`);

  await session.evaluate(`(() => {
    document.querySelector('.timer-controls .btn-main-action')?.click();
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
  await session.evaluate(`(() => {
    const button = [...document.querySelectorAll('.history-filter-row button')]
      .find((item) => item.textContent?.trim() === '近 7 天');
    button?.click();
  })()`);
  await delay(500);
  await session.shot(`${theme}-06b-history-7d`);

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

async function inspectRibbonFrame(session) {
  return session.evaluate(`new Promise((resolve) => {
    const canvas = document.querySelector('.ribbon-canvas');
    const ribbon = document.querySelector('.temporal-ribbon');
    if (!canvas) {
      resolve({ present: false, changed: false });
      return;
    }
    const before = canvas.toDataURL();
    window.setTimeout(() => {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const pixelRatio = Math.max(
        1,
        Number.parseFloat(canvas.dataset.pixelRatio || '') || canvas.width / canvas.clientWidth || 1,
      );
      const pointerX = Math.round(canvas.width * 0.62);
      const pointerExclusion = Math.max(2, Math.round(pixelRatio * 3));
      let greenMaterialPixels = 0;
      let redParticlePixels = 0;
      let redPixels = 0;
      let maxGreenHorizontalRun = 0;
      let maxRedHorizontalRun = 0;
      let greenMinX = canvas.width;
      let greenMaxX = -1;
      let redMinX = canvas.width;
      let redMaxX = -1;
      const redParticleMask = new Uint8Array(canvas.width * canvas.height);
      for (let y = 0; y < canvas.height; y += 1) {
        let redRun = 0;
        let greenRun = 0;
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const alpha = pixels[offset + 3];
          // Use channel separation instead of a light-theme-only absolute colour. This
          // keeps the audit valid for both review themes and still ignores neutral rails.
          const isRed = alpha > 40 && red > 55 && red - green > 22 && red - blue > 18;
          const isGreen =
            alpha > 40 && green > 45 && green - red > 18 && green - blue > 10;
          if (isRed) {
            redPixels += 1;
            // The paused state pointer itself is red. Exclude its narrow vertical
            // stroke so this metric measures the particles shed by the frontier.
            if (Math.abs(x - pointerX) > pointerExclusion) {
              redParticlePixels += 1;
              redParticleMask[y * canvas.width + x] = 1;
              redRun += 1;
              redMinX = Math.min(redMinX, x);
              redMaxX = Math.max(redMaxX, x);
              maxRedHorizontalRun = Math.max(maxRedHorizontalRun, redRun);
            } else {
              redRun = 0;
            }
          } else {
            redRun = 0;
          }
          if (isGreen && x < pointerX - pointerExclusion) {
            greenMaterialPixels += 1;
            greenMinX = Math.min(greenMinX, x);
            greenMaxX = Math.max(greenMaxX, x);
            greenRun += 1;
            maxGreenHorizontalRun = Math.max(maxGreenHorizontalRun, greenRun);
          } else {
            greenRun = 0;
          }
        }
      }

      // Count visible red islands as a black-box approximation of live particles.
      // A minimum area rejects isolated antialiasing pixels around the pointer.
      const visited = new Uint8Array(redParticleMask.length);
      const minimumComponentArea = Math.max(2, Math.round(pixelRatio * pixelRatio * 0.45));
      let redParticleComponents = 0;
      for (let start = 0; start < redParticleMask.length; start += 1) {
        if (!redParticleMask[start] || visited[start]) continue;
        const stack = [start];
        visited[start] = 1;
        let area = 0;
        while (stack.length > 0) {
          const current = stack.pop();
          area += 1;
          const x = current % canvas.width;
          const y = Math.floor(current / canvas.width);
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            const nextY = y + offsetY;
            if (nextY < 0 || nextY >= canvas.height) continue;
            for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
              if (offsetX === 0 && offsetY === 0) continue;
              const nextX = x + offsetX;
              if (nextX < 0 || nextX >= canvas.width) continue;
              const next = nextY * canvas.width + nextX;
              if (redParticleMask[next] && !visited[next]) {
                visited[next] = 1;
                stack.push(next);
              }
            }
          }
        }
        if (area >= minimumComponentArea) redParticleComponents += 1;
      }

      const greenMaterialSpan =
        greenMaxX >= greenMinX ? (greenMaxX - greenMinX + 1) / pixelRatio : 0;
      const redParticleSpan =
        redMaxX >= redMinX ? (redMaxX - redMinX + 1) / pixelRatio : 0;
      const redParticleDistanceFromPointer =
        redMaxX >= redMinX
          ? Math.max(Math.abs(pointerX - redMinX), Math.abs(redMaxX - pointerX)) / pixelRatio
          : 0;
      resolve({
        present: true,
        changed: before !== canvas.toDataURL(),
        motion: ribbon?.dataset.motion || null,
        scale: ribbon?.dataset.scale || null,
        dissolve: ribbon?.dataset.dissolve || null,
        width: canvas.width,
        height: canvas.height,
        pixelRatio,
        pointerX: pointerX / pixelRatio,
        greenMaterialPixels,
        greenMaterialSpan,
        maxGreenHorizontalRun: maxGreenHorizontalRun / pixelRatio,
        redParticlePixels,
        redParticleComponents,
        redParticleSpan,
        redParticleDistanceFromPointer,
        redPixels,
        maxRedHorizontalRun: maxRedHorizontalRun / pixelRatio,
      });
    }, 240);
  })`);
}

async function captureRibbonStates(session) {
  await goView(session, '专注');
  await session.evaluate(`(async () => {
    const snap = await window.focuslink.timer.getSnapshot();
    if (snap.state !== 'idle') await window.focuslink.timer.reset();
  })()`);
  await waitForTimerState(session, 'idle');
  await session.evaluate(`document.querySelector('.timer-controls .btn-main-action')?.click()`);
  await waitForTimerState(session, 'running');
  await delay(12_000);
  const running = await inspectRibbonFrame(session);
  await session.shot('ribbon-running-near');

  await session.evaluate(`document.querySelector('.timer-controls .btn-main-action')?.click()`);
  await waitForTimerState(session, 'paused');
  const pauseStartedAt = Date.now();
  // Pause is a real wall-clock interval. Compare an early and late frame to prove
  // that the particle trace grows across that interval instead of looping locally.
  await delay(3_000);
  const pausedEarly = await inspectRibbonFrame(session);
  await session.shot('ribbon-paused-early-near');
  await delay(Math.max(0, 25_000 - (Date.now() - pauseStartedAt)));
  const pausedLate = await inspectRibbonFrame(session);
  await session.shot('ribbon-paused-late-near');

  const resumeClickedAt = Date.now();
  await session.evaluate(`document.querySelector('.timer-controls .btn-main-action')?.click()`);
  await waitForTimerState(session, 'running');
  await delay(Math.max(0, 2_200 - (Date.now() - resumeClickedAt)));
  const resumed = await inspectRibbonFrame(session);
  await session.shot('ribbon-resumed-settled');

  // A high-density particle body can form short accidental pixel joins. Keep the
  // ceiling well below one second (8px) times five while still rejecting a drawn line.
  const maximumRedHorizontalRun = 36;
  const minimumEarlyTraceSpan = 14;
  const minimumTraceGrowth = 120;
  const checks = [
    [running.present && running.changed, 'running material remains alive between frames'],
    [running.motion === 'continuous-material', 'running ribbon declares continuous material'],
    [running.greenMaterialPixels > 600, 'running near view contains a dense green particle body'],
    [running.greenMaterialSpan > 70, 'green particles visibly record the full focused interval'],
    [pausedEarly.present && pausedEarly.changed, 'early pause loss particles move between frames'],
    [pausedLate.present && pausedLate.changed, 'late pause loss particles move between frames'],
    [pausedEarly.scale === 'seconds' && pausedLate.scale === 'seconds', 'pause stays in near view'],
    [
      pausedEarly.motion === 'pause-dissolve' && pausedLate.motion === 'pause-dissolve',
      'paused ribbon declares pause dissolve motion',
    ],
    [
      pausedEarly.dissolve === 'interval-trace' && pausedLate.dissolve === 'interval-trace',
      'paused ribbon declares a wall-clock particle interval trace',
    ],
    [
      pausedEarly.redParticleSpan > minimumEarlyTraceSpan &&
        pausedEarly.redParticlePixels > 100 &&
        pausedEarly.redParticleComponents > 8,
      'early pause already forms a dense readable particle time body',
    ],
    [
      pausedLate.redParticleSpan > pausedEarly.redParticleSpan + minimumTraceGrowth,
      'red particle trace grows with the real paused interval',
    ],
    [
      pausedLate.redParticlePixels > pausedEarly.redParticlePixels * 2,
      'longer pause contains proportionally more visible trace particles',
    ],
    [
      pausedEarly.maxRedHorizontalRun < maximumRedHorizontalRun &&
        pausedLate.maxRedHorizontalRun < maximumRedHorizontalRun,
      'pause loss contains no persistent horizontal red segment',
    ],
    [
      resumed.greenMaterialPixels > pausedLate.greenMaterialPixels,
      'resuming creates a new green focus interval after the pause trace',
    ],
    [resumed.motion === 'continuous-material', 'resumed ribbon returns to continuous material'],
    [resumed.dissolve === 'none', 'resumed ribbon leaves active pause-trace semantics'],
    [
      resumed.redParticlePixels > 100 &&
        Math.abs(resumed.redParticleSpan - pausedLate.redParticleSpan) < 12,
      'completed pause remains readable as a historical particle interval',
    ],
  ];
  const failures = checks.filter(([ok]) => !ok).map(([, label]) => label);
  process.stderr.write(
    `[review] ribbon audit: ${JSON.stringify({
      running,
      pausedEarly,
      pausedLate,
      resumed,
      maximumRedHorizontalRun,
      minimumEarlyTraceSpan,
      minimumTraceGrowth,
    })}\n`,
  );
  if (failures.length > 0) throw new Error(`Ribbon review failed: ${failures.join('; ')}`);
  await session.evaluate(`window.focuslink.timer.stop()`);
}

async function main() {
  process.stderr.write('[review] waiting for main renderer\n');
  const mainTarget = await waitForTarget(
    (target) =>
      target.type === 'page' &&
      /^(https?|file):/.test(String(target.url)) &&
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

  if (ribbonOnly) {
    await setTheme(session, ribbonTheme);
    await captureRibbonStates(session);
    process.stderr.write(`[review] ribbon-only done -> ${outputDir}\n`);
    return;
  }

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
              /^(https?|file):/.test(String(target.url)) &&
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

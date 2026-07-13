const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..', '..');
const packageVersion = String(
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '',
).trim();
const generatedVersion = fs.readFileSync(path.join(root, 'shared', 'version.generated.ts'), 'utf8');
const generatedCommitMatch = /APP_COMMIT\s*=\s*'([^']+)'/.exec(generatedVersion);
const expectedCommit = generatedCommitMatch?.[1] || '';
const executable = path.resolve(
  process.argv[2] || path.join(root, '..', 'release-v0110', 'win-unpacked', 'FocusLink.exe'),
);
const outputDir = path.resolve(
  process.argv[3] || path.join(os.tmpdir(), `focuslink-ui-states-${Date.now()}`),
);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-ui-smoke-'));
const port = 9400 + Math.floor(Math.random() * 400);

if (!fs.existsSync(executable)) {
  throw new Error(`FocusLink executable not found: ${executable}`);
}
if (!packageVersion || !expectedCommit || expectedCommit.endsWith('-dirty')) {
  throw new Error('Smoke requires concrete, clean package and generated commit metadata');
}
fs.mkdirSync(outputDir, { recursive: true });

const app = spawn(
  executable,
  [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--hidden'],
  { stdio: 'ignore', windowsHide: true },
);

let socket;
let commandId = 0;
const pending = new Map();
const ACCENT_COLORS = ['indigo', 'violet', 'emerald', 'rose', 'amber', 'sky'];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPage() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find(
        (target) => target.type === 'page' && !String(target.url).includes('mini.html'),
      );
      if (page?.webSocketDebuggerUrl) return page;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for Electron page: ${lastError?.message || 'unknown error'}`);
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
    throw new Error(response.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return response.result?.value;
}

async function inspectState(expectedState) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await evaluate(`(() => {
      const consoleElement = document.querySelector('.focus-console');
      const workspace = document.querySelector('.session-workspace');
      const primary = document.querySelector('.timer-controls button');
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        state: consoleElement?.dataset.state || null,
        pauseToken: rootStyle.getPropertyValue('--app-pause').trim(),
        successToken: rootStyle.getPropertyValue('--app-success').trim(),
        workspaceClass: workspace?.className || null,
        workspaceBorder: workspace ? getComputedStyle(workspace).borderColor : null,
        workspaceShadow: workspace ? getComputedStyle(workspace).boxShadow : null,
        primaryBackground: primary ? getComputedStyle(primary).backgroundImage + ' ' + getComputedStyle(primary).backgroundColor : null,
        primaryText: primary?.textContent?.trim() || null,
        viewport: [window.innerWidth, window.innerHeight],
        bodyScroll: [document.body.scrollWidth, document.body.scrollHeight],
      };
    })()`);
    if (result.state === expectedState) return result;
    await delay(100);
  }
  throw new Error(`Renderer did not reach ${expectedState}`);
}

async function capture(name, expectedState) {
  await inspectState(expectedState);
  await send('Page.bringToFront');
  await delay(700);
  const state = await inspectState(expectedState);
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(outputDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return { ...state, screenshot: file };
}

async function captureScreen(name) {
  await send('Page.bringToFront');
  await delay(1000);
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(outputDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

async function waitForAnyText(labels, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = await evaluate(`(() => {
      const text = document.body.innerText;
      return ${JSON.stringify(labels)}.some((label) => text.includes(label));
    })()`);
    if (found) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for UI text: ${labels.join(' / ')}`);
}

async function waitForSelector(selector, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (found) return;
    await delay(100);
  }
  const diagnostics = await evaluate(`(() => ({
    appClass: document.querySelector('.app-shell')?.className || null,
    activeNav: document.querySelector('.global-nav-button.active')?.textContent?.trim() || null,
    hasBrand: Boolean(document.querySelector('.global-brand')),
    bodyText: document.body.innerText.slice(0, 180)
  }))()`);
  throw new Error(
    `Timed out waiting for selector: ${selector}; diagnostics=${JSON.stringify(diagnostics)}`,
  );
}

async function main() {
  process.stderr.write('[ui-smoke] waiting for renderer\n');
  const page = await waitForPage();
  socket = new WebSocket(page.webSocketDebuggerUrl);
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

  await send('Page.enable');
  await send('Runtime.enable');
  await evaluate('window.focuslink.window.show()');
  await send('Page.bringToFront');
  await delay(3000);
  await evaluate("window.focuslink.settings.set({ theme: 'light', taskSource: 'ticktick-cli' })");
  await delay(400);
  await evaluate("document.querySelectorAll('.toast-close').forEach((button) => button.click())");
  await delay(250);
  const results = {
    buildIdentity: await evaluate(`(() => ({
      version: document.documentElement.dataset.appVersion || '',
      commit: document.documentElement.dataset.appCommit || ''
    }))()`),
  };
  process.stderr.write('[ui-smoke] capture idle\n');
  results.idle = await capture('idle', 'idle');
  process.stderr.write('[ui-smoke] verify all accent action contrasts\n');
  results.actionContrast = {};
  for (const theme of ['light', 'dark']) {
    results.actionContrast[theme] = {};
    for (const accentColor of ACCENT_COLORS) {
      await evaluate(`window.focuslink.settings.set(${JSON.stringify({ theme, accentColor })})`);
      await delay(90);
      const contrast = await evaluate(`(() => {
        const style = getComputedStyle(document.documentElement);
        const parse = (name) => style.getPropertyValue(name).trim().split(/\\s+/).map(Number);
        const luminance = (rgb) => {
          const linear = rgb.map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        };
        const ratio = (left, right) => {
          const a = luminance(left);
          const b = luminance(right);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const foreground = parse('--app-accent-fg');
        const start = parse(${JSON.stringify(theme === 'dark' ? '--app-accent' : '--app-accent-hover')});
        const end = parse(${JSON.stringify(theme === 'dark' ? '--app-accent-companion' : '--app-accent')});
        return {
          start: Number(ratio(foreground, start).toFixed(2)),
          end: Number(ratio(foreground, end).toFixed(2)),
        };
      })()`);
      if (Math.min(contrast.start, contrast.end) < 4.5) {
        throw new Error(
          `${theme}/${accentColor} action contrast is below 4.5: ${JSON.stringify(contrast)}`,
        );
      }
      results.actionContrast[theme][accentColor] = contrast;
    }
  }
  await evaluate("window.focuslink.settings.set({ theme: 'light', accentColor: 'indigo' })");
  await delay(180);
  await evaluate("document.querySelector('.timer-context-action')?.click()");
  await waitForAnyText(['点击任务即可关联', '暂无可用任务', '滴答清单']);
  results.taskPicker = await captureScreen('task-picker');
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await delay(250);
  await evaluate('document.querySelector(\'button[aria-label="任务"]\')?.click()');
  await waitForAnyText(['待完成', '滴答清单']);
  await delay(1200);
  await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.task-view-list button')];
    buttons.find((button) => button.textContent.includes('已完成'))?.click();
  })()`);
  await waitForAnyText(['最近 90 天', '这个范围内没有完成记录']);
  await delay(1200);
  results.tasksLight = await captureScreen('tasks-light');
  results.taskLightInspection = await evaluate(`(() => {
    const shell = document.querySelector('.task-workspace-shell');
    const rows = [...document.querySelectorAll('.task-completed-row, .task-workbench-row')];
    const shellStyle = shell ? getComputedStyle(shell) : null;
    return {
      theme: document.documentElement.classList.contains('light') ? 'light' : 'dark',
      rowCount: rows.length,
      completedCount: document.querySelectorAll('.task-completed-row').length,
      completedView: Boolean([...document.querySelectorAll('.task-view-list button')]
        .find((button) => button.classList.contains('active') && button.textContent.includes('已完成'))),
      hasSourceSelector: Boolean(document.querySelector('.task-source-rail, .picker-source-button')),
      shellBackdrop: shellStyle?.backdropFilter || shellStyle?.webkitBackdropFilter || 'none',
      viewport: [window.innerWidth, window.innerHeight],
      bodyScroll: [document.body.scrollWidth, document.body.scrollHeight],
      shellRect: shell ? [shell.getBoundingClientRect().width, shell.getBoundingClientRect().height] : null,
    };
  })()`);
  await evaluate("window.focuslink.settings.set({ theme: 'dark' })");
  await delay(450);
  results.tasksDark = await captureScreen('tasks-dark');
  await evaluate("window.focuslink.settings.set({ theme: 'light' })");
  const navigationClick = await evaluate(`(() => {
    const target = [...document.querySelectorAll('.global-nav-button')]
      .find((button) => button.textContent?.trim() === '专注');
    if (!target) return { clicked: false };
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { clicked: true, label: target.textContent?.trim() };
  })()`);
  if (!navigationClick.clicked) throw new Error('Focus navigation button was not found');
  await waitForSelector('.focus-console');
  await evaluate(`(async () => {
    const before = await window.focuslink.timer.getSnapshot();
    if (before.state !== 'idle') await window.focuslink.timer.reset();
    return window.focuslink.timer.toggle();
  })()`);
  await delay(900);
  process.stderr.write('[ui-smoke] capture running\n');
  results.running = await capture('running', 'running');
  await evaluate('window.focuslink.timer.toggle()');
  await delay(500);
  process.stderr.write('[ui-smoke] capture paused\n');
  results.paused = await capture('paused', 'paused');
  await evaluate('window.focuslink.timer.stop()');
  await delay(250);
  await evaluate('document.querySelector(\'button[aria-label="统计"]\')?.click()');
  await waitForAnyText(['时间筛选', '还没有专注记录', '加载失败']);
  results.history = await captureScreen('history');
  await evaluate('document.querySelector(\'button[aria-label="设置"]\')?.click()');
  await waitForAnyText(['滴答连接']);
  results.settingsLight = await captureScreen('settings-light');
  await evaluate("window.focuslink.settings.set({ theme: 'dark' })");
  await delay(400);
  results.settingsDark = await captureScreen('settings-dark');

  const assertions = [
    [results.buildIdentity.version === packageVersion, 'packaged version matches package.json'],
    [results.buildIdentity.commit === expectedCommit, 'packaged commit matches generated metadata'],
    [results.running.workspaceClass.includes('state-running'), 'running workspace state class'],
    [results.running.primaryText === '暂停', 'running primary action'],
    [results.paused.workspaceClass.includes('state-paused'), 'paused workspace state class'],
    [results.paused.primaryText === '继续', 'paused primary action'],
    [results.idle.primaryBackground.includes('78, 78, 178'), 'idle primary uses brand accent'],
    [results.paused.primaryBackground.includes('78, 78, 178'), 'resume uses brand accent'],
    [results.running.successToken === '19 132 89', 'focus green token'],
    [results.paused.pauseToken === '194 75 91', 'pause red token'],
    [results.idle.bodyScroll[0] === results.idle.viewport[0], 'no horizontal overflow'],
    [results.idle.bodyScroll[1] === results.idle.viewport[1], 'no vertical overflow'],
    [results.taskLightInspection.theme === 'light', 'task workspace light theme'],
    [results.taskLightInspection.completedView, 'task completed view'],
    [!results.taskLightInspection.hasSourceSelector, 'task provider is not exposed as a source'],
    [results.taskLightInspection.shellBackdrop === 'none', 'task workspace has no backdrop filter'],
    [
      results.taskLightInspection.bodyScroll[0] === results.taskLightInspection.viewport[0],
      'task workspace no horizontal overflow',
    ],
    [
      results.taskLightInspection.bodyScroll[1] === results.taskLightInspection.viewport[1],
      'task workspace no vertical overflow',
    ],
  ];
  const failed = assertions.filter(([passed]) => !passed).map(([, label]) => label);
  if (failed.length > 0) throw new Error(`UI state assertions failed: ${failed.join(', ')}`);

  fs.writeFileSync(path.join(outputDir, 'states.json'), JSON.stringify(results, null, 2));
  process.stdout.write(`${JSON.stringify({ outputDir, results }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (socket?.readyState === WebSocket.OPEN) {
        await evaluate('window.focuslink.window.quit()');
        socket.close();
      }
    } catch {
      // The process is terminated below if graceful quit is unavailable.
    }
    await delay(300);
    if (!app.killed) app.kill();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

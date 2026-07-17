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
const generatedVersion = fs.readFileSync(path.join(root, 'shared', 'version.generated.ts'), 'utf8');
const generatedCommitMatch = /APP_COMMIT\s*=\s*'([^']+)'/.exec(generatedVersion);
const expectedCommit = generatedCommitMatch?.[1] || '';
const executable = path.resolve(
  process.argv[2] || path.join(root, '..', releaseDirectory, 'win-unpacked', 'FocusLink.exe'),
);
const outputDir = path.resolve(
  process.argv[3] || path.join(os.tmpdir(), `focuslink-ui-states-${Date.now()}`),
);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-ui-smoke-'));
let port = 0;

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
          const discoveredPort = Number.parseInt(rawPort, 10);
          if (Number.isInteger(discoveredPort) && discoveredPort > 0) {
            port = discoveredPort;
          }
        }
      }
      if (!port) throw new Error('DevToolsActivePort is not ready');
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

function attachMessageHandler(connection) {
  connection.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
}

function sendTo(connection, method, params = {}) {
  const id = ++commandId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    connection.send(JSON.stringify({ id, method, params }));
  });
}

function send(method, params = {}) {
  return sendTo(socket, method, params);
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
      const status = document.querySelector('.status-chip');
      const stateMoment = document.querySelector('.timer-state-time');
      const activity = document.querySelector('.timer-activity-rail > i');
      const ambient = document.querySelector('.ambient-field');
      const ambientCanvas = document.querySelector('.ambient-canvas');
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
        primaryTime: document.querySelector('.timer-primary')?.textContent?.trim() || null,
        statusText: status?.textContent?.trim() || null,
        stateMomentText: stateMoment?.textContent?.trim() || null,
        activityAnimation: activity ? getComputedStyle(activity).animationName : null,
        themeFamily: document.documentElement.dataset.themeFamily || null,
        ambientRenderer: ambient?.dataset.renderer || null,
        ambientCanvasSize: ambientCanvas ? [ambientCanvas.width, ambientCanvas.height] : null,
        ambientFallbackGlows: document.querySelectorAll('.ambient-glow').length,
        ledgerVisible: Boolean(document.querySelector('.session-ledger-pane')),
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

async function inspectMainWindowSize(width, height) {
  await evaluate(`window.resizeTo(${width}, ${height})`);
  await delay(400);
  const layout = await evaluate(`(() => ({
    outer: [window.outerWidth, window.outerHeight],
    viewport: [window.innerWidth, window.innerHeight],
    bodyScroll: [document.body.scrollWidth, document.body.scrollHeight],
  }))()`);
  return {
    requested: [width, height],
    ...layout,
  };
}

async function inspectToggle(selector) {
  return evaluate(`(() => {
    const toggle = document.querySelector(${JSON.stringify(selector)});
    if (!toggle) return null;
    const style = getComputedStyle(toggle);
    const thumb = toggle.querySelector('.toggle-thumb');
    return {
      role: toggle.getAttribute('role'),
      ariaChecked: toggle.getAttribute('aria-checked'),
      ariaLabel: toggle.getAttribute('aria-label'),
      checkedClass: toggle.classList.contains('checked'),
      size: [Math.round(toggle.getBoundingClientRect().width), Math.round(toggle.getBoundingClientRect().height)],
      borderWidth: style.borderTopWidth,
      borderColor: style.borderTopColor,
      backgroundColor: style.backgroundColor,
      thumbTransform: thumb ? getComputedStyle(thumb).transform : null,
    };
  })()`);
}

async function main() {
  process.stderr.write('[ui-smoke] waiting for renderer\n');
  const page = await waitForPage();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  attachMessageHandler(socket);

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
  const originalWindowSize = await evaluate('[window.outerWidth, window.outerHeight]');
  results.windowSizes = {
    large: await inspectMainWindowSize(1280, 720),
    minimum: await inspectMainWindowSize(980, 660),
  };
  await evaluate(`window.resizeTo(${originalWindowSize[0]}, ${originalWindowSize[1]})`);
  await delay(400);
  process.stderr.write('[ui-smoke] capture idle\n');
  results.idle = await capture('idle', 'idle');
  process.stderr.write('[ui-smoke] verify accent action contrasts\n');
  // 时间仪器主题为单一 accent 体系：不再逐 accentColor 循环，只验证真实操作面
  // （accent / accent-hover 上的 accent-fg 文字对比度）。
  results.actionContrast = {};
  for (const theme of ['light', 'dark']) {
    await evaluate(`window.focuslink.settings.set(${JSON.stringify({ theme })})`);
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
      return {
        accent: Number(ratio(foreground, parse('--app-accent')).toFixed(2)),
        hover: Number(ratio(foreground, parse('--app-accent-hover')).toFixed(2)),
      };
    })()`);
    if (Math.min(contrast.accent, contrast.hover) < 4.5) {
      throw new Error(`${theme} action contrast is below 4.5: ${JSON.stringify(contrast)}`);
    }
    results.actionContrast[theme] = contrast;
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
    return true;
  })()`);
  await inspectState('idle');
  results.focusActionStates = {};
  results.focusActionStates.focus = await evaluate(`(() => {
    document.documentElement.classList.add('kb-nav');
    const button = document.querySelector('.timer-btn-main');
    const stop = document.querySelector('.timer-btn-stop');
    if (!button || !stop) return null;
    button.focus();
    const style = getComputedStyle(button);
    return {
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      stopDisabled: stop.disabled,
      stopOpacity: getComputedStyle(stop).opacity,
    };
  })()`);
  const startRect = await evaluate(`(() => {
    const button = document.querySelector('.timer-btn-main');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!startRect) throw new Error('Start focus button was not found');
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: startRect.x,
    y: startRect.y,
  });
  await delay(180);
  results.focusActionStates.hover = await evaluate(`(() => {
    const style = getComputedStyle(document.querySelector('.timer-btn-main'));
    return { background: style.backgroundColor, transform: style.transform, shadow: style.boxShadow };
  })()`);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: startRect.x,
    y: startRect.y,
    button: 'left',
    clickCount: 1,
  });
  await delay(150);
  results.focusActionStates.active = await evaluate(`(() => {
    const style = getComputedStyle(document.querySelector('.timer-btn-main'));
    return { background: style.backgroundColor, transform: style.transform };
  })()`);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: startRect.x,
    y: startRect.y,
    button: 'left',
    clickCount: 1,
  });
  await delay(900);
  process.stderr.write('[ui-smoke] capture running\n');
  results.running = await capture('running', 'running');
  const pauseClicked = await evaluate(`(() => {
    const button = document.querySelector('.timer-controls button');
    if (!button || !button.textContent.includes('暂停专注')) return false;
    button.click();
    return true;
  })()`);
  if (!pauseClicked) throw new Error('Pause focus button was not clickable');
  await delay(500);
  process.stderr.write('[ui-smoke] capture paused\n');
  results.paused = await capture('paused', 'paused');
  await evaluate('window.focuslink.timer.stop()');
  await delay(250);
  await evaluate('document.querySelector(\'button[aria-label="统计"]\')?.click()');
  await waitForAnyText(['时间范围', '当前时间范围没有专注记录', '加载失败']);
  await delay(650);
  results.history = await captureScreen('history');
  results.historyInspection = await evaluate(`(() => ({
    cards: document.querySelectorAll('.history-insight-card').length,
    hasRing: Boolean(document.querySelector('.history-focus-ring')),
    hasUnifiedCanvas: Boolean(document.querySelector('.history-visual-header')),
    hasCombinationChart: Boolean(document.querySelector('.history-chart-trend')) &&
      Boolean(document.querySelector('.history-chart-area')),
    columns: document.querySelectorAll('.history-column').length,
    ranks: document.querySelectorAll('.history-rank-row').length,
    hasDayNavigator: Boolean(document.querySelector('.history-day-navigator')),
    activeRange: [...document.querySelectorAll('.history-filter-row button')]
      .find((button) => button.classList.contains('bg-accent'))?.textContent?.trim() || null,
    nextDayDisabled: Boolean(document.querySelector('.history-day-navigator > button:last-child')?.disabled),
    cardBorders: [...document.querySelectorAll('.history-insight-card')]
      .map((card) => getComputedStyle(card).borderTopWidth),
  }))()`);
  results.historyTodayLabel = await evaluate(
    `document.querySelector('.history-day-current strong')?.textContent?.trim() || null`,
  );
  await evaluate(`document.querySelector('.history-day-navigator > button:first-child')?.click()`);
  await delay(220);
  results.historyPreviousDay = await evaluate(`(() => ({
    label: document.querySelector('.history-day-current strong')?.textContent?.trim() || null,
    nextDisabled: Boolean(document.querySelector('.history-day-navigator > button:last-child')?.disabled),
  }))()`);
  await evaluate(`document.querySelector('.history-day-navigator > button:last-child')?.click()`);
  await delay(220);
  results.historyReturnedToday = await evaluate(`(() => ({
    label: document.querySelector('.history-day-current strong')?.textContent?.trim() || null,
    nextDisabled: Boolean(document.querySelector('.history-day-navigator > button:last-child')?.disabled),
  }))()`);
  results.historyRanges = {};
  for (const label of ['近 7 天', '半个月', '1 个月']) {
    const clicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll('.history-filter-row button')]
        .find((item) => item.textContent?.trim() === ${JSON.stringify(label)});
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`History range button was not found: ${label}`);
    await delay(260);
    results.historyRanges[label] = await evaluate(`(() => ({
      activeRange: [...document.querySelectorAll('.history-filter-row button')]
        .find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent?.trim() || null,
      hasDayNavigator: Boolean(document.querySelector('.history-day-navigator')),
      columns: document.querySelectorAll('.history-column').length,
    }))()`);
  }
  const singleDayClicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.history-filter-row button')]
      .find((item) => item.textContent?.trim() === '单日');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!singleDayClicked) throw new Error('Single-day history range button was not found');
  await delay(260);
  results.historyReturnedSingleDay = await evaluate(`(() => ({
    activeRange: [...document.querySelectorAll('.history-filter-row button')]
      .find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent?.trim() || null,
    label: document.querySelector('.history-day-current strong')?.textContent?.trim() || null,
    nextDisabled: Boolean(document.querySelector('.history-day-navigator > button:last-child')?.disabled),
    columns: document.querySelectorAll('.history-column').length,
  }))()`);
  await evaluate('document.querySelector(\'button[aria-label="设置"]\')?.click()');
  await waitForAnyText(['滴答连接']);
  results.settingsLight = await captureScreen('settings-light');
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('.settings-tab')]
      .find((button) => button.textContent?.includes('体验'));
    if (!tab) throw new Error('Experience settings tab was not found');
    tab.click();
  })()`);
  await waitForAnyText(['字体气质']);
  const toggleSelector = '.toggle-track[aria-label^="跟随主界面主题："]';
  results.toggleInspection = {
    before: await inspectToggle(toggleSelector),
  };
  const toggleClicked = await evaluate(`(() => {
    const toggle = document.querySelector(${JSON.stringify(toggleSelector)});
    if (!toggle) return false;
    toggle.click();
    return true;
  })()`);
  if (!toggleClicked) throw new Error('Theme-following settings toggle was not clickable');
  await delay(280);
  results.toggleInspection.after = await inspectToggle(toggleSelector);
  await evaluate(`document.querySelector(${JSON.stringify(toggleSelector)})?.click()`);
  await delay(280);
  results.toggleInspection.restored = await inspectToggle(toggleSelector);
  await evaluate("window.focuslink.settings.set({ fontProfile: 'manrope' })");
  await delay(250);
  results.settingsFontManrope = await captureScreen('settings-font-manrope');
  results.manropeFont = await evaluate(`(() => {
    const body = getComputedStyle(document.body);
    const preview = getComputedStyle(document.querySelector('.font-preview-manrope .settings-font-sample'));
    return { family: body.fontFamily, weight: body.fontWeight, tracking: body.letterSpacing,
      previewFamily: preview.fontFamily, previewTracking: preview.letterSpacing };
  })()`);
  await evaluate("window.focuslink.settings.set({ fontProfile: 'geist' })");
  await delay(250);
  results.settingsFontGeist = await captureScreen('settings-font-geist');
  results.geistFont = await evaluate(`(() => {
    const body = getComputedStyle(document.body);
    const preview = getComputedStyle(document.querySelector('.font-preview-geist .settings-font-sample'));
    return { family: body.fontFamily, weight: body.fontWeight, tracking: body.letterSpacing,
      previewFamily: preview.fontFamily, previewTracking: preview.letterSpacing };
  })()`);
  await evaluate("window.focuslink.settings.set({ theme: 'dark' })");
  await delay(400);
  results.settingsDark = await captureScreen('settings-dark');

  const assertions = [
    [results.buildIdentity.version === packageVersion, 'packaged version matches package.json'],
    [results.buildIdentity.commit === expectedCommit, 'packaged commit matches generated metadata'],
    [results.running.workspaceClass.includes('state-running'), 'running workspace state class'],
    [results.running.primaryText === '暂停专注', 'running primary action'],
    [results.running.statusText === '专注中', 'running status is explicit'],
    [
      Boolean(results.running.stateMomentText?.startsWith('开始于')),
      'running start time is visible',
    ],
    [results.running.primaryTime !== '00:00', 'visible timer advances after UI start'],
    [results.running.activityAnimation !== 'none', 'running activity rail is animated'],
    [results.running.ledgerVisible, 'running ledger opens after UI start'],
    [results.running.themeFamily === 'quiet', 'quiet is the default visual theme'],
    [results.running.ambientRenderer === 'canvas', 'ambient field uses the canvas renderer'],
    [
      results.running.ambientCanvasSize?.[0] > 0 && results.running.ambientCanvasSize?.[1] > 0,
      'ambient canvas matches a real viewport',
    ],
    [results.running.ambientFallbackGlows === 3, 'ambient CSS fallback remains available'],
    [
      Number.parseFloat(results.focusActionStates.focus?.outlineWidth || '0') > 0,
      'keyboard focus exposes a visible primary-action outline',
    ],
    [
      results.focusActionStates.focus?.stopDisabled &&
        Number.parseFloat(results.focusActionStates.focus?.stopOpacity || '1') < 1,
      'idle stop action has an explicit disabled state',
    ],
    [
      results.focusActionStates.hover?.background !==
        results.focusActionStates.active?.background ||
        results.focusActionStates.hover?.transform !== results.focusActionStates.active?.transform,
      'primary action has distinct hover and active feedback',
    ],
    [results.paused.workspaceClass.includes('state-paused'), 'paused workspace state class'],
    [results.paused.primaryText === '继续专注', 'paused primary action'],
    [Boolean(results.paused.stateMomentText?.startsWith('暂停于')), 'pause time is visible'],
    [results.idle.primaryBackground.includes('40, 108, 99'), 'idle primary uses brand accent'],
    [results.paused.primaryBackground.includes('40, 108, 99'), 'resume uses brand accent'],
    [results.running.successToken === '40 108 99', 'focus teal token'],
    [results.paused.pauseToken === '204 81 69', 'pause red token'],
    [results.idle.bodyScroll[0] === results.idle.viewport[0], 'no horizontal overflow'],
    [results.idle.bodyScroll[1] === results.idle.viewport[1], 'no vertical overflow'],
    [
      results.windowSizes.large.outer[0] === 1280 && results.windowSizes.large.outer[1] === 720,
      'main window accepts 1280 by 720 bounds',
    ],
    [
      results.windowSizes.large.bodyScroll[0] <= results.windowSizes.large.viewport[0],
      'main window has no horizontal overflow at 1280 by 720',
    ],
    [
      results.windowSizes.minimum.outer[0] >= 980 && results.windowSizes.minimum.outer[1] >= 660,
      'main window enforces its 980 by 660 minimum bounds',
    ],
    [
      results.windowSizes.minimum.bodyScroll[0] <= results.windowSizes.minimum.viewport[0],
      'main window has no horizontal overflow at minimum size',
    ],
    [results.taskLightInspection.theme === 'light', 'task workspace light theme'],
    [results.taskLightInspection.completedView, 'task completed view'],
    [!results.taskLightInspection.hasSourceSelector, 'task provider is not exposed as a source'],
    [results.taskLightInspection.shellBackdrop === 'none', 'task workspace has no backdrop filter'],
    [results.historyInspection.cards === 3, 'history renders three insight charts'],
    [results.historyInspection.hasUnifiedCanvas, 'history charts share one analytics canvas'],
    [results.historyInspection.hasCombinationChart, 'history renders the bar-line-area trend'],
    [
      results.historyInspection.cardBorders.every((width) => width === '0px'),
      'history charts avoid nested card borders',
    ],
    [results.historyInspection.hasRing, 'history renders focus composition ring'],
    [results.historyInspection.columns > 0, 'history renders daily focus columns'],
    [results.historyInspection.ranks > 0, 'history renders session ranking bars'],
    [results.historyInspection.hasDayNavigator, 'history defaults to single-day navigation'],
    [results.historyInspection.activeRange === '单日', 'history defaults to today'],
    [results.historyInspection.nextDayDisabled, 'history cannot navigate beyond today'],
    [
      results.historyPreviousDay.label !== results.historyTodayLabel,
      'history previous-day control changes the selected day',
    ],
    [!results.historyPreviousDay.nextDisabled, 'history can navigate forward from a previous day'],
    [
      results.historyReturnedToday.label === results.historyTodayLabel &&
        results.historyReturnedToday.nextDisabled,
      'history next-day control returns to today and stops at the future boundary',
    ],
    [
      results.historyRanges['近 7 天']?.activeRange === '近 7 天' &&
        results.historyRanges['近 7 天']?.columns === 7 &&
        !results.historyRanges['近 7 天']?.hasDayNavigator,
      'history switches to a real seven-day chart',
    ],
    [
      results.historyRanges['半个月']?.activeRange === '半个月' &&
        results.historyRanges['半个月']?.columns === 15 &&
        !results.historyRanges['半个月']?.hasDayNavigator,
      'history switches to a real fifteen-day chart',
    ],
    [
      results.historyRanges['1 个月']?.activeRange === '1 个月' &&
        results.historyRanges['1 个月']?.columns === 30 &&
        !results.historyRanges['1 个月']?.hasDayNavigator,
      'history switches to a real thirty-day chart',
    ],
    [
      results.historyReturnedSingleDay.activeRange === '单日' &&
        results.historyReturnedSingleDay.label === results.historyTodayLabel &&
        results.historyReturnedSingleDay.nextDisabled &&
        results.historyReturnedSingleDay.columns === 1,
      'history returns from range presets to today single-day data',
    ],
    [results.toggleInspection.before?.role === 'switch', 'settings toggle uses switch semantics'],
    [
      results.toggleInspection.before?.size?.[0] === 42 &&
        results.toggleInspection.before?.size?.[1] === 24,
      'settings toggle keeps a clear 42 by 24 pixel shape',
    ],
    [
      Number.parseFloat(results.toggleInspection.before?.borderWidth || '0') > 0,
      'settings toggle keeps a visible border',
    ],
    [
      results.toggleInspection.before?.ariaChecked !==
        results.toggleInspection.after?.ariaChecked &&
        results.toggleInspection.before?.checkedClass !==
          results.toggleInspection.after?.checkedClass,
      'settings toggle click updates aria-checked and checked styling',
    ],
    [
      results.toggleInspection.before?.backgroundColor !==
        results.toggleInspection.after?.backgroundColor &&
        results.toggleInspection.before?.thumbTransform !==
          results.toggleInspection.after?.thumbTransform,
      'settings toggle click visibly changes its track and thumb',
    ],
    [
      results.toggleInspection.restored?.ariaChecked ===
        results.toggleInspection.before?.ariaChecked &&
        results.toggleInspection.restored?.checkedClass ===
          results.toggleInspection.before?.checkedClass,
      'settings toggle can restore its original state',
    ],
    [
      results.manropeFont.family.includes('IBM Plex Sans') &&
        results.geistFont.family.includes('IBM Plex Sans'),
      'interface font uses IBM Plex Sans',
    ],
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
    try {
      fs.rmSync(userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch (cleanupError) {
      process.stderr.write(`[ui-smoke] cleanup warning: ${cleanupError.message}\n`);
    }
  });

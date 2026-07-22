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
// Port 0 is unreliable for Electron CDP discovery on Windows: the process can
// start without exposing a usable DevToolsActivePort target. Keep this smoke
// isolated on a randomized high loopback port instead.
let port = 9200 + Math.floor(Math.random() * 600);

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
  const expectedPrimaryText = {
    running: '暂停',
    paused: '继续',
  }[expectedState];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await evaluate(`(() => {
      const consoleElement = document.querySelector('.focus-console');
      const workspace = document.querySelector('.session-workspace');
      const primary = document.querySelector('.timer-controls .btn-main-action');
      const status = document.querySelector('.focus-state-word');
      const stateMoment = document.querySelector('.timer-readout-meta > span:nth-child(2)');
      const ribbon = document.querySelector('.temporal-ribbon');
      const ribbonCanvas = document.querySelector('.ribbon-canvas');
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        state: consoleElement?.dataset.state || null,
        accentToken: rootStyle.getPropertyValue('--app-accent').trim(),
        pauseToken: rootStyle.getPropertyValue('--app-pause').trim(),
        successToken: rootStyle.getPropertyValue('--app-success').trim(),
        workspaceClass: workspace?.className || null,
        primaryBackground: primary ? getComputedStyle(primary).backgroundImage + ' ' + getComputedStyle(primary).backgroundColor : null,
        primaryText: primary?.textContent?.trim() || null,
        primaryTime: document.querySelector('.timer-dial')?.textContent?.trim() || null,
        statusText: status?.textContent?.trim() || null,
        stateMomentText: stateMoment?.textContent?.trim() || null,
        ribbonState: ribbon?.dataset.state || null,
        ribbonMotion: ribbon?.dataset.motion || null,
        ribbonDissolve: ribbon?.dataset.dissolve || null,
        hasRibbonCanvas: Boolean(ribbonCanvas),
        ribbonCanvasSize: ribbonCanvas ? [ribbonCanvas.width, ribbonCanvas.height] : null,
        ambientGone: !document.querySelector('.ambient-field'),
        themeFamily: document.documentElement.dataset.themeFamily || null,
        ledgerVisible: Boolean(document.querySelector('.session-ledger-pane')),
        ledgerTones: [...document.querySelectorAll('.ledger-row.row-focus, .ledger-row.row-pause')].map((row) => ({
          kind: row.classList.contains('row-pause') ? 'pause' : 'focus',
          border: getComputedStyle(row).borderLeftColor,
          title: getComputedStyle(row.querySelector('.ledger-row-title') || row).color,
        })),
        viewport: [window.innerWidth, window.innerHeight],
        bodyScroll: [document.body.scrollWidth, document.body.scrollHeight],
      };
    })()`);
    if (
      result.state === expectedState &&
      (!expectedPrimaryText || result.primaryText === expectedPrimaryText)
    ) {
      return result;
    }
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
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
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
  await evaluate("[...document.querySelectorAll('.timer-context-actions button')][0]?.click()");
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
    const target = document.querySelector('button[aria-label="专注"]');
    if (!target) return { clicked: false };
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { clicked: true, label: target.getAttribute('aria-label') };
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
    const button = document.querySelector('.timer-controls .btn-main-action');
    const stop = document.querySelector('.timer-controls .btn-stop-action');
    if (!button || !stop) return null;
    button.focus();
    const style = getComputedStyle(button);
    return {
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      stopDisabled: stop.disabled,
      stopBackground: getComputedStyle(stop).backgroundColor,
    };
  })()`);
  const startRect = await evaluate(`(() => {
    const button = document.querySelector('.timer-controls .btn-main-action');
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
    const style = getComputedStyle(document.querySelector('.timer-controls .btn-main-action'));
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
    const style = getComputedStyle(document.querySelector('.timer-controls .btn-main-action'));
    return { background: style.backgroundColor, transform: style.transform };
  })()`);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: startRect.x,
    y: startRect.y,
    button: 'left',
    clickCount: 1,
  });
  await delay(80);
  results.focusStartTransition = await evaluate(`(() => {
    const consoleElement = document.querySelector('.focus-console');
    const overlay = consoleElement ? getComputedStyle(consoleElement.querySelector('.focus-instrument'), '::after') : null;
    const dial = document.querySelector('.timer-dial');
    const dialRect = dial?.getBoundingClientRect();
    return {
      cue: consoleElement?.dataset.transition || null,
      animationName: overlay?.animationName || null,
      dialFontSize: dial ? Number.parseFloat(getComputedStyle(dial).fontSize) : 0,
      dialWidth: dialRect?.width ?? 0,
    };
  })()`);
  await delay(820);
  process.stderr.write('[ui-smoke] capture running\n');
  results.running = await capture('running', 'running');
  await evaluate("window.focuslink.settings.set({ timerStyle: 'flip' })");
  await delay(80);
  results.flipCycle = await evaluate(`new Promise((resolve) => {
    const startedAt = Date.now();
    let sawFold = false;
    let sawUnfold = false;
    const poll = () => {
      const cards = [...document.querySelectorAll('.dial-flip .flip-card')];
      sawFold ||= cards.some((card) => card.classList.contains('phase-fold'));
      sawUnfold ||= cards.some((card) => card.classList.contains('phase-unfold'));
      const settled =
        cards.length > 0 && cards.every((card) => card.classList.contains('phase-steady'));
      if ((sawFold && sawUnfold && settled) || Date.now() - startedAt > 2600) {
        resolve({
          cardCount: cards.length,
          sawFold,
          sawUnfold,
          settled,
          animationNodeCount: document.querySelectorAll('.dial-flip .flip-animation').length,
        });
        return;
      }
      setTimeout(poll, 16);
    };
    poll();
  })`);
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await delay(120);
  const reducedFlipBefore = await evaluate(
    `document.querySelector('.dial-flip')?.getAttribute('aria-label') || null`,
  );
  await delay(1200);
  results.reducedMotionFlip = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.dial-flip .flip-card')];
    return {
      before: ${JSON.stringify(reducedFlipBefore)},
      after: document.querySelector('.dial-flip')?.getAttribute('aria-label') || null,
      allSteady:
        cards.length > 0 && cards.every((card) => card.classList.contains('phase-steady')),
      animationNodeCount: document.querySelectorAll('.dial-flip .flip-animation').length,
    };
  })()`);
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  await evaluate("window.focuslink.settings.set({ timerStyle: 'standard' })");
  await delay(120);
  const immersiveClicked = await evaluate(`(() => {
    const button = document.querySelector('.focus-immersive-toggle[title="全屏进入沉浸模式"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!immersiveClicked) throw new Error('Immersive mode button was not clickable');
  await waitForSelector('[data-testid="focus-immersive"]');
  await delay(900);
  results.immersive = await evaluate(`(() => {
    const overlay = document.querySelector('[data-testid="focus-immersive"]');
    const animation = overlay ? getComputedStyle(overlay) : null;
    const rect = overlay?.getBoundingClientRect();
    return {
      present: Boolean(overlay),
      state: overlay?.dataset.state || null,
      viewport: [window.innerWidth, window.innerHeight],
      rect: rect ? [rect.left, rect.top, rect.width, rect.height] : null,
      hasNavigation: Boolean(overlay?.querySelector('.global-navigation')),
      hasLedger: Boolean(overlay?.querySelector('.session-ledger-pane')),
      hasReadout: Boolean(overlay?.querySelector('.immersive-readout .timer-dial')),
      hasBand: Boolean(overlay?.querySelector('.immersive-band .ribbon-canvas')),
      hasTotals: overlay?.querySelectorAll('.timer-total').length === 3,
      hasControls: Boolean(overlay?.querySelector('.timer-controls')),
      stageAnimationName: animation?.animationName || null,
      stageAnimationDuration: animation?.animationDuration || null,
    };
  })()`);
  results.immersive.screenshot = await captureScreen('immersive-running');
  await evaluate(`document.querySelector('.immersive-exit')?.click()`);
  await delay(650);
  if (await evaluate(`Boolean(document.querySelector('[data-testid="focus-immersive"]'))`)) {
    throw new Error('Immersive mode did not exit cleanly');
  }
  const pauseClicked = await evaluate(`(() => {
    const button = document.querySelector('.timer-controls .btn-main-action');
    if (!button || button.textContent.trim() !== '暂停') return false;
    button.click();
    return true;
  })()`);
  if (!pauseClicked) throw new Error('Pause focus button was not clickable');
  await delay(500);
  process.stderr.write('[ui-smoke] capture paused\n');
  results.paused = await capture('paused', 'paused');
  await evaluate('window.focuslink.timer.stop()');
  await inspectState('finished');
  results.focusFinishTransition = await evaluate(`(() => {
    const consoleElement = document.querySelector('.focus-console');
    const overlay = consoleElement ? getComputedStyle(consoleElement.querySelector('.focus-instrument'), '::after') : null;
    return {
      cue: consoleElement?.dataset.transition || null,
      animationName: overlay?.animationName || null,
    };
  })()`);
  await delay(900);
  results.finishedFreeze = {
    before: await evaluate(`(() => ({
      time: document.querySelector('.timer-dial')?.getAttribute('aria-label') || null,
      canvas: document.querySelector('.ribbon-canvas')?.toDataURL() || null,
    }))()`),
  };
  await delay(850);
  results.finishedFreeze.after = await evaluate(`(() => ({
    time: document.querySelector('.timer-dial')?.getAttribute('aria-label') || null,
    canvas: document.querySelector('.ribbon-canvas')?.toDataURL() || null,
  }))()`);
  // Starting a timer can auto-show the mini window when another app owns the
  // foreground. Restore the isolated main window before exercising analytics
  // so Chromium does not throttle the hidden renderer during this smoke.
  await evaluate('window.focuslink.mini.hide()');
  await send('Page.bringToFront');
  await delay(250);
  await evaluate('document.querySelector(\'button[aria-label="统计"]\')?.click()');
  await waitForAnyText(['时间范围', '当前时间范围没有专注记录', '加载失败']);
  await delay(650);
  results.history = await captureScreen('history');
  results.historyInspection = await evaluate(`(() => ({
    hasDashboard: Boolean(document.querySelector('.stats-dashboard')),
    dashboardTitle: document.querySelector('.stats-brief-copy h2')?.textContent?.trim() || null,
    kpiCount: document.querySelectorAll('.stats-metric').length,
    panelCount: document.querySelectorAll('.stats-panel').length,
    hasTimeline: Boolean(document.querySelector('.stats-timeline-detail')),
    hasTaskRanking: Boolean(document.querySelector('.stats-task-list')),
    taskRowCount: document.querySelectorAll('.stats-task-row').length,
    hasPauseCost: Boolean(document.querySelector('.stats-pause-cost')),
    hasSessionTable: Boolean(document.querySelector('.session-performance-list')),
    hasAbstractSwitcher: Boolean(document.querySelector('.insight-view-switch')),
    hasRing: Boolean(document.querySelector('.history-focus-ring')),
    hasDayNavigator: Boolean(document.querySelector('.history-day-navigator')),
    activeRange: [...document.querySelectorAll('.history-filter-row button')]
      .find((button) => button.classList.contains('bg-accent'))?.textContent?.trim() || null,
    nextDayDisabled: Boolean(document.querySelector('.history-day-navigator > button:last-child')?.disabled),
    dashboardBorder: getComputedStyle(document.querySelector('.stats-dashboard')).borderTopWidth,
  }))()`);
  results.historyMinimum = await inspectMainWindowSize(980, 660);
  results.historyMinimum.dashboard = await evaluate(`(() => {
    const dashboard = document.querySelector('.stats-dashboard');
    const rect = dashboard?.getBoundingClientRect();
    return {
      present: Boolean(dashboard),
      left: rect?.left ?? null,
      right: rect?.right ?? null,
      width: rect?.width ?? null,
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  })()`);
  await evaluate(`window.resizeTo(${originalWindowSize[0]}, ${originalWindowSize[1]})`);
  await delay(400);
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
      hasTrend: Boolean(document.querySelector('.stats-trend-chart')),
      hasLegacyVisual: Boolean(document.querySelector('.matrix-canvas, .weave-canvas, .beads-canvas, .mosaic')),
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
    hasTimeline: Boolean(document.querySelector('.stats-timeline-detail')),
    hasTrend: Boolean(document.querySelector('.stats-trend-chart')),
  }))()`);
  const historySessionOpened = await evaluate(`(() => {
    const row = document.querySelector('.history-session-row');
    if (!row) return false;
    row.click();
    return true;
  })()`);
  if (!historySessionOpened) throw new Error('History session row was not found');
  await waitForSelector('.history-segment-ledger');
  results.historySegmentLedger = await evaluate(`(() => ({
    focusRows: document.querySelectorAll('.history-segment-row.tone-focus').length,
    pauseRows: document.querySelectorAll('.history-segment-row.tone-pause').length,
    markers: document.querySelectorAll('.history-segment-marker').length,
    subjectChoices: document.querySelectorAll('.tomatodo-subject-actions button[title]').length,
    nestedCard: Boolean(document.querySelector('.history-segment-ledger .rounded-lg')),
  }))()`);
  const deleteOpened = await evaluate(`(() => {
    const button = document.querySelector('.history-icon-action.danger');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!deleteOpened) throw new Error('History delete action was not found');
  await waitForSelector('[data-testid="confirm-dialog-layer"]');
  results.historyDeleteDialog = await evaluate(`(() => {
    const layer = document.querySelector('[data-testid="confirm-dialog-layer"]');
    const shell = layer?.querySelector('.confirm-shell');
    const rect = shell?.getBoundingClientRect();
    return {
      portalAtBody: layer?.parentElement === document.body,
      role: shell?.getAttribute('role') || null,
      title: shell?.querySelector('.confirm-title')?.textContent?.trim() || null,
      description: shell?.querySelector('.confirm-desc')?.textContent?.trim() || null,
      confirmDanger: shell?.querySelector('.confirm-actions .btn-danger')?.textContent?.trim() || null,
      cancelFocused: document.activeElement === shell?.querySelector('.confirm-actions .btn-outline'),
      width: rect?.width ?? 0,
      insideViewport:
        Boolean(rect) && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
    };
  })()`);
  results.historyDeleteDialog.screenshot = await captureScreen('history-delete-confirm');
  await evaluate(`document.querySelector('.confirm-actions .btn-outline')?.click()`);
  await delay(260);
  results.historyDeleteDialog.closed = !(await evaluate(
    `Boolean(document.querySelector('[data-testid="confirm-dialog-layer"]'))`,
  ));
  await evaluate('document.querySelector(\'button[aria-label="设置"]\')?.click()');
  await waitForAnyText(['外观', '界面与体验']);
  results.settingsLight = await captureScreen('settings-light');
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('.settings-tab')]
      .find((button) => button.textContent?.includes('体验'));
    if (!tab) throw new Error('Experience settings tab was not found');
    tab.click();
  })()`);
  await waitForAnyText(['计时仪表']);
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
  // 界面字体：六种设置必须落到真实不同字形，而不是同一黑体的不同字重。
  results.interfaceFonts = {};
  for (const profile of ['noto', 'wenkai', 'zhisong', 'marker', 'xihei', 'smiley']) {
    await evaluate(`window.focuslink.settings.set({ fontProfile: '${profile}' })`);
    await delay(240);
    results.interfaceFonts[profile] = await evaluate(`(() => ({
      rootFontClass:
        [...document.documentElement.classList].find((name) => name.startsWith('font-profile-')) ||
        null,
      bodyFontFamily: getComputedStyle(document.body).fontFamily,
      sampleFontFamily: getComputedStyle(
        document.querySelector('.font-profile-choice.preview-${profile} .fp-sample')
      ).fontFamily,
      previewCount: document.querySelectorAll('.font-profile-choice').length,
    }))()`);
  }
  await evaluate("window.focuslink.settings.set({ fontProfile: 'wenkai' })");
  await delay(240);
  // 计时仪表：切换五种样式，验证根类、预览数量与独立构形。
  results.instrumentFonts = {};
  for (const style of ['standard', 'flip', 'pixel', 'thin', 'segment']) {
    await evaluate(`window.focuslink.settings.set({ timerStyle: '${style}' })`);
    await delay(220);
    results.instrumentFonts[style] = await evaluate(`(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).fontFamily : null;
      };
      return {
        rootTimerClass: [...document.documentElement.classList].find((c) => c.startsWith('timer-style-')) || null,
        standard: pick('.dial-standard'),
        flip: pick('.dial-flip'),
        pixel: pick('.dial-pixel'),
        thin: pick('.dial-thin'),
        segment: Boolean(document.querySelector('.dial-segment .segment-on')),
        previewCount: document.querySelectorAll('.instrument-choice .timer-dial').length,
      };
    })()`);
    await captureScreen(`settings-instrument-${style}`);
  }
  await evaluate("window.focuslink.settings.set({ timerStyle: 'standard', theme: 'dark' })");
  await delay(400);
  results.settingsDark = await captureScreen('settings-dark');

  const assertions = [
    [results.buildIdentity.version === packageVersion, 'packaged version matches package.json'],
    [results.buildIdentity.commit === expectedCommit, 'packaged commit matches generated metadata'],
    [results.running.workspaceClass.includes('state-running'), 'running workspace state class'],
    [results.running.primaryText === '暂停', 'running primary action'],
    [results.running.statusText === '专注中', 'running status is explicit'],
    [Boolean(results.running.stateMomentText?.startsWith('起于')), 'running start time is visible'],
    [results.running.primaryTime !== '00:00', 'visible timer advances after UI start'],
    [
      results.focusStartTransition.cue === 'start' &&
        results.focusStartTransition.animationName === 'focus-session-start' &&
        results.focusStartTransition.dialFontSize >= 88 &&
        results.focusStartTransition.dialWidth > 0,
      'focus start provides a one-shot transition around a large, measurable timer instrument',
    ],
    [
      results.focusFinishTransition.cue === 'finish' &&
        results.focusFinishTransition.animationName === 'focus-session-finish',
      'focus finish provides a distinct one-shot settlement transition',
    ],
    [
      results.running.ribbonState === 'running' && results.running.hasRibbonCanvas,
      'running temporal band canvas is live',
    ],
    [
      results.running.ribbonMotion === 'continuous-material',
      'running temporal band exposes continuous focus material',
    ],
    [
      results.running.ribbonCanvasSize?.[0] > 0 && results.running.ribbonCanvasSize?.[1] > 0,
      'temporal band canvas matches a real viewport',
    ],
    [results.running.ambientGone, 'ambient field is removed from the design system'],
    [results.running.themeFamily === null, 'legacy theme family is no longer written'],
    [results.running.ledgerVisible, 'running ledger opens after UI start'],
    [
      results.flipCycle.cardCount > 0 &&
        results.flipCycle.sawFold &&
        results.flipCycle.sawUnfold &&
        results.flipCycle.settled &&
        results.flipCycle.animationNodeCount === 0,
      'flip clock completes fold, unfold and steady phases without a stuck flap',
    ],
    [
      results.reducedMotionFlip.before !== results.reducedMotionFlip.after &&
        results.reducedMotionFlip.allSteady &&
        results.reducedMotionFlip.animationNodeCount === 0,
      'reduced-motion flip clock advances by static commits',
    ],
    [
      results.immersive.present &&
        results.immersive.state === 'running' &&
        results.immersive.rect?.[2] === results.immersive.viewport[0] &&
        results.immersive.rect?.[3] === results.immersive.viewport[1],
      'immersive focus surface fills the entire display',
    ],
    [
      !results.immersive.hasNavigation &&
        !results.immersive.hasLedger &&
        results.immersive.hasReadout &&
        results.immersive.hasBand &&
        results.immersive.hasTotals &&
        results.immersive.hasControls,
      'immersive mode shows only the complete focus interface',
    ],
    [
      results.immersive.stageAnimationName !== 'none' &&
        results.immersive.stageAnimationDuration !== '0s',
      'immersive mode enters with a real transition',
    ],
    [
      Number.parseFloat(results.focusActionStates.focus?.outlineWidth || '0') > 0,
      'keyboard focus exposes a visible primary-action outline',
    ],
    [
      results.focusActionStates.focus?.stopDisabled &&
        results.focusActionStates.focus?.stopBackground !== 'rgba(0, 0, 0, 0)',
      'idle stop action has an explicit disabled state',
    ],
    [results.focusActionStates.active?.transform !== 'none', 'primary action has active feedback'],
    [results.paused.workspaceClass.includes('state-paused'), 'paused workspace state class'],
    [
      results.paused.ribbonMotion === 'pause-dissolve',
      'paused temporal band exposes frontier particle loss',
    ],
    [
      results.paused.ribbonDissolve === 'interval-trace',
      'paused band declares a wall-clock particle interval trace',
    ],
    [results.paused.primaryText === '继续', 'paused primary action'],
    [Boolean(results.paused.stateMomentText?.startsWith('暂停于')), 'pause time is visible'],
    [
      results.finishedFreeze.before.time === results.finishedFreeze.after.time &&
        results.finishedFreeze.before.canvas === results.finishedFreeze.after.canvas,
      'finished timer and temporal band remain visually frozen after the zoom settles',
    ],
    [
      results.idle.primaryBackground.includes(results.idle.accentToken.split(' ').join(', ')),
      'idle primary uses the selected global accent',
    ],
    [
      results.paused.primaryBackground !== 'none rgba(0, 0, 0, 0)' &&
        !results.paused.primaryBackground.includes('210, 67, 57'),
      'resume uses interface action color, not pause red',
    ],
    [results.running.successToken === '14 159 110', 'focus green token'],
    [results.paused.pauseToken === '210 67 57', 'pause red token'],
    [
      results.paused.ledgerTones.some(
        (row) => row.kind === 'focus' && row.border !== 'rgba(0, 0, 0, 0)',
      ) &&
        results.paused.ledgerTones.some(
          (row) => row.kind === 'pause' && row.border !== 'rgba(0, 0, 0, 0)',
        ),
      'all focus and pause ledger rows retain semantic color',
    ],
    [results.idle.bodyScroll[0] === results.idle.viewport[0], 'no horizontal overflow'],
    [results.idle.bodyScroll[1] === results.idle.viewport[1], 'no vertical overflow'],
    [
      results.windowSizes.large.outer[0] >= 980 &&
        results.windowSizes.large.outer[0] <= 1280 &&
        results.windowSizes.large.outer[1] >= 660 &&
        results.windowSizes.large.outer[1] <= 720,
      'main window accepts requested or display-clamped large bounds',
    ],
    [
      results.windowSizes.large.bodyScroll[0] <= results.windowSizes.large.viewport[0],
      'main window has no horizontal overflow at large bounds',
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
    [results.historyInspection.hasDashboard, 'history renders the rebuilt analytics dashboard'],
    [results.historyInspection.kpiCount === 4, 'history exposes four familiar core KPIs'],
    [
      results.historyInspection.panelCount === 2 && results.historyInspection.hasPauseCost,
      'history has rhythm, allocation and pause-cost sections',
    ],
    [
      results.historyInspection.hasTimeline,
      'single-day history renders the readable activity timeline',
    ],
    [results.historyInspection.hasTaskRanking, 'history renders a readable task ranking'],
    [!results.historyInspection.hasSessionTable, 'dashboard does not duplicate the session ledger'],
    [
      !results.historyInspection.hasAbstractSwitcher,
      'history removes the abstract visualization switcher',
    ],
    [
      results.historyInspection.dashboardBorder !== '0px',
      'dashboard has one shared outer boundary',
    ],
    [
      results.historyMinimum.bodyScroll[0] <= results.historyMinimum.viewport[0] &&
        results.historyMinimum.dashboard.present &&
        results.historyMinimum.dashboard.left >= 0 &&
        results.historyMinimum.dashboard.right <=
          results.historyMinimum.dashboard.viewportWidth + 1 &&
        results.historyMinimum.dashboard.scrollWidth <=
          results.historyMinimum.dashboard.viewportWidth,
      'dashboard stays inside the 980px minimum viewport without horizontal overflow',
    ],
    [!results.historyInspection.hasRing, 'history removes decorative focus composition ring'],
    [
      results.historySegmentLedger.focusRows > 0 &&
        results.historySegmentLedger.pauseRows > 0 &&
        results.historySegmentLedger.markers ===
          results.historySegmentLedger.focusRows + results.historySegmentLedger.pauseRows &&
        !results.historySegmentLedger.nestedCard,
      'history detail separates focus and pause in one continuous segment ledger',
    ],
    [
      results.historyDeleteDialog.portalAtBody &&
        results.historyDeleteDialog.role === 'alertdialog' &&
        results.historyDeleteDialog.confirmDanger === '永久删除' &&
        results.historyDeleteDialog.cancelFocused &&
        results.historyDeleteDialog.width >= 360 &&
        results.historyDeleteDialog.insideViewport &&
        results.historyDeleteDialog.closed,
      'history delete uses a focused, viewport-safe top-level danger confirmation',
    ],
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
        results.historyRanges['近 7 天']?.hasTrend &&
        !results.historyRanges['近 7 天']?.hasLegacyVisual &&
        !results.historyRanges['近 7 天']?.hasDayNavigator,
      'history switches to the seven-day activity trend',
    ],
    [
      results.historyRanges['半个月']?.activeRange === '半个月' &&
        results.historyRanges['半个月']?.hasTrend &&
        !results.historyRanges['半个月']?.hasLegacyVisual &&
        !results.historyRanges['半个月']?.hasDayNavigator,
      'history switches to the fifteen-day activity trend',
    ],
    [
      results.historyRanges['1 个月']?.activeRange === '1 个月' &&
        results.historyRanges['1 个月']?.hasTrend &&
        !results.historyRanges['1 个月']?.hasLegacyVisual &&
        !results.historyRanges['1 个月']?.hasDayNavigator,
      'history switches to the thirty-day activity trend',
    ],
    [
      results.historyReturnedSingleDay.activeRange === '单日' &&
        results.historyReturnedSingleDay.label === results.historyTodayLabel &&
        results.historyReturnedSingleDay.nextDisabled &&
        results.historyReturnedSingleDay.hasTimeline &&
        !results.historyReturnedSingleDay.hasTrend,
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
      results.instrumentFonts.standard?.previewCount === 5,
      'settings renders live previews for all five timer instruments',
    ],
    [
      results.instrumentFonts.standard?.standard?.includes('JetBrains Mono') &&
        results.instrumentFonts.standard?.flip?.includes('Oswald') &&
        results.instrumentFonts.standard?.thin?.includes('Bodoni Moda') &&
        results.instrumentFonts.standard?.segment,
      'timer instruments use genuinely different digit families',
    ],
    [
      results.instrumentFonts.standard?.rootTimerClass === 'timer-style-standard' &&
        results.instrumentFonts.flip?.rootTimerClass === 'timer-style-flip' &&
        results.instrumentFonts.pixel?.rootTimerClass === 'timer-style-pixel' &&
        results.instrumentFonts.thin?.rootTimerClass === 'timer-style-thin' &&
        results.instrumentFonts.segment?.rootTimerClass === 'timer-style-segment',
      'timer style setting applies the matching instrument class',
    ],
    [
      Object.values(results.interfaceFonts).every((font) => font.previewCount === 6),
      'settings renders all six interface font families',
    ],
    [
      results.interfaceFonts.noto?.rootFontClass === 'font-profile-noto' &&
        results.interfaceFonts.noto?.bodyFontFamily.includes('Noto Sans SC') &&
        results.interfaceFonts.wenkai?.rootFontClass === 'font-profile-wenkai' &&
        results.interfaceFonts.wenkai?.bodyFontFamily.includes('LXGW WenKai') &&
        results.interfaceFonts.zhisong?.rootFontClass === 'font-profile-zhisong' &&
        results.interfaceFonts.zhisong?.bodyFontFamily.includes('LXGW Neo ZhiSong') &&
        results.interfaceFonts.marker?.rootFontClass === 'font-profile-marker' &&
        results.interfaceFonts.marker?.bodyFontFamily.includes('LXGW Marker Gothic') &&
        results.interfaceFonts.xihei?.rootFontClass === 'font-profile-xihei' &&
        results.interfaceFonts.xihei?.bodyFontFamily.includes('LXGW Neo XiHei') &&
        results.interfaceFonts.smiley?.rootFontClass === 'font-profile-smiley' &&
        results.interfaceFonts.smiley?.bodyFontFamily.includes('Smiley Sans'),
      'interface font setting applies six genuinely different families',
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

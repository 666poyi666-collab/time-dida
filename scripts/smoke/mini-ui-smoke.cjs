const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..', '..');
const executable = path.resolve(
  process.argv[2] || path.join(root, 'release-v0100', 'win-unpacked', 'FocusLink.exe'),
);
const outputDir = path.resolve(
  process.argv[3] || path.join(os.tmpdir(), `focuslink-mini-states-${Date.now()}`),
);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-mini-smoke-'));
const port = 9800 + Math.floor(Math.random() * 400);

const miniLayoutSource = fs.readFileSync(path.join(root, 'shared', 'miniWindowLayout.ts'), 'utf8');
function readSharedSize(exportName) {
  const match = new RegExp(
    `export const ${exportName} = \\{\\s*width:\\s*(\\d+),\\s*height:\\s*(\\d+)\\s*\\}`,
  ).exec(miniLayoutSource);
  if (!match) throw new Error(`Cannot read ${exportName} from shared/miniWindowLayout.ts`);
  return { width: Number(match[1]), height: Number(match[2]) };
}
const EXPANDED_SIZE = readSharedSize('MINI_WINDOW_EXPANDED_SIZE');
const COLLAPSED_SIZE = readSharedSize('MINI_WINDOW_COLLAPSED_SIZE');
const FOCUS_TOKEN = '82 190 141';
const PAUSE_TOKEN = '224 104 119';
const LIGHT_FOCUS_TOKEN = '19 132 89';
const LIGHT_PAUSE_TOKEN = '194 75 91';
const THEME_TOKENS = {
  dark: { focus: FOCUS_TOKEN, pause: PAUSE_TOKEN },
  light: { focus: LIGHT_FOCUS_TOKEN, pause: LIGHT_PAUSE_TOKEN },
};

if (!fs.existsSync(executable)) {
  throw new Error(`FocusLink executable not found: ${executable}`);
}
fs.mkdirSync(outputDir, { recursive: true });

const app = spawn(
  executable,
  [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--hidden'],
  { stdio: 'ignore', windowsHide: true },
);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
  return response.json();
}

async function waitForTarget(predicate, label) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const target = (await listTargets()).find(predicate);
      if (target?.webSocketDebuggerUrl) return target;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Timed out waiting for ${label}: ${lastError instanceof Error ? lastError.message : 'not found'}`,
  );
}

class CdpSession {
  constructor(target) {
    this.target = target;
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

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }
}

function readPngSize(buffer) {
  const pngSignature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== pngSignature || buffer.length < 24) {
    throw new Error('Captured screenshot is not a valid PNG');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function inspectMini(mini) {
  return mini.evaluate(`(() => {
    const shell = document.querySelector('.mini-window-shell');
    const primary = document.querySelector('.mini-primary-button');
    const secondary = document.querySelector('.mini-secondary-button');
    const primaryTime = document.querySelector('.mini-collapsed-time, .mini-expanded-time');
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const shellStyle = shell ? getComputedStyle(shell) : null;
    const primaryTimeStyle = primaryTime ? getComputedStyle(primaryTime) : null;
    const primaryStyle = primary ? getComputedStyle(primary) : null;
    const edgeProgress = document.querySelector('.mini-edge-progress');
    const edgeProgressAfterStyle = edgeProgress
      ? getComputedStyle(edgeProgress, '::after')
      : null;

    const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const rectOf = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const isVisible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const shellRect = shell?.getBoundingClientRect() || null;
    const isInsideShell = (element) => {
      if (!element || !shellRect || !isVisible(element)) return false;
      const rect = element.getBoundingClientRect();
      const tolerance = 1;
      return (
        rect.left >= shellRect.left - tolerance &&
        rect.top >= shellRect.top - tolerance &&
        rect.right <= shellRect.right + tolerance &&
        rect.bottom <= shellRect.bottom + tolerance
      );
    };
    const inspectElement = (selector) => {
      const element = document.querySelector(selector);
      return {
        present: Boolean(element),
        visible: isVisible(element),
        insideShell: isInsideShell(element),
        text: normalizeText(element?.textContent),
        rect: rectOf(element),
      };
    };

    const criticalSelectors = {
      collapsedContent: '[data-testid="mini-collapsed-content"]',
      compactCurrent: '.mini-collapsed-current',
      compactLabel: '.mini-collapsed-label',
      compactTime: '.mini-collapsed-time',
      compactTotal: '[data-testid="mini-cumulative-metric"]',
      edgeProgress: '.mini-edge-progress',
      expandedContent: '[data-testid="mini-expanded-content"]',
      expandedHeader: '.mini-expanded-header',
      headerContext: '.mini-header-context',
      taskTitle: '.mini-task-title',
      expandedBody: '.mini-expanded-body',
      focusCore: '.mini-focus-core',
      currentLabel: '.mini-current-label',
      expandedTime: '.mini-expanded-time',
      metricRail: '[data-testid="mini-metric-rail"]',
      focusTotal: '[data-testid="mini-focus-total"]',
      pauseTotal: '[data-testid="mini-pause-total"]',
      wallTotal: '[data-testid="mini-wall-total"]',
      expandedFooter: '.mini-expanded-footer',
      actionDock: '.mini-action-dock',
    };
    const elements = Object.fromEntries(
      Object.entries(criticalSelectors).map(([key, selector]) => [key, inspectElement(selector)])
    );
    const buttons = [...document.querySelectorAll('button')].map((button) => ({
      text: normalizeText(button.textContent),
      ariaLabel: button.getAttribute('aria-label'),
      disabled: button.disabled,
      visible: isVisible(button),
      insideShell: isInsideShell(button),
      rect: rectOf(button),
    }));
    const glyphs = primaryTime ? [...primaryTime.querySelectorAll('.motion-digit-flip')] : [];
    const primaryTimeText = normalizeText(primaryTime?.textContent);
    const expectedDigitCount = (primaryTimeText.match(/\\d/g) || []).length;
    const allGlyphsVisible =
      glyphs.length > 0 && glyphs.every((glyph) => isVisible(glyph) && isInsideShell(glyph));
    const timeComplete =
      /^(?:\\d+:)?\\d{2}:\\d{2}$/.test(primaryTimeText) &&
      !primaryTimeText.includes('…') &&
      glyphs.length === expectedDigitCount &&
      allGlyphsVisible &&
      isInsideShell(primaryTime);

    const metricLabels = [...document.querySelectorAll('.mini-metric > span')].map((element) =>
      normalizeText(element.textContent)
    );
    const metricValues = [...document.querySelectorAll('.mini-metric > strong')].map((element) =>
      normalizeText(element.textContent)
    );
    return {
      ready: Boolean(shell),
      shellClass: shell?.className || null,
      shellRect: rectOf(shell),
      focusToken: rootStyle.getPropertyValue('--app-success').trim(),
      pauseToken: rootStyle.getPropertyValue('--app-pause').trim(),
      accentToken: rootStyle.getPropertyValue('--app-accent').trim(),
      primaryTextToken: rootStyle.getPropertyValue('--app-text').trim(),
      primaryTimeColor: primaryTimeStyle?.color || null,
      primaryButtonBackground: primaryStyle
        ? primaryStyle.backgroundImage + ' ' + primaryStyle.backgroundColor
        : null,
      primaryTimeFontSize: primaryTimeStyle ? Number.parseFloat(primaryTimeStyle.fontSize) : 0,
      shellBackdropFilter:
        shellStyle?.backdropFilter || shellStyle?.webkitBackdropFilter || 'none',
      shellBackgroundImage: shellStyle?.backgroundImage || 'none',
      edgeProgressAnimation: edgeProgressAfterStyle?.animationName || 'none',
      hasMaterialGlow: Boolean(document.querySelector('.mini-material-glow')),
      hasMaterialGrain: Boolean(document.querySelector('.mini-material-grain')),
      hasFocusAura: Boolean(document.querySelector('.mini-focus-aura')),
      hasSignal: Boolean(document.querySelector('.mini-signal')),
      primaryText: primary?.textContent?.trim() || null,
      secondaryText: secondary?.textContent?.trim() || null,
      stateText: normalizeText(document.querySelector('.mini-state-badge')?.textContent),
      compactLabel: normalizeText(document.querySelector('.mini-collapsed-label')?.textContent),
      currentLabel: normalizeText(document.querySelector('.mini-current-label')?.textContent),
      taskTitle: normalizeText(document.querySelector('.mini-task-title')?.textContent),
      primaryTimeText,
      timeDigitCount: glyphs.length,
      timeComplete,
      collapsedContentText: normalizeText(
        document.querySelector('[data-testid="mini-collapsed-content"]')?.textContent
      ),
      metricLabels,
      metricValues,
      wallTimeText: normalizeText(
        document.querySelector('[data-testid="mini-wall-total"]')?.textContent
      ),
      visibleText: normalizeText(document.body.innerText),
      elements,
      buttons,
      viewport: [window.innerWidth, window.innerHeight],
      outer: [window.outerWidth, window.outerHeight],
      screenPosition: [window.screenX, window.screenY],
      devicePixelRatio: window.devicePixelRatio,
      bodyScroll: [document.body.scrollWidth, document.body.scrollHeight],
      bodyBackground: bodyStyle.backgroundColor,
      themeClass: rootStyle.colorScheme,
      rootClasses: [...document.documentElement.classList],
      timeOrigin: performance.timeOrigin,
      themeSmokeIdentity: window.__focuslinkMiniThemeSmokeIdentity || null,
    };
  })()`);
}

async function setFollowingMainTheme(main, theme) {
  const result = await main.evaluate(`(async () => {
    const current = await window.focuslink.settings.get();
    return window.focuslink.settings.set({
      theme: ${JSON.stringify(theme)},
      miniWindow: {
        ...current.miniWindow,
        followMainTheme: true,
      },
    });
  })()`);
  if (result?.theme !== theme || result?.miniWindow?.followMainTheme !== true) {
    throw new Error(`Could not enable follow-main ${theme} theme: ${JSON.stringify(result)}`);
  }
  return result;
}

async function enableEdgeDock(main) {
  const result = await main.evaluate(`(async () => {
    const current = await window.focuslink.settings.get();
    return window.focuslink.settings.set({
      miniWindow: {
        ...current.miniWindow,
        edgeAutoCollapse: true,
        edgeCollapseDelayMs: 180,
      },
    });
  })()`);
  if (result?.miniWindow?.edgeAutoCollapse !== true) {
    throw new Error(`Could not enable mini edge docking: ${JSON.stringify(result)}`);
  }
  return result;
}

async function waitForMiniTheme(mini, theme) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await inspectMini(mini);
    if (
      result.themeClass === theme &&
      result.rootClasses.includes(theme) &&
      !result.rootClasses.includes(theme === 'light' ? 'dark' : 'light')
    ) {
      return result;
    }
    await delay(100);
  }
  const last = await inspectMini(mini);
  throw new Error(`Mini did not switch to ${theme} theme in place: ${JSON.stringify(last)}`);
}

async function clickMini(mini, selector, label) {
  const result = await mini.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLButtonElement)) {
      return { clicked: false, reason: 'button not found' };
    }
    if (element.disabled) return { clicked: false, reason: 'button disabled' };
    element.click();
    return { clicked: true };
  })()`);
  if (!result?.clicked) {
    throw new Error(`Could not click ${label}: ${result?.reason || 'unknown error'}`);
  }
}

async function moveNativeWindow(session, left, top) {
  await session.evaluate(
    `window.moveTo(${Math.round(left)}, ${Math.round(top)}); ({ x: window.screenX, y: window.screenY })`,
  );
}

async function waitForPrimaryTimeAdvance(mini, state, collapsed, size) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await waitForMiniState(mini, state, collapsed, size);
    if (result.primaryTimeText !== '00:00') return result;
    await delay(100);
  }
  throw new Error(`Mini ${state} timer did not advance from 00:00`);
}

async function assertIdempotentSize(mini, state, collapsed, size, expression, label) {
  const before = await waitForMiniState(mini, state, collapsed, size);
  await mini.evaluate(expression);
  await mini.evaluate(expression);
  await delay(250);
  const after = await waitForMiniState(mini, state, collapsed, size);
  const config = await mini.evaluate('window.focuslink.mini.getConfig()');
  const boundsUnchanged =
    before.viewport[0] === after.viewport[0] &&
    before.viewport[1] === after.viewport[1] &&
    before.outer[0] === after.outer[0] &&
    before.outer[1] === after.outer[1] &&
    before.screenPosition[0] === after.screenPosition[0] &&
    before.screenPosition[1] === after.screenPosition[1];
  if (!boundsUnchanged) {
    throw new Error(
      `${label} was not idempotent: ${JSON.stringify({
        before: {
          viewport: before.viewport,
          outer: before.outer,
          screenPosition: before.screenPosition,
        },
        after: {
          viewport: after.viewport,
          outer: after.outer,
          screenPosition: after.screenPosition,
        },
      })}`,
    );
  }
  if (
    config?.collapsed !== collapsed ||
    config?.width !== EXPANDED_SIZE.width ||
    config?.height !== EXPANDED_SIZE.height
  ) {
    throw new Error(
      `${label} persisted an invalid fixed-mode config: ${JSON.stringify({ config, collapsed })}`,
    );
  }
}

async function waitForMiniState(mini, state, collapsed, size) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await inspectMini(mini);
    const classes = String(result.shellClass || '').split(/\s+/);
    const stateReady = !state || classes.includes(`mini-window-${state}`);
    const collapseReady = classes.includes('mini-window-collapsed') === collapsed;
    const sizeReady =
      result.viewport[0] === size.width &&
      (collapsed
        ? Math.abs(result.viewport[1] - size.height) <= 1
        : result.viewport[1] === size.height);
    const contentReady = collapsed
      ? result.elements.collapsedContent.present &&
        result.elements.collapsedContent.visible &&
        !result.elements.expandedContent.present
      : result.elements.expandedContent.present &&
        result.elements.expandedContent.visible &&
        !result.elements.collapsedContent.present;
    if (result.ready && stateReady && collapseReady && sizeReady && contentReady) return result;
    await delay(100);
  }
  const last = await inspectMini(mini);
  throw new Error(
    `Mini did not reach ${state || 'any-state'}/${collapsed ? 'collapsed' : 'expanded'} ` +
      `${size.width}x${size.height}: ${JSON.stringify(last)}`,
  );
}

async function capture(mini, name, state, collapsed, size) {
  await waitForMiniState(mini, state, collapsed, size);
  await delay(300);
  const inspected = await waitForMiniState(mini, state, collapsed, size);
  const response = await mini.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(response.data, 'base64');
  const screenshot = path.join(outputDir, `${name}.png`);
  fs.writeFileSync(screenshot, png);
  return { ...inspected, screenshot, screenshotSize: readPngSize(png) };
}

function expectedRgb(token) {
  return `rgb(${token.split(/\s+/).join(', ')})`;
}

function isTransparent(value) {
  return value === 'transparent' || value === 'rgba(0, 0, 0, 0)';
}

function isCompactDuration(value) {
  return /^\d+:\d{2}(?::\d{2})?$/.test(String(value || ''));
}

function backgroundContainsToken(background, token) {
  return String(background || '').includes(
    String(token || '')
      .trim()
      .split(/\s+/)
      .join(', '),
  );
}

function everyElementReady(result, keys) {
  return keys.every((key) => {
    const element = result.elements[key];
    return element?.present && element.visible && element.insideShell;
  });
}

function assertResult(name, result, expected) {
  const classes = String(result.shellClass || '').split(/\s+/);
  const themeTokens = THEME_TOKENS[expected.theme];
  const assertions = [
    [classes.includes(`mini-window-${expected.state}`), 'state class'],
    [classes.includes('mini-window-collapsed') === expected.collapsed, 'collapse class'],
    [result.viewport[0] === expected.size.width, 'viewport width'],
    [
      expected.collapsed
        ? Math.abs(result.viewport[1] - expected.size.height) <= 1
        : result.viewport[1] === expected.size.height,
      'viewport height',
    ],
    [result.outer[0] === expected.size.width, 'window width'],
    [
      expected.collapsed
        ? result.outer[1] >= expected.size.height && result.outer[1] <= expected.size.height + 10
        : result.outer[1] === expected.size.height,
      'window height',
    ],
    [result.bodyScroll[0] === expected.size.width, 'no horizontal overflow'],
    [result.bodyScroll[1] === result.viewport[1], 'no vertical overflow'],
    [result.themeClass === expected.theme, `${expected.theme} color scheme`],
    [result.rootClasses.includes(expected.theme), `${expected.theme} root class`],
    [result.focusToken === themeTokens.focus, `${expected.theme} focus green token`],
    [result.pauseToken === themeTokens.pause, `${expected.theme} pause red token`],
    [
      expected.collapsed ||
        expected.state === 'running' ||
        backgroundContainsToken(result.primaryButtonBackground, result.accentToken),
      'start and resume use brand accent',
    ],
    [
      result.primaryTimeColor === expectedRgb(result.primaryTextToken),
      'neutral primary time color',
    ],
    [result.shellBackdropFilter === 'none', 'no mini backdrop filter'],
    [result.shellBackgroundImage === 'none', 'solid mini surface'],
    [result.edgeProgressAnimation === 'none', 'static edge progress'],
    [!result.hasMaterialGlow, 'no material glow layer'],
    [!result.hasMaterialGrain, 'no material grain layer'],
    [!result.hasFocusAura, 'no focus aura layer'],
    [!result.hasSignal, 'no decorative signal bars'],
    [isTransparent(result.bodyBackground), 'transparent body'],
    [result.timeComplete, 'complete unclipped primary time'],
    [
      result.timeDigitCount === (result.primaryTimeText.match(/\d/g) || []).length,
      'all time digits',
    ],
    [
      result.shellRect?.width === expected.size.width &&
        Math.abs(result.shellRect?.height - result.viewport[1]) < 1,
      'shell fills viewport',
    ],
    [
      result.buttons.every((button) => button.visible && button.insideShell),
      'buttons inside shell',
    ],
    [
      result.screenshotSize.width === Math.round(expected.size.width * result.devicePixelRatio),
      'screenshot width',
    ],
    [
      result.screenshotSize.height === Math.round(result.viewport[1] * result.devicePixelRatio),
      'screenshot height',
    ],
  ];
  if (expected.collapsed) {
    const compactKeys = [
      'collapsedContent',
      'compactCurrent',
      'compactLabel',
      'compactTime',
      'edgeProgress',
    ];
    const expandedKeys = [
      'expandedContent',
      'expandedHeader',
      'headerContext',
      'taskTitle',
      'expandedBody',
      'focusCore',
      'currentLabel',
      'expandedTime',
      'metricRail',
      'focusTotal',
      'pauseTotal',
      'wallTotal',
      'expandedFooter',
      'actionDock',
    ];
    const expectedCollapsedText = expected.stripLabel + result.primaryTimeText;
    assertions.push(
      [everyElementReady(result, compactKeys), 'collapsed key content inside shell'],
      [!result.elements.compactTotal.present, 'collapsed omits cumulative metric'],
      [expandedKeys.every((key) => !result.elements[key].present), 'no expanded content collapsed'],
      [result.buttons.length === 1, 'collapsed has one button only'],
      [result.buttons[0]?.ariaLabel === '展开', 'collapsed expand button'],
      [result.buttons[0]?.text === '', 'collapsed button has no extra copy'],
      [result.stateText === '', 'collapsed has no redundant state badge'],
      [result.compactLabel === expected.stripLabel, 'collapsed current label'],
      [result.collapsedContentText === expectedCollapsedText, 'collapsed precise visible content'],
      [result.primaryTimeFontSize >= 23, 'collapsed primary time at least 23px'],
      [result.elements.compactTime.rect?.height >= 22, 'collapsed primary time visually dominant'],
      [result.primaryText === null && result.secondaryText === null, 'no timer controls collapsed'],
    );
  } else {
    const expandedKeys = [
      'expandedContent',
      'expandedHeader',
      'headerContext',
      'taskTitle',
      'expandedBody',
      'focusCore',
      'currentLabel',
      'expandedTime',
      'metricRail',
      'focusTotal',
      'pauseTotal',
      'wallTotal',
      'expandedFooter',
      'actionDock',
    ];
    const iconLabels = result.buttons
      .map((button) => button.ariaLabel)
      .filter(Boolean)
      .sort();
    assertions.push(
      [everyElementReady(result, expandedKeys), 'expanded key content inside shell'],
      [!result.elements.collapsedContent.present, 'no collapsed content expanded'],
      [result.buttons.length === 4, 'expanded has four controls'],
      [
        JSON.stringify(iconLabels) === JSON.stringify(['打开主窗口', '收起'].sort()),
        'expanded icon controls',
      ],
      [result.primaryText === expected.primaryText, 'primary action'],
      [result.secondaryText === '结束', 'secondary action'],
      [result.stateText === expected.stateText, 'precise state label'],
      [result.currentLabel === expected.currentLabel, 'current timer label'],
      [result.taskTitle.length > 0, 'task context copy'],
      [result.primaryTimeFontSize >= 29, 'expanded primary time at least 29px'],
      [result.elements.focusCore.rect?.width >= 130, 'expanded primary time column at least 130px'],
      [
        JSON.stringify(result.metricLabels) === JSON.stringify(['累计专注', '累计暂停', '总历时']),
        'expanded metric labels',
      ],
      [
        result.metricValues.length === 3 && result.metricValues.every(isCompactDuration),
        'expanded metric durations',
      ],
      [/^总历时\d+:\d{2}(?::\d{2})?$/.test(result.wallTimeText), 'expanded wall duration'],
    );
  }
  const failed = assertions.filter(([passed]) => !passed).map(([, label]) => label);
  if (failed.length > 0) {
    throw new Error(`${name} assertions failed: ${failed.join(', ')}\n${JSON.stringify(result)}`);
  }
}

let mainSession;
let miniSession;

async function main() {
  process.stderr.write('[mini-smoke] waiting for main renderer\n');
  const mainTarget = await waitForTarget(
    (target) => target.type === 'page' && !String(target.url).includes('mini.html'),
    'main renderer',
  );
  mainSession = new CdpSession(mainTarget);
  await mainSession.open();

  process.stderr.write('[mini-smoke] force dark main theme with mini following main\n');
  await setFollowingMainTheme(mainSession, 'dark');
  await enableEdgeDock(mainSession);
  await mainSession.evaluate('window.focuslink.mini.show()');
  const miniTarget = await waitForTarget(
    (target) => target.type === 'page' && String(target.url).includes('mini.html'),
    'mini renderer',
  );
  miniSession = new CdpSession(miniTarget);
  await miniSession.open();
  await miniSession.send('Page.bringToFront');
  await waitForMiniTheme(miniSession, 'dark');

  await mainSession.evaluate('window.focuslink.mini.expand()');
  await waitForMiniState(miniSession, 'idle', false, EXPANDED_SIZE);
  await assertIdempotentSize(
    miniSession,
    'idle',
    false,
    EXPANDED_SIZE,
    'window.focuslink.mini.expand()',
    'expanded command',
  );

  process.stderr.write('[mini-smoke] start from expanded primary button\n');
  await clickMini(miniSession, '.mini-primary-button', 'start');
  await waitForPrimaryTimeAdvance(miniSession, 'running', false, EXPANDED_SIZE);
  process.stderr.write('[mini-smoke] capture running expanded\n');
  const results = {};
  results.runningExpanded = await capture(
    miniSession,
    'running-expanded',
    'running',
    false,
    EXPANDED_SIZE,
  );

  process.stderr.write('[mini-smoke] collapse from mini button and verify idempotence\n');
  await clickMini(miniSession, 'button[aria-label="收起"]', 'collapse');
  await waitForMiniState(miniSession, 'running', true, COLLAPSED_SIZE);
  await assertIdempotentSize(
    miniSession,
    'running',
    true,
    COLLAPSED_SIZE,
    'window.focuslink.mini.collapse()',
    'collapsed command',
  );
  process.stderr.write('[mini-smoke] capture running collapsed\n');
  results.runningCollapsed = await capture(
    miniSession,
    'running-collapsed',
    'running',
    true,
    COLLAPSED_SIZE,
  );

  process.stderr.write('[mini-smoke] expand from mini button and verify idempotence\n');
  await clickMini(miniSession, 'button[aria-label="展开"]', 'expand');
  await waitForMiniState(miniSession, 'running', false, EXPANDED_SIZE);
  await assertIdempotentSize(
    miniSession,
    'running',
    false,
    EXPANDED_SIZE,
    'window.focuslink.mini.expand()',
    'expanded command',
  );

  process.stderr.write('[mini-smoke] pause from expanded primary button\n');
  await clickMini(miniSession, '.mini-primary-button', 'pause');
  await waitForPrimaryTimeAdvance(miniSession, 'paused', false, EXPANDED_SIZE);
  process.stderr.write('[mini-smoke] capture paused expanded\n');
  results.pausedExpanded = await capture(
    miniSession,
    'paused-expanded',
    'paused',
    false,
    EXPANDED_SIZE,
  );

  process.stderr.write('[mini-smoke] collapse paused state from mini button\n');
  await clickMini(miniSession, 'button[aria-label="收起"]', 'collapse paused state');
  await waitForMiniState(miniSession, 'paused', true, COLLAPSED_SIZE);
  await assertIdempotentSize(
    miniSession,
    'paused',
    true,
    COLLAPSED_SIZE,
    'window.focuslink.mini.collapse()',
    'paused collapsed command',
  );
  process.stderr.write('[mini-smoke] capture paused collapsed\n');
  results.pausedCollapsed = await capture(
    miniSession,
    'paused-collapsed',
    'paused',
    true,
    COLLAPSED_SIZE,
  );

  assertResult('running expanded', results.runningExpanded, {
    theme: 'dark',
    state: 'running',
    collapsed: false,
    size: EXPANDED_SIZE,
    primaryText: '暂停',
    stateText: '专注中',
    currentLabel: '本段专注',
  });
  assertResult('running collapsed', results.runningCollapsed, {
    theme: 'dark',
    state: 'running',
    collapsed: true,
    size: COLLAPSED_SIZE,
    stripLabel: '专注',
  });
  assertResult('paused collapsed', results.pausedCollapsed, {
    theme: 'dark',
    state: 'paused',
    collapsed: true,
    size: COLLAPSED_SIZE,
    stripLabel: '暂停',
  });
  assertResult('paused expanded', results.pausedExpanded, {
    theme: 'dark',
    state: 'paused',
    collapsed: false,
    size: EXPANDED_SIZE,
    primaryText: '继续',
    stateText: '已暂停',
    currentLabel: '本段暂停',
  });

  process.stderr.write('[mini-smoke] verify live follow-main light theme without reload\n');
  await clickMini(miniSession, 'button[aria-label="展开"]', 'expand for controls');
  await waitForMiniState(miniSession, 'paused', false, EXPANDED_SIZE);
  await clickMini(miniSession, '.mini-primary-button', 'resume');
  const resumed = await waitForMiniState(miniSession, 'running', false, EXPANDED_SIZE);
  if (resumed.primaryText !== '暂停') {
    throw new Error(`Resume control did not restore pause action: ${JSON.stringify(resumed)}`);
  }

  const themeSmokeIdentity = `mini-theme-smoke-${Date.now()}`;
  const documentBeforeThemeSwitch = await miniSession.evaluate(`(() => {
    window.__focuslinkMiniThemeSmokeIdentity = ${JSON.stringify(themeSmokeIdentity)};
    return {
      timeOrigin: performance.timeOrigin,
      identity: window.__focuslinkMiniThemeSmokeIdentity,
    };
  })()`);
  await setFollowingMainTheme(mainSession, 'light');
  await waitForMiniTheme(miniSession, 'light');
  results.lightRunningExpanded = await capture(
    miniSession,
    'light-running-expanded',
    'running',
    false,
    EXPANDED_SIZE,
  );
  assertResult('light running expanded', results.lightRunningExpanded, {
    theme: 'light',
    state: 'running',
    collapsed: false,
    size: EXPANDED_SIZE,
    primaryText: '暂停',
    stateText: '专注中',
    currentLabel: '本段专注',
  });

  process.stderr.write('[mini-smoke] verify light paused collapsed state\n');
  await clickMini(miniSession, '.mini-primary-button', 'pause in light theme');
  await waitForPrimaryTimeAdvance(miniSession, 'paused', false, EXPANDED_SIZE);
  await clickMini(miniSession, 'button[aria-label="收起"]', 'collapse in light theme');
  results.lightPausedCollapsed = await capture(
    miniSession,
    'light-paused-collapsed',
    'paused',
    true,
    COLLAPSED_SIZE,
  );
  assertResult('light paused collapsed', results.lightPausedCollapsed, {
    theme: 'light',
    state: 'paused',
    collapsed: true,
    size: COLLAPSED_SIZE,
    stripLabel: '暂停',
  });

  process.stderr.write('[mini-smoke] switch follow-main theme back to dark without reload\n');
  await setFollowingMainTheme(mainSession, 'dark');
  const darkAgain = await waitForMiniTheme(miniSession, 'dark');
  if (
    darkAgain.timeOrigin !== documentBeforeThemeSwitch.timeOrigin ||
    darkAgain.themeSmokeIdentity !== themeSmokeIdentity ||
    darkAgain.viewport[0] !== COLLAPSED_SIZE.width ||
    Math.abs(darkAgain.viewport[1] - COLLAPSED_SIZE.height) > 1 ||
    darkAgain.bodyScroll[0] !== COLLAPSED_SIZE.width ||
    darkAgain.bodyScroll[1] !== darkAgain.viewport[1] ||
    !isTransparent(darkAgain.bodyBackground)
  ) {
    throw new Error(
      `Follow-main theme switch reloaded or disturbed mini layout: ${JSON.stringify({
        documentBeforeThemeSwitch,
        darkAgain,
      })}`,
    );
  }

  process.stderr.write('[mini-smoke] verify stop control after theme round trip\n');
  await clickMini(miniSession, 'button[aria-label="展开"]', 'expand after theme round trip');
  await waitForMiniState(miniSession, 'paused', false, EXPANDED_SIZE);
  await clickMini(miniSession, '.mini-primary-button', 'resume after theme round trip');
  await waitForMiniState(miniSession, 'running', false, EXPANDED_SIZE);
  await clickMini(miniSession, '.mini-secondary-button', 'stop');
  const stopped = await waitForMiniState(miniSession, 'finished', false, EXPANDED_SIZE);
  if (stopped.primaryText !== '开始' || stopped.secondaryText !== '结束') {
    throw new Error(`Stop control did not enter finished state: ${JSON.stringify(stopped)}`);
  }

  process.stderr.write(
    '[mini-smoke] verify four-edge policy through right-edge dock and release\n',
  );
  // A recent click-to-expand has a short anti-rebound grace period.
  await delay(1000);
  const workArea = await miniSession.evaluate(`(() => ({
    left: Number.isFinite(screen.availLeft) ? screen.availLeft : 0,
    top: Number.isFinite(screen.availTop) ? screen.availTop : 0,
    width: screen.availWidth,
    height: screen.availHeight,
  }))()`);
  const dockTop =
    workArea.top + Math.max(60, Math.round((workArea.height - EXPANDED_SIZE.height) / 3));
  const workAreaRight = workArea.left + workArea.width;
  await moveNativeWindow(miniSession, workAreaRight - EXPANDED_SIZE.width, dockTop);
  results.edgeDockCollapsed = await waitForMiniState(miniSession, null, true, COLLAPSED_SIZE);
  const dockedConfig = await miniSession.evaluate('window.focuslink.mini.getConfig()');
  if (
    results.edgeDockCollapsed.screenPosition[0] !== workAreaRight - COLLAPSED_SIZE.width ||
    dockedConfig?.collapsed !== true
  ) {
    throw new Error(
      `Right-edge collapse did not remain pinned: ${JSON.stringify({
        workArea,
        result: results.edgeDockCollapsed,
        config: dockedConfig,
      })}`,
    );
  }

  await delay(350);
  await moveNativeWindow(miniSession, workArea.left + 180, dockTop);
  results.edgeReleaseExpanded = await waitForMiniState(miniSession, null, false, EXPANDED_SIZE);
  const releasedConfig = await miniSession.evaluate('window.focuslink.mini.getConfig()');
  if (
    releasedConfig?.collapsed !== false ||
    results.edgeReleaseExpanded.screenPosition[0] <= workArea.left + 30 ||
    results.edgeReleaseExpanded.screenPosition[0] + EXPANDED_SIZE.width >= workAreaRight - 30
  ) {
    throw new Error(
      `Dragging the docked capsule away did not expand stably: ${JSON.stringify({
        workArea,
        result: results.edgeReleaseExpanded,
        config: releasedConfig,
      })}`,
    );
  }

  const report = {
    contract: { collapsed: COLLAPSED_SIZE, expanded: EXPANDED_SIZE },
    controls: { start: true, pause: true, resume: true, stop: true, collapse: true, expand: true },
    themes: {
      followMainTheme: true,
      dark: true,
      light: true,
      liveRoundTripWithoutReload: true,
      bodyTransparent: true,
    },
    edgeDock: {
      supportedEdges: ['left', 'right', 'top', 'bottom'],
      rightEdgeAutoCollapsed: true,
      draggedAwayAutoExpanded: true,
      enterThresholdPx: 14,
      releaseThresholdPx: 30,
    },
    results,
  };
  fs.writeFileSync(path.join(outputDir, 'states.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ outputDir, ...report }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (mainSession?.socket.readyState === WebSocket.OPEN) {
        await mainSession.evaluate('window.focuslink.window.quit()');
      }
    } catch {
      // The process is terminated below if graceful quit is unavailable.
    }
    miniSession?.close();
    mainSession?.close();
    await delay(300);
    if (!app.killed) app.kill();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

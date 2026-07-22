// 隔离 Electron 实例，自动开始专注 → 暂停，捕获时间之带、历史台账与删除确认。
// 运行方式（在 FocusLink/ 下）：
//   npx electron scripts/regression/temporal-ribbon-screenshot-entry.cjs
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureIsolatedUserData } from './isolatedUserData';
import { initDatabase, closeDatabase } from '../../electron/db/index.js';
import { TimerManager } from '../../electron/timer/manager.js';
import { FocusTimerController } from '../../electron/timer/focusTimerController.js';
import { getSettings, updateSettings } from '../../electron/settingsStore.js';
import { registerIpc } from '../../electron/ipc.js';
import { MINI_WINDOW_EXPANDED_SIZE } from '@shared/miniWindowLayout';
import { MAIN_WINDOW_DEFAULT_SIZE } from '@shared/mainWindowLayout';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const outputDir = path.resolve(projectRoot, 'test-data', 'temporal-ribbon-screenshots');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app
  .whenReady()
  .then(async () => {
    configureIsolatedUserData('temporal-ribbon-screenshot', true);
    fs.mkdirSync(outputDir, { recursive: true });
    initDatabase();

    // 禁用自动小窗、自动启动等，避免干扰截图。
    const settings = getSettings();
    updateSettings({
      miniWindow: {
        ...settings.miniWindow,
        collapsed: false,
        autoShowOnFocusStart: false,
        autoHideOnFocusEnd: false,
        autoShowOnMainHide: false,
        edgeAutoCollapse: false,
      },
      tomatodo: {
        ...settings.tomatodo,
        enabled: true,
      },
      startMinimizedToTray: false,
      showMiniOnStart: false,
    });

    const localTimer = new TimerManager();
    const timer = new FocusTimerController(localTimer);
    timer.recover();

    const mainWindow = new BrowserWindow({
      width: MAIN_WINDOW_DEFAULT_SIZE.width,
      height: MAIN_WINDOW_DEFAULT_SIZE.height,
      show: false,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#f5f7f4',
      webPreferences: {
        preload: path.join(projectRoot, 'dist-electron', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    const miniWindow = new BrowserWindow({
      width: MINI_WINDOW_EXPANDED_SIZE.width,
      height: MINI_WINDOW_EXPANDED_SIZE.height,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(projectRoot, 'dist-electron', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // Renderer 会在首次渲染时立即 invoke；必须在 loadFile 前完成注册。
    registerIpc(timer, mainWindow, () => undefined);
    // registerIpc 只注册 invoke 处理器，不主动广播 tick；这里把 snapshot 推给两个窗口。
    timer.onSnapshot((snapshot) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tick', snapshot);
        mainWindow.webContents.send('timer:state-changed', snapshot);
      }
      if (!miniWindow.isDestroyed()) {
        miniWindow.webContents.send('tick', snapshot);
      }
    });

    mainWindow.loadFile(path.join(projectRoot, 'dist', 'index.html'));
    miniWindow.loadFile(path.join(projectRoot, 'dist', 'mini.html'));

    await Promise.all([waitForDidFinishLoad(mainWindow), waitForDidFinishLoad(miniWindow)]);

    // 显示窗口并截图。
    mainWindow.show();
    miniWindow.show();
    miniWindow.setAlwaysOnTop(true);
    // 给一点渲染/合成时间。
    await sleep(800);

    // 在沉浸覆盖层内开始，确认 cue 不会落在被遮住的普通工作面上。
    await mainWindow.webContents.executeJavaScript(`
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('全屏沉浸'))?.click();
  `);
    await waitForSelector(mainWindow, '.focus-immersive');
    await sleep(760);
    await timer.toggle();
    await waitForState(timer, 'running');
    await waitForSelector(mainWindow, '.focus-immersive[data-transition="start"]');
    await assertCueAnimation(mainWindow, 'start');
    await sleep(160);
    await captureMain('00-immersive-start-cue', mainWindow);
    await mainWindow.webContents.executeJavaScript(`
    document.querySelector('.immersive-exit')?.click();
  `);
    await waitForSelectorGone(mainWindow, '.focus-immersive');
    await sleep(2600);

    // 切到时间之带 Tab：通过 IPC 导航到首页计时面板。
    mainWindow.webContents.send('navigate', 'home');
    await sleep(300);

    // 首次截图：专注态。
    await capture('01-focus-running', mainWindow, miniWindow);

    await timer.pause();
    await waitForState(timer, 'paused');

    // 暂停后不同时间点截图。
    const pauseShots = [100, 300, 600, 900, 1100, 1500, 2500, 3000, 5000];
    let previousDelay = 0;
    for (const delay of pauseShots) {
      await sleep(delay - previousDelay);
      const tag = `02-pause-${String(delay).padStart(4, '0')}ms`;
      await capture(tag, mainWindow, miniWindow);
      previousDelay = delay;
    }

    // 跨秒边界截图：找到下一秒前后。
    const snap = timer.getSnapshot();
    const pauseStart = snap.currentPauseStartedAt ?? Date.now();
    const nextSecond = Math.ceil((Date.now() - pauseStart) / 1000) * 1000 + pauseStart;
    await sleep(Math.max(0, nextSecond - Date.now() - 150));
    await capture('03-pause-before-second-boundary', mainWindow, miniWindow);
    await sleep(350);
    await capture('04-pause-after-second-boundary', mainWindow, miniWindow);

    // 静态 reduced-motion 验证：用 Chromium emulation 触发真实 MediaQueryList 更新。
    await Promise.all([
      emulateReducedMotion(mainWindow, true),
      emulateReducedMotion(miniWindow, true),
    ]);
    await sleep(300);
    await capture('05-pause-reduced-motion', mainWindow, miniWindow);

    await Promise.all([
      emulateReducedMotion(mainWindow, false),
      emulateReducedMotion(miniWindow, false),
    ]);
    await sleep(100);
    await mainWindow.webContents.executeJavaScript(`
    [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('全屏沉浸'))?.click();
  `);
    await waitForSelector(mainWindow, '.focus-immersive');
    await sleep(760);
    await timer.stop();
    await waitForState(timer, 'finished');
    await waitForSelector(mainWindow, '.focus-immersive[data-transition="finish"]');
    await assertCueAnimation(mainWindow, 'finish');
    await sleep(180);
    await captureMain('06-immersive-finish-cue', mainWindow);
    await mainWindow.webContents.executeJavaScript(`
    document.querySelector('.immersive-exit')?.click();
  `);
    await waitForSelectorGone(mainWindow, '.focus-immersive');
    await sleep(240);
    await capture('06-finished-frozen', mainWindow, miniWindow);

    // 运行时媒体模拟会改变 Framer Motion 的全局 preference；重载 renderer 后再验弹层，
    // 避免动画库缓存的 reduced-motion 状态让截图出现近零透明度的“幽灵弹窗”。
    detachDebugger(mainWindow);
    detachDebugger(miniWindow);
    await reloadWindow(mainWindow);
    await sleep(500);

    // 使用刚完成的真实会话验证连续历史台账与顶层危险确认。
    mainWindow.webContents.send('navigate', 'history');
    await waitForSelector(mainWindow, '.history-session-row');
    // 统计图表与会话行有交错显现（最长约 800ms），先等页面稳定再做视觉断言。
    await sleep(900);
    await mainWindow.webContents.executeJavaScript(`
    document.querySelector('.history-session-row')?.click();
  `);
    await waitForSelector(mainWindow, '.history-segment-ledger');
    const ledgerState = await mainWindow.webContents.executeJavaScript(`(() => ({
    focusRows: document.querySelectorAll('.history-segment-row.tone-focus').length,
    pauseRows: document.querySelectorAll('.history-segment-row.tone-pause').length,
  }))()`);
    if (ledgerState.focusRows < 1 || ledgerState.pauseRows < 1) {
      throw new Error(
        `History ledger did not render both row types: ${JSON.stringify(ledgerState)}`,
      );
    }
    // 等待详情高度动画落定后再滚动；否则后续展开会把目标重新推到视口外。
    await sleep(900);
    await mainWindow.webContents.executeJavaScript(`
    document.querySelector('.history-segment-list')?.scrollIntoView({ block: 'center' });
  `);
    await sleep(160);
    await captureMain('07-history-segment-ledger', mainWindow);

    await mainWindow.webContents.executeJavaScript(`
    document.querySelector('.history-icon-action.danger')?.click();
  `);
    await waitForSelector(mainWindow, '[data-testid="confirm-dialog-layer"]');
    await waitForDialogVisible(mainWindow);
    await sleep(240); // 等待 compositor 提交 portal 的新 frame
    await captureMain('08-history-delete-confirm', mainWindow);
    await mainWindow.webContents.executeJavaScript(`
    [...document.querySelectorAll('.confirm-actions button')]
      .find((button) => button.textContent?.trim() === '取消')?.click();
  `);
    await waitForSelectorGone(mainWindow, '[data-testid="confirm-dialog-layer"]');
    await mainWindow.webContents.executeJavaScript(
      `window.focuslink.settings.set({ theme: 'dark' })`,
    );
    await waitForDocumentClass(mainWindow, 'dark');
    await sleep(360);
    await mainWindow.webContents.executeJavaScript(`
    document.querySelector('.history-icon-action.danger')?.click();
  `);
    await waitForSelector(mainWindow, '[data-testid="confirm-dialog-layer"]');
    await waitForDialogVisible(mainWindow);
    await sleep(240);
    const dangerContrast = await measureDangerButtonContrast(mainWindow);
    if (dangerContrast < 4.5) {
      throw new Error(`Dark danger button contrast is only ${dangerContrast.toFixed(2)}:1`);
    }
    await captureMain('09-history-delete-confirm-dark', mainWindow);
    await mainWindow.webContents.executeJavaScript(`
    [...document.querySelectorAll('.confirm-actions button')]
      .find((button) => button.textContent?.trim() === '取消')?.click();
  `);
    await waitForSelectorGone(mainWindow, '[data-testid="confirm-dialog-layer"]');
    await mainWindow.webContents.executeJavaScript(
      `window.focuslink.settings.set({ theme: 'light' })`,
    );
    await waitForDocumentClass(mainWindow, 'light');

    // 最小主窗仍须完整容纳连续台账，不允许产生横向溢出。
    mainWindow.setContentSize(980, 660);
    await sleep(240);
    await mainWindow.webContents.executeJavaScript(`
    document.querySelector('.history-segment-list')?.scrollIntoView({ block: 'center' });
  `);
    await sleep(160);
    const minimumLayout = await mainWindow.webContents.executeJavaScript(`(() => {
    const ledger = document.querySelector('.history-segment-ledger')?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
      ledgerLeft: ledger?.left ?? -1,
      ledgerRight: ledger?.right ?? Number.POSITIVE_INFINITY,
    };
  })()`);
    if (
      minimumLayout.scrollWidth > minimumLayout.viewportWidth + 1 ||
      minimumLayout.ledgerLeft < 0 ||
      minimumLayout.ledgerRight > minimumLayout.viewportWidth + 1
    ) {
      throw new Error(`History ledger overflowed at 980x660: ${JSON.stringify(minimumLayout)}`);
    }
    await captureMain('10-history-segment-ledger-980x660', mainWindow);

    // 关闭数据库并退出。
    detachDebugger(mainWindow);
    detachDebugger(miniWindow);
    timer.dispose();
    closeDatabase();
    app.exit(0);
  })
  .catch((error) => {
    console.error('[screenshot] failed', error);
    try {
      closeDatabase();
    } catch {
      // The database may not have opened yet.
    }
    app.exit(1);
  });

function waitForDidFinishLoad(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (win.webContents.isLoadingMainFrame()) {
      win.webContents.once('did-finish-load', () => resolve());
    } else {
      resolve();
    }
  });
}

function reloadWindow(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    win.webContents.once('did-finish-load', () => resolve());
    win.reload();
  });
}

function waitForState(
  timer: FocusTimerController,
  state: 'running' | 'paused' | 'finished',
): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (timer.getSnapshot().state === state) {
        resolve();
        return;
      }
      setTimeout(check, 30);
    };
    check();
  });
}

async function emulateReducedMotion(win: BrowserWindow, reduced: boolean): Promise<void> {
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [
      {
        name: 'prefers-reduced-motion',
        value: reduced ? 'reduce' : 'no-preference',
      },
    ],
  });
}

function detachDebugger(win: BrowserWindow): void {
  if (!win.isDestroyed() && win.webContents.debugger.isAttached()) {
    win.webContents.debugger.detach();
  }
}

async function assertCueAnimation(win: BrowserWindow, cue: 'start' | 'finish'): Promise<void> {
  const animationName = await win.webContents.executeJavaScript(`
    getComputedStyle(document.querySelector('.focus-immersive'), '::after').animationName
  `);
  if (!String(animationName).includes(`focus-session-${cue}`)) {
    throw new Error(`Immersive ${cue} cue is not active: ${String(animationName)}`);
  }
}

async function measureDangerButtonContrast(win: BrowserWindow): Promise<number> {
  return win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.confirm-actions .btn-danger');
    if (!button) return 0;
    const style = getComputedStyle(button);
    const parse = (value) => (value.match(/[\\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (rgb) => {
      const channels = rgb.map((value) => {
        const normalized = value / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(parse(style.color));
    const background = luminance(parse(style.backgroundColor));
    return (Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05);
  })()`);
}

function waitForSelector(win: BrowserWindow, selector: string, timeoutMs = 8000): Promise<void> {
  return waitForSelectorState(win, selector, true, timeoutMs);
}

function waitForSelectorGone(
  win: BrowserWindow,
  selector: string,
  timeoutMs = 8000,
): Promise<void> {
  return waitForSelectorState(win, selector, false, timeoutMs);
}

function waitForDocumentClass(win: BrowserWindow, className: string): Promise<void> {
  return waitForSelector(win, `html.${className}`);
}

function waitForDialogVisible(win: BrowserWindow, timeoutMs = 4000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      const state = await win.webContents.executeJavaScript(`(() => {
        const layer = document.querySelector('[data-testid="confirm-dialog-layer"]');
        const backdrop = layer?.querySelector('.overlay-backdrop');
        const shell = layer?.querySelector('.confirm-shell');
        if (!layer || !backdrop || !shell) return null;
        const shellStyle = getComputedStyle(shell);
        const backdropStyle = getComputedStyle(backdrop);
        const rect = shell.getBoundingClientRect();
        const backgroundAlpha = Number(
          (shellStyle.backgroundColor.match(/[\\d.]+/g) ?? [0, 0, 0, 1])[3] ?? 1,
        );
        return {
          shellOpacity: Number(shellStyle.opacity),
          backdropOpacity: Number(backdropStyle.opacity),
          backgroundAlpha,
          width: rect.width,
          height: rect.height,
          insideViewport:
            rect.left >= 0 && rect.top >= 0 &&
            rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
        };
      })()`);
      if (
        state &&
        state.shellOpacity >= 0.98 &&
        state.backdropOpacity >= 0.98 &&
        state.backgroundAlpha >= 0.95 &&
        state.width >= 360 &&
        state.height >= 160 &&
        state.insideViewport
      ) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Dialog did not become visibly stable: ${JSON.stringify(state)}`));
        return;
      }
      setTimeout(() => void check(), 50);
    };
    void check();
  });
}

function waitForSelectorState(
  win: BrowserWindow,
  selector: string,
  expected: boolean,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      if (win.isDestroyed()) {
        reject(new Error(`Window closed while waiting for selector: ${selector}`));
        return;
      }
      const present = await win.webContents.executeJavaScript(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      );
      if (present === expected) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(
          new Error(`Timed out waiting for selector ${expected ? '' : 'to close '}${selector}`),
        );
        return;
      }
      setTimeout(() => void check(), 50);
    };
    void check();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function capture(
  tag: string,
  mainWindow: BrowserWindow,
  miniWindow: BrowserWindow,
): Promise<void> {
  // 完整窗口 PNG。
  const mainShot = await mainWindow.capturePage();
  fs.writeFileSync(path.join(outputDir, `${tag}-main.png`), mainShot.toPNG());

  const miniShot = await miniWindow.capturePage();
  fs.writeFileSync(path.join(outputDir, `${tag}-mini.png`), miniShot.toPNG());

  // 时间之带 Canvas PNG：通过执行 JS 获取 dataURL。
  const canvasDataUrl = await mainWindow.webContents.executeJavaScript(`
    (() => {
      const canvas = document.querySelector('.ribbon-canvas');
      return canvas ? canvas.toDataURL('image/png') : null;
    })()
  `);
  if (canvasDataUrl) {
    const base64 = canvasDataUrl.split(',')[1];
    fs.writeFileSync(
      path.join(outputDir, `${tag}-ribbon-canvas.png`),
      Buffer.from(base64, 'base64'),
    );
  }

  console.log(`[screenshot] captured ${tag}`);
}

async function captureMain(tag: string, mainWindow: BrowserWindow): Promise<void> {
  const mainShot = await mainWindow.capturePage();
  fs.writeFileSync(path.join(outputDir, `${tag}-main.png`), mainShot.toPNG());
  console.log(`[screenshot] captured ${tag}`);
}

// Electron 主进程入口
// 单实例锁、主窗口+专注小窗、托盘、快捷键、IPC、崩溃恢复、snapshot 推送
import {
  app,
  BrowserWindow,
  shell,
  powerMonitor,
  ipcMain,
  screen,
  nativeImage,
  Menu,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';
import { initDatabase, closeDatabase, listSegments, getSetting, setSetting } from './db/index.js';
import { TimerManager } from './timer/manager.js';
import { FocusTimerController } from './timer/focusTimerController.js';
import { createTray, destroyTray } from './tray.js';
import { registerIpc, setTimerForHotkeys } from './ipc.js';
import { getSettings, updateSettings } from './settingsStore.js';
import {
  unregisterAll,
  setHotkeyHandlers,
  setStateGetter,
  registerAllHotkeys,
  broadcastResults,
  type HotkeyHandlers,
} from './hotkeys.js';
import type { TimerSnapshot } from '@shared/types';
import { APP_VERSION, APP_COMMIT, APP_BUILD_TIME, APP_RELEASE_DIR } from '@shared/version';
import { hasTicktickLinkedSegments, shouldAutoSyncFinishedSession } from '@shared/autoSyncPolicy';
import {
  MINI_WINDOW_COLLAPSED_SIZE,
  MINI_WINDOW_COLLAPSED_HEIGHT,
  MINI_WINDOW_DOCK_TRANSITION_MS,
  MINI_WINDOW_EDGE_RELEASE_DISTANCE,
  MINI_WINDOW_EXPANDED_SIZE,
  MINI_WINDOW_SIZE_PRESETS,
  anchorMiniWindowToEdge,
  areMiniWindowBoundsClose,
  detectMiniWindowEdge,
  getExpandedMiniWindowSize,
  resizeMiniWindowAroundCenter,
  type MiniWindowEdge,
} from '@shared/miniWindowLayout';
import { MAIN_WINDOW_DEFAULT_SIZE, MAIN_WINDOW_MIN_SIZE } from '@shared/mainWindowLayout';
import {
  getLoginItemSettings,
  shouldAutoSelectDidaTaskSource,
  shouldStartHiddenToTray,
} from '@shared/startupPolicy';
import { enqueueSessionSync, runPending } from './sync/syncService.js';
import { resolveDidaExecTarget } from './tasks/cliProvider.js';
import {
  syncSessionToTomatodo,
  uploadPendingTomatodoRecords,
  getPendingTomatodoCount,
} from './sync/tomatodoSyncService.js';
import { runAutomaticDeviceSync } from './sync/deviceSyncService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 应用图标：开发态从项目根 build/，打包后从 resources/build/ 读取 */
function getAppIcon(): Electron.NativeImage {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon.ico')
    : path.join(__dirname, '..', 'build', 'icon.ico');
  try {
    return nativeImage.createFromPath(iconPath);
  } catch {
    return nativeImage.createEmpty();
  }
}

let mainWindow: BrowserWindow | null = null;
let miniWindow: BrowserWindow | null = null;
let miniDockedEdge: MiniWindowEdge | null = null;
let miniEdgeTimer: NodeJS.Timeout | null = null;
let miniDockTransitionActive = false;
let miniDockSnapBounds: Electron.Rectangle | null = null;
let miniBoundsMutationUntil = 0;
let miniEdgeSuppressUntil = 0;
let localTimer: TimerManager | null = null;
let timer: FocusTimerController | null = null;
// 标记用户真正想退出（点托盘"退出"），区分于"关闭窗口最小化到托盘"
let isQuitting = false;
// 上次计时器状态，用于检测状态转换触发小窗自动显示/隐藏
let lastTimerState: TimerSnapshot['state'] | null = null;
const autoSyncSessions = new Set<string>();
const autoSyncInFlight = new Set<Promise<void>>();
let runtimeUiInitialized = false;
let snapshotUnsubscribe: (() => void) | null = null;

const RENDERER_UNRESPONSIVE_GRACE_MS = 5_000;
const RENDERER_RECOVERY_WINDOW_MS = 60_000;
const RENDERER_MAX_RECOVERIES_PER_WINDOW = 3;

/**
 * A renderer reload is safe for FocusLink because the timer and ledger live in the main process.
 * Give transient Chromium stalls a short grace period, then recover the UI without ending focus.
 * A bounded retry window prevents a broken bundle from entering a tight reload loop.
 */
function attachRendererHealthRecovery(win: BrowserWindow, kind: 'main' | 'mini'): void {
  let unresponsiveTimer: NodeJS.Timeout | null = null;
  let recoveryInFlight = false;
  let recoveryWindowStartedAt = 0;
  let recoveryCount = 0;

  const clearUnresponsiveTimer = () => {
    if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
    unresponsiveTimer = null;
  };

  const context = () => {
    try {
      return {
        kind,
        url: win.webContents.getURL(),
        rendererPid: win.webContents.getOSProcessId(),
      };
    } catch {
      return { kind };
    }
  };

  const recover = (trigger: 'unresponsive' | 'render-process-gone', details?: unknown) => {
    if (isQuitting || win.isDestroyed() || recoveryInFlight) return;
    const now = Date.now();
    if (
      recoveryWindowStartedAt === 0 ||
      now - recoveryWindowStartedAt >= RENDERER_RECOVERY_WINDOW_MS
    ) {
      recoveryWindowStartedAt = now;
      recoveryCount = 0;
    }
    if (recoveryCount >= RENDERER_MAX_RECOVERIES_PER_WINDOW) {
      const retryInMs = Math.max(
        1_000,
        RENDERER_RECOVERY_WINDOW_MS - (now - recoveryWindowStartedAt),
      );
      logger.error('renderer', 'automatic recovery budget exhausted; retry scheduled', {
        ...context(),
        trigger,
        recoveryCount,
        retryInMs,
        details,
      });
      clearUnresponsiveTimer();
      unresponsiveTimer = setTimeout(() => {
        recoveryWindowStartedAt = 0;
        recoveryCount = 0;
        recover(trigger, details);
      }, retryInMs);
      unresponsiveTimer.unref?.();
      return;
    }

    recoveryInFlight = true;
    recoveryCount += 1;
    logger.warn('renderer', 'reloading renderer after health failure', {
      ...context(),
      trigger,
      recoveryAttempt: recoveryCount,
      details,
    });
    try {
      win.webContents.reloadIgnoringCache();
    } catch (error) {
      recoveryInFlight = false;
      logger.error('renderer', 'renderer reload failed', {
        ...context(),
        trigger,
        error,
      });
    }
  };

  win.on('unresponsive', () => {
    logger.warn('renderer', 'renderer became unresponsive', context());
    clearUnresponsiveTimer();
    unresponsiveTimer = setTimeout(() => recover('unresponsive'), RENDERER_UNRESPONSIVE_GRACE_MS);
    unresponsiveTimer.unref?.();
  });
  win.on('responsive', () => {
    clearUnresponsiveTimer();
    logger.info('renderer', 'renderer became responsive', context());
  });
  win.webContents.on('did-finish-load', () => {
    if (recoveryInFlight) {
      logger.info('renderer', 'renderer recovery completed', {
        ...context(),
        recoveryAttempt: recoveryCount,
      });
    }
    recoveryInFlight = false;
    clearUnresponsiveTimer();
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    clearUnresponsiveTimer();
    logger.error('renderer', 'render process gone', { ...context(), details });
    if (details.reason !== 'clean-exit') recover('render-process-gone', details);
  });
  win.on('closed', clearUnresponsiveTimer);
}

// ============ 单实例锁 ============
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (shouldStartHiddenToTray(false, argv)) {
      logger.info('main', 'second instance hidden startup ignored');
      return;
    }
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const isDev = !app.isPackaged;
function devUrl(): string {
  return process.env['VITE_DEV_SERVER_URL'] || 'http://localhost:5174';
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: MAIN_WINDOW_DEFAULT_SIZE.width,
    height: MAIN_WINDOW_DEFAULT_SIZE.height,
    minWidth: MAIN_WINDOW_MIN_SIZE.width,
    minHeight: MAIN_WINDOW_MIN_SIZE.height,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    backgroundColor: '#f5f7f4',
    title: 'FocusLink',
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  attachRendererHealthRecovery(win, 'main');

  logger.info('main', 'createMainWindow', { isDev, isPackaged: app.isPackaged });
  if (isDev) {
    win.loadURL(devUrl());
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // 关闭窗口：根据设置决定是最小化到托盘还是退出
  win.on('close', (e) => {
    if (!isQuitting) {
      const settings = getSettings();
      if (settings.closeToTray || settings.minimizeToTray) {
        e.preventDefault();
        win.hide();
        logger.info('main', 'window hidden to tray (close-to-tray)');
        return;
      }
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  // 主窗口最小化：根据设置自动显示专注小窗
  win.on('minimize', () => {
    const settings = getSettings();
    if (settings.miniWindow.autoShowOnMainHide) {
      logger.info('main', 'main window minimized, auto-show mini window');
      showMiniWindow();
    }
  });

  // 主窗口隐藏到托盘：根据设置自动显示专注小窗
  win.on('hide', () => {
    const settings = getSettings();
    if (settings.miniWindow.autoShowOnMainHide) {
      logger.info('main', 'main window hidden, auto-show mini window');
      showMiniWindow();
    }
  });

  win.once('ready-to-show', () => {
    const settings = getSettings();
    if (!shouldStartHiddenToTray(settings.startMinimizedToTray, process.argv)) {
      win.show();
    } else {
      logger.info('main', 'main window hidden on startup');
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  return win;
}

function createMiniWindow(): BrowserWindow {
  const settings = getSettings();
  const cfg = settings.miniWindow;
  // 小窗固定尺寸：边缘进度条 184×35，展开控制台尺寸来自 shared 唯一真值。
  const MIN_W = MINI_WINDOW_SIZE_PRESETS[0].width;
  const MIN_H = MINI_WINDOW_COLLAPSED_HEIGHT;
  const MAX_W = MINI_WINDOW_SIZE_PRESETS[1].width;
  const MAX_H = MINI_WINDOW_SIZE_PRESETS[1].height;
  const DEFAULT_W = MINI_WINDOW_SIZE_PRESETS[1].width;
  const DEFAULT_H = MINI_WINDOW_SIZE_PRESETS[1].height;

  // 启动时校验保存的尺寸是否合理，不合理则恢复默认
  let initWidth = cfg.width && cfg.width >= MIN_W && cfg.width <= MAX_W ? cfg.width : DEFAULT_W;
  let initHeight =
    cfg.height && cfg.height >= MIN_H && cfg.height <= MAX_H ? cfg.height : DEFAULT_H;
  if (cfg.collapsed) {
    initWidth = MINI_WINDOW_COLLAPSED_SIZE.width;
    initHeight = MINI_WINDOW_COLLAPSED_SIZE.height;
  } else {
    const expanded = getExpandedMiniWindowSize(initWidth, initHeight);
    initWidth = expanded.width;
    initHeight = expanded.height;
  }
  let initX = cfg.x;
  let initY = cfg.y;
  // 校验位置是否在屏幕内（避免上次保存位置已不在任何屏幕）
  if (initX !== null && initY !== null) {
    const testDisplay = screen.getDisplayMatching({
      x: initX,
      y: initY,
      width: initWidth,
      height: initHeight,
    });
    const wa = testDisplay.workArea;
    if (
      initX < wa.x - 100 ||
      initX > wa.x + wa.width - 100 ||
      initY < wa.y - 100 ||
      initY > wa.y + wa.height - 100
    ) {
      // 位置离屏 → 重置到默认
      initX = null;
      initY = null;
    }
  }
  const useHeight = cfg.collapsed ? MINI_WINDOW_COLLAPSED_HEIGHT : initHeight;

  const opts: Electron.BrowserWindowConstructorOptions = {
    width: initWidth,
    height: useHeight,
    minWidth: MIN_W,
    minHeight: MIN_H,
    maxWidth: MAX_W,
    maxHeight: MAX_H,
    frame: false,
    thickFrame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    title: 'FocusLink Mini',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  if (initX !== null && initY !== null) {
    opts.x = initX;
    opts.y = initY;
  } else {
    // 默认位置：右上角附近
    const primary = screen.getPrimaryDisplay();
    opts.x = primary.workArea.x + primary.workArea.width - initWidth - 24;
    opts.y = primary.workArea.y + 24;
  }

  const win = new BrowserWindow(opts);
  attachRendererHealthRecovery(win, 'mini');

  if (cfg.collapsed) {
    win.setContentSize(MINI_WINDOW_COLLAPSED_SIZE.width, MINI_WINDOW_COLLAPSED_SIZE.height, false);
  }

  if (cfg.collapsed && cfg.edgeAutoCollapse) {
    const initialBounds = win.getBounds();
    const initialDisplay = screen.getDisplayMatching(initialBounds);
    miniDockedEdge = detectMiniWindowEdge(
      initialBounds,
      initialDisplay.workArea,
      MINI_WINDOW_EDGE_RELEASE_DISTANCE,
    );
  } else {
    miniDockedEdge = null;
  }

  // 应用透明度（通过 setOpacity 控制整个窗口透明度）
  if (cfg.opacity < 1.0) {
    win.setOpacity(cfg.opacity);
  }

  if (isDev) {
    win.loadURL(devUrl().replace(/\/$/, '') + '/mini.html');
  } else {
    win.loadFile(path.join(__dirname, '../dist/mini.html'));
  }

  // 节流保存窗口位置和大小
  let saveTimer: NodeJS.Timeout | null = null;
  let applyingSnap = false;
  let nativeMoveLoopActive = false;
  const scheduleSave = () => {
    if (applyingSnap || Date.now() < miniBoundsMutationUntil) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!miniWindow || miniWindow.isDestroyed()) return;
      const cur = getSettings();
      let bounds = miniWindow.getBounds();
      if (!cur.miniWindow.collapsed) {
        const snapped = getExpandedMiniWindowSize(bounds.width, bounds.height);
        if (snapped.width !== bounds.width || snapped.height !== bounds.height) {
          applyingSnap = true;
          miniWindow.setBounds({ ...bounds, width: snapped.width, height: snapped.height }, false);
          applyingSnap = false;
          bounds = miniWindow.getBounds();
        }
      }
      // 收起时只保存位置，保留上次展开尺寸。
      const saveHeight = cur.miniWindow.collapsed ? cur.miniWindow.height : bounds.height;
      const saveWidth = cur.miniWindow.collapsed ? cur.miniWindow.width : bounds.width;
      updateSettings({
        miniWindow: {
          ...cur.miniWindow,
          width: saveWidth,
          height: saveHeight,
          x: bounds.x,
          y: bounds.y,
        },
      });
      logger.info('main', 'mini window bounds saved', {
        w: saveWidth,
        h: saveHeight,
        x: bounds.x,
        y: bounds.y,
      });
    }, 400);
  };

  const scheduleEdgeTransition = () => {
    const now = Date.now();
    if (nativeMoveLoopActive || now < miniEdgeSuppressUntil) return;

    if (miniDockTransitionActive) {
      const current = win.getBounds();
      const isProgrammaticSnap =
        miniDockSnapBounds !== null && areMiniWindowBoundsClose(current, miniDockSnapBounds);
      if (isProgrammaticSnap) return;

      // Any different native move during the fold cue is a new user drag.
      // Cancel the pending resize immediately so the window never collapses
      // underneath the pointer.
      if (miniEdgeTimer) clearTimeout(miniEdgeTimer);
      miniEdgeTimer = null;
      miniDockTransitionActive = false;
      miniDockSnapBounds = null;
      miniBoundsMutationUntil = 0;
      win.webContents.send('mini:dock-transition', { phase: 'cancel', edge: null });
    } else if (now < miniBoundsMutationUntil) {
      return;
    }

    if (miniEdgeTimer) clearTimeout(miniEdgeTimer);
    miniEdgeTimer = null;

    const cur = getSettings();
    if (!cur.miniWindow.edgeAutoCollapse) {
      miniDockedEdge = null;
      return;
    }

    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const edge = detectMiniWindowEdge(bounds, display.workArea);

    if (cur.miniWindow.collapsed) {
      const releaseEdge = detectMiniWindowEdge(
        bounds,
        display.workArea,
        MINI_WINDOW_EDGE_RELEASE_DISTANCE,
      );
      if (releaseEdge) {
        miniDockedEdge = releaseEdge;
        return;
      }
      // A manually collapsed window stays compact when moved. Only a docked
      // capsule expands automatically after it clearly leaves every edge.
      if (!miniDockedEdge) return;
      miniEdgeTimer = setTimeout(() => {
        if (!miniWindow || miniWindow.isDestroyed()) return;
        const latestBounds = miniWindow.getBounds();
        const latestDisplay = screen.getDisplayMatching(latestBounds);
        const stillAway = !detectMiniWindowEdge(
          latestBounds,
          latestDisplay.workArea,
          MINI_WINDOW_EDGE_RELEASE_DISTANCE,
        );
        if (stillAway) {
          // Drag-away is different from a click-to-expand: preserve the user's
          // new location instead of snapping the larger panel back to its old edge.
          miniDockedEdge = null;
          expandMiniWindow();
        }
      }, 140);
      return;
    }

    if (!edge) return;
    const delay = Math.max(180, Math.min(900, cur.miniWindow.edgeCollapseDelayMs));
    miniEdgeTimer = setTimeout(() => {
      if (!miniWindow || miniWindow.isDestroyed()) return;
      const latestBounds = miniWindow.getBounds();
      const latestDisplay = screen.getDisplayMatching(latestBounds);
      const latestEdge = detectMiniWindowEdge(latestBounds, latestDisplay.workArea);
      if (!latestEdge) return;

      // A real Windows drag reaches this timer only after WM_EXITSIZEMOVE. The
      // delay is a post-release settle period; it never resizes under the pointer.
      // Programmatic moves and non-Windows development builds use the same
      // debounced fallback. Snap first, then show the renderer fold cue.
      const snapped = anchorMiniWindowToEdge(
        latestBounds,
        MINI_WINDOW_EXPANDED_SIZE,
        latestDisplay.workArea,
        latestEdge,
      );
      miniDockedEdge = latestEdge;
      miniDockSnapBounds = snapped;
      applyMiniWindowBounds(snapped);
      miniBoundsMutationUntil = Date.now() + MINI_WINDOW_DOCK_TRANSITION_MS + 80;
      miniDockTransitionActive = true;
      miniWindow.webContents.send('mini:dock-transition', {
        phase: 'prepare',
        edge: latestEdge,
      });
      miniEdgeTimer = setTimeout(() => {
        miniEdgeTimer = null;
        miniDockTransitionActive = false;
        miniDockSnapBounds = null;
        collapseMiniWindow(latestEdge);
      }, MINI_WINDOW_DOCK_TRANSITION_MS);
    }, delay);
  };

  win.on('resize', scheduleSave);
  win.on('move', () => {
    scheduleSave();
    if (!nativeMoveLoopActive) scheduleEdgeTransition();
  });

  if (process.platform === 'win32') {
    const WM_ENTERSIZEMOVE = 0x0231;
    const WM_EXITSIZEMOVE = 0x0232;
    win.hookWindowMessage(WM_ENTERSIZEMOVE, () => {
      nativeMoveLoopActive = true;
      if (miniEdgeTimer) clearTimeout(miniEdgeTimer);
      miniEdgeTimer = null;
      if (miniDockTransitionActive) {
        miniDockTransitionActive = false;
        miniDockSnapBounds = null;
        miniBoundsMutationUntil = 0;
        win.webContents.send('mini:dock-transition', { phase: 'cancel', edge: null });
      }
    });
    win.hookWindowMessage(WM_EXITSIZEMOVE, () => {
      nativeMoveLoopActive = false;
      scheduleEdgeTransition();
    });
  }

  win.on('closed', () => {
    if (saveTimer) clearTimeout(saveTimer);
    if (miniEdgeTimer) clearTimeout(miniEdgeTimer);
    miniEdgeTimer = null;
    miniDockTransitionActive = false;
    miniDockSnapBounds = null;
    miniDockedEdge = null;
    nativeMoveLoopActive = false;
    miniWindow = null;
  });

  return win;
}

function applyMiniWindowBounds(bounds: Electron.Rectangle): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  miniBoundsMutationUntil = Date.now() + 260;
  if (
    bounds.width === MINI_WINDOW_COLLAPSED_SIZE.width &&
    bounds.height === MINI_WINDOW_COLLAPSED_SIZE.height
  ) {
    // Windows enforces a ~44px native minimum frame even for transparent
    // frameless windows. Content bounds keep the visible progress strip at the
    // product-owned 35px height while the unavoidable transparent frame stays
    // outside the renderer surface.
    miniWindow.setContentBounds(bounds, false);
  } else {
    miniWindow.setBounds(bounds, false);
  }
}

/** 收起小窗：围绕中心缩成进度胶囊；贴边时始终钉住接触边。 */
function collapseMiniWindow(edge?: MiniWindowEdge): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const cur = getSettings();
  if (cur.miniWindow.collapsed) return;
  if (miniDockTransitionActive) {
    if (miniEdgeTimer) clearTimeout(miniEdgeTimer);
    miniEdgeTimer = null;
    miniDockTransitionActive = false;
    miniDockSnapBounds = null;
  }
  const bounds = miniWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const dockedEdge =
    edge ??
    (cur.miniWindow.edgeAutoCollapse ? detectMiniWindowEdge(bounds, display.workArea) : null);
  const target = dockedEdge
    ? anchorMiniWindowToEdge(bounds, MINI_WINDOW_COLLAPSED_SIZE, display.workArea, dockedEdge)
    : resizeMiniWindowAroundCenter(bounds, MINI_WINDOW_COLLAPSED_SIZE, display.workArea);
  miniDockedEdge = dockedEdge;
  applyMiniWindowBounds(target);
  const next = updateSettings({
    miniWindow: {
      ...cur.miniWindow,
      x: target.x,
      y: target.y,
      collapsed: true,
    },
  });
  broadcastMiniSettings(next);
  logger.info('main', 'mini window collapsed', {
    edge: dockedEdge,
    x: target.x,
    y: target.y,
  });
}

/** 展开小窗：在原位置恢复控制台；从边缘展开时继续贴住该边。 */
function expandMiniWindow(): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const cur = getSettings();
  if (!cur.miniWindow.collapsed) return;
  if (miniEdgeTimer) clearTimeout(miniEdgeTimer);
  miniEdgeTimer = null;
  if (miniDockTransitionActive) {
    miniDockTransitionActive = false;
    miniDockSnapBounds = null;
    miniWindow.webContents.send('mini:dock-transition', { phase: 'cancel', edge: null });
  }
  const bounds = miniWindow.getBounds();
  const restore = getExpandedMiniWindowSize(cur.miniWindow.width, cur.miniWindow.height);
  const display = screen.getDisplayMatching(bounds);
  const edge = miniDockedEdge;
  const target = edge
    ? anchorMiniWindowToEdge(bounds, restore, display.workArea, edge)
    : resizeMiniWindowAroundCenter(bounds, restore, display.workArea);
  applyMiniWindowBounds(target);
  // A click on the docked capsule opens a usable panel. A later drag to an
  // edge re-arms auto-collapse; no hover loop can resize it underneath input.
  miniEdgeSuppressUntil = Date.now() + 900;
  miniDockedEdge = null;
  const next = updateSettings({
    miniWindow: {
      ...cur.miniWindow,
      width: restore.width,
      height: restore.height,
      x: target.x,
      y: target.y,
      collapsed: false,
    },
  });
  broadcastMiniSettings(next);
  logger.info('main', 'mini window expanded', { edge, x: target.x, y: target.y });
}

/** 重置小窗位置和大小为默认 */
function resetMiniWindow(): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const cur = getSettings();
  const next = updateSettings({
    miniWindow: {
      ...cur.miniWindow,
      width: MINI_WINDOW_SIZE_PRESETS[1].width,
      height: MINI_WINDOW_SIZE_PRESETS[1].height,
      x: null,
      y: null,
      collapsed: false,
    },
  });
  const primary = screen.getPrimaryDisplay();
  miniDockedEdge = null;
  miniEdgeSuppressUntil = Date.now() + 900;
  applyMiniWindowBounds({
    x: primary.workArea.x + primary.workArea.width - MINI_WINDOW_SIZE_PRESETS[1].width - 24,
    y: primary.workArea.y + 24,
    width: MINI_WINDOW_SIZE_PRESETS[1].width,
    height: MINI_WINDOW_SIZE_PRESETS[1].height,
  });
  broadcastMiniSettings(next);
  logger.info('main', 'mini window reset to default');
}

function broadcastMiniSettings(settings: ReturnType<typeof getSettings>): void {
  for (const window of getAllWindows()) {
    window.webContents.send('settings:changed', settings);
  }
}

function showMiniWindow(): void {
  if (!miniWindow) {
    miniWindow = createMiniWindow();
  }
  miniWindow.show();
  miniWindow.setAlwaysOnTop(true);
}

function hideMiniWindow(): void {
  if (miniWindow) {
    miniWindow.hide();
  }
}

function toggleMiniWindow(): void {
  if (miniWindow && miniWindow.isVisible()) {
    hideMiniWindow();
  } else {
    showMiniWindow();
  }
}

function toggleMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

/** 把 snapshot 推送到所有渲染窗口 - 计时数字实时刷新的关键 */
function pushSnapshot(snap: TimerSnapshot): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tick', snap);
  }
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send('tick', snap);
  }
  // 检测状态转换：专注开始/结束时自动控制小窗
  handleTimerStateTransition(snap);
}

/** 专注开始/结束时根据设置自动显示/隐藏小窗 */
function handleTimerStateTransition(snap: TimerSnapshot): void {
  const prev = lastTimerState;
  lastTimerState = snap.state;
  if (prev === snap.state) return;
  // getSettings performs compatibility checks backed by SQLite. It is only needed for an actual
  // state transition, not for every one-second timer tick.
  const cur = getSettings();

  // 专注开始：从非 running 状态转为 running
  const justStarted = snap.state === 'running' && prev !== 'running';
  if (justStarted && cur.miniWindow.autoShowOnFocusStart) {
    // 仅当主窗口不在前台时才自动显示小窗
    const mainVisible =
      mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused();
    if (!mainVisible) {
      logger.info('main', 'focus started and main window not focused, auto-show mini window');
      showMiniWindow();
    }
  }
  // v0.1.5：移除 autoCollapseOnFocusStart 逻辑（贴边收纳不稳定，交给 UI AI 重做）

  // 专注结束：从 running/paused 转为 finished
  const justFinished = snap.state === 'finished' && (prev === 'running' || prev === 'paused');
  if (justFinished && snap.sessionId) {
    const operation = autoSyncFinishedSession(snap.sessionId);
    autoSyncInFlight.add(operation);
    void operation.finally(() => autoSyncInFlight.delete(operation));
  }
  if (justFinished && cur.miniWindow.autoHideOnFocusEnd) {
    logger.info('main', 'focus finished, auto-hide mini window');
    hideMiniWindow();
  }
}

async function autoSyncFinishedSession(sessionId: string): Promise<void> {
  if (autoSyncSessions.has(sessionId)) return;
  autoSyncSessions.add(sessionId);
  const operations: Promise<unknown>[] = [];

  // FocusLink's own cross-device ledger replication is a separate domain from dida/TomaToDo.
  // It only exports completed bundles and never exposes provider credentials or local bridges.
  operations.push(
    runAutomaticDeviceSync()
      .then((result) => {
        if (result && (result.pushed > 0 || result.imported > 0)) {
          logger.info('deviceSync', 'auto sync after focus finished', result);
        }
      })
      .catch((error) => {
        logger.warn('deviceSync', 'auto sync after focus finished failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
  );

  // 番茄 Todo 同步：独立并行通道，不受 dida syncMode 影响，按学科分类写入本地库
  operations.push(
    syncSessionToTomatodo(sessionId)
      .then((ttResult) => {
        if (ttResult.total > 0) {
          logger.info('tomatodoSync', 'auto sync after focus finished', {
            sessionId,
            total: ttResult.total,
            synced: ttResult.synced,
            cloudSynced: ttResult.results.filter((result) => result.cloudSynced).length,
            skipped: ttResult.skipped,
            failed: ttResult.failed,
            dbPath: ttResult.dbPath,
          });
        }
      })
      .catch((err) => {
        logger.warn('tomatodoSync', 'auto sync failed', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }),
  );

  // dida 同步（原有逻辑）
  const settings = getSettings();
  const segments = listSegments(sessionId);
  if (!shouldAutoSyncFinishedSession(settings.syncMode, segments)) {
    if (settings.syncMode === 'local-only') {
      logger.info('sync', 'auto sync skipped: local-only mode', { sessionId });
    } else if (!hasTicktickLinkedSegments(segments)) {
      logger.info('sync', 'auto sync skipped: no ticktick-linked segments', { sessionId });
    }
    await Promise.allSettled(operations);
    return;
  }

  try {
    enqueueSessionSync(sessionId);
  } catch (err) {
    logger.warn('sync', 'auto enqueue failed', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    await Promise.allSettled(operations);
    return;
  }

  operations.push(
    runPending()
      .then((result) => {
        logger.info('sync', 'auto sync after focus finished', { sessionId, ...result });
      })
      .catch((err) => {
        logger.warn('sync', 'auto sync run failed', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }),
  );
  await Promise.allSettled(operations);
}

function getAllWindows(): BrowserWindow[] {
  const wins: BrowserWindow[] = [];
  if (mainWindow && !mainWindow.isDestroyed()) wins.push(mainWindow);
  if (miniWindow && !miniWindow.isDestroyed()) wins.push(miniWindow);
  return wins;
}

function ensureTrayAndHotkeys(): void {
  if (!mainWindow || !timer) return;
  if (runtimeUiInitialized) return;
  runtimeUiInitialized = true;
  let trayCreated = false;
  try {
    createTray(mainWindow, timer, {
      onShowMini: showMiniWindow,
      onHideMini: hideMiniWindow,
      onCollapseMini: collapseMiniWindow,
      onExpandMini: expandMiniWindow,
      onResetMini: resetMiniWindow,
    });
    trayCreated = true;
    setTimerForHotkeys(timer);

    // 注入状态查询函数（快捷键触发日志用）
    setStateGetter(() => timer?.getSnapshot().state ?? 'unknown');

    // 快捷键 handler
    const hotkeyHandlers: HotkeyHandlers = {
      toggleTimer: () => {
        void timer
          ?.toggle()
          .catch((error) => logger.warn('hotkey', 'toggle failed', { error: String(error) }));
      },
      stopTimer: () =>
        void timer
          ?.stop()
          .catch((error) => logger.warn('hotkey', 'stop failed', { error: String(error) })),
      toggleWindow: () => toggleMainWindow(),
      linkTask: () => {
        mainWindow?.show();
        mainWindow?.focus();
        mainWindow?.webContents.send('navigate', 'tasks');
      },
      toggleMiniWindow: () => toggleMiniWindow(),
    };
    setHotkeyHandlers(hotkeyHandlers);

    // ready-to-show and the already-loaded fallback can race. Keep exactly one snapshot listener.
    snapshotUnsubscribe = timer.onSnapshot(pushSnapshot);

    // 注册快捷键并广播结果
    const settings = getSettings();
    const results = registerAllHotkeys(settings);
    broadcastResults(getAllWindows(), results);
  } catch (error) {
    logger.error('main', 'tray/hotkey initialization failed', error);
    // Once createTray returns it owns a timer listener; retrying initialization would duplicate it.
    // Keep the usable tray/snapshot path and degrade only the failed optional shortcut setup.
    if (!trayCreated) {
      snapshotUnsubscribe?.();
      snapshotUnsubscribe = null;
      runtimeUiInitialized = false;
      destroyTray();
    }
  }
}

app.whenReady().then(() => {
  logger.init();
  // 移除默认菜单栏（File/Edit/View/Window/Help）— 专业应用不显示默认菜单
  Menu.setApplicationMenu(null);
  // 版本标识：启动时输出完整版本信息，避免用户打开旧版
  logger.info('main', `FocusLink version: ${APP_VERSION}`, {
    commit: APP_COMMIT,
    buildTime: APP_BUILD_TIME,
    releaseDir: APP_RELEASE_DIR,
    electronVersion: app.getVersion(),
    isDev,
  });
  console.log(`FocusLink version: ${APP_VERSION}`);
  console.log(`commit: ${APP_COMMIT}`);
  console.log(`buildTime: ${APP_BUILD_TIME}`);
  console.log(`releaseDir: ${APP_RELEASE_DIR}`);

  initDatabase();

  let settings = getSettings();
  const didaSourceMigrationKey = 'migration.taskSourceDidaV060';
  const didaSourceMigrationDone = getSetting(didaSourceMigrationKey) === '1';
  if (!didaSourceMigrationDone) {
    try {
      const target = resolveDidaExecTarget(settings.ticktickCli.executable);
      const didaInstalled = target.kind !== 'path-command' || fs.existsSync(target.executablePath);
      if (
        shouldAutoSelectDidaTaskSource({
          migrationDone: didaSourceMigrationDone,
          didaInstalled,
          taskSource: settings.taskSource,
        })
      ) {
        settings = updateSettings({ taskSource: 'ticktick-cli' });
        logger.info('main', 'selected dida CLI as the default task source', {
          executablePath: target.executablePath,
        });
      }
      if (didaInstalled) {
        setSetting(didaSourceMigrationKey, '1');
      }
    } catch (error) {
      logger.warn('main', 'dida default source detection deferred', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  localTimer = new TimerManager();
  timer = new FocusTimerController(localTimer);
  timer.setSegmentBehavior(settings.segmentBehavior);

  mainWindow = createMainWindow();

  // 设置 IPC，传入按域分流的 onSettingsChanged 回调
  registerIpc(timer, mainWindow, (domains, s) => {
    if (!timer) return;
    // 计时行为变更
    if (domains.includes('general')) {
      timer.setSegmentBehavior(s.segmentBehavior);
    }
    if (domains.includes('deviceSync')) {
      timer.reloadConfiguration();
    }
    // 只有快捷键域变更才重新注册 - 主题/小窗/任务来源变更不再触发快捷键重注册
    if (domains.includes('hotkeys')) {
      unregisterAll();
      const results = registerAllHotkeys(s);
      broadcastResults(getAllWindows(), results);
    }
    // 开机自启
    if (domains.includes('general')) {
      app.setLoginItemSettings(getLoginItemSettings(s.autoStart));
    }
    // Tray actions do not depend on mutable settings. Recreating it leaked the previous timer
    // listener and multiplied native menu rebuilds on every tick, so keep the single tray alive.
  });

  // 崩溃恢复
  timer.recover();

  // 启动时自动处理积压的同步队列（迁移重置的失败项等）
  void runPending()
    .then((result) => {
      if (result.processed > 0) {
        logger.info('sync', 'startup sync completed', result);
      }
    })
    .catch((err) => {
      logger.warn('sync', 'startup sync failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

  void runAutomaticDeviceSync().catch((error) => {
    logger.warn('deviceSync', 'startup sync failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // 启动后立即检查，并持续探测番茄 Todo：用户晚于 FocusLink 启动客户端时也能自动补传。
  const TOMATODO_UPLOAD_INTERVAL_MS = 20_000;
  let tomatodoUploadInFlight = false;
  const runTomatodoPendingUpload = () => {
    if (tomatodoUploadInFlight) return;
    const pending = getPendingTomatodoCount();
    if (pending === 0) return;
    tomatodoUploadInFlight = true;
    void uploadPendingTomatodoRecords()
      .then((result) => {
        if (result.uploaded > 0) {
          logger.info('tomatodoSync', 'periodic pending upload', result);
        }
      })
      .catch((err) => {
        logger.warn('tomatodoSync', 'periodic upload failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        tomatodoUploadInFlight = false;
      });
  };
  runTomatodoPendingUpload();
  setInterval(runTomatodoPendingUpload, TOMATODO_UPLOAD_INTERVAL_MS);

  const DEVICE_SYNC_INTERVAL_MS = 60_000;
  const deviceSyncInterval = setInterval(() => {
    void runAutomaticDeviceSync().catch((error) => {
      logger.warn('deviceSync', 'periodic sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, DEVICE_SYNC_INTERVAL_MS);
  deviceSyncInterval.unref?.();

  // 专注小窗 IPC 控制
  ipcMain.on('mini:show', () => showMiniWindow());
  ipcMain.on('mini:hide', () => hideMiniWindow());
  ipcMain.on('mini:toggle', () => toggleMiniWindow());
  ipcMain.on('mini:collapse', () => collapseMiniWindow());
  ipcMain.on('mini:expand', () => expandMiniWindow());
  ipcMain.on('mini:reset', () => resetMiniWindow());
  ipcMain.handle('mini:get-config', () => getSettings().miniWindow);
  // 设置变化时实时应用透明度
  ipcMain.on('mini:set-opacity', (_e, opacity: number) => {
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.setOpacity(Math.max(0.6, Math.min(1.0, opacity)));
    }
  });

  // 托盘 + 快捷键 + snapshot 推送
  mainWindow.once('ready-to-show', () => {
    ensureTrayAndHotkeys();
    if (settings.showMiniOnStart) {
      showMiniWindow();
    }
  });
  if (mainWindow.webContents.isLoading() === false) {
    ensureTrayAndHotkeys();
  }

  app.setLoginItemSettings(getLoginItemSettings(settings.autoStart));

  // 电源事件
  powerMonitor.on('suspend', () => {
    logger.info('main', 'system suspend');
  });
  powerMonitor.on('resume', () => {
    logger.info('main', 'system resume');
    timer?.reconnect();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    } else {
      mainWindow?.show();
    }
  });
});

// 关闭主窗口后保留托盘，不退出
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    // macOS 不退出
  }
  // Windows/Linux 关闭窗口后保留托盘
});

// 真正退出（点托盘"退出"时 isQuitting=true）
app.on('before-quit', (e) => {
  if (isQuitting) return;
  e.preventDefault();
  isQuitting = true;
  logger.info('main', 'before-quit: persisting & cleaning up');
  void (async () => {
    try {
      timer?.dispose();
    } catch (err) {
      logger.error('main', 'timer dispose error', err);
    }

    const pending = [...autoSyncInFlight];
    if (pending.length > 0) {
      logger.info('main', 'before-quit: waiting for sync handoff', { count: pending.length });
      await Promise.race([
        Promise.allSettled(pending),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
    snapshotUnsubscribe?.();
    snapshotUnsubscribe = null;
    runtimeUiInitialized = false;
    destroyTray();
    unregisterAll();
    closeDatabase();
    app.exit(0);
  })();
});

process.on('uncaughtException', (err) => {
  logger.error('main', 'uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  logger.error('main', 'unhandledRejection', reason);
});

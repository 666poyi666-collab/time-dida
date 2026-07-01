// Electron 主进程入口
// 单实例锁、主窗口+专注小窗、托盘、快捷键、IPC、崩溃恢复、snapshot 推送
import { app, BrowserWindow, shell, powerMonitor, Tray, ipcMain, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';
import { initDatabase, closeDatabase, listSegments } from './db/index.js';
import { TimerManager } from './timer/manager.js';
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
  MINI_WINDOW_SIZE_PRESETS,
  getExpandedMiniWindowSize,
} from '@shared/miniWindowLayout';
import { getLoginItemSettings, shouldStartHiddenToTray } from '@shared/startupPolicy';
import { enqueueSessionSync, runPending } from './sync/syncService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let miniWindow: BrowserWindow | null = null;
let timer: TimerManager | null = null;
let tray: Tray | null = null;
// 标记用户真正想退出（点托盘"退出"），区分于"关闭窗口最小化到托盘"
let isQuitting = false;
// 上次计时器状态，用于检测状态转换触发小窗自动显示/隐藏
let lastTimerState: TimerSnapshot['state'] | null = null;
const autoSyncSessions = new Set<string>();

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
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: true,
    titleBarStyle: 'default',
    backgroundColor: '#0b0e14',
    title: 'FocusLink',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

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
  // 小窗固定尺寸：缩小卡片 260×88，展开详情 420×184。
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
  const scheduleSave = () => {
    if (applyingSnap) return;
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

  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);

  // v0.1.5 稳定性策略：移除贴边自动收纳 + 鼠标悬停展开 + 专注开始自动收纳
  // 原因：贴边检测不稳定，动画导致窗口乱跳；小窗 UI 交给 UI AI 重做
  // 保留：手动收起/展开（托盘菜单 + 快捷键）、主窗口隐藏时自动显示

  win.on('closed', () => {
    miniWindow = null;
  });

  return win;
}

/** 收起小窗：直接 setBounds 到 260×88 缩小卡片，无动画（避免窗口乱跳） */
function collapseMiniWindow(): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const cur = getSettings();
  if (cur.miniWindow.collapsed) return;
  const bounds = miniWindow.getBounds();
  miniWindow.setBounds(
    {
      x: bounds.x,
      y: bounds.y,
      width: MINI_WINDOW_COLLAPSED_SIZE.width,
      height: MINI_WINDOW_COLLAPSED_SIZE.height,
    },
    false,
  );
  updateSettings({ miniWindow: { ...cur.miniWindow, collapsed: true } });
  logger.info('main', 'mini window collapsed (no animation)');
}

/** 展开小窗：直接 setBounds 恢复高度，无动画 */
function expandMiniWindow(): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const cur = getSettings();
  if (!cur.miniWindow.collapsed) return;
  const bounds = miniWindow.getBounds();
  const restore = getExpandedMiniWindowSize(cur.miniWindow.width, cur.miniWindow.height);
  miniWindow.setBounds(
    { x: bounds.x, y: bounds.y, width: restore.width, height: restore.height },
    false,
  );
  updateSettings({ miniWindow: { ...cur.miniWindow, collapsed: false } });
  logger.info('main', 'mini window expanded (no animation)');
}

/** 重置小窗位置和大小为默认 */
function resetMiniWindow(): void {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const cur = getSettings();
  updateSettings({
    miniWindow: {
      ...cur.miniWindow,
      width: MINI_WINDOW_SIZE_PRESETS[1].width,
      height: MINI_WINDOW_SIZE_PRESETS[1].height,
      x: null,
      y: null,
      collapsed: false,
    },
  });
  miniWindow.setSize(MINI_WINDOW_SIZE_PRESETS[1].width, MINI_WINDOW_SIZE_PRESETS[1].height);
  // 重置到屏幕右上角
  const primary = screen.getPrimaryDisplay();
  miniWindow.setPosition(
    primary.workArea.x + primary.workArea.width - MINI_WINDOW_SIZE_PRESETS[1].width - 24,
    primary.workArea.y + 24,
  );
  logger.info('main', 'mini window reset to default');
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
  const cur = getSettings();
  const prev = lastTimerState;
  lastTimerState = snap.state;
  if (prev === snap.state) return;

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
    autoSyncFinishedSession(snap.sessionId);
  }
  if (justFinished && cur.miniWindow.autoHideOnFocusEnd) {
    logger.info('main', 'focus finished, auto-hide mini window');
    hideMiniWindow();
  }
}

function autoSyncFinishedSession(sessionId: string): void {
  if (autoSyncSessions.has(sessionId)) return;
  const settings = getSettings();
  const segments = listSegments(sessionId);
  if (!shouldAutoSyncFinishedSession(settings.syncMode, segments)) {
    if (settings.syncMode === 'local-only') {
      logger.info('sync', 'auto sync skipped: local-only mode', { sessionId });
    } else if (!hasTicktickLinkedSegments(segments)) {
      logger.info('sync', 'auto sync skipped: no ticktick-linked segments', { sessionId });
    }
    return;
  }

  autoSyncSessions.add(sessionId);
  try {
    enqueueSessionSync(sessionId);
  } catch (err) {
    logger.warn('sync', 'auto enqueue failed', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  void runPending()
    .then((result) => {
      logger.info('sync', 'auto sync after focus finished', { sessionId, ...result });
    })
    .catch((err) => {
      logger.warn('sync', 'auto sync run failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

function getAllWindows(): BrowserWindow[] {
  const wins: BrowserWindow[] = [];
  if (mainWindow && !mainWindow.isDestroyed()) wins.push(mainWindow);
  if (miniWindow && !miniWindow.isDestroyed()) wins.push(miniWindow);
  return wins;
}

function ensureTrayAndHotkeys(): void {
  if (!mainWindow || !timer) return;
  tray = createTray(mainWindow, timer, {
    onShowMini: showMiniWindow,
    onHideMini: hideMiniWindow,
    onCollapseMini: collapseMiniWindow,
    onExpandMini: expandMiniWindow,
    onResetMini: resetMiniWindow,
  });
  setTimerForHotkeys(timer);

  // 注入状态查询函数（快捷键触发日志用）
  setStateGetter(() => timer?.getSnapshot().state ?? 'unknown');

  // 快捷键 handler
  const hotkeyHandlers: HotkeyHandlers = {
    toggleTimer: () => {
      timer?.toggle();
    },
    stopTimer: () => timer?.stop(),
    toggleWindow: () => toggleMainWindow(),
    linkTask: () => {
      mainWindow?.show();
      mainWindow?.focus();
      mainWindow?.webContents.send('navigate', 'tasks');
    },
    toggleMiniWindow: () => toggleMiniWindow(),
  };
  setHotkeyHandlers(hotkeyHandlers);

  // 注册 snapshot 推送（核心修复：计时器实时刷新）
  timer.onSnapshot((snap) => pushSnapshot(snap));

  // 注册快捷键并广播结果
  const settings = getSettings();
  const results = registerAllHotkeys(settings);
  broadcastResults(getAllWindows(), results);
}

app.whenReady().then(() => {
  logger.init();
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

  const settings = getSettings();
  timer = new TimerManager(settings.segmentBehavior);

  mainWindow = createMainWindow();

  // 设置 IPC，传入按域分流的 onSettingsChanged 回调
  registerIpc(timer, mainWindow, (domains, s) => {
    if (!timer) return;
    // 计时行为变更
    if (domains.includes('general')) {
      timer.setSegmentBehavior(s.segmentBehavior);
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
    // 托盘菜单需重建（含小窗选项）
    if (domains.includes('general') && tray && mainWindow && timer) {
      destroyTray();
      tray = createTray(mainWindow, timer, {
        onShowMini: showMiniWindow,
        onHideMini: hideMiniWindow,
        onCollapseMini: collapseMiniWindow,
        onExpandMini: expandMiniWindow,
        onResetMini: resetMiniWindow,
      });
    }
  });

  // 崩溃恢复
  timer.recover();

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
    timer?.recover();
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
  try {
    timer?.dispose();
  } catch (err) {
    logger.error('main', 'timer dispose error', err);
  }
  destroyTray();
  unregisterAll();
  closeDatabase();
  app.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error('main', 'uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  logger.error('main', 'unhandledRejection', reason);
});

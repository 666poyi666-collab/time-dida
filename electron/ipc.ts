// IPC 处理器 - 主进程接收渲染进程调用
// 所有 IPC 通道类型安全；关键操作写日志
import { ipcMain, BrowserWindow } from 'electron';
import type { TimerManager } from './timer/manager.js';
import { LocalTaskProvider } from './tasks/localProvider.js';
import {
  detectCli,
  diagnoseCli,
  testCommand,
  ticktickCliProvider,
  applyDidaDefaults,
  templatesContainTicktick,
  DIDA_DEFAULT_TEMPLATES,
} from './tasks/cliProvider.js';
import { ticktickAdapter } from './providers/ticktickAdapter.js';
import { getSettings, saveSettings, updateSettings, setHotkey } from './settingsStore.js';
import {
  registerAllHotkeys,
  setHotkeyHandlers,
  registerSingle,
  testAccelerator,
  getRegistrationStatus,
  isValidAccelerator,
  type HotkeyHandlers,
  type RegistrationResult,
} from './hotkeys.js';
import {
  enqueueSegmentSync,
  enqueueSessionSync,
  listQueue,
  retryItem,
  runPending,
} from './sync/syncService.js';
import {
  listSessions,
  getSession as getSessionDb,
  listSegments,
  listPauses,
  deleteSession,
} from './db/index.js';
import { exportSessionById } from './export.js';
import { logger } from './logger.js';
import type { TaskSource, AppSettings, SettingsDomain, Task } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';

/** 计算设置变更涉及的域 - 用于按域分流副作用，避免主题保存触发快捷键重注册 */
function detectChangedDomains(prev: AppSettings, next: AppSettings): SettingsDomain[] {
  const domains: SettingsDomain[] = [];
  if (prev.theme !== next.theme || prev.accentColor !== next.accentColor) {
    domains.push('theme');
  }
  if (JSON.stringify(prev.hotkeys) !== JSON.stringify(next.hotkeys)) {
    domains.push('hotkeys');
  }
  if (JSON.stringify(prev.miniWindow) !== JSON.stringify(next.miniWindow)) {
    domains.push('miniWindow');
  }
  if (
    prev.taskSource !== next.taskSource ||
    JSON.stringify(prev.ticktickCli) !== JSON.stringify(next.ticktickCli)
  ) {
    domains.push('taskProvider');
  }
  if (JSON.stringify(prev.layout) !== JSON.stringify(next.layout)) {
    domains.push('layout');
  }
  // general: 计时行为、同步、系统行为等
  if (
    prev.segmentBehavior !== next.segmentBehavior ||
    prev.syncMode !== next.syncMode ||
    prev.experimentalFocusEnabled !== next.experimentalFocusEnabled ||
    prev.minimizeToTray !== next.minimizeToTray ||
    prev.autoStart !== next.autoStart ||
    prev.startMinimizedToTray !== next.startMinimizedToTray ||
    prev.closeToTray !== next.closeToTray ||
    prev.showMiniOnStart !== next.showMiniOnStart ||
    JSON.stringify(prev.ticktick) !== JSON.stringify(next.ticktick)
  ) {
    domains.push('general');
  }
  if (domains.length === 0) domains.push('general');
  return domains;
}

export function registerIpc(
  timer: TimerManager,
  window: BrowserWindow,
  onSettingsChanged: (domains: SettingsDomain[], next: AppSettings) => void,
): void {
  // ============ Timer ============
  ipcMain.handle('timer:get-snapshot', () => timer.getSnapshot());
  ipcMain.handle('timer:toggle', () => timer.toggle());
  ipcMain.handle('timer:pause', () => timer.pause());
  ipcMain.handle('timer:resume', () => timer.resume());
  ipcMain.handle('timer:stop', () => {
    const snap = timer.stop();
    return snap;
  });
  ipcMain.handle('timer:reset', () => timer.reset());

  // 带任务原子启动：开始专注时同时写入 Session 默认任务 + 第一个 Segment 任务
  ipcMain.handle(
    'timer:start-with-task',
    (_e, args: { taskId: string; taskSource: TaskSource; taskTitle?: string }) => {
      let title = args.taskTitle;
      if (title == null && args.taskSource === 'local') {
        const task = LocalTaskProvider.getById(args.taskId);
        title = task?.title;
      }
      return timer.startWithTask(args.taskId, args.taskSource, title);
    },
  );

  ipcMain.handle(
    'timer:link-task',
    (
      _e,
      args: { segmentId: string; taskId: string; taskSource: TaskSource; taskTitle?: string },
    ) => {
      // 渲染层优先传 taskTitle；未传时 local 任务可从 provider 反查，dida 任务无反查则留空
      let title = args.taskTitle;
      if (title == null && args.taskSource === 'local') {
        const task = LocalTaskProvider.getById(args.taskId);
        title = task?.title;
      }
      timer.linkSegmentTask(args.segmentId, args.taskId, args.taskSource, title);
    },
  );

  ipcMain.handle(
    'timer:link-session-task',
    (
      _e,
      args: { sessionId: string; taskId: string; taskSource: TaskSource; taskTitle?: string },
    ) => {
      let title = args.taskTitle;
      if (title == null && args.taskSource === 'local') {
        const task = LocalTaskProvider.getById(args.taskId);
        title = task?.title;
      }
      timer.linkSessionTask(args.sessionId, args.taskId, args.taskSource, title);
    },
  );

  ipcMain.handle('timer:clear-segment-task', (_e, args: { segmentId: string }) => {
    timer.clearSegmentTask(args.segmentId);
  });

  ipcMain.handle('timer:clear-session-default-task', (_e, args: { sessionId: string }) => {
    timer.clearSessionDefaultTask(args.sessionId);
  });

  ipcMain.handle(
    'timer:link-segments-batch',
    (
      _e,
      args: {
        sessionId: string;
        taskId: string;
        taskSource: TaskSource;
        taskTitle?: string;
        onlyUnlinked: boolean;
      },
    ) => {
      let title = args.taskTitle;
      if (title == null && args.taskSource === 'local') {
        const task = LocalTaskProvider.getById(args.taskId);
        title = task?.title;
      }
      return timer.linkSegmentsBatch(
        args.sessionId,
        args.taskId,
        args.taskSource,
        title ?? null,
        args.onlyUnlinked,
      );
    },
  );

  ipcMain.handle('timer:set-segment-title', (_e, args: { segmentId: string; title: string }) => {
    timer.setSegmentTitle(args.segmentId, args.title);
  });

  ipcMain.handle('timer:merge-segments', (_e, args: { segmentIds: string[] }) => {
    timer.mergeSegments(args.segmentIds);
  });

  // ============ Tasks ============
  ipcMain.handle('tasks:list-local', () => LocalTaskProvider.list());
  ipcMain.handle('tasks:create-local', (_e, input: { title: string; projectId?: string }) =>
    LocalTaskProvider.create(input.title, input.projectId),
  );
  ipcMain.handle('tasks:search', (_e, query: string) => {
    const local = LocalTaskProvider.search(query);
    return local;
  });
  ipcMain.handle('tasks:complete', async (_e, task: Task) => {
    if (task.source === 'local') {
      return LocalTaskProvider.complete(task.id);
    }
    const settings = getSettings();
    if (settings.taskSource === 'ticktick-cli') {
      await ticktickCliProvider.completeTask(task);
      return { ...task, status: 'completed', isCompleted: true };
    }
    if (settings.taskSource === 'ticktick-oauth') {
      await ticktickAdapter.completeTask(task);
      return { ...task, status: 'completed', isCompleted: true };
    }
    throw new Error('当前任务来源不是滴答清单，无法同步完成状态');
  });

  // ============ 滴答清单 CLI ============
  ipcMain.handle('cli:detect', async () => {
    return detectCli();
  });
  // 应用 dida 默认模板（覆盖旧 ticktick 模板）
  ipcMain.handle('cli:apply-dida-defaults', async () => {
    try {
      const next = applyDidaDefaults();
      // 广播设置变更（taskProvider 域）给所有窗口
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) {
          w.webContents.send('settings:changed', next);
          w.webContents.send('settings:domain-changed', ['taskProvider']);
        }
      }
      return { ok: true as const, data: next.ticktickCli };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
  // 查询当前 provider 类型 + 当前模板是否含 ticktick
  ipcMain.handle('cli:get-current-provider', async () => {
    const cfg = getSettings().ticktickCli;
    const detect = await detectCli();
    const hasTicktick = templatesContainTicktick(cfg);
    const providerType: 'dida' | 'ticktick' | 'unknown' =
      detect.executable === 'dida'
        ? 'dida'
        : detect.executable === 'ticktick' || detect.executable === 'ticktick-cli'
          ? 'ticktick'
          : cfg.executable === 'dida' || cfg.listTasksCommand.startsWith('dida')
            ? 'dida'
            : cfg.listTasksCommand.startsWith('ticktick')
              ? 'ticktick'
              : 'unknown';
    return {
      providerType,
      executable: detect.executable || cfg.executable,
      executablePath: detect.executablePath,
      hasStaleTicktickTemplates: hasTicktick,
      currentTemplates: cfg,
      didaDefaultTemplates: DIDA_DEFAULT_TEMPLATES,
    };
  });
  ipcMain.handle('cli:list-projects', async () => {
    try {
      return { ok: true as const, data: await ticktickCliProvider.listProjects() };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('cli:list-tasks', async (_e, projectId?: string) => {
    try {
      return { ok: true as const, data: await ticktickCliProvider.listTasks(projectId) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('cli:search-tasks', async (_e, query: string) => {
    try {
      return { ok: true as const, data: await ticktickCliProvider.searchTasks(query) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
  // 完整诊断：探测/版本/登录/项目/任务/搜索
  ipcMain.handle('cli:diagnose', async () => {
    try {
      return { ok: true as const, data: await diagnoseCli() };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
  // 测试任意命令并返回完整执行记录
  ipcMain.handle('cli:test-command', async (_e, command: string, timeoutMs: number) => {
    try {
      return { ok: true as const, data: await testCommand(command, timeoutMs) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ============ TickTick ============
  ipcMain.handle(
    'ticktick:login',
    async (_e, clientId: string, clientSecret: string, region: 'ticktick' | 'dida365') => {
      ticktickAdapter.configure(region, clientId, clientSecret);
      await ticktickAdapter.auth();
      const settings = updateSettings({
        ticktick: { connected: true, clientId, region },
      });
      onSettingsChanged(['general'], settings);
      logger.info('ipc', 'ticktick login success');
      return settings;
    },
  );

  ipcMain.handle('ticktick:logout', async () => {
    await ticktickAdapter.logout();
    const settings = updateSettings({
      ticktick: { connected: false, clientId: '', region: getSettings().ticktick.region },
    });
    onSettingsChanged(['general'], settings);
    return settings;
  });

  ipcMain.handle('ticktick:list-projects', async () => {
    if (!ticktickAdapter.isAuthenticated) throw new Error('未登录 TickTick');
    return ticktickAdapter.listProjects();
  });

  ipcMain.handle('ticktick:list-tasks', async (_e, projectId?: string) => {
    if (!ticktickAdapter.isAuthenticated) throw new Error('未登录 TickTick');
    return ticktickAdapter.listTasks(projectId);
  });

  ipcMain.handle('ticktick:status', () => ({
    connected: ticktickAdapter.isAuthenticated,
    region: getSettings().ticktick.region,
  }));

  // ============ Sessions ============
  ipcMain.handle('sessions:list', (_e, limit?: number) => listSessions(limit ?? 100));
  ipcMain.handle('sessions:get', (_e, id: string) => {
    const session = getSessionDb(id);
    if (!session) return null;
    return { session, segments: listSegments(id), pauses: listPauses(id) };
  });
  ipcMain.handle('sessions:delete', (_e, id: string) => deleteSession(id));
  ipcMain.handle('sessions:export', (_e, id: string, format: 'json' | 'csv' | 'markdown') =>
    exportSessionById(id, format),
  );

  // ============ Settings ============
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (_e, settings) => {
    const prev = getSettings();
    const next = saveSettings(settings);
    const domains = detectChangedDomains(prev, next);
    // 按域分流副作用：只有 hotkeys 域变更才重新注册快捷键
    onSettingsChanged(domains, next);
    // 广播到所有窗口（带域信息），让小窗等独立窗口能同步主题/收起状态
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send('settings:changed', next);
        w.webContents.send('settings:domain-changed', domains);
      }
    }
    return next;
  });
  ipcMain.handle('settings:set-hotkey', (_e, key, accelerator: string) => {
    const current = getSettings();
    const oldAccelerator = current.hotkeys[key as keyof AppSettings['hotkeys']];
    const result = registerSingle(key, accelerator);
    let next = current;

    if (result.success) {
      next = setHotkey(key, accelerator);
      logger.info('ipc', 'hotkey updated', { key, oldAccelerator, accelerator });
    } else {
      logger.warn('ipc', 'hotkey register failed, restored old', {
        key,
        oldAccelerator,
        attempted: accelerator,
        error: result.error,
      });
    }

    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send('hotkey:registered', {
          key: result.key,
          accelerator: result.accelerator,
          success: result.success,
          error: result.error,
        });
        w.webContents.send('settings:changed', next);
        w.webContents.send('settings:domain-changed', ['hotkeys']);
      }
    }

    return { settings: next, registration: result };
  });
  // 恢复默认快捷键
  ipcMain.handle('hotkey:reset-defaults', () => {
    const current = getSettings();
    const next: AppSettings = {
      ...current,
      hotkeys: { ...DEFAULT_SETTINGS.hotkeys },
    };
    saveSettings(next);
    // 只有 hotkeys 域变更
    onSettingsChanged(['hotkeys'], next);
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send('settings:changed', next);
        w.webContents.send('settings:domain-changed', ['hotkeys']);
      }
    }
    return next;
  });
  // 测试某个 accelerator 能否注册（不绑定 handler）
  ipcMain.handle('hotkey:test', (_e, accelerator: string) => {
    if (!isValidAccelerator(accelerator)) return false;
    return testAccelerator(accelerator);
  });
  // 查询当前注册状态
  ipcMain.handle('hotkey:status', () => getRegistrationStatus());

  // ============ Sync ============
  ipcMain.handle('sync:enqueue-segment', (_e, segmentId: string) => enqueueSegmentSync(segmentId));
  ipcMain.handle('sync:enqueue-session', (_e, sessionId: string) => enqueueSessionSync(sessionId));
  ipcMain.handle('sync:list', () => listQueue());
  ipcMain.handle('sync:retry', (_e, id: string) => retryItem(id));
  ipcMain.handle('sync:run-pending', () => runPending());

  // ============ Window ============
  ipcMain.on('window:minimize-to-tray', () => window.hide());
  ipcMain.on('window:show', () => {
    window.show();
    window.focus();
  });
  ipcMain.on('window:quit', () => window.close());

  logger.info('ipc', 'all handlers registered');
}

/** 注册全局快捷键并广播结果（保留兼容，主流程已由 main.ts 的 ensureTrayAndHotkeys 处理） */
export function applyHotkeys(window: BrowserWindow): void {
  const settings = getSettings();
  setHotkeyHandlers({
    toggleTimer: () => {
      timer_toggle(window);
    },
    stopTimer: () => timer_stop(window),
    toggleWindow: () => toggleWindow(window),
    linkTask: () => {
      window.show();
      window.focus();
      window.webContents.send('navigate', 'tasks');
    },
    toggleMiniWindow: () => {
      // 由 main.ts 处理；此处仅广播事件
      window.webContents.send('navigate', 'mini');
    },
  });
  const results = registerAllHotkeys(settings);
  for (const r of results) {
    window.webContents.send('hotkey:registered', {
      key: r.key,
      accelerator: r.accelerator,
      success: r.success,
      error: r.error,
    });
  }
}

// helpers - 闭包引用 timer
let _timer: TimerManager | null = null;
export function setTimerForHotkeys(t: TimerManager): void {
  _timer = t;
}
function timer_toggle(_w: BrowserWindow): void {
  _timer?.toggle();
}
function timer_stop(_w: BrowserWindow): void {
  _timer?.stop();
}
function toggleWindow(window: BrowserWindow): void {
  if (window.isVisible()) {
    window.hide();
  } else {
    window.show();
    window.focus();
  }
}

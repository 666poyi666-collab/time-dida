// IPC 处理器 - 主进程接收渲染进程调用
// 所有 IPC 通道类型安全；关键操作写日志
import { ipcMain, BrowserWindow, app } from 'electron';
import type { TimerManager } from './timer/manager.js';
import { LocalTaskProvider } from './tasks/localProvider.js';
import { refreshTaskWorkspace, setTaskCompleted } from './tasks/workspaceService.js';
import {
  detectCli,
  diagnoseCli,
  testCommand,
  ticktickCliProvider,
  applyDidaDefaults,
  templatesContainTicktick,
  DIDA_DEFAULT_TEMPLATES,
} from './tasks/cliProvider.js';
import { ticktickAdapter } from './integrations/ticktick/oauthAdapter.js';
import { getSettings, saveSettings, updateSettings, setHotkey } from './settingsStore.js';
import {
  registerAllHotkeys,
  setHotkeyHandlers,
  registerSingle,
  testAccelerator,
  getRegistrationStatus,
  isValidAccelerator,
} from './hotkeys.js';
import {
  enqueueSegmentSync,
  enqueueSessionSync,
  listQueue,
  retryItem,
  runPending,
  resyncSegment,
  withPendingSyncExclusive,
} from './sync/syncService.js';
import {
  syncSegmentToTomatodo,
  syncSessionToTomatodo,
  deleteTomatodoRecordForSegment,
  getTomatodoSyncStatus,
  getPendingTomatodoCount,
  setTomatodoSubjectForSegment,
  setTomatodoSubjectsForSegments,
  uploadPendingTomatodoRecords,
} from './sync/tomatodoSyncService.js';
import {
  ensureTomatodoBridge,
  getTomatodoBridgeStatus,
} from './integrations/tomatodo/bridgeLifecycle.js';
import {
  listSessions,
  listSessionsInRange,
  getSession as getSessionDb,
  listSegments,
  listSegmentsInSessionRange,
  listPauses,
  listPausesInSessionRange,
  getSegment,
  deleteSession,
  deleteSegment,
  deleteSyncQueueForSegments,
} from './db/index.js';
import { exportSessionById } from './export.js';
import { buildSessionAnalytics } from '@shared/sessionAnalytics';
import { logger } from './logger.js';
import type {
  TaskSource,
  AppSettings,
  SettingsDomain,
  Task,
  FocusSegment,
  TaskWorkspaceRefreshOptions,
} from '@shared/types';
import type { SessionAnalyticsRange } from '@shared/ipc/api';
import { DEFAULT_SETTINGS } from '@shared/types';
import { shouldDeleteDidaFocusRecord } from '@shared/autoSyncPolicy';
import { detectSettingsChangedDomains } from '@shared/settingsPolicy';

async function deleteExternalRecordsForSegment(segment: FocusSegment): Promise<{
  didaDeleted: boolean;
  tomatodoDeleted: number;
}> {
  const didaDeleted = await deleteDidaFocusForSegment(segment);
  const tomatodo = await deleteTomatodoRecordForSegment(segment.id);
  if (!tomatodo.ok) {
    throw new Error(`番茄 Todo 记录删除失败（片段 ${segment.id.slice(0, 8)}）`);
  }
  return { didaDeleted, tomatodoDeleted: tomatodo.deletedCount };
}

async function deleteDidaFocusForSegment(segment: FocusSegment): Promise<boolean> {
  // `taskSource=ticktick` describes the local association and is shared by dida CLI and OAuth.
  // Calling dida unconditionally would make an OAuth-only user unable to delete a never-synced
  // segment. A stored cloudFocusId always requires dida cleanup; marker-only legacy cleanup is
  // attempted when dida is the configured provider.
  const shouldDeleteDida = shouldDeleteDidaFocusRecord(segment, getSettings().taskSource);
  if (shouldDeleteDida) {
    const ok = (await ticktickCliProvider.deleteFocusRecord?.(segment.id)) ?? false;
    if (!ok) {
      throw new Error(`滴答云端记录删除失败（片段 ${segment.id.slice(0, 8)}）`);
    }
    return true;
  }
  return false;
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
    async (
      _e,
      args: { segmentId: string; taskId: string; taskSource: TaskSource; taskTitle?: string },
    ) => {
      // 渲染层优先传 taskTitle；未传时 local 任务可从 provider 反查，dida 任务无反查则留空
      let title = args.taskTitle;
      if (title == null && args.taskSource === 'local') {
        const task = LocalTaskProvider.getById(args.taskId);
        title = task?.title;
      }
      const previous = getSegment(args.segmentId);
      const changed =
        !!previous && (previous.taskId !== args.taskId || previous.taskSource !== args.taskSource);
      if (changed && previous?.endedAt) {
        await withPendingSyncExclusive(async () => {
          deleteSyncQueueForSegments([previous.id]);
          await deleteDidaFocusForSegment(previous);
          timer.linkSegmentTask(args.segmentId, args.taskId, args.taskSource, title);
        });
        return;
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

  ipcMain.handle('timer:clear-segment-task', async (_e, args: { segmentId: string }) => {
    const previous = getSegment(args.segmentId);
    if (previous?.endedAt) {
      await withPendingSyncExclusive(async () => {
        deleteSyncQueueForSegments([previous.id]);
        await deleteDidaFocusForSegment(previous);
        timer.clearSegmentTask(args.segmentId);
      });
      return;
    }
    timer.clearSegmentTask(args.segmentId);
  });

  ipcMain.handle('timer:clear-session-default-task', (_e, args: { sessionId: string }) => {
    timer.clearSessionDefaultTask(args.sessionId);
  });

  ipcMain.handle(
    'timer:link-segments-batch',
    async (
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
      const changing = listSegments(args.sessionId).filter(
        (segment) =>
          segment.endedAt &&
          (!args.onlyUnlinked || !segment.taskId) &&
          (segment.taskId !== args.taskId || segment.taskSource !== args.taskSource),
      );
      if (changing.length === 0) {
        return timer.linkSegmentsBatch(
          args.sessionId,
          args.taskId,
          args.taskSource,
          title ?? null,
          args.onlyUnlinked,
        );
      }
      return withPendingSyncExclusive(async () => {
        deleteSyncQueueForSegments(changing.map((segment) => segment.id));
        for (const segment of changing) await deleteDidaFocusForSegment(segment);
        return timer.linkSegmentsBatch(
          args.sessionId,
          args.taskId,
          args.taskSource,
          title ?? null,
          args.onlyUnlinked,
        );
      });
    },
  );

  ipcMain.handle('timer:set-segment-title', (_e, args: { segmentId: string; title: string }) => {
    timer.setSegmentTitle(args.segmentId, args.title);
  });

  ipcMain.handle('timer:merge-segments', (_e, args: { segmentIds: string[] }) => {
    timer.mergeSegments(args.segmentIds);
  });

  // ============ Tasks ============
  ipcMain.handle('tasks:complete', async (_e, task: Task) => {
    return setTaskCompleted(task, true);
  });
  ipcMain.handle('tasks:set-completed', (_e, task: Task, completed: boolean) =>
    setTaskCompleted(task, completed),
  );
  ipcMain.handle('tasks:refresh', (_e, options?: TaskWorkspaceRefreshOptions) =>
    refreshTaskWorkspace(options),
  );

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
  ipcMain.handle('sessions:analytics', (_e, range: SessionAnalyticsRange) => {
    if (
      !range ||
      !Number.isFinite(range.start) ||
      !Number.isFinite(range.end) ||
      (range.timelineStart !== undefined && !Number.isFinite(range.timelineStart)) ||
      (range.timelineEnd !== undefined && !Number.isFinite(range.timelineEnd))
    ) {
      throw new Error('统计时间范围无效');
    }
    const start = Math.min(range.start, range.end);
    const end = Math.max(range.start, range.end);
    return buildSessionAnalytics(range, {
      sessions: listSessionsInRange(start, end),
      segments: listSegmentsInSessionRange(start, end),
      pauses: listPausesInSessionRange(start, end),
    });
  });
  ipcMain.handle('sessions:delete', async (_e, id: string) => {
    const segs = listSegments(id);
    const snapshot = timer.getSnapshot();
    if (
      snapshot.sessionId === id &&
      (snapshot.state === 'running' || snapshot.state === 'paused')
    ) {
      throw new Error('当前专注仍在进行中，请先结束后再删除。');
    }

    return withPendingSyncExclusive(async () => {
      // 独占区间覆盖撤队列、外部删除和本地删除，防止新的后台 create 在中间插入。
      deleteSyncQueueForSegments(
        segs.map((segment) => segment.id),
        id,
      );

      let cloudDeleted = 0;
      let tomatodoDeleted = 0;
      for (const seg of segs) {
        try {
          const result = await deleteExternalRecordsForSegment(seg);
          if (result.didaDeleted) cloudDeleted += 1;
          tomatodoDeleted += result.tomatodoDeleted;
        } catch (error) {
          logger.warn('ipc', 'session external deletion failed; local record preserved', {
            sessionId: id,
            segmentId: seg.id,
            error: error instanceof Error ? error.message : String(error),
          });
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}；本地记录已保留，可稍后重试删除。`,
          );
        }
      }

      // 所有外部删除都确认完成后，才允许删除本地事实来源。
      deleteSession(id);
      timer.resetIfSession(id);
      // 若计时器卡在 finished 状态（1.5s 自动重置窗口内），立即重置为 idle，
      // 避免用户回到计时界面看到 finished 状态的 UI 空洞
      timer.resetIfFinished();
      logger.info('ipc', 'session deleted', {
        sessionId: id,
        cloudDeleted,
        tomatodoDeleted,
      });
      // 始终返回最新快照，确保渲染层 UI 一致
      return timer.getSnapshot();
    });
  });

  /** 删除单个 segment：先删云端专注记录，再删本地 */
  ipcMain.handle('segments:delete', async (_e, id: string) => {
    const segment = getSegment(id);
    if (!segment) return { cloudDeleted: false, tomatodoDeleted: 0 };
    const snapshot = timer.getSnapshot();
    if (
      snapshot.currentSegmentId === id &&
      (snapshot.state === 'running' || snapshot.state === 'paused')
    ) {
      throw new Error('当前片段仍在计时，不能删除。');
    }

    return withPendingSyncExclusive(async () => {
      deleteSyncQueueForSegments([id]);
      try {
        const external = await deleteExternalRecordsForSegment(segment);
        deleteSegment(id);
        logger.info('ipc', 'segment deleted', {
          segmentId: id,
          cloudDeleted: external.didaDeleted,
          tomatodoDeleted: external.tomatodoDeleted,
        });
        return {
          cloudDeleted: external.didaDeleted,
          tomatodoDeleted: external.tomatodoDeleted,
        };
      } catch (error) {
        logger.warn('ipc', 'segment external deletion failed; local record preserved', {
          segmentId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}；本地片段已保留，可稍后重试。`,
        );
      }
    });
  });
  ipcMain.handle('sessions:export', (_e, id: string, format: 'json' | 'csv' | 'markdown') =>
    exportSessionById(id, format),
  );

  // ============ Settings ============
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (_e, settings) => {
    const prev = getSettings();
    // Renderer callers intentionally send partial settings (for example the task drawer only
    // changes taskSource). Persisting that object directly temporarily returned a one-field
    // settings object to Zustand and made timer/theme code lose hotkeys and nested config.
    const next = updateSettings(settings as Partial<AppSettings>);
    const domains = detectSettingsChangedDomains(prev, next);
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
  /** 删除单个 segment 的云端专注记录并重新同步（保留本地数据） */
  ipcMain.handle('sync:resync-segment', async (_e, segmentId: string) => {
    const result = await resyncSegment(segmentId);
    return result;
  });

  // ============ 番茄 Todo 同步（独立并行通道） ============
  /** 手动同步单个 segment 到番茄 Todo */
  ipcMain.handle('tomatodo:sync-segment', (_e, segmentId: string) =>
    syncSegmentToTomatodo(segmentId),
  );
  /** 手动同步整个会话到番茄 Todo */
  ipcMain.handle('tomatodo:sync-session', (_e, sessionId: string) =>
    syncSessionToTomatodo(sessionId),
  );
  /** 查询某会话各 segment 的番茄 Todo 同步状态（供 UI 展示） */
  ipcMain.handle('tomatodo:status', (_e, sessionId: string) => getTomatodoSyncStatus(sessionId));
  /** 设置 segment 的番茄 Todo 学科分类（手动选择） */
  ipcMain.handle('tomatodo:set-subject', (_e, segmentId: string, subject: string | null) =>
    setTomatodoSubjectForSegment(segmentId, subject),
  );
  ipcMain.handle('tomatodo:set-subjects', (_e, segmentIds: string[], subject: string | null) =>
    setTomatodoSubjectsForSegments(segmentIds, subject),
  );
  /** 手动上传所有待同步的番茄 Todo 记录到云端 */
  ipcMain.handle('tomatodo:upload-pending', () =>
    uploadPendingTomatodoRecords({ ensureBridge: true }),
  );
  /** 查询待上云的番茄 Todo 记录数 */
  ipcMain.handle('tomatodo:pending-count', () => getPendingTomatodoCount());
  /** 只读查询桥状态；不会启动或关闭番茄 Todo。 */
  ipcMain.handle('tomatodo:bridge-status', () => getTomatodoBridgeStatus());
  /** 用户显式请求时确保桥可用；已普通运行时绝不强制重启。 */
  ipcMain.handle('tomatodo:bridge-ensure', () => ensureTomatodoBridge());

  // ============ Window ============
  ipcMain.on('window:minimize-to-tray', () => window.hide());
  ipcMain.on('window:minimize', () => window.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.handle('window:set-full-screen', (_event, enabled: boolean) => {
    window.setFullScreen(Boolean(enabled));
    return window.isFullScreen();
  });
  ipcMain.on('window:close', () => window.close());
  ipcMain.on('window:show', () => {
    window.show();
    window.focus();
  });
  // `window.close()` is intercepted by close-to-tray and only hides the app. This channel is the
  // explicit quit contract, so route it through before-quit to persist the timer and close DB.
  ipcMain.on('window:quit', () => app.quit());

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

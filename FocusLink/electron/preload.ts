// Preload - 暴露类型安全的 IPC 接口给渲染进程
// contextIsolation: true, nodeIntegration: false
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { Task, TaskWorkspaceRefreshOptions, TomatodoSubject } from '@shared/types';
import type { FocusLinkAPI, FocusLinkEventMap, HotkeyAction } from '@shared/ipc/api';

const api = {
  timer: {
    getSnapshot: () => ipcRenderer.invoke('timer:get-snapshot'),
    toggle: () => ipcRenderer.invoke('timer:toggle'),
    pause: () => ipcRenderer.invoke('timer:pause'),
    resume: () => ipcRenderer.invoke('timer:resume'),
    stop: () => ipcRenderer.invoke('timer:stop'),
    reset: () => ipcRenderer.invoke('timer:reset'),
    /** 带任务原子启动：开始专注时同时写入 Session 默认任务 + 第一个 Segment 任务 */
    startWithTask: (taskId: string, taskSource: 'local' | 'ticktick', taskTitle?: string) =>
      ipcRenderer.invoke('timer:start-with-task', { taskId, taskSource, taskTitle }),
    linkTask: (
      segmentId: string,
      taskId: string,
      taskSource: 'local' | 'ticktick',
      taskTitle?: string,
    ) => ipcRenderer.invoke('timer:link-task', { segmentId, taskId, taskSource, taskTitle }),
    linkSessionTask: (
      sessionId: string,
      taskId: string,
      taskSource: 'local' | 'ticktick',
      taskTitle?: string,
    ) =>
      ipcRenderer.invoke('timer:link-session-task', { sessionId, taskId, taskSource, taskTitle }),
    clearSegmentTask: (segmentId: string) =>
      ipcRenderer.invoke('timer:clear-segment-task', { segmentId }),
    clearSessionDefaultTask: (sessionId: string) =>
      ipcRenderer.invoke('timer:clear-session-default-task', { sessionId }),
    linkSegmentsBatch: (
      sessionId: string,
      taskId: string,
      taskSource: 'local' | 'ticktick',
      taskTitle: string | null,
      onlyUnlinked: boolean,
    ) =>
      ipcRenderer.invoke('timer:link-segments-batch', {
        sessionId,
        taskId,
        taskSource,
        taskTitle: taskTitle ?? undefined,
        onlyUnlinked,
      }),
    setSegmentTitle: (segmentId: string, title: string) =>
      ipcRenderer.invoke('timer:set-segment-title', { segmentId, title }),
    mergeSegments: (segmentIds: string[]) =>
      ipcRenderer.invoke('timer:merge-segments', { segmentIds }),
  },
  tasks: {
    complete: (task: Task) => ipcRenderer.invoke('tasks:complete', task),
    setCompleted: (task: Task, completed: boolean) =>
      ipcRenderer.invoke('tasks:set-completed', task, completed),
    refresh: (options?: TaskWorkspaceRefreshOptions) =>
      ipcRenderer.invoke('tasks:refresh', options),
  },
  ticktick: {
    login: (clientId: string, clientSecret: string, region: 'ticktick' | 'dida365') =>
      ipcRenderer.invoke('ticktick:login', clientId, clientSecret, region),
    logout: () => ipcRenderer.invoke('ticktick:logout'),
    listProjects: () => ipcRenderer.invoke('ticktick:list-projects'),
    listTasks: (projectId?: string) => ipcRenderer.invoke('ticktick:list-tasks', projectId),
    status: () => ipcRenderer.invoke('ticktick:status'),
  },
  cli: {
    detect: () => ipcRenderer.invoke('cli:detect'),
    listProjects: () => ipcRenderer.invoke('cli:list-projects'),
    listTasks: (projectId?: string) => ipcRenderer.invoke('cli:list-tasks', projectId),
    searchTasks: (query: string) => ipcRenderer.invoke('cli:search-tasks', query),
    diagnose: () => ipcRenderer.invoke('cli:diagnose'),
    testCommand: (command: string, timeoutMs: number) =>
      ipcRenderer.invoke('cli:test-command', command, timeoutMs),
    applyDidaDefaults: () => ipcRenderer.invoke('cli:apply-dida-defaults'),
    getCurrentProvider: () => ipcRenderer.invoke('cli:get-current-provider'),
  },
  sessions: {
    list: (limit?: number) => ipcRenderer.invoke('sessions:list', limit),
    get: (id: string) => ipcRenderer.invoke('sessions:get', id),
    analytics: (range: Parameters<FocusLinkAPI['sessions']['analytics']>[0]) =>
      ipcRenderer.invoke('sessions:analytics', range),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    export: (id: string, format: 'json' | 'csv' | 'markdown') =>
      ipcRenderer.invoke('sessions:export', id, format),
  },
  segments: {
    delete: (id: string) => ipcRenderer.invoke('segments:delete', id),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: Parameters<FocusLinkAPI['settings']['set']>[0]) =>
      ipcRenderer.invoke('settings:set', settings),
    setHotkey: (key: HotkeyAction, accelerator: string) =>
      ipcRenderer.invoke('settings:set-hotkey', key, accelerator),
  },
  hotkey: {
    test: (accelerator: string) => ipcRenderer.invoke('hotkey:test', accelerator),
    resetDefaults: () => ipcRenderer.invoke('hotkey:reset-defaults'),
    status: () => ipcRenderer.invoke('hotkey:status'),
  },
  mini: {
    show: () => ipcRenderer.send('mini:show'),
    hide: () => ipcRenderer.send('mini:hide'),
    toggle: () => ipcRenderer.send('mini:toggle'),
    collapse: () => ipcRenderer.send('mini:collapse'),
    expand: () => ipcRenderer.send('mini:expand'),
    reset: () => ipcRenderer.send('mini:reset'),
    getConfig: () => ipcRenderer.invoke('mini:get-config'),
    setOpacity: (opacity: number) => ipcRenderer.send('mini:set-opacity', opacity),
  },
  sync: {
    enqueueSegment: (segmentId: string) => ipcRenderer.invoke('sync:enqueue-segment', segmentId),
    enqueueSession: (sessionId: string) => ipcRenderer.invoke('sync:enqueue-session', sessionId),
    list: () => ipcRenderer.invoke('sync:list'),
    retry: (id: string) => ipcRenderer.invoke('sync:retry', id),
    runPending: () => ipcRenderer.invoke('sync:run-pending'),
    resyncSegment: (segmentId: string) => ipcRenderer.invoke('sync:resync-segment', segmentId),
  },
  deviceSync: {
    status: () => ipcRenderer.invoke('device-sync:status'),
    configure: (input: Parameters<FocusLinkAPI['deviceSync']['configure']>[0]) =>
      ipcRenderer.invoke('device-sync:configure', input),
    syncNow: () => ipcRenderer.invoke('device-sync:run'),
  },
  tomatodo: {
    syncSegment: (segmentId: string) => ipcRenderer.invoke('tomatodo:sync-segment', segmentId),
    syncSession: (sessionId: string) => ipcRenderer.invoke('tomatodo:sync-session', sessionId),
    status: (sessionId: string) => ipcRenderer.invoke('tomatodo:status', sessionId),
    setSubject: (segmentId: string, subject: TomatodoSubject | null) =>
      ipcRenderer.invoke('tomatodo:set-subject', segmentId, subject),
    setSubjects: (segmentIds: string[], subject: TomatodoSubject | null) =>
      ipcRenderer.invoke('tomatodo:set-subjects', segmentIds, subject),
    uploadPending: () => ipcRenderer.invoke('tomatodo:upload-pending'),
    pendingCount: () => ipcRenderer.invoke('tomatodo:pending-count'),
    bridgeStatus: () => ipcRenderer.invoke('tomatodo:bridge-status'),
    ensureBridge: () => ipcRenderer.invoke('tomatodo:bridge-ensure'),
  },
  window: {
    minimizeToTray: () => ipcRenderer.send('window:minimize-to-tray'),
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    setFullScreen: (enabled: boolean) => ipcRenderer.invoke('window:set-full-screen', enabled),
    close: () => ipcRenderer.send('window:close'),
    show: () => ipcRenderer.send('window:show'),
    quit: () => ipcRenderer.send('window:quit'),
  },
  // 事件监听
  on: <Channel extends keyof FocusLinkEventMap>(
    channel: Channel,
    cb: (...args: FocusLinkEventMap[Channel]) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, ...args: unknown[]) =>
      cb(...(args as FocusLinkEventMap[Channel]));
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
} satisfies FocusLinkAPI;

contextBridge.exposeInMainWorld('focuslink', api);

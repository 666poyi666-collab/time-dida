// Preload - 暴露类型安全的 IPC 接口给渲染进程
// contextIsolation: true, nodeIntegration: false
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

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
    listLocal: () => ipcRenderer.invoke('tasks:list-local'),
    createLocal: (title: string, projectId?: string) =>
      ipcRenderer.invoke('tasks:create-local', { title, projectId }),
    search: (query: string) => ipcRenderer.invoke('tasks:search', query),
    complete: (task: unknown) => ipcRenderer.invoke('tasks:complete', task),
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
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    export: (id: string, format: 'json' | 'csv' | 'markdown') =>
      ipcRenderer.invoke('sessions:export', id, format),
  },
  segments: {
    delete: (id: string) => ipcRenderer.invoke('segments:delete', id),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),
    setHotkey: (key: string, accelerator: string) =>
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
    resyncSegment: (segmentId: string) =>
      ipcRenderer.invoke('sync:resync-segment', segmentId),
  },
  window: {
    minimizeToTray: () => ipcRenderer.send('window:minimize-to-tray'),
    show: () => ipcRenderer.send('window:show'),
    quit: () => ipcRenderer.send('window:quit'),
  },
  // 事件监听
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
};

contextBridge.exposeInMainWorld('focuslink', api);

export type FocusLinkAPI = typeof api;

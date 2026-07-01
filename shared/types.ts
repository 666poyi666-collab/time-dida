// 共享类型定义 - 主进程和渲染进程共用
// 严格模式，禁止 any 泛滥

export type TimerState = 'idle' | 'running' | 'paused' | 'stopping' | 'finished';
export type TimerEvent = 'START' | 'PAUSE' | 'RESUME' | 'STOP' | 'RESET' | 'LINK_TASK' | 'SYNC';
export type TaskSource = 'local' | 'ticktick';

/** 专注会话：一次完整的专注，可包含多个 Segment */
export interface FocusSession {
  id: string;
  title: string | null;
  status: SessionStatus;
  startedAt: number; // epoch ms
  endedAt: number | null;
  activeElapsedMs: number; // 真正专注时长（不含暂停）
  pauseElapsedMs: number; // 暂停总时长
  wallElapsedMs: number; // 自然总跨度
  defaultTaskId: string | null;
  defaultTaskSource: TaskSource | null;
  defaultTaskTitle: string | null; // 默认任务标题（冗余存储，避免运行时反查）
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export type SessionStatus = 'active' | 'finished' | 'aborted';

/** 专注片段：会话中的一个时间段，关联一个任务 */
export interface FocusSegment {
  id: string;
  sessionId: string;
  taskId: string | null;
  taskSource: TaskSource | null;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  activeElapsedMs: number;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 暂停事件：暂停不属于任何 Segment，但记录间隔 */
export interface PauseEvent {
  id: string;
  sessionId: string;
  segmentId: string | null;
  pauseStartedAt: number;
  pauseEndedAt: number | null;
  durationMs: number;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 任务缓存（本地 + 滴答清单） */
export interface TaskCache {
  id: string;
  source: TaskSource;
  externalId: string;
  projectId: string | null;
  title: string;
  status: string | null;
  priority: number | null;
  dueDate: number | null;
  tags: string | null;
  content: string | null;
  rawJson: string | null;
  lastSyncedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 同步队列项 */
export interface SyncQueueItem {
  id: string;
  type: string;
  payload: string; // JSON
  status: SyncStatus;
  retryCount: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export type SyncStatus = 'pending' | 'synced' | 'failed' | 'skipped';

/** 计时器实时快照 - 渲染进程订阅 */
export interface TimerSnapshot {
  state: TimerState;
  sessionId: string | null;
  currentSegmentId: string | null;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  currentTaskSource: TaskSource | null;
  /** 本次 Session 的默认任务 id（用于任务区高亮"本次默认"标识） */
  sessionDefaultTaskId: string | null;
  /** 本次 Session 的默认任务标题（用于 TimerPanel 显示） */
  sessionDefaultTaskTitle: string | null;
  activeElapsedMs: number;
  pauseElapsedMs: number;
  wallElapsedMs: number;
  /** 当前暂停开始时间，若正在暂停 */
  currentPauseStartedAt: number | null;
  segments: SegmentSummary[];
  /** 真实暂停事件列表（含当前进行中的暂停），用于前端构建混合时间线，不再靠间隙推导 */
  pauseEvents: PauseEventSummary[];
  lastTick: number;
}

export interface SegmentSummary {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  taskSource: TaskSource | null;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  activeElapsedMs: number;
}

/** 暂停事件摘要（暴露给前端，用于混合时间线显示） */
export interface PauseEventSummary {
  id: string;
  segmentId: string | null;
  pauseStartedAt: number;
  pauseEndedAt: number | null;
  durationMs: number;
  /** 是否为当前进行中的暂停 */
  isCurrent: boolean;
}

/** 任务统一模型 */
export interface Task {
  id: string;
  source: TaskSource;
  externalId: string;
  projectId: string | null;
  title: string;
  status: string | null;
  priority: number | null;
  dueDate: number | null;
  tags: string[];
  content: string | null;
  /** 父任务 ID（dida CLI 用 items[] 嵌套，归一化时填充） */
  parentId?: string | null;
  /** 子任务（dida CLI 的 items[] 归一化后填充） */
  children?: Task[];
  /** 是否已完成（status=2 或 completedTime 非空 → true） */
  isCompleted?: boolean;
  /** dida sortOrder 字段，用于稳定排序 */
  sortOrder?: number | null;
}

export interface Project {
  id: string;
  source: TaskSource;
  externalId: string;
  name: string;
  color: string | null;
}

/** TickTick 适配器接口 */
export interface TaskProvider {
  name: string;
  isAuthenticated: boolean;
  auth(): Promise<void>;
  logout(): Promise<void>;
  listProjects(): Promise<Project[]>;
  listTasks(projectId?: string): Promise<Task[]>;
  getTask(taskId: string): Promise<Task | null>;
  updateTask(taskId: string, input: Partial<TaskUpdateInput>): Promise<void>;
  /** 稳定通道：在任务备注/描述中追加专注记录 */
  appendFocusRecordToTask?(taskId: string, record: FocusRecord): Promise<void>;
  /** 完成任务，用于把 FocusLink 内的勾选同步到任务来源 */
  completeTask?(task: Task): Promise<void>;
  /** 实验性：直接写入 Focus/Pomodoro 记录 */
  createFocusRecord?(record: FocusRecord): Promise<void>;
}

export interface TaskUpdateInput {
  title?: string;
  content?: string;
  status?: string;
}

export interface FocusRecord {
  sessionId: string;
  segmentId?: string;
  taskTitle: string | null;
  startedAt: number;
  endedAt: number | null;
  activeElapsedMs: number;
  pauseElapsedMs: number;
  wallElapsedMs: number;
  note?: string | null;
}

/** 应用设置 */
export interface AppSettings {
  hotkeys: {
    toggleTimer: string;
    stopTimer: string;
    toggleWindow: string;
    linkTask: string;
    toggleMiniWindow: string;
  };
  theme: 'dark' | 'light';
  accentColor: string;
  segmentBehavior: 'new-segment' | 'continue-segment';
  syncMode: 'note' | 'experimental-focus' | 'local-only';
  experimentalFocusEnabled: boolean;
  minimizeToTray: boolean;
  autoStart: boolean;
  /** 启动后最小化到托盘（不显示主窗口） */
  startMinimizedToTray: boolean;
  /** 关闭主窗口时最小化到托盘（而非退出） */
  closeToTray: boolean;
  /** 启动时显示专注小窗 */
  showMiniOnStart: boolean;
  /** 当前任务来源：本地任务 / 滴答清单 CLI / TickTick OAuth */
  taskSource: 'local' | 'ticktick-cli' | 'ticktick-oauth';
  /** 滴答清单 CLI 配置 */
  ticktickCli: TickTickCliConfig;
  /** 专注小窗配置 */
  miniWindow: MiniWindowConfig;
  /** 主界面布局配置 */
  layout: LayoutConfig;
  ticktick: {
    connected: boolean;
    clientId: string;
    /** region: ticktick (海外) | dida365 (国内) */
    region: 'ticktick' | 'dida365';
  };
}

/** 设置变更域 - 用于按域分流处理副作用，避免主题保存触发快捷键重注册 */
export type SettingsDomain =
  'theme' | 'hotkeys' | 'miniWindow' | 'taskProvider' | 'layout' | 'general';

/** 主界面左右分栏布局配置 */
export interface LayoutConfig {
  /** 左侧计时区宽度（px），null 表示使用默认比例 */
  leftPaneWidth: number | null;
}

/** 专注小窗配置 - 主题、透明度、位置、尺寸、收起状态、自动显示行为 */
export interface MiniWindowConfig {
  /** 是否跟随主界面主题 */
  followMainTheme: boolean;
  /** 小窗主题：跟随系统 / 深色 / 浅色（强制） */
  themeMode: 'system' | 'dark' | 'light';
  /** 透明度 0.6-1.0 */
  opacity: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /** X 位置（null 表示使用默认） */
  x: number | null;
  /** Y 位置（null 表示使用默认） */
  y: number | null;
  /** 是否收起状态 */
  collapsed: boolean;
  /** 是否启用贴边自动收纳 */
  edgeAutoCollapse: boolean;
  /** 贴边后多少毫秒触发自动收纳（默认 500） */
  edgeCollapseDelayMs: number;
  /** 鼠标悬停收纳条时自动展开（默认开） */
  hoverToExpand: boolean;
  /** 专注开始后若小窗贴边则自动收纳（默认关） */
  autoCollapseOnFocusStart: boolean;
  /** 主窗口最小化或隐藏到托盘时，自动显示小窗（默认开） */
  autoShowOnMainHide: boolean;
  /** 专注开始时，如果主窗口不在前台，自动显示小窗（默认开） */
  autoShowOnFocusStart: boolean;
  /** 专注结束后自动隐藏小窗（默认关） */
  autoHideOnFocusEnd: boolean;
}

/** 滴答清单 CLI Provider 配置 - 用户可自定义命令模板 */
export interface TickTickCliConfig {
  /** CLI 可执行文件路径（留空则自动探测） */
  executable: string;
  /** 列出任务命令模板，支持 {{projectId}} 占位 */
  listTasksCommand: string;
  /** 搜索任务命令模板，支持 {{query}} 占位 */
  searchTasksCommand: string;
  /** 任务详情命令模板，支持 {{taskId}} 占位 */
  getTaskCommand: string;
  /** 追加备注命令模板，支持 {{taskId}} {{content}} 占位 */
  appendNoteCommand: string;
  /** 列出项目命令模板 */
  listProjectsCommand: string;
  /** 命令超时（毫秒） */
  timeoutMs: number;
}

/** 默认设置 */
export const DEFAULT_SETTINGS: AppSettings = {
  hotkeys: {
    toggleTimer: 'CommandOrControl+Alt+Space',
    stopTimer: 'CommandOrControl+Alt+Enter',
    toggleWindow: 'CommandOrControl+Alt+F',
    linkTask: 'CommandOrControl+Alt+T',
    toggleMiniWindow: 'CommandOrControl+Alt+M',
  },
  theme: 'dark',
  accentColor: 'indigo',
  segmentBehavior: 'new-segment',
  syncMode: 'note',
  experimentalFocusEnabled: false,
  minimizeToTray: true,
  autoStart: false,
  startMinimizedToTray: false,
  closeToTray: true,
  showMiniOnStart: false,
  taskSource: 'local',
  ticktickCli: {
    executable: '',
    listTasksCommand: 'dida task filter --json',
    searchTasksCommand: 'dida task filter --json',
    getTaskCommand: 'dida task get {{projectId}} {{taskId}} --json',
    appendNoteCommand: 'dida task update {{taskId}} --id {{taskId}} --content "{{content}}"',
    listProjectsCommand: 'dida project list --json',
    timeoutMs: 10000,
  },
  miniWindow: {
    followMainTheme: true,
    themeMode: 'system',
    opacity: 0.92,
    width: 420,
    height: 184,
    x: null,
    y: null,
    collapsed: false,
    edgeAutoCollapse: false,
    edgeCollapseDelayMs: 500,
    hoverToExpand: true,
    autoCollapseOnFocusStart: false,
    autoShowOnMainHide: true,
    autoShowOnFocusStart: true,
    autoHideOnFocusEnd: false,
  },
  layout: {
    leftPaneWidth: null,
  },
  ticktick: {
    connected: false,
    clientId: '',
    region: 'dida365',
  },
};

/** IPC 通道定义 - 类型安全 */
export interface TimerIPC {
  'timer:get-snapshot': () => Promise<TimerSnapshot>;
  'timer:toggle': () => Promise<TimerSnapshot>;
  'timer:pause': () => Promise<TimerSnapshot>;
  'timer:resume': () => Promise<TimerSnapshot>;
  'timer:stop': () => Promise<TimerSnapshot>;
  'timer:reset': () => Promise<TimerSnapshot>;
  /** 带任务原子启动：开始专注时同时写入 Session 默认任务 + 第一个 Segment 任务 */
  'timer:start-with-task': (args: {
    taskId: string;
    taskSource: TaskSource;
    taskTitle?: string;
  }) => Promise<TimerSnapshot>;
  'timer:link-task': (args: {
    segmentId: string;
    taskId: string;
    taskSource: TaskSource;
    taskTitle?: string;
  }) => Promise<void>;
  'timer:link-session-task': (args: {
    sessionId: string;
    taskId: string;
    taskSource: TaskSource;
    taskTitle?: string;
  }) => Promise<void>;
  'timer:clear-segment-task': (args: { segmentId: string }) => Promise<void>;
  'timer:clear-session-default-task': (args: { sessionId: string }) => Promise<void>;
  'timer:link-segments-batch': (args: {
    sessionId: string;
    taskId: string;
    taskSource: TaskSource;
    taskTitle?: string;
    onlyUnlinked: boolean;
  }) => Promise<number>;
  'timer:set-segment-title': (args: { segmentId: string; title: string }) => Promise<void>;
  'timer:merge-segments': (args: { segmentIds: string[] }) => Promise<void>;
  'timer:split-segment': (args: { segmentId: string; atMs: number }) => Promise<void>;
}

export interface TaskIPC {
  'tasks:list-local': () => Promise<Task[]>;
  'tasks:create-local': (input: { title: string; projectId?: string }) => Promise<Task>;
  'tasks:search': (query: string) => Promise<Task[]>;
  'tasks:complete': (task: Task) => Promise<Task>;
  'ticktick:login': (
    clientId: string,
    clientSecret: string,
    region: 'ticktick' | 'dida365',
  ) => Promise<void>;
  'ticktick:logout': () => Promise<void>;
  'ticktick:list-projects': () => Promise<Project[]>;
  'ticktick:list-tasks': (projectId?: string) => Promise<Task[]>;
  'ticktick:status': () => Promise<{ connected: boolean; region: string }>;
}

export interface SessionIPC {
  'sessions:list': (limit?: number) => Promise<FocusSession[]>;
  'sessions:get': (
    id: string,
  ) => Promise<{ session: FocusSession; segments: FocusSegment[]; pauses: PauseEvent[] } | null>;
  'sessions:delete': (id: string) => Promise<void>;
  'sessions:export': (id: string, format: 'json' | 'csv' | 'markdown') => Promise<string>;
}

export interface SettingsIPC {
  'settings:get': () => Promise<AppSettings>;
  'settings:set': (settings: Partial<AppSettings>) => Promise<AppSettings>;
  'settings:set-hotkey': (
    key: keyof AppSettings['hotkeys'],
    accelerator: string,
  ) => Promise<{
    settings: AppSettings;
    registration: {
      key: keyof AppSettings['hotkeys'];
      accelerator: string;
      success: boolean;
      error?: string;
    };
  }>;
}

export interface SyncIPC {
  'sync:enqueue-segment': (segmentId: string) => Promise<SyncQueueItem>;
  'sync:enqueue-session': (sessionId: string) => Promise<SyncQueueItem>;
  'sync:list': () => Promise<SyncQueueItem[]>;
  'sync:retry': (id: string) => Promise<void>;
  'sync:run-pending': () => Promise<{ processed: number; succeeded: number; failed: number }>;
}

export interface WindowIPC {
  'window:minimize-to-tray': () => void;
  'window:show': () => void;
  'window:quit': () => void;
}

/** 事件：主进程 -> 渲染进程 */
export interface MainEvents {
  'timer:state-changed': (snapshot: TimerSnapshot) => void;
  tick: (snapshot: TimerSnapshot) => void;
  'toast:show': (toast: {
    message: string;
    type: 'success' | 'error' | 'info';
    id: string;
  }) => void;
  'hotkey:registered': (info: { key: string; success: boolean; error?: string }) => void;
}

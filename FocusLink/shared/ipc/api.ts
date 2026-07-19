import type {
  AppSettings,
  FocusSegment,
  FocusSession,
  MiniWindowConfig,
  PauseEvent,
  Project,
  SettingsDomain,
  SyncQueueItem,
  Task,
  TaskSource,
  TaskWorkspaceRefreshOptions,
  TickTickCliConfig,
  TimerSnapshot,
  TomatodoSubject,
} from '../types';

/** A serializable success/error envelope used by the CLI diagnostics endpoints. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface TaskWorkspaceRefreshData {
  /** local 仅保留旧渲染器类型兼容；工作台服务实际只返回滴答连接。 */
  provider: 'local' | 'dida-cli' | 'ticktick-oauth';
  projects: Project[];
  tasks: Task[];
  refreshedAt: number;
}

export interface CliExecRecord {
  command: string;
  cwd: string;
  timeoutMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  status: 'success' | 'failed' | 'timeout' | 'not-found' | 'parse-failed';
  parseResult: 'success' | 'failed' | 'na';
  error?: string;
}

export interface CliDiagnoseStep {
  name: string;
  ok: boolean;
  summary: string;
  record?: CliExecRecord;
}

export interface CliDiagnoseResult {
  provider: 'dida';
  executable: string;
  executablePath: string;
  cwd: string;
  version: string;
  loggedIn: boolean | null;
  loginStatusText: string;
  steps: CliDiagnoseStep[];
  lastError: string | null;
  lastStdout: string;
  lastStderr: string;
  templates: TickTickCliConfig;
}

export interface CliDetectResult {
  found: boolean;
  executable: string;
  executablePath: string;
  candidates: { cmd: string; found: boolean };
  helpOutput?: string;
}

export interface CliProviderInfo {
  providerType: 'dida' | 'ticktick' | 'unknown';
  executable: string;
  executablePath: string;
  hasStaleTicktickTemplates: boolean;
  currentTemplates: TickTickCliConfig;
  didaDefaultTemplates: TickTickCliConfig;
}

export type HotkeyAction = keyof AppSettings['hotkeys'];

export interface HotkeyRegistrationResult {
  key: HotkeyAction;
  accelerator: string;
  success: boolean;
  error?: string;
}

export interface HotkeyRegistrationStatus {
  registered: Record<string, { action: HotkeyAction; accelerator: string }>;
  failed: HotkeyRegistrationResult[];
}

export interface SessionDetail {
  session: FocusSession;
  segments: FocusSegment[];
  pauses: PauseEvent[];
}

export interface SessionAnalyticsRange {
  start: number;
  end: number;
  /** Optional single-day window used for the detailed mixed timeline. */
  timelineStart?: number;
  timelineEnd?: number;
}

export interface SessionAnalyticsDaily {
  date: string;
  activeMs: number;
  pauseMs: number;
  wallMs: number;
  sessionCount: number;
}

export interface SessionAnalyticsTask {
  key: string;
  taskId: string | null;
  title: string;
  activeMs: number;
  segmentCount: number;
}

export interface SessionAnalyticsTimelineItem {
  id: string;
  sessionId: string;
  kind: 'focus' | 'pause';
  title: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  taskId: string | null;
}

export interface SessionAnalyticsResult {
  range: SessionAnalyticsRange;
  daily: SessionAnalyticsDaily[];
  tasks: SessionAnalyticsTask[];
  sessions: FocusSession[];
  timeline: SessionAnalyticsTimelineItem[];
  totals: {
    activeMs: number;
    pauseMs: number;
    wallMs: number;
    sessionCount: number;
  };
  stability: {
    activeDays: number;
    calendarDays: number;
    averageDailyActiveMs: number;
    standardDeviationMs: number;
    score: number;
  };
}

export interface SegmentDeleteResult {
  cloudDeleted: boolean;
  tomatodoDeleted: number;
}

export interface RunPendingResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export interface ResyncSegmentResult {
  ok: boolean;
  queued?: boolean;
  error?: string;
}

export interface TomatodoSyncSegmentResult {
  segmentId: string;
  ok: boolean;
  skipped: boolean;
  synced: boolean;
  localWritten: boolean;
  cloudSynced: boolean;
  syncState: 'skipped' | 'local-pending' | 'cloud-pending' | 'cloud-synced' | 'failed';
  subject: TomatodoSubject;
  minutes: number;
  recordId?: number;
  error?: string;
}

export interface TomatodoSyncSessionResult {
  sessionId: string;
  ok: boolean;
  total: number;
  synced: number;
  skipped: number;
  failed: number;
  results: TomatodoSyncSegmentResult[];
  dbPath: string;
}

export interface TomatodoSubjectSetResult {
  ok: boolean;
  updatedCount: number;
  externalFoundCount: number;
  externalUpdatedCount: number;
  error?: string;
}

export interface TomatodoSegmentStatus {
  segmentId: string;
  synced: boolean;
  writtenLocally: boolean;
  cloudSynced: boolean;
  state: 'not-written' | 'local-pending' | 'cloud-synced';
  subject: TomatodoSubject;
  source: 'manual' | 'auto' | 'fallback';
}

export interface TomatodoSyncStatus {
  enabled: boolean;
  dbPath: string;
  segments: TomatodoSegmentStatus[];
}

export interface PendingTomatodoUploadResult {
  ok: boolean;
  total: number;
  uploaded: number;
  failed: number;
  error?: string;
}

export type TomatodoBridgeState =
  | 'connected'
  | 'stopped'
  | 'restart-required'
  | 'not-installed'
  | 'launch-failed'
  | 'launch-timeout';

export interface TomatodoBridgeStatus {
  state: TomatodoBridgeState;
  connected: boolean;
  running: boolean;
  installed: boolean;
  launched: boolean;
  executablePath?: string;
  error?: string;
}

export type FocusLinkNavigationTarget = 'timer' | 'history' | 'settings' | 'tasks' | 'mini';

export interface FocusLinkToast {
  message: string;
  type: 'success' | 'error' | 'info';
  id: string;
}

export interface MiniDockTransition {
  phase: 'prepare' | 'cancel';
  edge: 'left' | 'right' | 'top' | 'bottom' | null;
}

/** Main-process events accepted by the renderer-facing subscription API. */
export interface FocusLinkEventMap {
  tick: [snapshot: TimerSnapshot];
  'timer:state-changed': [snapshot: TimerSnapshot];
  navigate: [target: FocusLinkNavigationTarget];
  'toast:show': [toast: FocusLinkToast];
  'hotkey:registered': [info: HotkeyRegistrationResult];
  'settings:changed': [settings: AppSettings];
  'settings:domain-changed': [domains: SettingsDomain[]];
  'mini:dock-transition': [transition: MiniDockTransition];
}

/**
 * The complete, context-isolated API exposed by electron/preload.ts.
 *
 * Keep this contract in shared/ so renderer declarations never need to import
 * executable Electron code merely to learn the shape of window.focuslink.
 */
export interface FocusLinkAPI {
  timer: {
    getSnapshot(): Promise<TimerSnapshot>;
    toggle(): Promise<TimerSnapshot>;
    pause(): Promise<TimerSnapshot>;
    resume(): Promise<TimerSnapshot>;
    stop(): Promise<TimerSnapshot>;
    reset(): Promise<TimerSnapshot>;
    startWithTask(
      taskId: string,
      taskSource: TaskSource,
      taskTitle?: string,
    ): Promise<TimerSnapshot>;
    linkTask(
      segmentId: string,
      taskId: string,
      taskSource: TaskSource,
      taskTitle?: string,
    ): Promise<void>;
    linkSessionTask(
      sessionId: string,
      taskId: string,
      taskSource: TaskSource,
      taskTitle?: string,
    ): Promise<void>;
    clearSegmentTask(segmentId: string): Promise<void>;
    clearSessionDefaultTask(sessionId: string): Promise<void>;
    linkSegmentsBatch(
      sessionId: string,
      taskId: string,
      taskSource: TaskSource,
      taskTitle: string | null,
      onlyUnlinked: boolean,
    ): Promise<number>;
    setSegmentTitle(segmentId: string, title: string): Promise<void>;
    mergeSegments(segmentIds: string[]): Promise<void>;
  };
  tasks: {
    complete(task: Task): Promise<Task>;
    setCompleted(task: Task, completed: boolean): Promise<Task>;
    refresh(options?: TaskWorkspaceRefreshOptions): Promise<IpcResult<TaskWorkspaceRefreshData>>;
  };
  ticktick: {
    login(
      clientId: string,
      clientSecret: string,
      region: 'ticktick' | 'dida365',
    ): Promise<AppSettings>;
    logout(): Promise<AppSettings>;
    listProjects(): Promise<Project[]>;
    listTasks(projectId?: string): Promise<Task[]>;
    status(): Promise<{ connected: boolean; region: 'ticktick' | 'dida365' }>;
  };
  cli: {
    detect(): Promise<CliDetectResult>;
    listProjects(): Promise<IpcResult<Project[]>>;
    listTasks(projectId?: string): Promise<IpcResult<Task[]>>;
    searchTasks(query: string): Promise<IpcResult<Task[]>>;
    diagnose(): Promise<IpcResult<CliDiagnoseResult>>;
    testCommand(command: string, timeoutMs: number): Promise<IpcResult<CliExecRecord>>;
    applyDidaDefaults(): Promise<IpcResult<TickTickCliConfig>>;
    getCurrentProvider(): Promise<CliProviderInfo>;
  };
  sessions: {
    list(limit?: number): Promise<FocusSession[]>;
    get(id: string): Promise<SessionDetail | null>;
    analytics(range: SessionAnalyticsRange): Promise<SessionAnalyticsResult>;
    delete(id: string): Promise<TimerSnapshot>;
    export(id: string, format: 'json' | 'csv' | 'markdown'): Promise<string>;
  };
  segments: {
    delete(id: string): Promise<SegmentDeleteResult>;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(settings: Partial<AppSettings>): Promise<AppSettings>;
    setHotkey(
      key: HotkeyAction,
      accelerator: string,
    ): Promise<{ settings: AppSettings; registration: HotkeyRegistrationResult }>;
  };
  hotkey: {
    test(accelerator: string): Promise<boolean>;
    resetDefaults(): Promise<AppSettings>;
    status(): Promise<HotkeyRegistrationStatus>;
  };
  mini: {
    show(): void;
    hide(): void;
    toggle(): void;
    collapse(): void;
    expand(): void;
    reset(): void;
    getConfig(): Promise<MiniWindowConfig>;
    setOpacity(opacity: number): void;
  };
  sync: {
    enqueueSegment(segmentId: string): Promise<SyncQueueItem>;
    enqueueSession(sessionId: string): Promise<SyncQueueItem>;
    list(): Promise<SyncQueueItem[]>;
    retry(id: string): Promise<void>;
    runPending(): Promise<RunPendingResult>;
    resyncSegment(segmentId: string): Promise<ResyncSegmentResult>;
  };
  tomatodo: {
    syncSegment(segmentId: string): Promise<TomatodoSyncSegmentResult>;
    syncSession(sessionId: string): Promise<TomatodoSyncSessionResult>;
    status(sessionId: string): Promise<TomatodoSyncStatus>;
    setSubject(
      segmentId: string,
      subject: TomatodoSubject | null,
    ): Promise<TomatodoSubjectSetResult>;
    setSubjects(
      segmentIds: string[],
      subject: TomatodoSubject | null,
    ): Promise<TomatodoSubjectSetResult>;
    uploadPending(): Promise<PendingTomatodoUploadResult>;
    pendingCount(): Promise<number>;
    bridgeStatus(): Promise<TomatodoBridgeStatus>;
    ensureBridge(): Promise<TomatodoBridgeStatus>;
  };
  window: {
    minimizeToTray(): void;
    minimize(): void;
    toggleMaximize(): void;
    setFullScreen(enabled: boolean): Promise<boolean>;
    close(): void;
    show(): void;
    quit(): void;
  };
  on<Channel extends keyof FocusLinkEventMap>(
    channel: Channel,
    callback: (...args: FocusLinkEventMap[Channel]) => void,
  ): () => void;
}

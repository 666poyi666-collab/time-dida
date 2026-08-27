import type {
  LiveFocusTimelinePause,
  LiveFocusTimelineSegment,
} from '@shared/sync/liveFocusProtocol';

export type LiveFocusPhase = 'idle' | 'running' | 'paused';

/**
 * Renderer-facing boundary for the live-focus protocol. HTTP details stay in syncClient;
 * native notification code receives only a short-lived display projection.
 */
export interface LiveFocusSnapshotLike {
  state: LiveFocusPhase;
  revision: number;
  sessionId: string | null;
  startedAt: number | null;
  updatedAt: number;
  /** Server epoch used to materialize the elapsed values. */
  serverTime: number;
  /** Local receipt time; display ticks use this so device/server clock skew cannot jump elapsed. */
  observedAt: number;
  activeElapsedMs: number;
  pauseElapsedMs: number;
  wallElapsedMs: number;
  currentStateStartedAt: number | null;
  segments: LiveFocusTimelineSegment[];
  pauses: LiveFocusTimelinePause[];
  title: string | null;
  ownerDeviceId: string | null;
  taskId: string | null;
  taskSource: 'local' | 'ticktick' | null;
  taskTitle: string | null;
}

export interface LiveFocusDurations {
  activeElapsedMs: number;
  pauseElapsedMs: number;
  wallElapsedMs: number;
  primaryElapsedMs: number;
}

export interface RuntimeControlAvailability {
  start: boolean;
  pause: boolean;
  resume: boolean;
  finish: boolean;
}

export type LiveConnectionState = 'unconfigured' | 'connecting' | 'live' | 'offline' | 'error';

export function idleLiveFocusSnapshot(
  revision = 0,
  serverTime = Date.now(),
  observedAt = serverTime,
): LiveFocusSnapshotLike {
  return {
    state: 'idle',
    revision,
    sessionId: null,
    startedAt: null,
    updatedAt: serverTime,
    serverTime,
    observedAt,
    activeElapsedMs: 0,
    pauseElapsedMs: 0,
    wallElapsedMs: 0,
    currentStateStartedAt: null,
    segments: [],
    pauses: [],
    title: null,
    ownerDeviceId: null,
    taskId: null,
    taskSource: null,
    taskTitle: null,
  };
}

export function projectLiveFocusDurations(
  snapshot: LiveFocusSnapshotLike,
  now = Date.now(),
): LiveFocusDurations {
  const delta = snapshot.state === 'idle' ? 0 : Math.max(0, Math.floor(now - snapshot.observedAt));
  const activeElapsedMs = snapshot.activeElapsedMs + (snapshot.state === 'running' ? delta : 0);
  const pauseElapsedMs = snapshot.pauseElapsedMs + (snapshot.state === 'paused' ? delta : 0);
  const wallElapsedMs = snapshot.wallElapsedMs + delta;

  return {
    activeElapsedMs,
    pauseElapsedMs,
    wallElapsedMs,
    primaryElapsedMs:
      snapshot.state === 'paused'
        ? Math.max(
            0,
            snapshot.serverTime - (snapshot.currentStateStartedAt ?? snapshot.serverTime),
          ) + delta
        : snapshot.state === 'running'
          ? activeElapsedMs
          : 0,
  };
}

export function runtimeControlAvailability(input: {
  snapshot: LiveFocusSnapshotLike;
  connection: LiveConnectionState;
  pending: boolean;
  localSession?: boolean;
  allowOfflineStart?: boolean;
}): RuntimeControlAvailability {
  const ready = (input.connection === 'live' || input.localSession === true) && !input.pending;
  return {
    start:
      !input.pending &&
      ((input.snapshot.state === 'idle' && input.connection === 'live') ||
        input.allowOfflineStart === true),
    pause: ready && input.snapshot.state === 'running',
    resume: ready && input.snapshot.state === 'paused',
    finish: ready && input.snapshot.state !== 'idle',
  };
}

export function liveStateLabel(state: LiveFocusPhase): string {
  if (state === 'running') return '专注中';
  if (state === 'paused') return '已暂停';
  return '待开始';
}

export function liveConnectionCopy(
  connection: LiveConnectionState,
  hasSnapshot: boolean,
  connectionNotice: string | null = null,
): { title: string; detail: string } {
  const withNotice = (copy: { title: string; detail: string }) =>
    connectionNotice ? { ...copy, detail: connectionNotice } : copy;
  if (connection === 'live') {
    return withNotice({
      title: '多端状态已连接',
      detail: '来自任一设备的操作会自动更新到这里',
    });
  }
  if (connection === 'connecting') {
    return withNotice({ title: '正在连接实时状态', detail: '完成握手后即可从此设备控制专注' });
  }
  if (connection === 'offline') {
    return withNotice({
      title: '当前离线 · 本机专注可用',
      detail: hasSnapshot
        ? '云端状态仅供参考；可新建独立本机会话，结束后联网补传'
        : '可立即开始本机专注，结束后联网补传',
    });
  }
  if (connection === 'error') {
    return withNotice({
      title: '实时连接中断',
      detail: hasSnapshot
        ? '保留最后确认状态；可新建独立本机会话，不会覆盖云端'
        : '可先使用本机专注，连接恢复后自动补传',
    });
  }
  return withNotice({
    title: '尚未配对设备',
    detail: '输入任一已配对设备的 8 位码，即可启用多端控制与自动同步',
  });
}

export function formatClockDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function compactDeviceId(value: string | null): string {
  if (!value) return '尚无操作设备';
  return value.length <= 18 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

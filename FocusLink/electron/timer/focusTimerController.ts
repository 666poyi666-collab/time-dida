import crypto from 'node:crypto';
import type { TaskSource, TimerSnapshot } from '@shared/types';
import {
  LIVE_FOCUS_MAX_WAIT_MS,
  LIVE_FOCUS_PROTOCOL_VERSION,
  type LiveFocusAction,
  type LiveFocusCommand,
  type LiveFocusSnapshot,
  type LiveFocusSnapshotResponse,
  type LiveFocusTaskContext,
} from '@shared/sync/liveFocusProtocol';
import { normalizeDeviceSyncEndpoint } from '@shared/sync/deviceProtocol';
import { FINISHED_PRESENTATION_HOLD_MS } from '@shared/focus/bandMath';
import {
  liveSnapshotVersion,
  shouldAcceptLiveSnapshot,
  type LiveSnapshotVersion,
} from '@shared/sync/liveSnapshotPolicy';
import { logger } from '../logger.js';
import { getSession } from '../db/index.js';
import {
  getDeviceSyncRuntimeConnection,
  runDeviceSync,
  setDeviceSyncLiveTelemetry,
} from '../sync/deviceSyncService.js';
import type { SnapshotListener, TimerManager } from './manager.js';

const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const REQUEST_RETRY_DELAY_MS = 250;
const REQUEST_MAX_ATTEMPTS = 2;

export class FocusTimerController {
  private snapshot: TimerSnapshot;
  private liveRevision = 0;
  private clockOffsetMs = 0;
  private listeners = new Set<SnapshotListener>();
  private abortController: AbortController | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private generation = 0;
  private liveMode = false;
  private reconnectAttempt = 0;
  private acceptedLiveVersion: LiveSnapshotVersion | null = null;
  private liveConnectionKey: string | null = null;

  constructor(private readonly local: TimerManager) {
    this.snapshot = local.getSnapshot();
    local.onSnapshot((snapshot) => {
      if (this.liveMode) return;
      this.publish(snapshot);
      if (snapshot.state === 'idle' && getDeviceSyncRuntimeConnection()) {
        this.reloadConfiguration();
      }
    });
  }

  recover(): void {
    this.local.recover();
    this.reloadConfiguration();
  }

  reloadConfiguration(): void {
    // A confirmed remote running/paused session is the authoritative fact source. If the
    // connection is restarted (or briefly disappears), keep that lock instead of silently
    // exposing the idle local manager as a second timer.
    const preserveActiveLiveSession =
      this.liveMode && (this.snapshot.state === 'running' || this.snapshot.state === 'paused');
    this.generation += 1;
    this.stopLiveLoop();
    if (!preserveActiveLiveSession) this.liveMode = false;
    this.reconnectAttempt = 0;
    const connection = getDeviceSyncRuntimeConnection();
    const nextConnectionKey = connection
      ? `${normalizeDeviceSyncEndpoint(connection.endpoint)}\u0000${connection.accessToken}`
      : null;
    if (nextConnectionKey !== this.liveConnectionKey) {
      this.liveConnectionKey = nextConnectionKey;
      this.liveRevision = 0;
      this.acceptedLiveVersion = null;
    }
    if (!connection) {
      this.markLiveDisconnected();
      this.publish(preserveActiveLiveSession ? this.snapshot : this.local.getSnapshot());
      return;
    }
    const localSnapshot = this.local.getSnapshot();
    if (!preserveActiveLiveSession && localSnapshot.state !== 'idle') {
      logger.warn('liveFocus', 'live control deferred until local timer is idle');
      this.publish(localSnapshot);
      return;
    }
    void this.refreshAndWait(this.generation);
  }

  reconnect(): void {
    this.reloadConfiguration();
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): TimerSnapshot {
    return this.liveMode ? this.snapshot : this.local.getSnapshot();
  }

  async toggle(): Promise<TimerSnapshot> {
    if (!this.isLiveEnabled()) return this.local.toggle();
    if (this.snapshot.state === 'idle') {
      try {
        return await this.send('start');
      } catch (error) {
        return this.fallbackToLocalStart(error, () => this.local.toggle());
      }
    }
    if (this.snapshot.state === 'running') return this.send('pause');
    if (this.snapshot.state === 'paused') return this.send('resume');
    return this.snapshot;
  }

  async pause(): Promise<TimerSnapshot> {
    return this.isLiveEnabled() ? this.send('pause') : this.local.pause();
  }

  async resume(): Promise<TimerSnapshot> {
    return this.isLiveEnabled() ? this.send('resume') : this.local.resume();
  }

  async stop(): Promise<TimerSnapshot> {
    return this.isLiveEnabled() ? this.send('finish') : this.local.stop();
  }

  async reset(): Promise<TimerSnapshot> {
    if (
      this.isLiveEnabled() &&
      (this.snapshot.state === 'running' || this.snapshot.state === 'paused')
    ) {
      return this.send('abort');
    }
    return this.isLiveEnabled() ? this.snapshot : this.local.reset();
  }

  async startWithTask(
    taskId: string,
    taskSource: TaskSource,
    taskTitle?: string,
  ): Promise<TimerSnapshot> {
    if (!this.isLiveEnabled()) return this.local.startWithTask(taskId, taskSource, taskTitle);
    try {
      return await this.send('start', { taskId, taskSource, taskTitle: taskTitle ?? null });
    } catch (error) {
      return this.fallbackToLocalStart(error, () =>
        this.local.startWithTask(taskId, taskSource, taskTitle),
      );
    }
  }

  private fallbackToLocalStart(error: unknown, startLocal: () => TimerSnapshot): TimerSnapshot {
    if (
      this.snapshot.state !== 'idle' ||
      this.local.getSnapshot().state !== 'idle' ||
      !isTransportFailure(error)
    ) {
      throw error;
    }
    // Cancel the old long-poll before changing fact sources. Otherwise a late
    // response from a dying service could overwrite the newly started local timer.
    this.generation += 1;
    this.stopLiveLoop();
    this.liveMode = false;
    this.markLiveDisconnected();
    this.publish(this.local.getSnapshot());
    logger.warn('liveFocus', 'start command unavailable; falling back to local timer', {
      error: error instanceof Error ? error.message : String(error),
    });
    return startLocal();
  }

  linkSegmentTask(...args: Parameters<TimerManager['linkSegmentTask']>): void {
    this.ensureNotLiveSession(args[0]);
    this.local.linkSegmentTask(...args);
  }
  clearSegmentTask(...args: Parameters<TimerManager['clearSegmentTask']>): void {
    this.ensureNotLiveSession(args[0]);
    this.local.clearSegmentTask(...args);
  }
  linkSessionTask(...args: Parameters<TimerManager['linkSessionTask']>): void {
    this.ensureNotLiveSession(args[0]);
    this.local.linkSessionTask(...args);
  }
  clearSessionDefaultTask(...args: Parameters<TimerManager['clearSessionDefaultTask']>): void {
    this.ensureNotLiveSession(args[0]);
    this.local.clearSessionDefaultTask(...args);
  }
  linkSegmentsBatch(...args: Parameters<TimerManager['linkSegmentsBatch']>): number {
    this.ensureNotLiveSession(args[0]);
    return this.local.linkSegmentsBatch(...args);
  }
  setSegmentTitle(...args: Parameters<TimerManager['setSegmentTitle']>): void {
    this.ensureNotLiveSession(args[0]);
    this.local.setSegmentTitle(...args);
  }
  mergeSegments(...args: Parameters<TimerManager['mergeSegments']>): void {
    this.local.mergeSegments(...args);
  }
  resetIfSession(id: string): boolean {
    return this.local.resetIfSession(id);
  }
  resetIfFinished(): void {
    this.local.resetIfFinished();
  }
  setSegmentBehavior(value: 'new-segment' | 'continue-segment'): void {
    this.local.setSegmentBehavior(value);
  }

  dispose(): void {
    this.generation += 1;
    this.stopLiveLoop();
    this.local.dispose();
  }

  private isLiveEnabled(): boolean {
    return this.liveMode;
  }

  private ensureNotLiveSession(id: string): void {
    if (this.isLiveEnabled() && this.snapshot.sessionId === id) {
      throw new Error('多端实时会话需在开始前选择任务；进行中不能修改关联');
    }
  }

  private async send(
    action: LiveFocusAction,
    task: LiveFocusTaskContext | null = null,
  ): Promise<TimerSnapshot> {
    const connection = getDeviceSyncRuntimeConnection();
    if (!connection) throw new Error('PC 实时专注未启用或连接配置不完整');
    const current = this.snapshot;
    const sessionId = action === 'start' ? crypto.randomUUID() : current.sessionId;
    if (!sessionId) throw new Error('当前没有可控制的实时专注');
    const base = {
      commandId: crypto.randomUUID(),
      expectedRevision: this.liveRevision,
      sessionId,
    };
    const command: LiveFocusCommand =
      action === 'start'
        ? { ...base, action, title: task?.taskTitle ?? null, task }
        : { ...base, action };
    const response = await this.request('/v1/live/command', connection, {
      method: 'POST',
      body: JSON.stringify({
        protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
        deviceId: connection.deviceId,
        command,
      }),
    });
    const value = (await response.json()) as LiveFocusSnapshotResponse & {
      ack: { status: string; errorCode: string | null; completedEntityId: string | null };
    };
    if (value.ack.status !== 'applied' && value.ack.status !== 'duplicate') {
      this.accept(value);
      throw new Error(this.commandError(value.ack.errorCode));
    }
    if ((action === 'finish' || action === 'abort') && value.ack.completedEntityId) {
      this.accept(value, false);
      await runDeviceSync();
      const imported = getSession(value.ack.completedEntityId);
      if (!imported) throw new Error('实时会话已结束，但权威账本尚未导入本机');
      if (imported.status === 'finished') {
        this.publish({ ...current, state: 'finished', sessionId: imported.id });
        setTimeout(
          () => this.publish(this.toTimerSnapshot(value.snapshot, Date.now())),
          FINISHED_PRESENTATION_HOLD_MS,
        );
      } else {
        this.publish(this.toTimerSnapshot(value.snapshot, Date.now()));
      }
    } else {
      this.accept(value);
    }
    return this.snapshot;
  }

  private async refreshAndWait(generation: number): Promise<void> {
    const connection = getDeviceSyncRuntimeConnection();
    if (!connection || generation !== this.generation) return;
    if (!this.liveMode && this.local.getSnapshot().state !== 'idle') return;
    try {
      // Do not switch the local fact source until the first authoritative snapshot
      // has been fetched and accepted. A configured-but-stopped loopback service must
      // never block the ordinary desktop timer.
      const initialController = new AbortController();
      this.abortController = initialController;
      const initial = (await (
        await this.request('/v1/live', connection, {}, initialController.signal)
      ).json()) as LiveFocusSnapshotResponse;
      if (generation !== this.generation || !this.isCurrentConnection(connection)) return;
      if (!this.liveMode && this.local.getSnapshot().state !== 'idle') {
        this.markLiveDisconnected();
        this.publish(this.local.getSnapshot());
        return;
      }
      this.abortController = null;
      // Do not advertise live mode until the initial response has passed `accept`. If protocol
      // validation fails, the desktop remains on the local fact source and can still start.
      this.accept(initial);
      this.liveMode = true;
      this.reconnectAttempt = 0;
      while (generation === this.generation && getDeviceSyncRuntimeConnection()) {
        const controller = new AbortController();
        this.abortController = controller;
        const query = `/v1/live/wait?afterRevision=${this.liveRevision}&waitMs=${LIVE_FOCUS_MAX_WAIT_MS}`;
        const next = (await (
          await this.request(query, connection, {}, controller.signal)
        ).json()) as LiveFocusSnapshotResponse;
        const previous = this.snapshot;
        if (
          next.snapshot.state === 'idle' &&
          previous.sessionId &&
          (previous.state === 'running' || previous.state === 'paused')
        ) {
          this.accept(next, false);
          await runDeviceSync();
          const imported = getSession(previous.sessionId);
          if (!imported) throw new Error('远端实时会话已结束，但权威账本尚未导入本机');
          if (imported.status === 'finished') {
            this.publish({ ...previous, state: 'finished', sessionId: imported.id });
            setTimeout(
              () => this.publish(this.toTimerSnapshot(next.snapshot, Date.now())),
              FINISHED_PRESENTATION_HOLD_MS,
            );
          } else {
            this.publish(this.toTimerSnapshot(next.snapshot, Date.now()));
          }
        } else {
          this.accept(next);
        }
      }
    } catch (error) {
      if (
        generation !== this.generation ||
        (error instanceof DOMException && error.name === 'AbortError')
      )
        return;
      this.abortController = null;
      const wasUsingLiveMode = this.liveMode;
      // Keep active remote sessions authoritative; idle sessions can safely fall back offline.
      const canFallBackToLocal =
        wasUsingLiveMode &&
        this.snapshot.state === 'idle' &&
        this.local.getSnapshot().state === 'idle';
      if (canFallBackToLocal) this.liveMode = false;
      if (!wasUsingLiveMode || canFallBackToLocal) {
        // Initial handshakes are optional for the desktop timer. Keep the local
        // controller usable and expose the disconnected state in Settings instead
        // of routing every start click into a dead endpoint.
        this.publish(this.local.getSnapshot());
      }
      const delay = this.nextReconnectDelay();
      logger.warn('liveFocus', 'live connection lost; retry scheduled', {
        error: error instanceof Error ? error.message : String(error),
        retryInMs: delay,
        liveMode: this.liveMode,
      });
      this.markLiveDisconnected();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.refreshAndWait(generation);
      }, delay);
      this.reconnectTimer.unref?.();
    }
  }

  private isCurrentConnection(connection: { endpoint: string; accessToken: string }): boolean {
    const current = getDeviceSyncRuntimeConnection();
    if (!current) return false;
    return (
      normalizeDeviceSyncEndpoint(current.endpoint) ===
        normalizeDeviceSyncEndpoint(connection.endpoint) &&
      current.accessToken === connection.accessToken
    );
  }

  private nextReconnectDelay(): number {
    const delay = Math.min(
      RECONNECT_DELAY_MS * 2 ** Math.min(this.reconnectAttempt, 5),
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 6);
    return delay;
  }

  private markLiveDisconnected(): void {
    setDeviceSyncLiveTelemetry({
      liveConnected: false,
      liveRevision: this.liveRevision > 0 ? this.liveRevision : null,
      liveState: 'disconnected',
    });
  }

  private accept(response: LiveFocusSnapshotResponse, publish = true): void {
    if (response.protocolVersion !== LIVE_FOCUS_PROTOCOL_VERSION)
      throw new Error('实时协议版本不兼容');
    const incomingVersion = liveSnapshotVersion(response);
    if (!shouldAcceptLiveSnapshot(this.acceptedLiveVersion, incomingVersion)) {
      logger.warn('liveFocus', 'ignored stale or inconsistent live snapshot', {
        currentRevision: this.acceptedLiveVersion?.revision ?? null,
        incomingRevision: incomingVersion.revision,
      });
      return;
    }
    this.acceptedLiveVersion = incomingVersion;
    const observedAt = Date.now();
    this.clockOffsetMs = observedAt - response.serverTime;
    this.liveRevision = response.snapshot.revision;
    if (publish) this.publish(this.toTimerSnapshot(response.snapshot, observedAt));
    setDeviceSyncLiveTelemetry({
      liveConnected: true,
      liveRevision: this.liveRevision,
      liveState: response.snapshot.state,
    });
  }

  private toTimerSnapshot(snapshot: LiveFocusSnapshot, observedAt: number): TimerSnapshot {
    const session = snapshot.session;
    if (!session) return idleSnapshot(observedAt);
    const local = (timestamp: number | null) =>
      timestamp === null ? null : timestamp + this.clockOffsetMs;
    const closedPauseMs = session.pauses.reduce(
      (sum, pause) => sum + (pause.endedAt === null ? 0 : pause.endedAt - pause.startedAt),
      0,
    );
    return {
      state: session.state,
      sessionId: session.id,
      currentSegmentId: session.state === 'running' ? (session.segments.at(-1)?.id ?? null) : null,
      currentTaskId: session.task?.taskId ?? null,
      currentTaskTitle: session.task?.taskTitle ?? session.title,
      currentTaskSource: session.task?.taskSource ?? null,
      sessionDefaultTaskId: session.task?.taskId ?? null,
      sessionDefaultTaskTitle: session.task?.taskTitle ?? null,
      activeElapsedMs: session.activeElapsedMs,
      pauseElapsedMs: closedPauseMs,
      wallElapsedMs: session.wallElapsedMs,
      currentPauseStartedAt: local(session.currentPauseStartedAt),
      segments: session.segments.map((segment) => ({
        id: segment.id,
        taskId: session.task?.taskId ?? null,
        taskTitle: session.task?.taskTitle ?? null,
        taskSource: session.task?.taskSource ?? null,
        title: session.task?.taskTitle ?? session.title,
        startedAt: local(segment.startedAt)!,
        endedAt: local(segment.endedAt),
        activeElapsedMs: (segment.endedAt ?? observedAt - this.clockOffsetMs) - segment.startedAt,
      })),
      pauseEvents: session.pauses.map((pause) => ({
        id: pause.id,
        segmentId: pause.segmentId,
        pauseStartedAt: local(pause.startedAt)!,
        pauseEndedAt: local(pause.endedAt),
        durationMs: pause.endedAt === null ? 0 : pause.endedAt - pause.startedAt,
        isCurrent: pause.endedAt === null,
      })),
      lastTick: observedAt,
    };
  }

  private publish(snapshot: TimerSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener(snapshot));
    this.restartTick(snapshot.state === 'running');
  }

  private restartTick(running: boolean): void {
    if (!running) {
      if (this.tickTimer) clearInterval(this.tickTimer);
      this.tickTimer = null;
      return;
    }
    if (!this.tickTimer) {
      this.tickTimer = setInterval(
        () => this.listeners.forEach((listener) => listener(this.snapshot)),
        1_000,
      );
    }
  }

  private stopLiveLoop(): void {
    this.abortController?.abort();
    this.abortController = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.restartTick(false);
  }

  private async request(
    path: string,
    connection: { endpoint: string; accessToken: string },
    init: { method?: string; body?: string } = {},
    signal?: AbortSignal,
  ): Promise<Response> {
    const endpoint = normalizeDeviceSyncEndpoint(connection.endpoint);
    const url = `${endpoint}${path}`;
    const requestInit: RequestInit = {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${connection.accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body,
      signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    };
    let response: Response | null = null;
    for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
      try {
        response = await fetch(url, requestInit);
        break;
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          throw error;
        }
        if (attempt < REQUEST_MAX_ATTEMPTS) {
          await waitForRetry(signal);
          continue;
        }
        const reason = error instanceof Error ? error.message : String(error);
        const suffix = reason && reason !== 'fetch failed' ? `：${reason}` : '';
        throw new Error(`无法连接实时同步服务（${url}）${suffix}，请检查服务是否启动、地址或网络`);
      }
    }
    if (!response) throw new Error(`实时同步请求未返回响应（${url}）`);
    if (!response.ok) throw new Error(`实时同步服务返回 HTTP ${response.status}`);
    return response;
  }

  private commandError(code: string | null): string {
    if (code === 'revision_conflict')
      return '本次操作未执行：云端 revision 已变化，请确认当前状态后重试';
    if (code === 'active_session_exists') return '本次操作未执行：云端已有进行中的专注';
    if (code === 'no_active_session') return '本次操作未执行：云端当前没有活动专注';
    return `实时专注命令未确认${code ? `（${code}）` : ''}`;
  }
}

function waitForRetry(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, REQUEST_RETRY_DELAY_MS);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function isTransportFailure(error: unknown): boolean {
  if (error instanceof TypeError && /fetch failed|network error|连接被拒绝/i.test(error.message)) {
    return true;
  }
  return (
    error instanceof Error &&
    /fetch failed|network error|无法连接实时同步服务|连接被拒绝/i.test(error.message)
  );
}

function idleSnapshot(now: number): TimerSnapshot {
  return {
    state: 'idle',
    sessionId: null,
    currentSegmentId: null,
    currentTaskId: null,
    currentTaskTitle: null,
    currentTaskSource: null,
    sessionDefaultTaskId: null,
    sessionDefaultTaskTitle: null,
    activeElapsedMs: 0,
    pauseElapsedMs: 0,
    wallElapsedMs: 0,
    currentPauseStartedAt: null,
    segments: [],
    pauseEvents: [],
    lastTick: now,
  };
}

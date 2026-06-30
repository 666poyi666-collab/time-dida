// TimerManager - 计时器核心管理器
// 实现 Session + Segment + Pause Event 三时间账本
//
// 关键不变量：
//   activeElapsedMs = 真正专注时间（不含暂停）
//   pauseElapsedMs  = 暂停总时间
//   wallElapsedMs   = now - session.startedAt （自然总跨度）
//   running 时 activeElapsed 持续增加；paused 时不再增加
//
// 持久化策略：
//   - 状态转换立即写库（session/segment/pause）
//   - 每 1s tick 更新内存快照并推送给渲染进程
//   - 每 5s 持久化 activeElapsedMs 快照到 segment + app_meta(lastTick)
//   - 崩溃恢复时：若存在 active session，按 lastTick 与当前时间重算
import { app } from 'electron';
import crypto from 'node:crypto';
import { logger } from '../logger.js';
import {
  getActiveSession,
  insertSession,
  updateSession,
  getSession,
  insertSegment,
  updateSegment,
  listSegments,
  getSegment,
  insertPause,
  updatePause,
  getOpenPause,
  listPauses,
  deleteSegment,
  getMeta,
  setMeta,
} from '../db/index.js';
import { transition, getToggleEvent } from './stateMachine.js';
import type {
  TimerState,
  TimerSnapshot,
  FocusSession,
  FocusSegment,
  PauseEvent,
  PauseEventSummary,
  SegmentSummary,
  TaskSource,
} from '@shared/types';

const TICK_INTERVAL_MS = 1000;
const PERSIST_INTERVAL_MS = 5000;
const META_LAST_TICK = 'timer.lastTick';
const META_LAST_STATE = 'timer.lastState';
const META_LAST_SEGMENT = 'timer.lastSegmentId';

export type SnapshotListener = (snapshot: TimerSnapshot) => void;

export class TimerManager {
  private state: TimerState = 'idle';
  private session: FocusSession | null = null;
  private currentSegment: FocusSegment | null = null;
  private currentPause: PauseEvent | null = null;
  /** 当前 segment 自上次持久化以来已累计的活跃毫秒（增量） */
  private activeElapsedMs = 0;
  /** 当前 segment 开始时的累计 activeElapsedMs 基准。
   *  segment 的独立时长 = this.activeElapsedMs - this.currentSegmentActiveBaseMs。
   *  这样 resume 创建新 segment 时，新 segment 从 0 开始计时，
   *  而不是错误地继承整个 session 的累计值。 */
  private currentSegmentActiveBaseMs = 0;
  private pauseElapsedMs = 0;
  /** 上一次 tick 的时间戳，用于增量计算 */
  private lastTick = 0;
  private tickTimer: NodeJS.Timeout | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<SnapshotListener>();
  private segmentBehavior: 'new-segment' | 'continue-segment' = 'new-segment';

  constructor(segmentBehavior: 'new-segment' | 'continue-segment' = 'new-segment') {
    this.segmentBehavior = segmentBehavior;
  }

  setSegmentBehavior(b: 'new-segment' | 'continue-segment'): void {
    this.segmentBehavior = b;
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((l) => l(snap));
  }

  // ============ 启动 / 恢复 ============

  /** 程序启动时调用，从 DB 恢复状态 */
  recover(): void {
    const active = getActiveSession();
    if (!active) {
      logger.info('timer', 'no active session to recover');
      return;
    }
    this.session = active;
    const segments = listSegments(active.id);
    const lastSegment = segments[segments.length - 1] ?? null;

    const openPause = getOpenPause(active.id);
    const lastTickStr = getMeta(META_LAST_TICK);
    const lastState = getMeta(META_LAST_STATE) ?? 'running';
    const lastTick = lastTickStr ? Number(lastTickStr) : 0;

    if (openPause) {
      // 恢复为暂停状态
      this.currentPause = openPause;
      this.currentSegment = lastSegment;
      this.activeElapsedMs = active.activeElapsedMs;
      // 反推当前 segment 基准：累计 active - 当前 segment 已结算的独立时长
      this.currentSegmentActiveBaseMs = Math.max(
        0,
        this.activeElapsedMs - (lastSegment?.activeElapsedMs ?? 0),
      );
      this.pauseElapsedMs = active.pauseElapsedMs;
      this.state = 'paused';
      logger.info('timer', 'recovered as paused', { sessionId: active.id });
    } else if (lastState === 'running' && lastSegment && lastTick > 0) {
      // 重启前在 running：根据 lastTick 重算
      this.currentSegment = lastSegment;
      this.activeElapsedMs = active.activeElapsedMs;
      // 反推当前 segment 基准：累计 active - 当前 segment 已结算的独立时长
      this.currentSegmentActiveBaseMs = Math.max(
        0,
        this.activeElapsedMs - (lastSegment?.activeElapsedMs ?? 0),
      );
      this.pauseElapsedMs = active.pauseElapsedMs;
      const now = Date.now();
      const delta = Math.max(0, now - lastTick);
      this.activeElapsedMs += delta;
      this.lastTick = now;
      this.state = 'running';
      logger.info('timer', 'recovered as running, recalculated', {
        sessionId: active.id,
        deltaMs: delta,
      });
      this.startTick();
    } else {
      // 未知状态，保守处理为 finished
      logger.warn('timer', 'unclear recovery state, finishing session', { sessionId: active.id });
      this.session = active;
      this.stop();
      return;
    }
    this.emit();
  }

  // ============ 状态转换 ============

  toggle(): TimerSnapshot {
    const event = getToggleEvent(this.state);
    if (!event) {
      logger.warn('timer', `toggle ignored in state ${this.state}`);
      return this.getSnapshot();
    }
    if (event === 'START') return this.start();
    if (event === 'PAUSE') return this.pause();
    if (event === 'RESUME') return this.resume();
    return this.getSnapshot();
  }

  start(): TimerSnapshot {
    const result = transition(this.state, 'START');
    if (!result.ok) {
      logger.warn('timer', result.reason ?? 'start failed');
      return this.getSnapshot();
    }
    const now = Date.now();
    const session: FocusSession = {
      id: crypto.randomUUID(),
      title: null,
      status: 'active',
      startedAt: now,
      endedAt: null,
      activeElapsedMs: 0,
      pauseElapsedMs: 0,
      wallElapsedMs: 0,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      note: null,
      createdAt: now,
      updatedAt: now,
    };
    insertSession(session);
    this.session = session;

    const segment = this.createSegment(session.id, now);
    this.currentSegment = segment;
    this.activeElapsedMs = 0;
    this.currentSegmentActiveBaseMs = 0;
    this.pauseElapsedMs = 0;
    this.lastTick = now;
    this.state = 'running';
    this.persistMeta(now);
    this.startTick();

    logger.info('timer', 'started', { sessionId: session.id, segmentId: segment.id });
    this.emit();
    return this.getSnapshot();
  }

  /** 带任务原子启动：开始专注时同时写入 Session 默认任务 + 第一个 Segment 任务。
   *  避免出现"先 start 再 link"的中间脏状态。 */
  startWithTask(taskId: string, taskSource: TaskSource, taskTitle?: string): TimerSnapshot {
    const result = transition(this.state, 'START');
    if (!result.ok) {
      logger.warn('timer', result.reason ?? 'startWithTask failed');
      return this.getSnapshot();
    }
    const now = Date.now();
    const session: FocusSession = {
      id: crypto.randomUUID(),
      title: null,
      status: 'active',
      startedAt: now,
      endedAt: null,
      activeElapsedMs: 0,
      pauseElapsedMs: 0,
      wallElapsedMs: 0,
      // Session 默认任务 = 用户选择的任务
      defaultTaskId: taskId,
      defaultTaskSource: taskSource,
      defaultTaskTitle: taskTitle ?? null,
      note: null,
      createdAt: now,
      updatedAt: now,
    };
    insertSession(session);
    this.session = session;

    // 创建第一个 Segment 并原子写入任务关联
    const segment = this.createSegment(session.id, now);
    segment.taskId = taskId;
    segment.taskSource = taskSource;
    if (taskTitle != null) segment.title = taskTitle;
    segment.updatedAt = now;
    updateSegment(segment);
    this.currentSegment = segment;

    this.activeElapsedMs = 0;
    this.currentSegmentActiveBaseMs = 0;
    this.pauseElapsedMs = 0;
    this.lastTick = now;
    this.state = 'running';
    this.persistMeta(now);
    this.startTick();

    logger.info('timer', 'started with task', {
      sessionId: session.id,
      segmentId: segment.id,
      taskId,
      taskTitle,
    });
    this.emit();
    return this.getSnapshot();
  }

  pause(): TimerSnapshot {
    const result = transition(this.state, 'PAUSE');
    if (!result.ok) {
      logger.warn('timer', result.reason ?? 'pause failed');
      return this.getSnapshot();
    }
    const now = Date.now();
    // 结算 active 增量
    this.settleActive(now);
    // 创建暂停事件
    if (this.session && this.currentSegment) {
      const pause: PauseEvent = {
        id: crypto.randomUUID(),
        sessionId: this.session.id,
        segmentId: this.currentSegment.id,
        pauseStartedAt: now,
        pauseEndedAt: null,
        durationMs: 0,
        reason: null,
        createdAt: now,
        updatedAt: now,
      };
      insertPause(pause);
      this.currentPause = pause;
    }
    this.state = 'paused';
    this.persistMeta(now);
    this.stopTick();
    logger.info('timer', 'paused', { activeMs: this.activeElapsedMs });
    this.emit();
    return this.getSnapshot();
  }

  resume(): TimerSnapshot {
    const result = transition(this.state, 'RESUME');
    if (!result.ok) {
      logger.warn('timer', result.reason ?? 'resume failed');
      return this.getSnapshot();
    }
    const now = Date.now();
    // 结束当前 pause 并累加 pauseElapsedMs
    if (this.currentPause && this.session) {
      const duration = Math.max(0, now - this.currentPause.pauseStartedAt);
      this.currentPause.pauseEndedAt = now;
      this.currentPause.durationMs = duration;
      this.currentPause.updatedAt = now;
      updatePause(this.currentPause);
      this.pauseElapsedMs += duration;
    }
    this.currentPause = null;

    // 本项目规则固定为：resume 始终创建新的 focus segment。
    // 即使 settings.segmentBehavior === 'continue-segment' 也无视，
    // 保证"暂停后继续，专注时间从 0 开始"这一核心语义。
    if (this.session) {
      // 先结算旧 segment（写入其独立时长）
      this.closeSegment(now);
      // 新建 segment，重置 active 基准 = 当前累计 activeElapsedMs
      // 这样新 segment 的独立时长 = activeElapsedMs - base，从 0 开始
      const seg = this.createSegment(this.session.id, now);
      this.currentSegment = seg;
      this.currentSegmentActiveBaseMs = this.activeElapsedMs;
      // 新 segment 沿用 session 默认任务（含标题）
      if (this.session.defaultTaskId && this.session.defaultTaskSource) {
        seg.taskId = this.session.defaultTaskId;
        seg.taskSource = this.session.defaultTaskSource;
        if (this.session.defaultTaskTitle) seg.title = this.session.defaultTaskTitle;
        updateSegment(seg);
      }
    }

    this.lastTick = now;
    this.state = 'running';
    this.persistMeta(now);
    this.startTick();
    logger.info('timer', 'resumed (always new segment)', {
      newSegmentId: this.currentSegment?.id,
      activeBase: this.currentSegmentActiveBaseMs,
      pauseMs: this.pauseElapsedMs,
    });
    this.emit();
    return this.getSnapshot();
  }

  stop(): TimerSnapshot {
    const fromState = this.state;
    const result = transition(this.state, 'STOP');
    if (!result.ok) {
      logger.warn('timer', result.reason ?? 'stop failed');
      return this.getSnapshot();
    }
    const now = Date.now();
    if (fromState === 'running') {
      this.settleActive(now);
    }
    // 关闭可能存在的暂停
    if (this.currentPause && this.session) {
      const duration = Math.max(0, now - this.currentPause.pauseStartedAt);
      this.currentPause.pauseEndedAt = now;
      this.currentPause.durationMs = duration;
      this.currentPause.updatedAt = now;
      updatePause(this.currentPause);
      this.pauseElapsedMs += duration;
      this.currentPause = null;
    }
    // 关闭 segment
    this.closeSegment(now);
    // 关闭 session
    if (this.session) {
      this.session.status = 'finished';
      this.session.endedAt = now;
      this.session.activeElapsedMs = this.activeElapsedMs;
      this.session.pauseElapsedMs = this.pauseElapsedMs;
      this.session.wallElapsedMs = Math.max(0, now - this.session.startedAt);
      this.session.updatedAt = now;
      updateSession(this.session);
    }
    this.state = 'finished';
    this.stopTick();
    this.clearMeta();
    logger.info('timer', 'stopped', {
      activeMs: this.activeElapsedMs,
      pauseMs: this.pauseElapsedMs,
      wallMs: this.session?.wallElapsedMs,
    });
    this.emit();
    // 完成后自动重置为 idle，保留数据
    setTimeout(() => this.reset(), 1500);
    return this.getSnapshot();
  }

  reset(): TimerSnapshot {
    const result = transition(this.state, 'RESET');
    if (!result.ok) {
      // 直接强制重置（finished -> idle）
      if (this.state !== 'finished' && this.state !== 'idle') {
        logger.warn('timer', `force reset from ${this.state}`);
      }
    }
    this.session = null;
    this.currentSegment = null;
    this.currentPause = null;
    this.activeElapsedMs = 0;
    this.pauseElapsedMs = 0;
    this.lastTick = 0;
    this.state = 'idle';
    this.stopTick();
    this.clearMeta();
    this.emit();
    return this.getSnapshot();
  }

  // ============ 任务关联 ============

  linkSegmentTask(
    segmentId: string,
    taskId: string,
    taskSource: TaskSource,
    taskTitle?: string,
  ): void {
    const seg = getSegment(segmentId);
    if (!seg) throw new Error(`segment 不存在: ${segmentId}`);
    seg.taskId = taskId;
    seg.taskSource = taskSource;
    if (taskTitle != null) seg.title = taskTitle;
    seg.updatedAt = Date.now();
    updateSegment(seg);
    if (this.currentSegment?.id === segmentId) {
      this.currentSegment = seg;
    }
    logger.info('timer', 'linked task to segment', { segmentId, taskId, taskSource });
    this.emit();
  }

  /** 清除某 segment 的任务关联 */
  clearSegmentTask(segmentId: string): void {
    const seg = getSegment(segmentId);
    if (!seg) throw new Error(`segment 不存在: ${segmentId}`);
    seg.taskId = null;
    seg.taskSource = null;
    seg.title = null;
    seg.updatedAt = Date.now();
    updateSegment(seg);
    if (this.currentSegment?.id === segmentId) {
      this.currentSegment = seg;
    }
    logger.info('timer', 'cleared segment task link', { segmentId });
    this.emit();
  }

  linkSessionTask(
    sessionId: string,
    taskId: string,
    taskSource: TaskSource,
    taskTitle?: string,
  ): void {
    if (!this.session || this.session.id !== sessionId) {
      const s = getSession(sessionId);
      if (!s) throw new Error(`session 不存在: ${sessionId}`);
      this.session = s;
    }
    this.session.defaultTaskId = taskId;
    this.session.defaultTaskSource = taskSource;
    this.session.defaultTaskTitle = taskTitle ?? null;
    this.session.updatedAt = Date.now();
    updateSession(this.session);
    // 同步到当前 segment（如果未单独指定）
    if (this.currentSegment && !this.currentSegment.taskId) {
      this.currentSegment.taskId = taskId;
      this.currentSegment.taskSource = taskSource;
      if (taskTitle != null) this.currentSegment.title = taskTitle;
      this.currentSegment.updatedAt = Date.now();
      updateSegment(this.currentSegment);
    }
    logger.info('timer', 'linked task to session', { sessionId, taskId, taskSource });
    this.emit();
  }

  /** 清除 session 的默认任务 */
  clearSessionDefaultTask(sessionId: string): void {
    if (!this.session || this.session.id !== sessionId) {
      const s = getSession(sessionId);
      if (!s) throw new Error(`session 不存在: ${sessionId}`);
      this.session = s;
    }
    this.session.defaultTaskId = null;
    this.session.defaultTaskSource = null;
    this.session.defaultTaskTitle = null;
    this.session.updatedAt = Date.now();
    updateSession(this.session);
    logger.info('timer', 'cleared session default task', { sessionId });
    this.emit();
  }

  /** 批量关联一个 session 的 segments 到指定任务
   *  onlyUnlinked=true: 只关联未设置任务的 segment
   *  onlyUnlinked=false: 覆盖所有 segment
   *  返回被更新的 segment 数量
   */
  linkSegmentsBatch(
    sessionId: string,
    taskId: string,
    taskSource: TaskSource,
    taskTitle: string | null,
    onlyUnlinked: boolean,
  ): number {
    const segs = listSegments(sessionId);
    let count = 0;
    for (const seg of segs) {
      if (onlyUnlinked && seg.taskId) continue;
      seg.taskId = taskId;
      seg.taskSource = taskSource;
      if (taskTitle != null) seg.title = taskTitle;
      seg.updatedAt = Date.now();
      updateSegment(seg);
      if (this.currentSegment?.id === seg.id) {
        this.currentSegment = seg;
      }
      count++;
    }
    // 同步更新 session 默认任务（便于后续新建 segment 继承）
    if (count > 0) {
      if (!this.session || this.session.id !== sessionId) {
        const s = getSession(sessionId);
        if (s) this.session = s;
      }
      if (this.session) {
        this.session.defaultTaskId = taskId;
        this.session.defaultTaskSource = taskSource;
        this.session.defaultTaskTitle = taskTitle;
        this.session.updatedAt = Date.now();
        updateSession(this.session);
      }
    }
    logger.info('timer', 'batch linked segments', { sessionId, count, onlyUnlinked });
    this.emit();
    return count;
  }

  setSegmentTitle(segmentId: string, title: string): void {
    const seg = getSegment(segmentId);
    if (!seg) throw new Error(`segment 不存在: ${segmentId}`);
    seg.title = title;
    seg.updatedAt = Date.now();
    updateSegment(seg);
    if (this.currentSegment?.id === segmentId) {
      this.currentSegment = seg;
    }
    this.emit();
  }

  /** 合并多个 segment 为一个（按时间顺序拼接，时长相加） */
  mergeSegments(segmentIds: string[]): void {
    if (!this.session || segmentIds.length < 2) return;
    const segs = listSegments(this.session.id).filter((s) => segmentIds.includes(s.id));
    if (segs.length < 2) return;
    segs.sort((a, b) => a.startedAt - b.startedAt);
    const first = segs[0];
    const last = segs[segs.length - 1];
    const totalActive = segs.reduce((sum, s) => sum + s.activeElapsedMs, 0);
    // 保留第一个，删除其余
    first.endedAt = last.endedAt;
    first.activeElapsedMs = totalActive;
    first.updatedAt = Date.now();
    updateSegment(first);
    for (let i = 1; i < segs.length; i++) {
      deleteSegment(segs[i].id);
    }
    if (this.currentSegment && segmentIds.includes(this.currentSegment.id)) {
      this.currentSegment = first;
    }
    logger.info('timer', 'merged segments', { count: segs.length, into: first.id });
    this.emit();
  }

  // ============ 内部辅助 ============

  private createSegment(sessionId: string, startedAt: number): FocusSegment {
    const now = startedAt;
    const segment: FocusSegment = {
      id: crypto.randomUUID(),
      sessionId,
      taskId: null,
      taskSource: null,
      title: null,
      startedAt,
      endedAt: null,
      activeElapsedMs: 0,
      note: null,
      createdAt: now,
      updatedAt: now,
    };
    insertSegment(segment);
    return segment;
  }

  private closeSegment(now: number): void {
    if (!this.currentSegment) return;
    this.currentSegment.endedAt = now;
    // segment 独立时长 = 累计 activeElapsedMs - 该 segment 开始时的基准
    // 这样新 segment 从 0 开始，旧 segment 保留自己的真实时长
    this.currentSegment.activeElapsedMs = Math.max(
      0,
      this.activeElapsedMs - this.currentSegmentActiveBaseMs,
    );
    this.currentSegment.updatedAt = now;
    updateSegment(this.currentSegment);
  }

  /** 把自 lastTick 到 now 的活跃时间计入 activeElapsedMs */
  private settleActive(now: number): void {
    if (this.state !== 'running' || this.lastTick === 0) return;
    const delta = Math.max(0, now - this.lastTick);
    this.activeElapsedMs += delta;
    this.lastTick = now;
  }

  private startTick(): void {
    this.stopTick();
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.persistTimer = setInterval(() => this.persistSnapshot(), PERSIST_INTERVAL_MS);
  }

  private stopTick(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
  }

  private tick(): void {
    if (this.state !== 'running') return;
    const now = Date.now();
    this.settleActive(now);
    this.emit();
  }

  /** 周期性持久化 activeElapsedMs 快照，便于崩溃恢复 */
  private persistSnapshot(): void {
    if (this.state !== 'running' && this.state !== 'paused') return;
    const now = Date.now();
    this.settleActive(now);
    if (this.currentSegment && this.session) {
      // segment 写入独立时长（差值），session 写入累计值
      this.currentSegment.activeElapsedMs = Math.max(
        0,
        this.activeElapsedMs - this.currentSegmentActiveBaseMs,
      );
      this.currentSegment.updatedAt = now;
      updateSegment(this.currentSegment);
      this.session.activeElapsedMs = this.activeElapsedMs;
      this.session.pauseElapsedMs = this.pauseElapsedMs;
      this.session.wallElapsedMs = Math.max(0, now - this.session.startedAt);
      this.session.updatedAt = now;
      updateSession(this.session);
    }
    this.persistMeta(now);
  }

  private persistMeta(now: number): void {
    setMeta(META_LAST_TICK, String(now));
    setMeta(META_LAST_STATE, this.state);
    if (this.currentSegment) {
      setMeta(META_LAST_SEGMENT, this.currentSegment.id);
    }
  }

  private clearMeta(): void {
    setMeta(META_LAST_TICK, '0');
    setMeta(META_LAST_STATE, 'idle');
    setMeta(META_LAST_SEGMENT, '');
  }

  // ============ 快照 ============

  getSnapshot(): TimerSnapshot {
    const now = Date.now();
    // 注意：activeElapsedMs / pauseElapsedMs 返回"已结算"的基础值，
    // 渲染层结合 lastTick 用 Date.now() 动态计算实时显示值，
    // 这样即使主进程推送延迟，UI 也能持续刷新。
    const activeMs = this.activeElapsedMs;
    const pauseMs = this.pauseElapsedMs;
    let wallMs = 0;
    let currentPauseStartedAt: number | null = null;

    if (this.session) {
      wallMs = Math.max(0, now - this.session.startedAt);
      if (this.state === 'paused' && this.currentPause) {
        currentPauseStartedAt = this.currentPause.pauseStartedAt;
      }
    }

    const segments: SegmentSummary[] = this.buildSegmentSummaries(now);
    const pauseEvents: PauseEventSummary[] = this.buildPauseEventSummaries();

    return {
      state: this.state,
      sessionId: this.session?.id ?? null,
      currentSegmentId: this.currentSegment?.id ?? null,
      currentTaskId: this.currentSegment?.taskId ?? this.session?.defaultTaskId ?? null,
      // 当前片段标题优先；否则用 session 默认任务标题；均为空则 null（渲染层显示"未关联任务"）
      currentTaskTitle: this.currentSegment?.title ?? this.session?.defaultTaskTitle ?? null,
      currentTaskSource: this.currentSegment?.taskSource ?? this.session?.defaultTaskSource ?? null,
      // Session 默认任务（用于任务区高亮"本次默认"标识 + TimerPanel 显示）
      sessionDefaultTaskId: this.session?.defaultTaskId ?? null,
      sessionDefaultTaskTitle: this.session?.defaultTaskTitle ?? null,
      activeElapsedMs: activeMs,
      pauseElapsedMs: pauseMs,
      wallElapsedMs: wallMs,
      currentPauseStartedAt,
      segments,
      pauseEvents,
      // lastTick = 上次活跃结算时间（running 时）；渲染层用 (now - lastTick) 算增量
      lastTick: this.lastTick > 0 ? this.lastTick : now,
    };
  }

  private buildSegmentSummaries(_now: number): SegmentSummary[] {
    if (!this.session) return [];
    const segs = listSegments(this.session.id);
    return segs.map((s) => {
      // 当前运行中的 segment：返回独立时长（累计值 - 基准），渲染层用 lastTick 动态算增量
      // 其它已结算 segment：直接用 DB 中的独立时长
      const activeMs =
        this.currentSegment?.id === s.id
          ? Math.max(0, this.activeElapsedMs - this.currentSegmentActiveBaseMs)
          : s.activeElapsedMs;
      return {
        id: s.id,
        taskId: s.taskId,
        // segment.title 存储的是关联任务标题（linkSegmentTask 时写入）
        taskTitle: s.title,
        taskSource: s.taskSource,
        title: s.title,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        activeElapsedMs: activeMs,
      };
    });
  }

  /** 构建暂停事件摘要（含当前进行中的暂停），暴露给前端构建混合时间线 */
  private buildPauseEventSummaries(): PauseEventSummary[] {
    if (!this.session) return [];
    const pauses = listPauses(this.session.id);
    return pauses.map((p) => ({
      id: p.id,
      segmentId: p.segmentId,
      pauseStartedAt: p.pauseStartedAt,
      pauseEndedAt: p.pauseEndedAt,
      durationMs: p.durationMs,
      isCurrent: this.currentPause?.id === p.id,
    }));
  }

  dispose(): void {
    this.stopTick();
    // 退出前最后持久化一次
    this.persistSnapshot();
  }
}

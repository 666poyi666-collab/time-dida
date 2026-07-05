// 统一计时 selector - 所有"当前片段时间 / 累计统计"显示位置的唯一数据来源
// 语义口径：
//   - 当前片段时间 = 当前专注片段或当前暂停片段的时长（每次新片段从 0 开始）
//   - 累计专注 = 所有专注 Segment 的 activeElapsedMs 总和
//   - 累计暂停 = 所有 Pause 片段总和
//   - 总历时 = 从本次 Session 开始到现在经过的自然时间
import type { TimerSnapshot } from '@shared/types';

/**
 * 当前专注片段时间（running 状态使用）
 * = 当前 Segment 的 activeElapsedMs + (now - lastTick)
 * 每次 resume 创建新 Segment 时，该值从 0 重新开始。
 */
export function getCurrentSegmentDisplayMs(snapshot: TimerSnapshot | null, now: number): number {
  if (!snapshot) return 0;
  if (snapshot.state !== 'running') {
    // 非 running：返回当前 segment 的已结算值（idle/finished 也走这里）
    const seg = snapshot.segments?.find((s) => s.id === snapshot.currentSegmentId);
    return seg?.activeElapsedMs ?? 0;
  }
  const seg = snapshot.segments?.find((s) => s.id === snapshot.currentSegmentId);
  if (!seg || snapshot.lastTick <= 0) return seg?.activeElapsedMs ?? 0;
  return seg.activeElapsedMs + Math.max(0, now - snapshot.lastTick);
}

/**
 * 当前暂停片段时间（paused 状态使用）
 * = now - currentPauseStartedAt
 */
export function getCurrentPauseDisplayMs(snapshot: TimerSnapshot | null, now: number): number {
  if (!snapshot || snapshot.state !== 'paused' || !snapshot.currentPauseStartedAt) return 0;
  return Math.max(0, now - snapshot.currentPauseStartedAt);
}

/**
 * 大看板主显示时间：根据状态自动选择当前专注片段或当前暂停片段
 */
export function getMainDisplayMs(snapshot: TimerSnapshot | null, now: number): number {
  if (!snapshot) return 0;
  if (snapshot.state === 'paused') return getCurrentPauseDisplayMs(snapshot, now);
  return getCurrentSegmentDisplayMs(snapshot, now);
}

/**
 * 累计专注时间 = 所有专注 Segment 的 activeElapsedMs 总和
 * running 时加上当前未结算的 (now - lastTick) 增量
 */
export function getCumulativeActiveMs(snapshot: TimerSnapshot | null, now: number): number {
  if (!snapshot) return 0;
  if (snapshot.state === 'running' && snapshot.lastTick > 0) {
    return snapshot.activeElapsedMs + Math.max(0, now - snapshot.lastTick);
  }
  return snapshot.activeElapsedMs;
}

/**
 * 累计暂停时间 = 所有 Pause 片段总和
 * paused 时加上当前未结算的 (now - currentPauseStartedAt) 增量
 */
export function getCumulativePauseMs(snapshot: TimerSnapshot | null, now: number): number {
  if (!snapshot) return 0;
  if (snapshot.state === 'paused' && snapshot.currentPauseStartedAt) {
    return snapshot.pauseElapsedMs + Math.max(0, now - snapshot.currentPauseStartedAt);
  }
  return snapshot.pauseElapsedMs;
}

/**
 * 总历时 = 从本次 Session 开始到现在经过的自然时间
 */
export function getWallElapsedMs(snapshot: TimerSnapshot | null): number {
  if (!snapshot) return 0;
  return snapshot.wallElapsedMs;
}

/**
 * 分钟节奏条当前秒数（0-59），60 秒循环
 */
export function getMinuteRhythmSec(snapshot: TimerSnapshot | null, now: number): number {
  const ms = getMainDisplayMs(snapshot, now);
  return Math.floor(ms / 1000) % 60;
}

/**
 * 当前任务标题（统一来源）
 * 优先级：snapshot.currentTaskTitle → 当前 segment 的 title → session 默认任务 → null
 */
export function getCurrentTaskTitle(snapshot: TimerSnapshot | null): string | null {
  if (!snapshot) return null;
  if (snapshot.currentTaskTitle) return snapshot.currentTaskTitle;
  const seg = snapshot.segments?.find((s) => s.id === snapshot.currentSegmentId);
  if (seg?.title) return seg.title;
  if (seg?.taskTitle) return seg.taskTitle;
  if (snapshot.sessionDefaultTaskTitle) return snapshot.sessionDefaultTaskTitle;
  return null;
}

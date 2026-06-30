// 混合时间线构建器 - 用真实 pauseEvents 构建专注/暂停交替的时间线
// 不再靠 Segment 间隙推导，避免暂停片段丢失或被混成专注片段
import type { SegmentSummary, PauseEventSummary, TimerState } from '@shared/types';

export type TimelineItem =
  | {
      type: 'focus';
      id: string;
      index: number;
      title: string;
      startedAt: number;
      endedAt: number | null;
      durationMs: number;
      taskId: string | null;
      taskTitle: string | null;
      taskSource: string | null;
      isActive: boolean;
      isOngoing: boolean;
    }
  | {
      type: 'pause';
      id: string;
      index: number;
      title: string;
      startedAt: number;
      endedAt: number | null;
      durationMs: number;
      isActive: boolean;
      isOngoing: boolean;
    };

/** 构建混合时间线：按时间顺序交替排列专注片段与真实暂停事件。
 *  数据源：snapshot.segments（专注）+ snapshot.pauseEvents（真实暂停）。
 *  当前进行中的暂停（pauseEndedAt=null）用 now 计算实时时长。 */
export function buildMixedTimelineItems(params: {
  segments: SegmentSummary[];
  pauseEvents: PauseEventSummary[];
  currentSegmentId: string | null;
  state: TimerState;
  now: number;
}): TimelineItem[] {
  const { segments, pauseEvents, currentSegmentId, state, now } = params;
  const items: TimelineItem[] = [];

  // 专注片段
  let focusIdx = 0;
  for (const seg of segments) {
    focusIdx += 1;
    const isActive = seg.id === currentSegmentId;
    const isOngoing = isActive && state === 'running';
    const durationMs = isOngoing ? seg.activeElapsedMs : seg.activeElapsedMs; // 已结算或当前 segment 的已结算值（渲染层会再加 now-lastTick）
    items.push({
      type: 'focus',
      id: seg.id,
      index: focusIdx,
      title: seg.taskTitle ?? seg.title ?? `专注片段 ${focusIdx}`,
      startedAt: seg.startedAt,
      endedAt: seg.endedAt,
      durationMs,
      taskId: seg.taskId,
      taskTitle: seg.taskTitle,
      taskSource: seg.taskSource,
      isActive,
      isOngoing,
    });
  }

  // 真实暂停事件
  let pauseIdx = 0;
  for (const p of pauseEvents) {
    pauseIdx += 1;
    const isOngoing = p.isCurrent || (p.pauseEndedAt == null && state === 'paused');
    const durationMs = isOngoing
      ? Math.max(0, now - p.pauseStartedAt)
      : p.durationMs || (p.pauseEndedAt ? Math.max(0, p.pauseEndedAt - p.pauseStartedAt) : 0);
    items.push({
      type: 'pause',
      id: p.id,
      index: pauseIdx,
      title: `暂停片段 ${pauseIdx}`,
      startedAt: p.pauseStartedAt,
      endedAt: p.pauseEndedAt,
      durationMs,
      isActive: isOngoing,
      isOngoing,
    });
  }

  // 按开始时间排序，确保交替显示
  items.sort((a, b) => a.startedAt - b.startedAt);

  // 重新编号（排序后）
  let fIdx = 0;
  let pIdx = 0;
  for (const item of items) {
    if (item.type === 'focus') {
      fIdx += 1;
      item.index = fIdx;
      if (!item.taskTitle) item.title = `专注片段 ${fIdx}`;
    } else {
      pIdx += 1;
      item.index = pIdx;
      item.title = `暂停片段 ${pIdx}`;
    }
  }

  return items;
}

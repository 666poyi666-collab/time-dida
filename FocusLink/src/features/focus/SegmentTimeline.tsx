// 本次专注账本：纯文本账簿 —— 发丝横线分隔条目，当前条目左侧 2px 状态竖条，
// 专注/暂停按发生顺序交织呈现，无 chip、无色块、无卡片堆叠。
// 数据源不变：snapshot.segments + snapshot.pauseEvents，经 buildMixedTimelineItems 混合。
// 语义契约：已关联/未关联 = 本地任务关联；已同步/未同步/同步失败 = 滴答云同步队列，
// 同步状态只出现在滴答来源的专注片段上，提示语统一为「同步到滴答清单」。
import { memo, useEffect, useMemo, useState, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useStore } from '../../app/store';
import { formatDuration, formatMinutes, formatClock } from '../../lib/time';
import { buildMixedTimelineItems, getTimelineDisplayDuration } from '@shared/focus/timeline';
import type { TimelineItem } from '@shared/focus/timeline';
import { getCurrentTaskTitle } from '@shared/focus/selectors';
import {
  NOT_SYNCED_STATE,
  buildSessionSyncStateMap,
  queueItemToSessionSyncState,
  type SessionSyncState,
} from '../history/syncPresentation';
import type { SyncQueueItem } from '@shared/types';

function useNowTick(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

// 与历史页同口径：同一 segment 可能多次入队（重试/重建），只取最新一条决定展示状态。
function buildSegmentSyncMap(queue: SyncQueueItem[]): Record<string, SessionSyncState> {
  const latest = new Map<string, SyncQueueItem>();
  for (const item of queue) {
    try {
      const payload = JSON.parse(item.payload) as { segmentId?: string };
      if (!payload.segmentId) continue;
      const previous = latest.get(payload.segmentId);
      if (!previous || item.updatedAt >= previous.updatedAt) latest.set(payload.segmentId, item);
    } catch {
      // 无效队列项不应影响账本渲染
    }
  }
  return Object.fromEntries(
    Array.from(latest, ([segmentId, item]) => [segmentId, queueItemToSessionSyncState(item)]),
  );
}

const TimelineRow = memo(function TimelineRow({
  item,
  state,
  liveNow,
  lastTick,
  syncState,
  reducedMotion,
}: {
  item: TimelineItem;
  state: string;
  liveNow: number;
  lastTick: number;
  syncState: SessionSyncState | null;
  reducedMotion: boolean;
}) {
  const isFocus = item.type === 'focus';
  const duration = getTimelineDisplayDuration(item, liveNow, lastTick);
  const isCurrent = item.isActive;
  const pausedNow = isFocus && isCurrent && state === 'paused';

  return (
    <motion.div
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
      transition={{ duration: reducedMotion ? 0.12 : 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={`ledger-row ${isFocus ? 'row-focus' : 'row-pause'} ${
        isCurrent ? 'is-current' : ''
      }`}
    >
      <div className="ledger-row-main">
        <span
          className="ledger-row-title"
          title={isFocus ? `${String(item.index).padStart(2, '0')} · ${item.title}` : '暂停'}
        >
          {isFocus ? `${String(item.index).padStart(2, '0')} · ${item.title}` : '暂停'}
        </span>
        <span className="ledger-row-duration">
          {isFocus ? formatDuration(duration) : formatMinutes(duration)}
        </span>
      </div>
      <div className="ledger-row-sub">
        <span className="tabular-nums">{formatClock(item.startedAt)}</span>
        {item.isOngoing ? (
          <span className="tabular-nums">— 此刻</span>
        ) : item.endedAt ? (
          <span className="tabular-nums">— {formatClock(item.endedAt)}</span>
        ) : null}
        {item.isOngoing ? (
          <span className={`ledger-live ${isFocus ? 'focus' : 'pause'}`}>
            {isFocus ? '进行中' : '已暂停'}
          </span>
        ) : pausedNow ? (
          <span className="ledger-live pause">已暂停</span>
        ) : null}
        {isFocus && (
          <span
            className={`ledger-assoc ${item.taskId ? 'linked' : 'unlinked'}`}
            title={item.taskId ? '已关联本地任务' : '未关联任务'}
          >
            {item.taskId ? '已关联' : '未关联'}
          </span>
        )}
        {isFocus && syncState && (
          <span
            className={`ledger-sync tone-${syncState.tone}`}
            title={`同步到滴答清单：${syncState.title ?? syncState.label}`}
          >
            {syncState.label}
          </span>
        )}
      </div>
    </motion.div>
  );
});

export function SegmentTimeline() {
  const { snapshot, syncQueue, setSyncQueue } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion() ?? false;

  const state = snapshot?.state ?? 'idle';
  const sessionId = snapshot?.sessionId ?? null;
  const currentSegmentId = snapshot?.currentSegmentId ?? null;
  const lastTick = snapshot?.lastTick ?? 0;

  const hasOngoing = state === 'running' || state === 'paused';
  const now = useNowTick(hasOngoing);

  const items = useMemo(
    () =>
      buildMixedTimelineItems({
        segments: snapshot?.segments ?? [],
        pauseEvents: snapshot?.pauseEvents ?? [],
        currentSegmentId,
        state,
        // 实时行时长由 TimelineRow 单独计算，避免每秒重建和重排整份账本。
        now: 0,
      }),
    [snapshot?.segments, snapshot?.pauseEvents, currentSegmentId, state],
  );

  const focusCount = items.filter((i) => i.type === 'focus').length;
  const pauseCount = items.filter((i) => i.type === 'pause').length;
  const currentTaskTitle = getCurrentTaskTitle(snapshot);

  // 同步状态映射：片段级（逐行）+ 会话级（结束后的头部汇总）
  const segmentSyncMap = useMemo(() => buildSegmentSyncMap(syncQueue), [syncQueue]);
  const sessionSyncMap = useMemo(() => buildSessionSyncStateMap(syncQueue), [syncQueue]);
  const sessionSync = sessionId ? sessionSyncMap[sessionId] : undefined;

  // 同步队列记录只在结束时才写入主进程，且 worker 异步推进 pending → synced/failed。
  // 进入 finished 时补拉一次；此后每 4s 轮询直到没有 pending，保证账本同步状态新鲜。
  useEffect(() => {
    if (state !== 'finished' || !sessionId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const queue = await window.focuslink.sync.list();
        if (!cancelled) setSyncQueue(queue);
      } catch {
        // 拉取失败保持现有状态，不打断账本展示
      }
    };
    void refresh();
    const id = setInterval(() => {
      const hasPending = useStore.getState().syncQueue.some((item) => item.status === 'pending');
      if (hasPending) void refresh();
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [state, sessionId, setSyncQueue]);

  // 新条目出现时滚到底部（账本按时间追加）；每秒的时长刷新不触发滚动
  useEffect(() => {
    if (scrollRef.current && items.length > 0) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [items.length]);

  if (items.length === 0) {
    return (
      <div className="timeline-container h-full min-h-0 overflow-hidden">
        <header className="ledger-header">
          <h3 className="ledger-title">本次专注账本</h3>
          <span className="ledger-summary">0 段专注 · 0 次暂停</span>
        </header>
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <p className="text-[12px] leading-[1.8] text-fg-subtle">
            专注和暂停会按发生顺序记录在这里。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-container h-full min-h-0 overflow-hidden">
      <header className="ledger-header">
        <h3 className="ledger-title">本次专注账本</h3>
        <span
          className="ledger-summary"
          title={
            state === 'finished' && sessionSync
              ? `同步到滴答清单：${sessionSync.title ?? sessionSync.label}`
              : undefined
          }
        >
          {focusCount} 段专注 · {pauseCount} 次暂停
          {state === 'finished' && sessionSync ? ` · ${sessionSync.label}` : ''}
        </span>
      </header>

      <div className="ledger-task">
        <span className="ledger-task-label">当前任务</span>
        <span
          className={`ledger-task-title ${currentTaskTitle ? '' : 'is-empty'}`}
          title={currentTaskTitle ?? '未选择任务'}
        >
          {currentTaskTitle ?? '未选择任务'}
        </span>
      </div>

      <div ref={scrollRef} className="ledger-list">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const isFocus = item.type === 'focus';
            const syncState =
              isFocus && item.taskSource === 'ticktick'
                ? (segmentSyncMap[item.id] ?? NOT_SYNCED_STATE)
                : null;

            return (
              <TimelineRow
                key={item.id}
                item={item}
                state={state}
                liveNow={item.isOngoing ? now : 0}
                lastTick={isFocus && item.isOngoing ? lastTick : 0}
                syncState={syncState}
                reducedMotion={reducedMotion}
              />
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

// 本次专注账本：纯文本账簿 —— 发丝横线分隔条目，当前条目左侧 2px 状态竖条，
// 专注/暂停按发生顺序交织呈现，无 chip、无色块、无卡片堆叠。
// 数据源不变：snapshot.segments + snapshot.pauseEvents，经 buildMixedTimelineItems 混合。
import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from '../../ui/Icon';
import { useStore } from '../../app/store';
import { formatDuration, formatMinutes, formatClock } from '../../lib/time';
import { buildMixedTimelineItems } from '@shared/focus/timeline';
import { getCurrentTaskTitle } from '@shared/focus/selectors';

function useNowTick(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function SegmentTimeline() {
  const { snapshot } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const segments = snapshot?.segments ?? [];
  const pauseEvents = snapshot?.pauseEvents ?? [];
  const state = snapshot?.state ?? 'idle';
  const currentSegmentId = snapshot?.currentSegmentId ?? null;
  const lastTick = snapshot?.lastTick ?? 0;

  const hasOngoing = state === 'running' || state === 'paused';
  const now = useNowTick(hasOngoing);

  const items = buildMixedTimelineItems({
    segments,
    pauseEvents,
    currentSegmentId,
    state,
    now,
  });

  const focusCount = items.filter((i) => i.type === 'focus').length;
  const pauseCount = items.filter((i) => i.type === 'pause').length;
  const currentTaskTitle = getCurrentTaskTitle(snapshot);
  useEffect(() => {
    if (scrollRef.current && items.length > 0) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [items.length]);

  const getDisplayDuration = (item: (typeof items)[number]): number => {
    if (item.type === 'focus' && item.isOngoing && lastTick > 0) {
      return item.durationMs + Math.max(0, now - lastTick);
    }
    return item.durationMs;
  };

  if (items.length === 0) {
    return (
      <div className="timeline-container timeline-empty h-full min-h-0 overflow-hidden">
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
        <span className="ledger-summary">
          {focusCount} 段专注 · {pauseCount} 次暂停
        </span>
      </header>

      <div className="ledger-task">
        <span className="ledger-task-label">当前任务</span>
        <span className={`ledger-task-title ${currentTaskTitle ? '' : 'is-empty'}`}>
          {currentTaskTitle ?? '未选择任务'}
        </span>
      </div>

      <div ref={scrollRef} className="ledger-list" style={{ scrollbarWidth: 'thin' }}>
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((item) => {
            const isFocus = item.type === 'focus';
            const duration = getDisplayDuration(item);
            const isCurrent = item.isActive;
            const pausedNow = isFocus && isCurrent && state === 'paused';

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className={`ledger-row ${isFocus ? 'row-focus' : 'row-pause'} ${
                  isCurrent ? 'is-current' : ''
                }`}
              >
                <div className="ledger-row-main">
                  <span className="ledger-row-title">
                    {isFocus ? `${String(item.index).padStart(2, '0')} · ${item.title}` : '暂停'}
                  </span>
                  <span className="ledger-row-duration">
                    {isFocus ? formatDuration(duration) : formatMinutes(duration)}
                  </span>
                </div>
                <div className="ledger-row-sub">
                  <span className="tabular-nums">{formatClock(item.startedAt)}</span>
                  {item.isOngoing ? (
                    <span className={`ledger-live ${isFocus ? 'focus' : 'pause'}`}>
                      {isFocus ? '进行中' : '已暂停'}
                    </span>
                  ) : pausedNow ? (
                    <span className="ledger-live pause">已暂停</span>
                  ) : item.endedAt ? (
                    <span className="tabular-nums">— {formatClock(item.endedAt)}</span>
                  ) : null}
                  {isFocus && (
                    <span
                      className={`ledger-assoc ${item.taskId ? 'linked' : 'unlinked'}`}
                      title={item.taskId ? '已关联本地任务' : '未关联任务'}
                    >
                      {item.taskId ? '已关联' : '未关联'}
                    </span>
                  )}
                  {isFocus && item.taskSource === 'ticktick' && (
                    <span className="ledger-source" title="已关联滴答任务">
                      <Icon.Link size="xs" />
                      滴答
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

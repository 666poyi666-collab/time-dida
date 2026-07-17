// 本次片段轨：精致时间线 —— 左侧轨道线与节点圆点，专注/暂停按发生顺序呈现。
import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from '../../ui/Icon';
import { useStore } from '../../app/store';
import { formatDuration, formatClock } from '../../lib/time';
import { buildMixedTimelineItems } from '@shared/focus/timeline';

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

  const focusDuration = items.reduce(
    (total, item) => total + (item.type === 'focus' ? getDisplayDuration(item) : 0),
    0,
  );
  const pauseDuration = items.reduce(
    (total, item) => total + (item.type === 'pause' ? getDisplayDuration(item) : 0),
    0,
  );
  const focusShare = Math.round((focusDuration / Math.max(1, focusDuration + pauseDuration)) * 100);

  if (items.length === 0) {
    return (
      <div className="timeline-container timeline-empty h-full min-h-0 overflow-hidden">
        <div className="ledger-header flex items-center justify-between px-4">
          <div>
            <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">本次片段</h3>
            <div className="mt-0.5 text-[11px] text-fg-subtle">专注账本</div>
          </div>
          <span className="ledger-count">0</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="timeline-empty-mark">
            <span />
            <span />
            <span />
          </div>
          <h4 className="mt-4 text-[13px] font-medium text-fg-muted">等待第一次专注</h4>
          <p className="mt-1.5 max-w-[220px] text-[11.5px] leading-[1.7] text-fg-subtle">
            专注和暂停会按发生顺序记录在这里。
          </p>
          <div className="mt-4 flex items-center gap-4 text-[10.5px] font-medium text-fg-subtle">
            <span className="inline-flex items-center gap-1.5">
              <i className="h-1.5 w-1.5 rounded-full bg-success" />
              专注
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-1.5 w-1.5 rounded-full border border-pause/70" />
              暂停
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-container h-full min-h-0 overflow-hidden">
      <div className="ledger-header flex items-center justify-between px-4">
        <div>
          <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">本次片段</h3>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            {focusCount} 次专注 · {pauseCount} 次暂停
          </p>
        </div>
        <span className="ledger-count">{items.length}</span>
      </div>

      <div
        ref={scrollRef}
        className="ledger-list relative min-h-0 flex-1 overflow-y-auto px-3 py-1.5"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div className="ledger-rail" />

        <AnimatePresence initial={false} mode="popLayout">
          {items.map((item, idx) => {
            const isFocus = item.type === 'focus';
            const duration = getDisplayDuration(item);
            const chipBorderCls = item.isActive
              ? isFocus
                ? 'segment-chip-active-focus'
                : 'segment-chip-active-pause'
              : 'segment-chip-idle';

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className={`segment-chip ledger-row relative flex w-full flex-shrink-0 cursor-default items-center py-2.5 pl-11 pr-3 ${
                  isFocus ? 'row-focus min-h-[64px]' : 'row-pause'
                } ${chipBorderCls}`}
              >
                <span
                  className={`ledger-node ${isFocus ? 'focus' : 'pause'} ${item.isActive ? 'active' : ''}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="ledger-row-title truncate text-[12.5px] font-medium text-fg">
                      {item.title}
                    </span>
                    <span className="ledger-row-duration timer-digit shrink-0 text-[14px] font-semibold text-fg">
                      {formatDuration(duration)}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10.5px] text-fg-subtle">
                    <span className="tabular-nums">{formatClock(item.startedAt)}</span>
                    {item.isOngoing ? (
                      <span className={`ledger-live ${isFocus ? 'focus' : 'pause'}`}>进行中</span>
                    ) : item.endedAt ? (
                      <span className="tabular-nums">— {formatClock(item.endedAt)}</span>
                    ) : null}
                    <span className="ml-auto text-[10px] text-fg-subtle/80">#{idx + 1}</span>
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
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <footer className="ledger-session-footer">
        <div>
          <span>本轮连续性</span>
          <strong>{focusShare}%</strong>
        </div>
        <div className="ledger-session-progress" aria-hidden="true">
          <i style={{ width: `${focusShare}%` }} />
        </div>
        <small>{pauseCount === 0 ? '保持连续专注' : `经历 ${pauseCount} 次暂停`}</small>
      </footer>
    </div>
  );
}

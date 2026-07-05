// 片段时间码头 - v0.4 Calm Studio 水平化时间线
import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from './Icon';
import { useStore } from '../store/useStore';
import { formatDuration, formatClock } from '../lib/time';
import { buildMixedTimelineItems } from '../lib/buildMixedTimeline';

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
  const { snapshot, addToast } = useStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
      scrollRef.current.scrollTo({ left: scrollRef.current.scrollWidth, behavior: 'smooth' });
    }
  }, [items.length]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMerge = async () => {
    if (selected.size < 2) {
      addToast('请至少选择两个专注片段进行合并', 'info');
      return;
    }
    try {
      await window.focuslink.timer.mergeSegments(Array.from(selected));
      setSelected(new Set());
      addToast('已合并选中片段', 'success');
    } catch (e) {
      addToast('合并失败：' + (e as Error).message, 'error');
    }
  };

  const getDisplayDuration = (item: (typeof items)[number]): number => {
    if (item.type === 'focus' && item.isOngoing && lastTick > 0) {
      return item.durationMs + Math.max(0, now - lastTick);
    }
    return item.durationMs;
  };

  if (items.length === 0) {
    return (
      <div className="motion-fade-in flex items-center justify-center gap-2 rounded-lg border border-dashed border-border/50 bg-bg-card/30 px-4 py-3 text-[12px] text-fg-subtle">
        <Icon.Clock size="sm" tone="subtle" />
        暂无片段 · 开始专注后这里会展示片段时间线
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-bg-card/60" style={{ boxShadow: 'var(--shadow-sm)' }}>
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-success/10 text-success">
            <Icon.Clock size="xs" tone="success" />
          </span>
          <span>片段时间线</span>
          <span className="text-[10.5px] font-normal text-fg-subtle">
            {focusCount} 专注 · {pauseCount} 暂停
          </span>
        </h3>
        <div className="flex items-center gap-1.5">
          {selected.size >= 2 && (
            <button className="btn-ghost !h-6 !px-2 !py-0 text-[11px]" onClick={handleMerge}>
              <Icon.Merge size="xs" />
              合并 {selected.size} 个
            </button>
          )}
        </div>
      </div>

      {/* 水平时间线 */}
      <div
        ref={scrollRef}
        className="scroll-snap-x relative flex items-stretch gap-1.5 overflow-x-auto px-3 py-2.5"
        style={{ scrollbarWidth: 'thin' }}
      >
        {/* 水平连接线 */}
        <div className="pointer-events-none absolute left-3 right-3 top-[22px] h-px bg-border/40" />

        <AnimatePresence initial={false}>
          {items.map((item, idx) => {
            const isFocus = item.type === 'focus';
            const duration = getDisplayDuration(item);
            const isSelected = isFocus && selected.has(item.id);

            const chipBorderCls = isSelected
              ? 'border-success/50 bg-success/8'
              : item.isActive
                ? isFocus
                  ? 'border-success/30 bg-success/5'
                  : 'border-warning/30 bg-warning/6'
                : isFocus
                  ? 'border-border/45 bg-bg-card/60 hover:border-border/70 hover:bg-bg-subtle/40'
                  : 'border-warning/15 bg-warning/3 hover:bg-warning/6';

            const accentBarCls = isFocus
              ? item.isActive ? 'bg-success' : 'bg-success/40'
              : item.isActive ? 'bg-warning' : 'bg-warning/35';

            const titleColorCls = isFocus ? 'text-fg' : 'text-warning';
            const dotColorCls = isFocus ? 'bg-success' : 'bg-warning';

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.92, x: 8 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.92, x: -8 }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                className={`motion-press scroll-snap-item relative flex w-[136px] flex-shrink-0 cursor-pointer flex-col rounded-md border p-2 ${chipBorderCls}`}
                onClick={() => {
                  if (isFocus) toggleSelect(item.id);
                }}
              >
                {/* 顶部色条 */}
                <span className={`absolute left-2 right-2 top-0 h-[2px] rounded-full ${accentBarCls}`} />

                {/* 节点 + 序号 */}
                <div className="relative z-10 mb-1 flex items-center justify-between">
                  <span
                    className={`flex h-3 w-3 items-center justify-center rounded-full border-2 border-bg-card ${dotColorCls} ${item.isActive ? 'ring-2 ring-offset-1 ring-offset-bg-card' : ''}`}
                    style={item.isActive ? { boxShadow: `0 0 0 3px rgb(var(--app-${isFocus ? 'success' : 'warning'}) / 0.15)` } : undefined}
                  >
                    {item.isActive && <span className="h-1 w-1 rounded-full bg-white" />}
                  </span>
                  <span className="text-[9px] font-semibold text-fg-subtle">#{idx + 1}</span>
                </div>

                {/* 时长 */}
                <span
                  className={`timer-digit motion-digit text-[12.5px] font-bold ${
                    isFocus ? 'text-fg' : 'text-warning'
                  }`}
                >
                  {formatDuration(duration)}
                </span>

                {/* 标题 */}
                <span className={`mt-0.5 truncate text-[10.5px] font-medium ${titleColorCls}`}>
                  {item.title}
                </span>

                {/* 元信息 */}
                <div className="mt-1 flex items-center gap-1 text-[8.5px] text-fg-subtle">
                  <span>{formatClock(item.startedAt)}</span>
                  {item.isOngoing ? (
                    <span className="inline-flex items-center gap-0.5 font-medium text-fg-muted">
                      · 进行中
                    </span>
                  ) : item.endedAt ? (
                    <span>→{formatClock(item.endedAt)}</span>
                  ) : null}
                </div>

                {/* 滴答关联标记 */}
                {isFocus && item.taskSource === 'ticktick' && (
                  <span className="mt-1 inline-flex w-fit items-center gap-0.5 rounded bg-accent/10 px-1 py-px text-[8.5px] text-accent">
                    <Icon.Link size="xs" tone="accent" /> 滴答
                  </span>
                )}

                {isSelected && (
                  <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-white">
                    <Icon.Check size="xs" />
                  </span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

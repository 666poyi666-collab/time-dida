// 片段时间码头 - v0.3 水平化时间线，贴底展示
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

  // 自动滚动到最右（最新条目）
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
      <div className="motion-fade-in flex items-center justify-center gap-2.5 rounded-2xl border border-dashed border-border/60 bg-bg-card/40 px-4 py-3.5 text-xs text-fg-subtle">
        <Icon.Clock size="sm" tone="subtle" />
        暂无片段 · 开始专注后这里会展示片段时间码头
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-[13px] font-bold">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-success/10 text-success">
            <Icon.Clock size="xs" tone="success" />
          </span>
          <span className="font-display">片段时间码头</span>
          <span className="text-[11px] font-normal text-fg-subtle">
            {focusCount} 专注 · {pauseCount} 暂停
          </span>
        </h3>
        <div className="flex items-center gap-2">
          {selected.size >= 2 && (
            <button className="btn-ghost motion-press text-[11px]" onClick={handleMerge}>
              <Icon.Merge size="xs" />
              合并 {selected.size} 个
            </button>
          )}
          <span className="text-[10px] text-fg-subtle">点击片段可选中合并</span>
        </div>
      </div>

      {/* 水平时间线 */}
      <div
        ref={scrollRef}
        className="scroll-snap-x relative flex items-stretch gap-2 overflow-x-auto px-4 py-3"
        style={{ scrollbarWidth: 'thin' }}
      >
        {/* 水平连接线 */}
        <div className="pointer-events-none absolute left-4 right-4 top-[26px] h-px bg-border/50" />

        <AnimatePresence initial={false}>
          {items.map((item, idx) => {
            const isFocus = item.type === 'focus';
            const duration = getDisplayDuration(item);
            const isSelected = isFocus && selected.has(item.id);

            const nodeCls = isFocus
              ? item.isActive
                ? 'border-success bg-success shadow-[0_0_0_3px_rgb(var(--app-success)/0.2)]'
                : 'border-success/45 bg-bg-card'
              : item.isActive
                ? 'border-warning bg-warning shadow-[0_0_0_3px_rgb(var(--app-warning)/0.2)]'
                : 'border-warning/45 bg-bg-card';

            const chipBorderCls = isSelected
              ? 'border-success bg-success/8 shadow-soft'
              : item.isActive
                ? isFocus
                  ? 'border-success/35 bg-success/6'
                  : 'border-warning/40 bg-warning/8'
                : isFocus
                  ? 'border-border/50 bg-bg-card/70 hover:border-border-strong/60'
                  : 'border-warning/20 bg-warning/4 hover:bg-warning/8';

            const accentBarCls = isFocus
              ? item.isActive
                ? 'bg-success'
                : 'bg-success/40'
              : item.isActive
                ? 'bg-warning'
                : 'bg-warning/40';

            const titleColorCls = isFocus ? 'text-fg' : 'text-warning';

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.9, x: 12 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: -12 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className={`motion-base motion-hover-expand scroll-snap-item perf-contain relative flex w-[150px] flex-shrink-0 cursor-pointer flex-col rounded-xl border p-2.5 ${chipBorderCls}`}
                onClick={() => {
                  if (isFocus) toggleSelect(item.id);
                }}
              >
                {/* 顶部色条 */}
                <span className={`absolute left-2.5 right-2.5 top-0 h-0.5 rounded-full ${accentBarCls}`} />

                {/* 节点 + 序号 */}
                <div className="relative z-10 mb-1.5 flex items-center justify-between">
                  <span
                    className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 bg-bg-card ${nodeCls}`}
                  >
                    {item.isActive && <span className="h-1 w-1 rounded-full bg-white" />}
                  </span>
                  <span className="text-[9px] font-bold text-fg-subtle">#{idx + 1}</span>
                </div>

                {/* 时长 */}
                <span
                  className={`timer-digit motion-digit text-[13px] font-bold ${
                    isFocus ? 'text-fg' : 'text-warning'
                  }`}
                >
                  {formatDuration(duration)}
                </span>

                {/* 标题 */}
                <span className={`mt-0.5 truncate text-[11px] font-medium ${titleColorCls}`}>
                  {item.title}
                </span>

                {/* 元信息 */}
                <div className="mt-1.5 flex items-center gap-1 text-[9px] text-fg-subtle">
                  <span>{formatClock(item.startedAt)}</span>
                  {item.isOngoing ? (
                    <span className="inline-flex items-center gap-0.5 font-medium text-fg-muted">
                      ·进行中
                      {isFocus ? (
                        <Icon.Play size="xs" tone="success" />
                      ) : (
                        <Icon.Coffee size="xs" tone="warning" />
                      )}
                    </span>
                  ) : item.endedAt ? (
                    <span>→{formatClock(item.endedAt)}</span>
                  ) : null}
                </div>

                {/* 滴答关联标记 */}
                {isFocus && item.taskSource === 'ticktick' && (
                  <span className="mt-1 inline-flex w-fit items-center gap-0.5 rounded-md bg-accent/10 px-1.5 py-0.5 text-[9px] text-accent">
                    <Icon.Link size="xs" tone="accent" /> 滴答
                  </span>
                )}

                {isSelected && (
                  <span className="absolute right-1.5 top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-white">
                    <Icon.ChevronRight size="xs" />
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

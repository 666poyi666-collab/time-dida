// Segment 时间线 - 用真实 pauseEvents 构建混合时间线，暂停片段用橙色
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link2, Merge, Clock, Coffee, Play } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatDuration, formatClock } from '../lib/time';
import { buildMixedTimelineItems } from '../lib/buildMixedTimeline';

// 仅对"进行中"的条目做本地每秒 tick，让持续时间实时增长
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

  const segments = snapshot?.segments ?? [];
  const pauseEvents = snapshot?.pauseEvents ?? [];
  const state = snapshot?.state ?? 'idle';
  const currentSegmentId = snapshot?.currentSegmentId ?? null;
  const lastTick = snapshot?.lastTick ?? 0;

  const hasOngoing = state === 'running' || state === 'paused';
  const now = useNowTick(hasOngoing);

  // 用真实 pauseEvents 构建混合时间线，不再靠间隙推导
  const items = buildMixedTimelineItems({
    segments,
    pauseEvents,
    currentSegmentId,
    state,
    now,
  });

  // 统计
  const focusCount = items.filter((i) => i.type === 'focus').length;
  const pauseCount = items.filter((i) => i.type === 'pause').length;

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

  // 渲染时对当前 running segment 的时长补上 now-lastTick 增量
  const getDisplayDuration = (item: (typeof items)[number]): number => {
    if (item.type === 'focus' && item.isOngoing && lastTick > 0) {
      return item.durationMs + Math.max(0, now - lastTick);
    }
    return item.durationMs;
  };

  if (items.length === 0) {
    return (
      <div className="motion-fade-in rounded-xl border border-dashed border-border bg-bg-card/55 p-4 text-center text-xs text-fg-subtle">
        暂无片段。按快捷键开始专注后会创建第一个片段。
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Clock size={14} />
          </span>
          片段时间线
          <span className="text-xs font-normal text-fg-subtle">
            ({focusCount} 专注 · {pauseCount} 暂停)
          </span>
        </h3>
        {selected.size >= 2 && (
          <button className="btn-ghost motion-press text-xs" onClick={handleMerge}>
            <Merge size={13} />
            合并 {selected.size} 个
          </button>
        )}
      </div>

      <div className="relative space-y-2">
        {/* 时间线竖线 */}
        <div className="absolute left-[17px] top-2 bottom-2 w-px bg-border" />

        <AnimatePresence initial={false}>
          {items.map((item) => {
            const isFocus = item.type === 'focus';
            const duration = getDisplayDuration(item);
            const isSelected = isFocus && selected.has(item.id);

            // 颜色：专注绿色（accent），暂停橙色（warning）
            const dotBorderCls = isFocus
              ? item.isActive
                ? 'border-accent bg-accent'
                : item.endedAt
                  ? 'border-accent/35 bg-bg-card'
                  : 'border-accent/45 bg-bg-card'
              : item.isActive
                ? 'border-warning bg-warning'
                : 'border-warning/40 bg-bg-card';
            const dotInnerCls = isFocus
              ? item.isActive
                ? 'bg-white'
                : 'bg-accent/55'
              : item.isActive
                ? 'bg-white'
                : 'bg-warning/55';

            const rowBorderCls = isSelected
              ? 'border-accent bg-accent/5'
              : item.isActive
                ? isFocus
                  ? 'border-accent/35 bg-accent/5 shadow-soft'
                  : 'border-warning/40 bg-warning/10 shadow-soft'
                : isFocus
                  ? 'border-border bg-bg-card/85 hover:bg-bg-subtle/55'
                  : 'border-warning/20 bg-warning/5 hover:bg-warning/10';

            const chipCls = isFocus
              ? 'status-chip border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] text-accent'
              : 'status-chip border-warning/25 bg-warning/10 px-2 py-0.5 text-[10px] text-warning';

            const titleColorCls = isFocus ? 'text-fg' : 'text-warning';

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className={`motion-base relative flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${rowBorderCls}`}
                onClick={() => {
                  // 仅专注片段可选（用于合并）；暂停片段为展示，不可选
                  if (isFocus) toggleSelect(item.id);
                }}
              >
                {/* 节点 */}
                <div
                  className={`mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${dotBorderCls} ${
                    item.isActive ? 'ring-2 ring-offset-1 ring-offset-bg-card' : ''
                  } ${isFocus ? 'ring-accent/30' : 'ring-warning/30'}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${dotInnerCls}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm font-semibold ${titleColorCls}`}>
                      {item.title}
                    </span>
                    <span
                      className={`timer-digit motion-digit flex-shrink-0 text-xs ${
                        isFocus ? 'text-fg-muted' : 'text-warning/80'
                      }`}
                    >
                      {formatDuration(duration)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
                    <span className={chipCls}>{isFocus ? '专注' : '暂停'}</span>
                    <span>{formatClock(item.startedAt)}</span>
                    <span>→</span>
                    {item.isOngoing ? (
                      <span className="inline-flex items-center gap-0.5 font-medium text-fg-muted">
                        进行中
                        {isFocus ? (
                          <Play size={9} className="text-accent" />
                        ) : (
                          <Coffee size={9} className="text-warning" />
                        )}
                      </span>
                    ) : item.endedAt ? (
                      <span>{formatClock(item.endedAt)}</span>
                    ) : (
                      <span>—</span>
                    )}
                    {/* 专注片段可显示关联任务 */}
                    {isFocus && item.taskSource === 'ticktick' && (
                      <span className="ml-auto inline-flex items-center gap-0.5 rounded-md bg-accent/10 px-1.5 py-0.5 text-accent">
                        <Link2 size={10} /> 滴答
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

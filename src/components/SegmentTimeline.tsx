// Segment 时间线 - 混合展示专注片段与暂停片段，按真实使用顺序排列
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link2, Merge, Clock, Coffee, Play } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatDuration, formatClock } from '../lib/time';
import type { SegmentSummary } from '@shared/types';

// ─── 时间线条目类型 ───────────────────────────────────────────

type TimelineEntry =
  | {
      kind: 'focus';
      id: string;
      index: number;
      seg: SegmentSummary;
      isCurrent: boolean;
      isOngoing: boolean; // 进行中（running）
    }
  | {
      kind: 'pause';
      id: string;
      index: number;
      startedAt: number;
      endedAt: number | null; // null 表示当前进行中的暂停
      isCurrent: boolean;
      isOngoing: boolean;
    };

// ─── 当前条目实时时长 hook ────────────────────────────────────

/** 仅对"进行中"的条目做本地每秒 tick，让持续时间实时增长。 */
function useNowTick(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

// ─── 主组件 ───────────────────────────────────────────────────

export function SegmentTimeline() {
  const { snapshot, addToast } = useStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const segments = snapshot?.segments ?? [];
  const state = snapshot?.state ?? 'idle';
  const currentSegmentId = snapshot?.currentSegmentId ?? null;
  const currentPauseStartedAt =
    state === 'paused' ? (snapshot?.currentPauseStartedAt ?? null) : null;
  const lastTick = snapshot?.lastTick ?? 0;

  // 是否有进行中的条目（用于开启本地 tick）
  const hasOngoing = state === 'running' || state === 'paused';
  const now = useNowTick(hasOngoing);

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
      addToast('请至少选择两个片段进行合并', 'info');
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

  // ─── 构造混合时间线 ───────────────────────────────────────
  // 专注片段之间天然存在间隙（上一片段 endedAt → 下一片段 startedAt），
  // 该间隙即为一次暂停。当前进行中的暂停由 currentPauseStartedAt 提供。
  const entries: TimelineEntry[] = [];
  let focusIdx = 0;
  let pauseIdx = 0;
  segments.forEach((seg, i) => {
    focusIdx += 1;
    const isCurrent = seg.id === currentSegmentId;
    const isOngoing = isCurrent && state === 'running';
    entries.push({
      kind: 'focus',
      id: seg.id,
      index: focusIdx,
      seg,
      isCurrent,
      isOngoing,
    });

    // 若该片段已结束且存在下一片段，推导中间的暂停
    if (seg.endedAt && i < segments.length - 1) {
      const nextSeg = segments[i + 1];
      if (nextSeg.startedAt > seg.endedAt) {
        pauseIdx += 1;
        entries.push({
          kind: 'pause',
          id: `pause-${seg.id}`,
          index: pauseIdx,
          startedAt: seg.endedAt,
          endedAt: nextSeg.startedAt,
          isCurrent: false,
          isOngoing: false,
        });
      }
    }
  });

  // 当前进行中的暂停：作为最后一个条目
  if (state === 'paused' && currentPauseStartedAt) {
    pauseIdx += 1;
    entries.push({
      kind: 'pause',
      id: 'pause-current',
      index: pauseIdx,
      startedAt: currentPauseStartedAt,
      endedAt: null,
      isCurrent: true,
      isOngoing: true,
    });
  }

  // ─── 计算单条目持续时间 ───────────────────────────────────
  const computeDuration = (e: TimelineEntry): number => {
    if (e.kind === 'focus') {
      if (e.isOngoing && lastTick > 0) {
        return e.seg.activeElapsedMs + Math.max(0, now - lastTick);
      }
      return e.seg.activeElapsedMs;
    }
    // pause
    const end = e.endedAt ?? now;
    return Math.max(0, end - e.startedAt);
  };

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-bg-card/55 p-4 text-center text-xs text-fg-subtle">
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
            ({focusIdx} 专注 · {pauseIdx} 暂停)
          </span>
        </h3>
        {selected.size >= 2 && (
          <button className="btn-ghost text-xs" onClick={handleMerge}>
            <Merge size={13} />
            合并 {selected.size} 个
          </button>
        )}
      </div>

      <div className="relative space-y-2">
        {/* 时间线竖线 */}
        <div className="absolute left-[17px] top-2 bottom-2 w-px bg-border" />

        <AnimatePresence initial={false}>
          {entries.map((e) => {
            const isFocus = e.kind === 'focus';
            const duration = computeDuration(e);
            const isSelected = isFocus && selected.has(e.id);

            // 颜色与样式
            const dotBorderCls = isFocus
              ? e.isCurrent
                ? 'border-accent bg-accent'
                : e.seg.endedAt
                  ? 'border-accent/35 bg-bg-card'
                  : 'border-accent/45 bg-bg-card'
              : e.isCurrent
                ? 'border-warning bg-warning'
                : 'border-warning/40 bg-bg-card';
            const dotInnerCls = isFocus
              ? e.isCurrent
                ? 'bg-white'
                : 'bg-accent/55'
              : e.isCurrent
                ? 'bg-white'
                : 'bg-warning/55';

            const rowBorderCls = isSelected
              ? 'border-accent bg-accent/5'
              : e.isCurrent
                ? isFocus
                  ? 'border-accent/35 bg-accent/5 shadow-soft'
                  : 'border-warning/40 bg-warning/10 shadow-soft'
                : isFocus
                  ? 'border-border bg-bg-card/85 hover:bg-bg-subtle/55'
                  : 'border-warning/20 bg-warning/5 hover:bg-warning/10';

            const chipCls = isFocus
              ? 'status-chip border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] text-accent'
              : 'status-chip border-warning/25 bg-warning/10 px-2 py-0.5 text-[10px] text-warning';

            const title = isFocus
              ? (e.seg.title ?? e.seg.taskTitle ?? `专注片段 ${e.index}`)
              : `暂停片段 ${e.index}`;

            const startedAt = isFocus ? e.seg.startedAt : e.startedAt;
            const endedAt = isFocus ? e.seg.endedAt : e.endedAt;
            const isOngoing = e.isOngoing;

            return (
              <motion.div
                key={e.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.25 }}
                className={`relative flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${rowBorderCls}`}
                onClick={() => {
                  // 仅专注片段可选（用于合并）；暂停片段为推导展示，不可选
                  if (isFocus) toggleSelect(e.id);
                }}
              >
                {/* 节点 */}
                <div
                  className={`mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${dotBorderCls} ${
                    e.isCurrent ? 'ring-2 ring-offset-1 ring-offset-bg-card' : ''
                  } ${isFocus ? 'ring-accent/30' : 'ring-warning/30'}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${dotInnerCls}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`truncate text-sm font-semibold ${
                        isFocus ? 'text-fg' : 'text-warning'
                      }`}
                    >
                      {title}
                    </span>
                    <span
                      className={`timer-digit flex-shrink-0 text-xs tabular-nums ${
                        isFocus ? 'text-fg-muted' : 'text-warning/80'
                      }`}
                    >
                      {formatDuration(duration)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
                    <span className={chipCls}>{isFocus ? '专注' : '暂停'}</span>
                    <span>{formatClock(startedAt)}</span>
                    <span>→</span>
                    {isOngoing ? (
                      <span className="inline-flex items-center gap-0.5 font-medium text-fg-muted">
                        进行中
                        {isFocus ? (
                          <Play size={9} className="text-accent" />
                        ) : (
                          <Coffee size={9} className="text-warning" />
                        )}
                      </span>
                    ) : endedAt ? (
                      <span>{formatClock(endedAt)}</span>
                    ) : (
                      <span>—</span>
                    )}
                    {/* 专注片段可显示关联任务 */}
                    {isFocus && e.seg.taskSource === 'ticktick' && (
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

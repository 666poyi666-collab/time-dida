// Segment 时间线 - 展示当前 session 的所有片段
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link2, Merge, Clock } from 'lucide-react';
import { useStore } from '../store/useStore';
import { formatDuration, formatClock } from '../lib/time';

export function SegmentTimeline() {
  const { snapshot, addToast } = useStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const segments = snapshot?.segments ?? [];

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

  if (segments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-bg-base/35 p-4 text-center text-xs text-fg-subtle">
        暂无片段。按快捷键开始专注后会创建第一个片段。
      </div>
    );
  }

  return (
    <div className="card p-3.5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Clock size={14} className="text-accent" />
          片段时间线
          <span className="text-xs font-normal text-fg-subtle">({segments.length})</span>
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
        <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

        <AnimatePresence initial={false}>
          {segments.map((seg, i) => {
            const isCurrent = seg.id === snapshot?.currentSegmentId;
            const isSelected = selected.has(seg.id);
            return (
              <motion.div
                key={seg.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.25 }}
                className={`relative flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  isSelected
                    ? 'border-accent bg-accent/5'
                    : isCurrent
                    ? 'border-accent/40 bg-bg-card'
                    : 'border-border bg-bg-card hover:bg-bg-subtle/50'
                }`}
                onClick={() => toggleSelect(seg.id)}
              >
                {/* 节点 */}
                <div
                  className={`mt-1 h-3 w-3 flex-shrink-0 rounded-full border-2 ${
                    isCurrent
                      ? 'border-accent bg-accent'
                      : seg.endedAt
                      ? 'border-border bg-bg-base'
                      : 'border-fg-subtle bg-bg-base'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-fg">
                      {seg.title ?? seg.taskTitle ?? `片段 ${i + 1}`}
                    </span>
                    <span className="timer-digit flex-shrink-0 text-xs text-fg-muted">
                      {formatDuration(seg.activeElapsedMs)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-fg-subtle">
                    <span>{formatClock(seg.startedAt)}</span>
                    {seg.endedAt && <span>→ {formatClock(seg.endedAt)}</span>}
                    {seg.taskSource === 'ticktick' && (
                      <span className="ml-auto inline-flex items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-accent">
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

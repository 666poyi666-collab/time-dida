// 历史可视化组件 - v0.4.7
// 三种可视化：每日专注柱状图 · GitHub风格热力图 · 任务分布环形图
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Icon } from './Icon';
import { formatDuration } from '../lib/time';
import type { FocusSession, FocusSegment } from '@shared/types';
import type { PeriodSummary, TimeRange } from '../lib/historyStats';
import { startOfDay, endOfDay, formatShortDate } from '../lib/historyStats';

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── 1. 每日专注柱状图 ───
export function DailyBarChart({
  dailyStats,
  range,
}: {
  dailyStats: PeriodSummary[];
  range: TimeRange;
}) {
  const maxActive = useMemo(() => {
    const max = Math.max(...dailyStats.map((d) => d.active), 0);
    return max > 0 ? max : 1;
  }, [dailyStats]);

  const sortedByDate = useMemo(() => {
    return [...dailyStats].sort((a, b) => a.label.localeCompare(b.label));
  }, [dailyStats]);

  const totalActive = useMemo(
    () => dailyStats.reduce((sum, d) => sum + d.active, 0),
    [dailyStats],
  );

  const activeDays = useMemo(
    () => dailyStats.filter((d) => d.active > 0).length,
    [dailyStats],
  );

  return (
    <div className="viz-card rounded-lg border border-border/60 bg-bg-card/50 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent/10 text-accent">
            <Icon.BarChart size="xs" tone="accent" />
          </span>
          <span className="text-[12px] font-semibold text-fg">每日专注</span>
          <span className="text-[10.5px] text-fg-subtle">
            {activeDays}天 · {formatDuration(totalActive)}
          </span>
        </div>
      </div>
      {sortedByDate.length === 0 ? (
        <p className="py-6 text-center text-[11px] text-fg-subtle">暂无数据</p>
      ) : (
        <div className="flex items-end gap-[3px]" style={{ height: 100 }}>
          {sortedByDate.map((item) => {
            const ratio = item.active / maxActive;
            const height = item.active > 0 ? Math.max(ratio * 100, 4) : 2;
            const isToday = item.label === formatShortDate(Date.now()).replace(/\//g, '-');
            return (
              <div
                key={item.label}
                className="group relative flex flex-1 flex-col items-center justify-end"
                style={{ minWidth: 8, maxWidth: 40 }}
              >
                <motion.div
                  className="w-full rounded-t-[3px]"
                  style={{
                    height: `${height}%`,
                    background:
                      item.active > 0
                        ? `linear-gradient(180deg, rgb(var(--accent) / ${0.6 + ratio * 0.4}), rgb(var(--accent) / ${0.3 + ratio * 0.3}))`
                        : 'rgb(var(--app-border) / 0.2)',
                  }}
                  initial={{ height: 0 }}
                  animate={{ height: `${height}%` }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                />
                {/* Tooltip */}
                <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border/60 bg-bg-elevated/95 px-2 py-1 text-[10px] shadow-md group-hover:block">
                  <div className="font-medium text-fg">{item.label}</div>
                  <div className="text-accent">{formatDuration(item.active)}</div>
                  {item.count > 0 && <div className="text-fg-subtle">{item.count} 次</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 2. GitHub 风格热力图 ───
export function FocusHeatmap({
  sessions,
  range,
}: {
  sessions: FocusSession[];
  range: TimeRange;
}) {
  const heatmapData = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      const dayLabel = new Date(s.startedAt).toISOString().slice(0, 10);
      map.set(dayLabel, (map.get(dayLabel) ?? 0) + s.activeElapsedMs);
    }
    return map;
  }, [sessions]);

  const maxMs = useMemo(() => Math.max(...heatmapData.values(), 1), [heatmapData]);

  // 生成范围内的所有日期
  const days = useMemo(() => {
    const result: { date: string; ms: number; label: string }[] = [];
    const start = startOfDay(range.start);
    const end = endOfDay(range.end);
    for (let t = start; t <= end; t += DAY_MS) {
      const d = new Date(t);
      const dateStr = d.toISOString().slice(0, 10);
      result.push({
        date: dateStr,
        ms: heatmapData.get(dateStr) ?? 0,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
      });
    }
    return result;
  }, [range.start, range.end, heatmapData]);

  const getLevel = (ms: number): number => {
    if (ms === 0) return 0;
    const ratio = ms / maxMs;
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  };

  const levelColors = [
    'rgb(var(--app-border) / 0.15)',
    'rgb(var(--accent) / 0.25)',
    'rgb(var(--accent) / 0.45)',
    'rgb(var(--accent) / 0.65)',
    'rgb(var(--accent) / 0.9)',
  ];

  const totalSessions = sessions.length;
  const totalMs = sessions.reduce((sum, s) => sum + s.activeElapsedMs, 0);

  return (
    <div className="viz-card rounded-lg border border-border/60 bg-bg-card/50 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-success/10 text-success">
            <Icon.Calendar size="xs" tone="success" />
          </span>
          <span className="text-[12px] font-semibold text-fg">专注热力图</span>
          <span className="text-[10.5px] text-fg-subtle">
            {totalSessions} 次 · {formatDuration(totalMs)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-fg-subtle">少</span>
          {levelColors.map((c, i) => (
            <span key={i} className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
          ))}
          <span className="text-[9px] text-fg-subtle">多</span>
        </div>
      </div>
      {days.length === 0 ? (
        <p className="py-6 text-center text-[11px] text-fg-subtle">暂无数据</p>
      ) : (
        <div className="flex flex-wrap gap-[3px]">
          {days.map((day) => {
            const level = getLevel(day.ms);
            return (
              <div
                key={day.date}
                className="group relative h-5 w-5 rounded-sm transition-transform hover:scale-125"
                style={{ background: levelColors[level] }}
              >
                <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border/60 bg-bg-elevated/95 px-2 py-1 text-[10px] shadow-md group-hover:block">
                  <div className="font-medium text-fg">{day.label}</div>
                  <div className="text-accent">{formatDuration(day.ms)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 3. 任务分布环形图 ───
export function TaskDistribution({
  sessionSegments,
}: {
  sessionSegments: Record<string, FocusSegment[]>;
}) {
  const taskStats = useMemo(() => {
    const map = new Map<string, { title: string; ms: number; count: number }>();
    for (const segments of Object.values(sessionSegments)) {
      for (const seg of segments) {
        if (seg.taskId && seg.title) {
          const existing = map.get(seg.taskId);
          if (existing) {
            existing.ms += seg.activeElapsedMs;
            existing.count += 1;
          } else {
            map.set(seg.taskId, {
              title: seg.title,
              ms: seg.activeElapsedMs,
              count: 1,
            });
          }
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.ms - a.ms).slice(0, 6);
  }, [sessionSegments]);

  const totalMs = useMemo(() => taskStats.reduce((s, t) => s + t.ms, 0), [taskStats]);

  // 环形图参数
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const colors = [
    'rgb(var(--accent))',
    'rgb(var(--app-success))',
    'rgb(var(--app-warning))',
    'rgb(var(--app-info))',
    'rgb(var(--app-danger))',
    'rgb(168 85 247)',
  ];

  if (taskStats.length === 0) {
    return (
      <div className="viz-card rounded-lg border border-border/60 bg-bg-card/50 p-3">
        <div className="mb-3 flex items-center gap-1.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-info/10 text-info">
            <Icon.PieChart size="xs" />
          </span>
          <span className="text-[12px] font-semibold text-fg">任务分布</span>
        </div>
        <p className="py-6 text-center text-[11px] text-fg-subtle">
          关联任务后展示专注时间分布
        </p>
      </div>
    );
  }

  let cumulativeOffset = 0;

  return (
    <div className="viz-card rounded-lg border border-border/60 bg-bg-card/50 p-3">
      <div className="mb-3 flex items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-info/10 text-info">
          <Icon.PieChart size="xs" />
        </span>
        <span className="text-[12px] font-semibold text-fg">任务分布</span>
        <span className="text-[10.5px] text-fg-subtle">{taskStats.length} 个任务</span>
      </div>
      <div className="flex items-center gap-4">
        {/* SVG 环形图 */}
        <div className="relative flex-shrink-0">
          <svg width={120} height={120} viewBox="0 0 120 120">
            <circle
              cx={60}
              cy={60}
              r={radius}
              fill="none"
              stroke="rgb(var(--app-border) / 0.2)"
              strokeWidth={10}
            />
            {taskStats.map((task, i) => {
              const ratio = task.ms / totalMs;
              const dashLength = ratio * circumference;
              const dash = `${dashLength} ${circumference - dashLength}`;
              const offset = -cumulativeOffset;
              cumulativeOffset += dashLength;
              return (
                <motion.circle
                  key={i}
                  cx={60}
                  cy={60}
                  r={radius}
                  fill="none"
                  stroke={colors[i % colors.length]}
                  strokeWidth={10}
                  strokeDasharray={dash}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  transform="rotate(-90 60 60)"
                  initial={{ strokeDasharray: `0 ${circumference}` }}
                  animate={{ strokeDasharray: dash }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: i * 0.08 }}
                />
              );
            })}
          </svg>
          {/* 中心文字 */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="timer-digit text-[14px] font-bold text-fg">
              {formatDuration(totalMs)}
            </span>
            <span className="text-[9px] font-medium text-fg-subtle">总计</span>
          </div>
        </div>
        {/* 图例 */}
        <div className="min-w-0 flex-1 space-y-1">
          {taskStats.map((task, i) => {
            const pct = ((task.ms / totalMs) * 100).toFixed(0);
            return (
              <div key={i} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ background: colors[i % colors.length] }}
                />
                <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-fg-muted">
                  {task.title}
                </span>
                <span className="flex-shrink-0 text-[10px] font-bold text-fg-subtle tabular-nums">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── 4. 趋势对比卡片 ───
export function TrendCard({
  current,
  previous,
  label,
  format = 'duration',
}: {
  current: number;
  previous: number;
  label: string;
  format?: 'duration' | 'number';
}) {
  const diff = current - previous;
  const pctChange = previous > 0 ? ((diff / previous) * 100).toFixed(0) : null;
  const isUp = diff > 0;
  const isFlat = diff === 0;
  const formatVal = (v: number) =>
    format === 'duration' ? formatDuration(v) : String(v);

  return (
    <div className="viz-trend-card rounded-lg border border-border/60 bg-bg-card/50 px-2.5 py-2">
      <div className="timer-digit text-[13px] font-semibold text-fg">
        {formatVal(current)}
      </div>
      <div className="mt-0.5 flex items-center justify-between">
        <span className="text-[10.5px] font-medium text-fg-subtle">{label}</span>
        {pctChange !== null && !isFlat && (
          <span
            className={`text-[9.5px] font-bold tabular-nums ${
              isUp ? 'text-success' : 'text-danger'
            }`}
          >
            {isUp ? '↑' : '↓'} {Math.abs(Number(pctChange))}%
          </span>
        )}
      </div>
    </div>
  );
}

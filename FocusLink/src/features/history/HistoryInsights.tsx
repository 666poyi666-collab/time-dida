// 统计工作台 v3：结论 → 指标 → 时间节律 → 任务去向/暂停损耗。
// 会话明细只保留下方唯一账本，不在 Dashboard 内重复一份表格。
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useInView, useReducedMotion } from 'framer-motion';
import type { SessionAnalyticsResult, SessionAnalyticsTimelineItem } from '@shared/ipc/api';
import { buildDashboardTaskAllocation } from '@shared/dashboardPresentation';
import { Icon } from '../../ui/Icon';
import { formatClock, formatMinutes } from '../../lib/time';
import {
  isSameLocalDay,
  type RangePreset,
  type SessionSummary,
  type TimeRange,
} from './historyStats';

interface HistoryInsightsProps {
  summary: SessionSummary;
  range: TimeRange;
  analytics: SessionAnalyticsResult | null;
  slideDirection: -1 | 0 | 1;
  onSelectRange: (preset: RangePreset) => void;
  onOpenSession?: (sessionId: string) => void;
}

const DAY_MS = 24 * 60 * 60_000;
const MINUTE = 60_000;

function duration(ms: number): string {
  return formatMinutes(Math.max(0, ms));
}

function axisDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${hours >= 10 || Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h`;
}

function percentage(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** KPI 数字 count-up：首次进入视口时从 0 平滑递增到目标值（≤600ms，expo-out）。
    只播放一次；此后目标值变化直接显示终值，避免反复跳动。
    prefers-reduced-motion 时始终直接显示终值。 */
function CountUp({ value, format }: { value: number; format: (current: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduceMotion = useReducedMotion();
  const hasPlayedRef = useRef(false);
  const [display, setDisplay] = useState(() => (typeof window === 'undefined' ? value : 0));
  useEffect(() => {
    if (!inView || reduceMotion || hasPlayedRef.current) {
      setDisplay(value);
      return;
    }
    hasPlayedRef.current = true;
    const target = value;
    const durationMs = 560;
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setDisplay(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduceMotion, value]);
  return <span ref={ref}>{format(display)}</span>;
}

export function HistoryInsights({
  summary,
  range,
  analytics,
  slideDirection,
  onSelectRange,
  onOpenSession,
}: HistoryInsightsProps) {
  const isEmpty = summary.count === 0;
  const singleDay = isSameLocalDay(range.start, range.end - 1);
  const isToday = singleDay && isSameLocalDay(range.start, Date.now());
  const tracked = Math.max(0, summary.active + summary.pause);
  const focusRate = percentage(summary.active, tracked);
  const average = summary.count > 0 ? summary.active / summary.count : 0;
  const longest = Math.max(0, ...(analytics?.sessionActive.map((item) => item.activeMs) ?? []));
  const activeDays = analytics?.stability.activeDays ?? 0;

  if (isEmpty) {
    return (
      <section className="history-insights" aria-label="专注统计 Dashboard">
        <div className="history-insights-empty state-block" role="status">
          <div className="state-block-icon">
            <Icon.Calendar size="lg" />
          </div>
          <p className="state-block-title">这段时间还没有专注记录</p>
          <p className="state-block-desc">开始一次专注，或查看更长的时间范围。</p>
          <div className="state-block-actions">
            {(['7d', '15d', '30d'] as const).map((preset) => (
              <button
                type="button"
                className="btn-outline motion-press"
                key={preset}
                onClick={() => onSelectRange(preset)}
              >
                {preset === '7d' ? '近 7 天' : preset === '15d' ? '半个月' : '1 个月'}
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="history-insights stats-dashboard"
      aria-label="专注统计 Dashboard"
      style={{ '--stats-shift': `${slideDirection * 7}px` } as CSSProperties}
    >
      <header className="stats-brief">
        <div className="stats-primary-readout">
          <span>{singleDay ? (isToday ? '今日有效专注' : '当日有效专注') : '范围内有效专注'}</span>
          <strong>
            <CountUp value={summary.active} format={duration} />
          </strong>
        </div>
        <div className="stats-brief-copy">
          <h2>
            {singleDay
              ? isToday
                ? '今天的时间，花在了哪里'
                : '这一天的时间，花在了哪里'
              : '这段时间，投入是否稳定'}
          </h2>
          <p>
            {singleDay
              ? `完成 ${summary.count} 轮，平均每轮 ${duration(average)}；暂停占已记录时间 ${percentage(summary.pause, tracked)}%。`
              : `${activeDays} 个活跃日完成 ${summary.count} 轮，日均专注 ${duration(activeDays > 0 ? summary.active / activeDays : 0)}。`}
          </p>
        </div>
        <FocusGauge rate={focusRate} />
      </header>

      <div className="stats-metric-strip" aria-label="核心指标">
        <Metric label="有效专注" value={summary.active} note="排除暂停" tone="accent" />
        <Metric
          label="暂停损耗"
          value={summary.pause}
          note={`${100 - focusRate}% 已记录时间`}
          tone="pause"
        />
        <Metric
          label={singleDay ? '完成轮次' : '活跃天数'}
          value={singleDay ? summary.count : activeDays}
          format={(current) => `${Math.round(current)}`}
          note={`平均 ${duration(average)}`}
        />
        <Metric label="最长一轮" value={longest} note="单次有效专注" />
      </div>

      <div className="stats-main-grid">
        {singleDay ? (
          <DayActivityTimeline
            range={range}
            timeline={analytics?.timeline ?? []}
            onOpenSession={onOpenSession}
          />
        ) : (
          <DailyActivityChart daily={analytics?.daily ?? []} />
        )}
        <TaskAllocation analytics={analytics} totalActive={summary.active} />
      </div>

      <PauseCost summary={summary} average={average} focusRate={focusRate} />
    </section>
  );
}

function FocusGauge({ rate }: { rate: number }) {
  return (
    <div
      className="stats-focus-gauge hm-fade-in"
      style={{ '--gauge-rate': `${rate * 3.6}deg` } as CSSProperties}
      role="img"
      aria-label={`专注率 ${rate}%`}
    >
      <div>
        <strong>
          <CountUp value={rate} format={(current) => `${Math.round(current)}%`} />
        </strong>
        <span>专注率</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  format = duration,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  format?: (current: number) => string;
  note: string;
  tone?: 'neutral' | 'accent' | 'pause';
}) {
  return (
    <div className={`stats-metric tone-${tone}`}>
      <span>{label}</span>
      <strong>
        <CountUp value={value} format={format} />
      </strong>
      <small>{note}</small>
    </div>
  );
}

function DayActivityTimeline({
  range,
  timeline,
  onOpenSession,
}: {
  range: TimeRange;
  timeline: SessionAnalyticsTimelineItem[];
  onOpenSession?: (sessionId: string) => void;
}) {
  const [scope, setScope] = useState<'active' | 'day'>('active');
  const dayStart = useMemo(() => {
    const day = new Date(range.start);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  }, [range.start]);
  const activity = useMemo(() => {
    if (timeline.length === 0) return { start: dayStart, end: dayStart + DAY_MS };
    const first = Math.min(...timeline.map((item) => item.startedAt));
    const last = Math.max(
      ...timeline.map((item) => item.endedAt ?? item.startedAt + item.durationMs),
    );
    const center = (first + last) / 2;
    const span = Math.max(2 * 60 * MINUTE, last - first + 60 * MINUTE);
    const start = Math.max(dayStart, center - span / 2);
    return { start, end: Math.min(dayStart + DAY_MS, start + span) };
  }, [dayStart, timeline]);
  const windowStart = scope === 'day' ? dayStart : activity.start;
  const windowEnd = scope === 'day' ? dayStart + DAY_MS : activity.end;
  const windowMs = Math.max(1, windowEnd - windowStart);

  return (
    <article className="stats-panel stats-rhythm-panel">
      <div className="stats-panel-head">
        <div>
          <span>专注节律</span>
          <h3>{scope === 'day' ? '全天 24 小时' : '活跃时间细看'}</h3>
        </div>
        <div className="stats-scope-switch" aria-label="时间轴范围">
          <button
            type="button"
            className={scope === 'active' ? 'active' : ''}
            aria-pressed={scope === 'active'}
            onClick={() => setScope('active')}
          >
            活跃时段
          </button>
          <button
            type="button"
            className={scope === 'day' ? 'active' : ''}
            aria-pressed={scope === 'day'}
            onClick={() => setScope('day')}
          >
            全天
          </button>
        </div>
      </div>

      <div
        className="stats-day-overview hm-fade-in"
        style={{ '--hm-delay': '80ms' } as CSSProperties}
        aria-label="全天活动概览"
      >
        {timeline.map((item) => (
          <TimelineBlock
            key={`overview-${item.id}`}
            item={item}
            start={dayStart}
            span={DAY_MS}
            onOpenSession={onOpenSession}
          />
        ))}
      </div>
      <div className="stats-day-axis" aria-hidden="true">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>

      <div className="stats-time-axis" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => {
          const timestamp = windowStart + (windowMs * index) / 4;
          return <span key={index}>{formatClock(timestamp)}</span>;
        })}
      </div>
      {timeline.length > 0 ? (
        <div
          className="stats-timeline-detail hm-fade-in"
          style={{ '--hm-delay': '160ms' } as CSSProperties}
          role="group"
          aria-label="专注与暂停时间轴"
        >
          <div className="stats-lane focus">
            <span>专注</span>
            {timeline
              .filter((item) => item.kind === 'focus')
              .map((item) => (
                <TimelineBlock
                  key={item.id}
                  item={item}
                  start={windowStart}
                  span={windowMs}
                  onOpenSession={onOpenSession}
                />
              ))}
          </div>
          <div className="stats-lane pause">
            <span>暂停</span>
            {timeline
              .filter((item) => item.kind === 'pause')
              .map((item) => (
                <TimelineBlock
                  key={item.id}
                  item={item}
                  start={windowStart}
                  span={windowMs}
                  onOpenSession={onOpenSession}
                />
              ))}
          </div>
        </div>
      ) : (
        <div className="stats-timeline-empty" role="status">
          这段记录只有会话汇总，没有可定位到分钟的片段明细。
        </div>
      )}
      <p className="stats-caption">
        {timeline.length > 0
          ? '上方保留全天位置，下方自动放大有记录的时段；色块宽度仍按真实时间计算。'
          : '有效专注仍计入上方指标；从新版本开始记录的片段会显示在时间轴中。'}
      </p>
    </article>
  );
}

function TimelineBlock({
  item,
  start,
  span,
  onOpenSession,
}: {
  item: SessionAnalyticsTimelineItem;
  start: number;
  span: number;
  onOpenSession?: (sessionId: string) => void;
}) {
  const end = item.endedAt ?? item.startedAt + item.durationMs;
  const left = Math.max(0, ((item.startedAt - start) / span) * 100);
  const right = Math.min(100, ((end - start) / span) * 100);
  if (right <= 0 || left >= 100 || right <= left) return null;
  const title = `${item.kind === 'focus' ? '专注' : '暂停'} ${formatClock(item.startedAt)}–${formatClock(end)} · ${duration(item.durationMs)}${item.title ? ` · ${item.title}` : ''}`;
  return (
    <button
      type="button"
      className={`stats-time-block ${item.kind}`}
      style={{ left: `${left}%`, width: `${Math.max(0.18, right - left)}%` }}
      title={title}
      aria-label={title}
      onClick={() => onOpenSession?.(item.sessionId)}
    />
  );
}

function DailyActivityChart({ daily }: { daily: SessionAnalyticsResult['daily'] }) {
  const width = 720;
  const height = 210;
  const padX = 48;
  const padY = 24;
  const max = Math.max(1, ...daily.map((day) => day.activeMs + day.pauseMs));
  const plotHeight = height - padY * 2;
  const plotWidth = width - padX * 2;
  const slotWidth = plotWidth / Math.max(1, daily.length);
  const barWidth = Math.max(5, Math.min(24, slotWidth * 0.58));

  return (
    <article className="stats-panel stats-trend-panel">
      <div className="stats-panel-head">
        <div>
          <span>每日趋势</span>
          <h3>投入是否持续</h3>
        </div>
        <div className="stats-legend">
          <i />
          专注 <i className="pause" />
          暂停
        </div>
      </div>
      <svg
        className="stats-trend-chart hm-fade-in"
        style={{ '--hm-delay': '80ms' } as CSSProperties}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="每日专注与暂停堆叠图"
      >
        {[0, 0.5, 1].map((ratio) => {
          const y = height - padY - ratio * plotHeight;
          return (
            <g key={ratio}>
              <line x1={padX} x2={width - padX} y1={y} y2={y} />
              <text className="axis-label" x={padX - 8} y={y + 3}>
                {axisDuration(max * ratio)}
              </text>
            </g>
          );
        })}
        {daily.map((day, index) => {
          const x = padX + slotWidth * index + (slotWidth - barWidth) / 2;
          const total = day.activeMs + day.pauseMs;
          const activeShare = total > 0 ? day.activeMs / total : 0;
          const pauseShare = total > 0 ? day.pauseMs / total : 0;
          const baseline = height - padY;
          const title = `${day.date} · 专注 ${duration(day.activeMs)} · 暂停 ${duration(day.pauseMs)} · ${day.sessionCount} 轮`;
          return (
            <g
              className="stats-day-column"
              key={day.date}
              role="img"
              tabIndex={0}
              aria-label={title}
              style={{ '--bar-scale': total / max } as CSSProperties}
            >
              <title>{title}</title>
              <rect
                className="active-bar"
                x={x}
                y={baseline - activeShare * plotHeight}
                width={barWidth}
                height={activeShare * plotHeight}
              />
              <rect
                className="pause-bar"
                x={x}
                y={baseline - plotHeight}
                width={barWidth}
                height={pauseShare * plotHeight}
              />
            </g>
          );
        })}
      </svg>
      <div className="stats-trend-labels">
        {daily.map((day, index) => (
          <span
            key={day.date}
            className={
              index % Math.max(1, Math.ceil(daily.length / 7)) === 0 || index === daily.length - 1
                ? 'show'
                : ''
            }
          >
            {day.date.slice(5).replace('-', '/')}
          </span>
        ))}
      </div>
      <p className="stats-caption">
        每根柱子的总高度是当天已记录时间；强调色为有效专注，红色为暂停损耗。悬停可查看精确值。
      </p>
    </article>
  );
}

function TaskAllocation({
  analytics,
  totalActive,
}: {
  analytics: SessionAnalyticsResult | null;
  totalActive: number;
}) {
  const allocation = useMemo(
    () => buildDashboardTaskAllocation(analytics?.tasks ?? [], totalActive),
    [analytics?.tasks, totalActive],
  );

  return (
    <article className="stats-panel stats-allocation-panel">
      <div className="stats-panel-head">
        <div>
          <span>任务去向</span>
          <h3>专注投入了什么</h3>
        </div>
      </div>
      <div className="stats-allocation-summary">
        <div className="stats-allocation-total">
          <strong>{duration(totalActive)}</strong>
          <span>{allocation.linkedCount} 项已关联</span>
        </div>
        <p>前四项直接比较；未关联任务与旧记录单独标记，不混入已关联任务。</p>
      </div>
      <div
        className="stats-allocation-band hm-fade-in"
        style={{ '--hm-delay': '80ms' } as CSSProperties}
        role="img"
        aria-label="任务专注时间构成"
      >
        {allocation.items.map((item) => (
          <i
            key={item.key}
            className={`tone-${item.tone}`}
            style={
              {
                width: `${item.width}%`,
                '--allocation-alpha': item.alpha,
              } as CSSProperties
            }
            title={`${item.title} · ${duration(item.activeMs)} · ${item.share}%`}
          />
        ))}
      </div>
      <div
        className="stats-task-list hm-fade-in"
        style={{ '--hm-delay': '160ms' } as CSSProperties}
      >
        {allocation.items.map((item) => (
          <div className={`stats-task-row tone-${item.tone}`} key={item.key}>
            <i style={{ '--allocation-alpha': item.alpha } as CSSProperties} />
            <strong title={item.title}>{item.title}</strong>
            <span>{item.share}%</span>
            <b>{duration(item.activeMs)}</b>
          </div>
        ))}
        {allocation.items.length === 0 && <p className="stats-caption">还没有可归类的任务时间。</p>}
      </div>
    </article>
  );
}

function PauseCost({
  summary,
  average,
  focusRate,
}: {
  summary: SessionSummary;
  average: number;
  focusRate: number;
}) {
  const tracked = summary.active + summary.pause;
  const pauseRate = tracked > 0 ? 100 - focusRate : 0;
  return (
    <article className="stats-pause-cost">
      <div>
        <span>暂停损耗</span>
        <strong>
          <CountUp value={summary.pause} format={duration} />
        </strong>
      </div>
      <div>
        <span>每轮平均专注</span>
        <strong>
          <CountUp value={average} format={duration} />
        </strong>
      </div>
      <div>
        <span>时间利用</span>
        <strong>
          <CountUp value={focusRate} format={(current) => `${Math.round(current)}%`} />
        </strong>
      </div>
      <div
        className="stats-cost-track hm-fade-in"
        style={{ '--hm-delay': '120ms' } as CSSProperties}
        aria-label={`暂停占比 ${pauseRate}%`}
      >
        <i className="focus" style={{ width: `${focusRate}%` }} />
        <i className="pause" style={{ left: `${focusRate}%`, width: `${pauseRate}%` }} />
      </div>
    </article>
  );
}

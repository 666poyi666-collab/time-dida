// 统计工作台 v3：结论 → 指标 → 时间节律 → 任务去向/暂停损耗。
// 会话明细只保留下方唯一账本，不在 Dashboard 内重复一份表格。
import { useMemo, useState, type CSSProperties } from 'react';
import type { FocusSession } from '@shared/types';
import type { SessionAnalyticsResult, SessionAnalyticsTimelineItem } from '@shared/ipc/api';
import { Icon } from '../../ui/Icon';
import { formatClock, formatMinutes } from '../../lib/time';
import {
  isSameLocalDay,
  type RangePreset,
  type SessionSummary,
  type TimeRange,
} from './historyStats';

interface HistoryInsightsProps {
  sessions: FocusSession[];
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

function roundedPercentages(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((value) => (Math.max(0, value) / total) * 100);
  const result = raw.map(Math.floor);
  let remaining = 100 - result.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - result[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let cursor = 0; remaining > 0; cursor += 1, remaining -= 1) {
    result[order[cursor % order.length].index] += 1;
  }
  return result;
}

export function HistoryInsights({
  sessions,
  summary,
  range,
  analytics,
  slideDirection,
  onSelectRange,
  onOpenSession,
}: HistoryInsightsProps) {
  const isEmpty = summary.count === 0;
  const singleDay = isSameLocalDay(range.start, range.end - 1);
  const tracked = Math.max(0, summary.active + summary.pause);
  const focusRate = percentage(summary.active, tracked);
  const average = summary.count > 0 ? summary.active / summary.count : 0;
  const longest = sessions.reduce((best, session) => Math.max(best, session.activeElapsedMs), 0);
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
          <span>{singleDay ? '今日有效专注' : '范围内有效专注'}</span>
          <strong>{duration(summary.active)}</strong>
        </div>
        <div className="stats-brief-copy">
          <h2>{singleDay ? '今天的时间，花在了哪里' : '这段时间，投入是否稳定'}</h2>
          <p>
            {singleDay
              ? `完成 ${summary.count} 轮，平均每轮 ${duration(average)}；暂停占已记录时间 ${percentage(summary.pause, tracked)}%。`
              : `${activeDays} 个活跃日完成 ${summary.count} 轮，日均专注 ${duration(activeDays > 0 ? summary.active / activeDays : 0)}。`}
          </p>
        </div>
        <FocusGauge rate={focusRate} />
      </header>

      <div className="stats-metric-strip" aria-label="核心指标">
        <Metric label="有效专注" value={duration(summary.active)} note="排除暂停" tone="accent" />
        <Metric
          label="暂停损耗"
          value={duration(summary.pause)}
          note={`${100 - focusRate}% 已记录时间`}
          tone="pause"
        />
        <Metric
          label={singleDay ? '完成轮次' : '活跃天数'}
          value={`${singleDay ? summary.count : activeDays}`}
          note={`平均 ${duration(average)}`}
        />
        <Metric label="最长一轮" value={duration(longest)} note="单次有效专注" />
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
      className="stats-focus-gauge"
      style={{ '--gauge-rate': `${rate * 3.6}deg` } as CSSProperties}
      role="img"
      aria-label={`专注率 ${rate}%`}
    >
      <div>
        <strong>{rate}%</strong>
        <span>专注率</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'neutral' | 'accent' | 'pause';
}) {
  return (
    <div className={`stats-metric tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
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

      <div className="stats-day-overview" aria-label="全天活动概览">
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
        <div className="stats-timeline-detail" role="group" aria-label="专注与暂停时间轴">
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
        className="stats-trend-chart"
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
          const activeHeight = (day.activeMs / max) * plotHeight;
          const pauseHeight = (day.pauseMs / max) * plotHeight;
          const baseline = height - padY;
          const title = `${day.date} · 专注 ${duration(day.activeMs)} · 暂停 ${duration(day.pauseMs)} · ${day.sessionCount} 轮`;
          return (
            <g
              className="stats-day-column"
              key={day.date}
              role="img"
              tabIndex={0}
              aria-label={title}
            >
              <title>{title}</title>
              <rect
                className="active-bar"
                x={x}
                y={baseline - activeHeight}
                width={barWidth}
                height={Math.max(day.activeMs > 0 ? 1 : 0, activeHeight)}
              />
              <rect
                className="pause-bar"
                x={x}
                y={baseline - activeHeight - pauseHeight}
                width={barWidth}
                height={Math.max(day.pauseMs > 0 ? 1 : 0, pauseHeight)}
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
  const allocation = useMemo(() => {
    const source = (analytics?.tasks ?? []).slice().sort((a, b) => b.activeMs - a.activeMs);
    const linked = source.filter((task) => task.taskId !== null);
    const unlinked = source.filter((task) => task.taskId === null);
    const primary = linked.slice(0, 4).map((task, index) => ({
      key: task.key,
      title: task.title,
      activeMs: task.activeMs,
      tone: 'linked' as const,
      alpha: Math.max(0.52, 1 - index * 0.14),
    }));
    const otherLinkedMs = linked.slice(4).reduce((sum, task) => sum + task.activeMs, 0);
    const unlinkedMs = unlinked.reduce((sum, task) => sum + task.activeMs, 0);
    const accountedMs = source.reduce((sum, task) => sum + task.activeMs, 0);
    const legacyMs = Math.max(0, totalActive - accountedMs);
    const items = [
      ...primary,
      ...(otherLinkedMs > 0
        ? [
            {
              key: 'other-linked',
              title: `其他已关联任务（${Math.max(0, linked.length - 4)}）`,
              activeMs: otherLinkedMs,
              tone: 'other' as const,
              alpha: 0.32,
            },
          ]
        : []),
      ...(unlinkedMs > 0
        ? [
            {
              key: 'unlinked',
              title: `未关联任务（${unlinked.length}）`,
              activeMs: unlinkedMs,
              tone: 'unlinked' as const,
              alpha: 1,
            },
          ]
        : []),
      ...(legacyMs > 0
        ? [
            {
              key: 'legacy',
              title: '旧记录（无片段归类）',
              activeMs: legacyMs,
              tone: 'legacy' as const,
              alpha: 1,
            },
          ]
        : []),
    ];
    const shares = roundedPercentages(items.map((item) => item.activeMs));
    const visualTotal = Math.max(
      1,
      items.reduce((sum, item) => sum + item.activeMs, 0),
    );
    return {
      items: items.map((item, index) => ({
        ...item,
        share: shares[index] ?? 0,
        width: (item.activeMs / visualTotal) * 100,
      })),
      linkedCount: linked.length,
    };
  }, [analytics, totalActive]);

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
      <div className="stats-allocation-band" role="img" aria-label="任务专注时间构成">
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
      <div className="stats-task-list">
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
        <strong>{duration(summary.pause)}</strong>
      </div>
      <div>
        <span>每轮平均专注</span>
        <strong>{duration(average)}</strong>
      </div>
      <div>
        <span>时间利用</span>
        <strong>{focusRate}%</strong>
      </div>
      <div className="stats-cost-track" aria-label={`暂停占比 ${pauseRate}%`}>
        <i className="focus" style={{ width: `${focusRate}%` }} />
        <i className="pause" style={{ left: `${focusRate}%`, width: `${pauseRate}%` }} />
      </div>
    </article>
  );
}

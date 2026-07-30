// 统计工作台 v3：结论 → 指标 → 时间节律 → 任务去向/暂停损耗。
// 会话明细只保留下方唯一账本，不在 Dashboard 内重复一份表格。
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useInView, useReducedMotion } from 'framer-motion';
import type { SessionAnalyticsResult } from '@shared/ipc/api';
import type {
  DayLedgerAnalytics,
  DayLedgerInterval,
  DayLedgerTask,
} from '@shared/dayLedgerAnalytics';
import {
  buildDashboardTaskAllocation,
  largestRemainderPercentages,
} from '@shared/dashboardPresentation';
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
    if (!inView) return;
    if (reduceMotion || hasPlayedRef.current) {
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
  const dayLedgers = useMemo(() => analytics?.dayLedgers ?? [], [analytics?.dayLedgers]);
  const selectedLedger = singleDay
    ? (dayLedgers.find(
        (item) => item.dayStartedAt === new Date(range.start).setHours(0, 0, 0, 0),
      ) ?? dayLedgers[0])
    : dayLedgers.at(-1);
  const ledgerTotals = dayLedgers.reduce(
    (total, item) => ({
      focusMs: total.focusMs + item.totals.focusMs,
      pauseMs: total.pauseMs + item.totals.pauseMs,
      gapMs: total.gapMs + item.totals.gapMs,
      observationMs: total.observationMs + item.totals.observationMs,
      estimatedFocusMs: total.estimatedFocusMs + item.totals.estimatedFocusMs,
      estimatedPauseMs: total.estimatedPauseMs + item.totals.estimatedPauseMs,
    }),
    {
      focusMs: 0,
      pauseMs: 0,
      gapMs: 0,
      observationMs: 0,
      estimatedFocusMs: 0,
      estimatedPauseMs: 0,
    },
  );
  const dashboardFocus = ledgerTotals.focusMs + ledgerTotals.estimatedFocusMs;
  const dashboardPause = ledgerTotals.pauseMs + ledgerTotals.estimatedPauseMs;
  const effectiveTasks = useMemo(() => {
    const taskMap = new Map<string, DayLedgerTask>();
    for (const ledger of dayLedgers) {
      for (const task of ledger.tasks) {
        const current = taskMap.get(task.key);
        taskMap.set(
          task.key,
          current
            ? {
                ...current,
                activeMs: current.activeMs + task.activeMs,
                segmentCount: current.segmentCount + task.segmentCount,
              }
            : { ...task },
        );
      }
    }
    return Array.from(taskMap.values()).sort(
      (left, right) => right.activeMs - left.activeMs || left.title.localeCompare(right.title),
    );
  }, [dayLedgers]);
  const [focusRate, pauseRate, gapRate] = largestRemainderPercentages([
    ledgerTotals.focusMs,
    ledgerTotals.pauseMs,
    ledgerTotals.gapMs,
  ]);
  const average = summary.count > 0 ? dashboardFocus / summary.count : 0;
  const longestSession = useMemo(() => {
    const bySession = new Map<string, { focusMs: number; estimated: boolean }>();
    for (const ledger of dayLedgers) {
      for (const session of ledger.sessionFocus) {
        const current = bySession.get(session.sessionId);
        bySession.set(session.sessionId, {
          focusMs: (current?.focusMs ?? 0) + session.focusMs,
          estimated: Boolean(current?.estimated || session.estimated),
        });
      }
    }
    return Array.from(bySession.values()).reduce(
      (longest, session) => (session.focusMs > longest.focusMs ? session : longest),
      { focusMs: 0, estimated: false },
    );
  }, [dayLedgers]);
  const activeDays = dayLedgers.filter(
    (ledger) => ledger.totals.focusMs + ledger.totals.estimatedFocusMs > 0,
  ).length;

  if (isEmpty) {
    return (
      <section className="history-insights" aria-label="专注统计 Dashboard">
        <div className="history-insights-empty state-block" role="status">
          <div className="state-block-icon">
            <Icon.Calendar size="lg" />
          </div>
          <p className="state-block-title">
            {singleDay && isToday
              ? selectedLedger?.status === 'estimated-only'
                ? '今日只有旧版估算记录'
                : '今日尚未启动'
              : '这段时间还没有专注记录'}
          </p>
          <p className="state-block-desc">
            {selectedLedger?.status === 'estimated-only'
              ? '旧记录缺少精确起止边界，只保留估算时长，不生成空档区间。'
              : '开始一次专注，或查看更长的时间范围。'}
          </p>
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
            <CountUp value={dashboardFocus} format={duration} />
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
              ? `完成 ${summary.count} 轮，平均每轮 ${duration(average)}；暂停占专注/暂停已分类时间 ${percentage(dashboardPause, dashboardFocus + dashboardPause)}%。`
              : `${activeDays} 个活跃日完成 ${summary.count} 轮，有效日日均专注 ${duration(activeDays > 0 ? dashboardFocus / activeDays : 0)}。`}
          </p>
        </div>
        <TimeBudgetDonut
          totals={{
            focusMs: ledgerTotals.focusMs,
            pauseMs: ledgerTotals.pauseMs,
            gapMs: ledgerTotals.gapMs,
          }}
        />
      </header>

      <div className="stats-metric-strip" aria-label="核心指标">
        <Metric
          label="有效专注"
          value={dashboardFocus}
          note={ledgerTotals.estimatedFocusMs > 0 ? '含 estimated 旧记录' : '真实 segment 区间'}
          tone="accent"
        />
        <Metric
          label="暂停损耗"
          value={dashboardPause}
          note={
            ledgerTotals.estimatedPauseMs > 0
              ? `${pauseRate}% 精确观察 · 含 estimated`
              : `${pauseRate}% 精确观察`
          }
          tone="pause"
        />
        <Metric
          label="观察空档"
          value={ledgerTotals.gapMs}
          note={ledgerTotals.observationMs > 0 ? `${gapRate}% 已分类时间` : '尚无观察区间'}
        />
        <Metric
          label="最长一轮"
          value={longestSession.focusMs}
          note={longestSession.estimated ? '有效日内 · estimated' : '有效日内单次专注'}
        />
      </div>

      <div className="stats-main-grid">
        {singleDay ? (
          <DayActivityTimeline ledger={selectedLedger} onOpenSession={onOpenSession} />
        ) : (
          <DailyActivityChart daily={dayLedgers} />
        )}
        <TaskAllocation tasks={effectiveTasks} totalActive={dashboardFocus} />
      </div>

      <GapLedger ledger={selectedLedger} />

      <PauseCost
        pauseMs={dashboardPause}
        average={average}
        focusRate={focusRate}
        pauseRate={pauseRate}
        gapRate={gapRate}
        estimated={ledgerTotals.estimatedFocusMs > 0 || ledgerTotals.estimatedPauseMs > 0}
        hasPreciseObservation={ledgerTotals.observationMs > 0}
      />
    </section>
  );
}

function TimeBudgetDonut({
  totals,
}: {
  totals: { focusMs: number; pauseMs: number; gapMs: number };
}) {
  const total = totals.focusMs + totals.pauseMs + totals.gapMs;
  const [focus, pause, gap] = largestRemainderPercentages([
    totals.focusMs,
    totals.pauseMs,
    totals.gapMs,
  ]);
  const label =
    total > 0
      ? `精确观察时间构成：专注 ${duration(totals.focusMs)}，暂停 ${duration(totals.pauseMs)}，空档 ${duration(totals.gapMs)}`
      : '尚无可绘制的精确观察区间';
  return (
    <svg
      className="stats-time-donut hm-fade-in"
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
    >
      <circle className="track" cx="50" cy="50" r="38" pathLength="100" />
      {total > 0 && (
        <>
          <circle
            className="segment focus"
            cx="50"
            cy="50"
            r="38"
            pathLength="100"
            strokeDasharray={`${focus} ${100 - focus}`}
          />
          <circle
            className="segment pause"
            cx="50"
            cy="50"
            r="38"
            pathLength="100"
            strokeDasharray={`${pause} ${100 - pause}`}
            strokeDashoffset={-focus}
          />
          <circle
            className="segment gap"
            cx="50"
            cy="50"
            r="38"
            pathLength="100"
            strokeDasharray={`${gap} ${100 - gap}`}
            strokeDashoffset={-(focus + pause)}
          />
        </>
      )}
      <text x="50" y="47" textAnchor="middle">
        {total > 0 ? `${focus}%` : '—'}
      </text>
      <text className="caption" x="50" y="61" textAnchor="middle">
        时间利用
      </text>
    </svg>
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
  ledger,
  onOpenSession,
}: {
  ledger?: DayLedgerAnalytics;
  onOpenSession?: (sessionId: string) => void;
}) {
  const span = ledger ? Math.max(1, ledger.dayEndedAt - ledger.dayStartedAt) : DAY_MS;
  const observationLabel =
    ledger?.observationStartedAt !== null && ledger?.observationStartedAt !== undefined
      ? `${formatClock(ledger.observationStartedAt)}–${formatClock(ledger.observationEndedAt)}`
      : '尚未形成观察区间';

  return (
    <article className="stats-panel stats-rhythm-panel">
      <div className="stats-panel-head">
        <div>
          <span>有效日节律</span>
          <h3>24 小时时间轴</h3>
        </div>
        <div className="stats-ledger-float" role="status" aria-live="polite">
          <strong>{ledger?.date ?? '—'}</strong>
          <span>{observationLabel}</span>
        </div>
      </div>

      {ledger ? (
        <div
          className="stats-ledger-chart hm-fade-in"
          style={{ '--hm-delay': '80ms' } as CSSProperties}
          role="group"
          aria-label={`${ledger.date} 全天时间轴；07:00 至 22:00 为默认有效日`}
        >
          <div className="stats-ledger-track">
            <i
              className="effective-window"
              style={{
                left: `${((ledger.effectiveStartedAt - ledger.dayStartedAt) / span) * 100}%`,
                width: `${(Math.max(0, ledger.effectiveEndedAt - ledger.effectiveStartedAt) / span) * 100}%`,
              }}
              aria-hidden="true"
            />
            {ledger.intervals.map((interval, index) => (
              <LedgerBlock
                key={`${interval.kind}-${interval.startedAt}-${index}`}
                interval={interval}
                dayStart={ledger.dayStartedAt}
                span={span}
                onOpenSession={onOpenSession}
              />
            ))}
          </div>
          <div className="stats-ledger-axis" aria-hidden="true">
            <span style={{ left: '0%' }}>00</span>
            <span style={{ left: `${(7 / 24) * 100}%` }}>07</span>
            <span style={{ left: '50%' }}>12</span>
            <span style={{ left: `${(22 / 24) * 100}%` }}>22</span>
            <span style={{ left: '100%' }}>24</span>
          </div>
          <div className="stats-ledger-legend" aria-label="时间分类图例">
            <span className="focus">专注</span>
            <span className="pause">暂停</span>
            <span className="gap">空档</span>
            <span className="sleep">睡眠 / 非统计</span>
          </div>
        </div>
      ) : (
        <div className="stats-timeline-empty" role="status">
          尚无共享日账本数据。
        </div>
      )}
      <p className="stats-caption">
        空档只由观察区间内专注与暂停并集的补集推导；00–07 与 22–24 仅作背景，不计入空档。
      </p>
    </article>
  );
}

function LedgerBlock({
  interval,
  dayStart,
  span,
  onOpenSession,
}: {
  interval: DayLedgerInterval;
  dayStart: number;
  span: number;
  onOpenSession?: (sessionId: string) => void;
}) {
  const left = ((interval.startedAt - dayStart) / span) * 100;
  const width = (interval.durationMs / span) * 100;
  const label = `${interval.kind === 'focus' ? '专注' : interval.kind === 'pause' ? '暂停' : '空档'} ${formatClock(interval.startedAt)}–${formatClock(interval.endedAt)}，${duration(interval.durationMs)}`;
  const sessionId = interval.sessionIds[0];
  if (sessionId && interval.kind !== 'gap' && onOpenSession) {
    return (
      <button
        type="button"
        className={`stats-ledger-block ${interval.kind}`}
        style={{ left: `${left}%`, width: `${Math.max(0.2, width)}%` }}
        title={label}
        aria-label={`${label}；打开会话详情`}
        onClick={() => onOpenSession(sessionId)}
      />
    );
  }
  return (
    <i
      className={`stats-ledger-block ${interval.kind}`}
      style={{ left: `${left}%`, width: `${Math.max(0.2, width)}%` }}
      title={label}
      aria-hidden="true"
    />
  );
}

function GapLedger({ ledger }: { ledger?: DayLedgerAnalytics }) {
  const gaps = ledger?.gaps ?? [];
  return (
    <article className="stats-gap-ledger" aria-labelledby="stats-gap-title">
      <header>
        <div>
          <span>精确空档</span>
          <h3 id="stats-gap-title">{ledger?.date ?? '所选日期'}的空档明细</h3>
        </div>
        {ledger?.estimated && <strong className="stats-estimated-badge">含旧数据估算</strong>}
      </header>
      {gaps.length > 0 ? (
        <ol>
          {gaps.map((gap) => {
            const label = `${formatClock(gap.startedAt)} 至 ${formatClock(gap.endedAt)}，空档 ${duration(gap.durationMs)}`;
            return (
              <li key={`${gap.startedAt}-${gap.endedAt}`} aria-label={label}>
                <time>{formatClock(gap.startedAt)}</time>
                <i aria-hidden="true" />
                <time>{formatClock(gap.endedAt)}</time>
                <strong>{duration(gap.durationMs)}</strong>
              </li>
            );
          })}
        </ol>
      ) : (
        <p role="status">
          {ledger?.status === 'not-started'
            ? ledger.isToday
              ? '今日尚未启动，不把全天计算为空档。'
              : '当日没有真实 focus 起点，未生成空档。'
            : ledger?.status === 'estimated-only'
              ? '旧记录缺少精确边界，只显示 estimated 时长，不伪造空档。'
              : '观察区间内没有空档。'}
        </p>
      )}
    </article>
  );
}

function DailyActivityChart({ daily }: { daily: DayLedgerAnalytics[] }) {
  const width = 720;
  const height = 210;
  const padX = 48;
  const padY = 24;
  const max = Math.max(
    1,
    ...daily.map((day) => day.totals.focusMs + day.totals.pauseMs + day.totals.gapMs),
  );
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
          暂停 <i className="gap" />
          空档
        </div>
      </div>
      <svg
        className="stats-trend-chart hm-fade-in"
        style={{ '--hm-delay': '80ms' } as CSSProperties}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label="每日专注、暂停与空档堆叠图"
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
          const focusMs = day.totals.focusMs;
          const pauseMs = day.totals.pauseMs;
          const gapMs = day.totals.gapMs;
          const total = focusMs + pauseMs + gapMs;
          const activeShare = total > 0 ? focusMs / total : 0;
          const pauseShare = total > 0 ? pauseMs / total : 0;
          const gapShare = total > 0 ? gapMs / total : 0;
          const baseline = height - padY;
          const estimatedLabel = day.estimated
            ? ` · 另含 estimated 专注 ${duration(day.totals.estimatedFocusMs)}、暂停 ${duration(day.totals.estimatedPauseMs)}，不进入精确三分类`
            : '';
          const title = `${day.date} · 专注 ${duration(focusMs)} · 暂停 ${duration(pauseMs)} · 空档 ${duration(gapMs)}${estimatedLabel}`;
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
                y={baseline - (activeShare + pauseShare) * plotHeight}
                width={barWidth}
                height={pauseShare * plotHeight}
              />
              <rect
                className="gap-bar"
                x={x}
                y={baseline - (activeShare + pauseShare + gapShare) * plotHeight}
                width={barWidth}
                height={gapShare * plotHeight}
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
        每根柱子的总高度是当天有效日已分类时间；强调色为专注、红色为暂停、灰色为空档。旧边界只计入
        estimated，悬停或键盘聚焦可读精确值。
      </p>
    </article>
  );
}

function TaskAllocation({ tasks, totalActive }: { tasks: DayLedgerTask[]; totalActive: number }) {
  const allocation = useMemo(
    () => buildDashboardTaskAllocation(tasks, totalActive),
    [tasks, totalActive],
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
  pauseMs,
  average,
  focusRate,
  pauseRate,
  gapRate,
  estimated,
  hasPreciseObservation,
}: {
  pauseMs: number;
  average: number;
  focusRate: number;
  pauseRate: number;
  gapRate: number;
  estimated: boolean;
  hasPreciseObservation: boolean;
}) {
  return (
    <article className="stats-pause-cost">
      <div>
        <span>暂停损耗</span>
        <strong>
          <CountUp value={pauseMs} format={duration} />
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
        role="img"
        aria-label={
          hasPreciseObservation
            ? `精确观察时间：专注 ${focusRate}%，暂停 ${pauseRate}%，空档 ${gapRate}%${estimated ? '；另有 estimated 旧记录，不进入三分类' : ''}`
            : `尚无精确观察区间${estimated ? '；旧记录只作 estimated 汇总，不进入三分类' : ''}`
        }
      >
        <i className="focus" style={{ width: `${focusRate}%` }} />
        <i className="pause" style={{ left: `${focusRate}%`, width: `${pauseRate}%` }} />
        <i className="gap" style={{ left: `${focusRate + pauseRate}%`, width: `${gapRate}%` }} />
      </div>
    </article>
  );
}

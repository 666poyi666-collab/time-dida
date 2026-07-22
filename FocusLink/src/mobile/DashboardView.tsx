import { useMemo, useState, type CSSProperties } from 'react';
import type {
  SessionAnalyticsDaily,
  SessionAnalyticsHourly,
  SessionAnalyticsSubject,
} from '@shared/ipc/api';
import {
  buildDashboardTaskAllocation,
  type DashboardTaskAllocation,
} from '@shared/dashboardPresentation';
import type { CachedBundle } from './cache';
import { buildMobileDashboard, mobileStatsRange, type MobileStatsRange } from './dashboardModel';
import { formatClockDuration } from './runtimeModel';
import { SessionLedger } from './SessionLedger';

const RANGE_OPTIONS: ReadonlyArray<{ value: MobileStatsRange; label: string }> = [
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
];

interface DashboardViewProps {
  records: readonly CachedBundle[];
  ready: boolean;
  configured: boolean;
  lastSyncAt: number | null;
  cursor: string | null;
  referenceNow?: number;
}

export function DashboardView({
  records,
  ready,
  configured,
  lastSyncAt,
  cursor,
  referenceNow = Date.now(),
}: DashboardViewProps) {
  const [range, setRange] = useState<MobileStatsRange>('today');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const analytics = useMemo(
    () => buildMobileDashboard(records, range, referenceNow),
    [records, range, referenceNow],
  );
  const bounds = useMemo(() => mobileStatsRange(range, referenceNow), [range, referenceNow]);
  const visibleRecords = useMemo(() => {
    const selectedBounds = selectedDate ? boundsForDate(selectedDate) : bounds;
    return records.filter((record) => sessionOverlaps(record, selectedBounds));
  }, [bounds, records, selectedDate]);
  const longestSessionMs = analytics.sessions.reduce(
    (longest, session) => Math.max(longest, session.activeElapsedMs),
    0,
  );
  const trackedMs = analytics.totals.activeMs + analytics.totals.pauseMs;
  const focusRate = trackedMs > 0 ? analytics.totals.activeMs / trackedMs : 0;
  const taskAllocation = useMemo(
    () => buildDashboardTaskAllocation(analytics.tasks, analytics.totals.activeMs),
    [analytics.tasks, analytics.totals.activeMs],
  );
  const scopeLabel = selectedDate
    ? formatFullDate(selectedDate)
    : formatRangeLabel(bounds.start, bounds.end, range);

  const selectRange = (nextRange: MobileStatsRange) => {
    setRange(nextRange);
    setSelectedDate(null);
  };

  return (
    <section className="dashboard-view view-surface" aria-labelledby="mobile-dashboard-title">
      <header className="dashboard-heading view-heading">
        <div>
          <p className="eyebrow">FOCUS ANALYTICS</p>
          <h2 id="mobile-dashboard-title">专注统计</h2>
        </div>
        <div className="dashboard-range" role="group" aria-label="统计范围">
          {RANGE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={range === option.value ? 'is-active' : ''}
              aria-pressed={range === option.value}
              onClick={() => selectRange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {!ready ? (
        <DashboardSkeleton />
      ) : (
        <>
          <section className="dashboard-hero" aria-labelledby="dashboard-conclusion-title">
            <div className="dashboard-primary">
              <span id="dashboard-conclusion-title">有效专注</span>
              <strong>{formatClockDuration(analytics.totals.activeMs)}</strong>
              <p>{dashboardConclusion(analytics.totals.activeMs, analytics.totals.pauseMs)}</p>
            </div>
            <div className="focus-rate" aria-label={`专注率 ${formatPercent(focusRate)}`}>
              <div>
                <span>专注率</span>
                <strong>{formatPercent(focusRate)}</strong>
              </div>
              <span className="focus-rate-track" aria-hidden="true">
                <i style={{ width: `${Math.round(focusRate * 100)}%` }} />
              </span>
              <small>{scopeLabel}</small>
            </div>
          </section>

          <div className="dashboard-kpis" aria-label="统计摘要">
            <DashboardMetric
              label="日均专注"
              value={formatClockDuration(analytics.stability.averageDailyActiveMs)}
              tone="focus"
            />
            <DashboardMetric
              label="累计暂停"
              value={formatClockDuration(analytics.totals.pauseMs)}
              tone="pause"
            />
            <DashboardMetric label="完成轮次" value={`${analytics.totals.sessionCount} 场`} />
            <DashboardMetric label="最长一轮" value={formatClockDuration(longestSessionMs)} />
          </div>

          <section className="dashboard-band trend-band" aria-labelledby="dashboard-trend-title">
            <AnalyticsHeading
              id="dashboard-trend-title"
              title="专注趋势"
              detail={`${analytics.stability.activeDays}/${analytics.stability.calendarDays} 个活跃日`}
            />
            <DailyTrend daily={analytics.daily} />
          </section>

          <div className="dashboard-analysis-grid">
            <section
              className="dashboard-band subject-band"
              aria-labelledby="dashboard-subject-title"
            >
              <AnalyticsHeading
                id="dashboard-subject-title"
                title="学科投入"
                detail="按专注片段归类"
              />
              <SubjectDistribution subjects={analytics.subjects} />
            </section>

            <section
              className="dashboard-band hourly-band"
              aria-labelledby="dashboard-hourly-title"
            >
              <AnalyticsHeading
                id="dashboard-hourly-title"
                title="24 小时时段"
                detail="专注 / 暂停"
              />
              <HourlyDistribution hourly={analytics.hourly} />
            </section>
          </div>

          <section
            className="dashboard-band task-allocation-band"
            aria-labelledby="dashboard-task-allocation-title"
          >
            <AnalyticsHeading
              id="dashboard-task-allocation-title"
              title="任务投入"
              detail="已关联 / 未关联 / 旧记录"
            />
            <MobileTaskAllocation allocation={taskAllocation} />
          </section>

          <section
            className="dashboard-band heatmap-band"
            aria-labelledby="dashboard-heatmap-title"
          >
            <AnalyticsHeading
              id="dashboard-heatmap-title"
              title="日期热力"
              detail={selectedDate ? '再次点击可查看全部日期' : '选择日期查看会话'}
            />
            <DailyHeatmap
              daily={analytics.daily}
              selectedDate={selectedDate}
              onSelect={(date) => setSelectedDate((current) => (current === date ? null : date))}
            />
          </section>

          <MobilePauseCost
            activeMs={analytics.totals.activeMs}
            pauseMs={analytics.totals.pauseMs}
            sessionCount={analytics.totals.sessionCount}
          />

          <SessionLedger
            records={visibleRecords}
            ready={ready}
            configured={configured}
            lastSyncAt={lastSyncAt}
            cursor={cursor}
            showSummary={false}
            scopeLabel={scopeLabel}
          />
        </>
      )}
    </section>
  );
}

function DashboardMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'focus' | 'pause';
}) {
  return (
    <div className={`dashboard-metric ${tone ? `tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AnalyticsHeading({ id, title, detail }: { id: string; title: string; detail: string }) {
  return (
    <header className="analytics-heading">
      <h3 id={id}>{title}</h3>
      <span>{detail}</span>
    </header>
  );
}

function DailyTrend({ daily }: { daily: readonly SessionAnalyticsDaily[] }) {
  const max = Math.max(1, ...daily.map((item) => item.activeMs + item.pauseMs));
  const labelStep = Math.max(1, Math.ceil(daily.length / 6));
  return (
    <div className="daily-trend" role="img" aria-label="每日专注与暂停趋势，详细数值见各日期标签">
      <div
        className="daily-trend-columns"
        style={{ '--trend-columns': daily.length } as CSSProperties}
      >
        {daily.map((item, index) => {
          const activeHeight = (item.activeMs / max) * 100;
          const pauseHeight = (item.pauseMs / max) * 100;
          const showLabel =
            daily.length <= 7 || index % labelStep === 0 || index === daily.length - 1;
          return (
            <div
              className="daily-trend-column"
              key={item.date}
              title={`${formatFullDate(item.date)}：专注 ${formatClockDuration(item.activeMs)}，暂停 ${formatClockDuration(item.pauseMs)}`}
              aria-label={`${formatFullDate(item.date)}：专注 ${formatClockDuration(item.activeMs)}，暂停 ${formatClockDuration(item.pauseMs)}，${item.sessionCount} 场会话`}
            >
              <span className="daily-trend-bars" aria-hidden="true">
                <span
                  className="daily-trend-stack"
                  style={
                    {
                      '--trend-scale': (item.activeMs + item.pauseMs) / max,
                    } as CSSProperties
                  }
                >
                  <i
                    className="trend-active"
                    style={{
                      flexBasis: `${activeHeight + pauseHeight > 0 ? (activeHeight / (activeHeight + pauseHeight)) * 100 : 0}%`,
                    }}
                  />
                  <i
                    className="trend-pause"
                    style={{
                      flexBasis: `${activeHeight + pauseHeight > 0 ? (pauseHeight / (activeHeight + pauseHeight)) * 100 : 0}%`,
                    }}
                  />
                </span>
              </span>
              <small>{showLabel ? formatShortDate(item.date) : ''}</small>
            </div>
          );
        })}
      </div>
      <div className="chart-legend" aria-hidden="true">
        <span className="legend-focus">专注</span>
        <span className="legend-pause">暂停</span>
      </div>
    </div>
  );
}

function SubjectDistribution({ subjects }: { subjects: readonly SessionAnalyticsSubject[] }) {
  const total = subjects.reduce((sum, item) => sum + item.activeMs, 0);
  if (subjects.length === 0) {
    return <p className="analytics-empty">这个范围还没有可归类的专注片段。</p>;
  }
  return (
    <div className="subject-distribution">
      {subjects.map((item) => {
        const share = total > 0 ? item.activeMs / total : 0;
        return (
          <div className="subject-row" key={item.subject}>
            <div>
              <strong>{item.subject}</strong>
              <span>
                {formatPercent(share)} · {item.segmentCount} 段
              </span>
            </div>
            <span className="subject-track" aria-hidden="true">
              <i style={{ width: `${Math.max(2, share * 100)}%` }} />
            </span>
            <small>{formatClockDuration(item.activeMs)}</small>
          </div>
        );
      })}
    </div>
  );
}

function HourlyDistribution({ hourly }: { hourly: readonly SessionAnalyticsHourly[] }) {
  const max = Math.max(1, ...hourly.map((item) => item.activeMs + item.pauseMs));
  return (
    <div className="hourly-distribution" role="img" aria-label="24 小时专注与暂停分布">
      <div className="hourly-columns">
        {hourly.map((item) => (
          <span
            className="hourly-column"
            key={item.hour}
            title={`${String(item.hour).padStart(2, '0')}:00：专注 ${formatClockDuration(item.activeMs)}，暂停 ${formatClockDuration(item.pauseMs)}`}
            aria-label={`${String(item.hour).padStart(2, '0')}:00 至 ${String((item.hour + 1) % 24).padStart(2, '0')}:00，专注 ${formatClockDuration(item.activeMs)}，暂停 ${formatClockDuration(item.pauseMs)}`}
          >
            <i
              className="hour-active"
              style={{ '--hour-scale': item.activeMs / max } as CSSProperties}
              aria-hidden="true"
            />
            <i
              className="hour-pause"
              style={{ '--hour-scale': item.pauseMs / max } as CSSProperties}
              aria-hidden="true"
            />
          </span>
        ))}
      </div>
      <div className="hourly-axis" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}

function MobileTaskAllocation({ allocation }: { allocation: DashboardTaskAllocation }) {
  if (allocation.items.length === 0) {
    return <p className="analytics-empty">这个范围还没有可归类的任务投入。</p>;
  }
  return (
    <div className="mobile-task-allocation">
      <div
        className="mobile-task-allocation-track"
        role="img"
        aria-label={`任务专注时间构成，${allocation.items.map((item) => `${item.title} ${item.share}%`).join('，')}`}
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
          />
        ))}
      </div>
      <div className="mobile-task-allocation-list">
        {allocation.items.map((item) => (
          <div className={`mobile-task-allocation-row tone-${item.tone}`} key={item.key}>
            <i style={{ '--allocation-alpha': item.alpha } as CSSProperties} />
            <strong>{item.title}</strong>
            <span>{item.share}%</span>
            <small>{formatClockDuration(item.activeMs)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function MobilePauseCost({
  activeMs,
  pauseMs,
  sessionCount,
}: {
  activeMs: number;
  pauseMs: number;
  sessionCount: number;
}) {
  const tracked = activeMs + pauseMs;
  const focusRate = tracked > 0 ? activeMs / tracked : 0;
  const pauseRate = tracked > 0 ? pauseMs / tracked : 0;
  const average = sessionCount > 0 ? activeMs / sessionCount : 0;
  return (
    <section className="dashboard-pause-cost" aria-label="暂停损耗与时间守恒">
      <div>
        <span>暂停损耗</span>
        <strong className="tone-pause">{formatClockDuration(pauseMs)}</strong>
      </div>
      <div>
        <span>每轮平均专注</span>
        <strong>{formatClockDuration(average)}</strong>
      </div>
      <div>
        <span>时间利用</span>
        <strong>{formatPercent(focusRate)}</strong>
      </div>
      <div
        className="mobile-pause-cost-track"
        role="img"
        aria-label={`有效专注 ${formatPercent(focusRate)}，暂停 ${formatPercent(pauseRate)}`}
      >
        <i className="focus" style={{ width: `${focusRate * 100}%` }} />
        <i
          className="pause"
          style={{ left: `${focusRate * 100}%`, width: `${pauseRate * 100}%` }}
        />
      </div>
    </section>
  );
}

function DailyHeatmap({
  daily,
  selectedDate,
  onSelect,
}: {
  daily: readonly SessionAnalyticsDaily[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const max = Math.max(1, ...daily.map((item) => item.activeMs));
  return (
    <div className="daily-heatmap" role="group" aria-label="每日专注热力">
      {daily.map((item) => {
        const intensity = item.activeMs / max;
        const active = selectedDate === item.date;
        return (
          <button
            type="button"
            key={item.date}
            className={active ? 'is-selected' : ''}
            aria-pressed={active}
            aria-label={`${formatFullDate(item.date)}，专注 ${formatClockDuration(item.activeMs)}，${item.sessionCount} 场会话`}
            onClick={() => onSelect(item.date)}
          >
            <i style={{ opacity: intensity }} aria-hidden="true" />
            <strong>{item.date.slice(-2)}</strong>
            <span>{formatCompactDuration(item.activeMs)}</span>
          </button>
        );
      })}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" role="status" aria-live="polite">
      <span className="sr-only">正在读取统计缓存</span>
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

function dashboardConclusion(activeMs: number, pauseMs: number): string {
  if (activeMs <= 0) return '这个范围还没有已结束的专注，完成一轮后会形成统计。';
  if (pauseMs <= 0) return '专注过程没有记录暂停，节奏保持完整。';
  const rate = activeMs / Math.max(1, activeMs + pauseMs);
  if (rate >= 0.85) return '专注时间占比稳定，暂停损耗保持在较低水平。';
  if (rate >= 0.65) return '专注是主要投入，仍有一部分暂停时间可以收紧。';
  return '暂停占比较高，可以从会话明细定位中断集中的时段。';
}

function sessionOverlaps(record: CachedBundle, bounds: { start: number; end: number }): boolean {
  const { session } = record.bundle;
  const end = session.endedAt ?? session.startedAt + Math.max(1, session.wallElapsedMs);
  return session.startedAt <= bounds.end && end >= bounds.start;
}

function boundsForDate(date: string): { start: number; end: number } {
  const [year, month, day] = date.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  const end = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
  return { start, end };
}

function formatRangeLabel(start: number, end: number, range: MobileStatsRange): string {
  if (range === 'today') return formatFullDate(dayKey(start));
  return `${formatShortDate(dayKey(start))} - ${formatShortDate(dayKey(end))}`;
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatFullDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(year, month - 1, day));
}

function formatShortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function formatCompactDuration(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h${remainder}m` : `${hours}h`;
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

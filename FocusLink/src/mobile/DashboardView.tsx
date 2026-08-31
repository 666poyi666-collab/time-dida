import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { CalendarDays, X } from 'lucide-react';
import type { DayLedgerAnalytics, DayLedgerInterval } from '@shared/dayLedgerAnalytics';
import type { SyncedTask } from '@shared/sync/taskSnapshotProtocol';
import {
  buildDashboardTaskAllocation,
  largestRemainderPercentages,
  type DashboardTaskAllocation,
} from '@shared/dashboardPresentation';
import type { CachedBundle } from './cache';
import {
  buildMobileDashboardInRange,
  mobileCustomStatsRange,
  mobileStatsRange,
  mobileTimelineIntervalAt,
  resolveMobileTimelineTasks,
  selectMobileDashboardLedger,
  type MobileStatsRange,
  type MobileTimelineTaskDetail,
} from './dashboardModel';
import { formatClockDuration } from './runtimeModel';
import { SessionLedger } from './SessionLedger';

const RANGE_OPTIONS: ReadonlyArray<{ value: MobileStatsRange; label: string }> = [
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: '7d', label: '近 7 天' },
  { value: 'previous-7d', label: '上个 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'previous-30d', label: '上个 30 天' },
];

type DashboardRangeChoice = MobileStatsRange | 'custom';

const DAY_PERIODS = [
  { label: '深夜', startHour: 0, endHour: 7 },
  { label: '上午', startHour: 7, endHour: 12 },
  { label: '下午', startHour: 12, endHour: 18 },
  { label: '晚间', startHour: 18, endHour: 22 },
  { label: '深夜', startHour: 22, endHour: 24 },
] as const;

interface DashboardViewProps {
  records: readonly CachedBundle[];
  ready: boolean;
  configured: boolean;
  lastSyncAt: number | null;
  cursor: string | null;
  tasks?: readonly SyncedTask[] | null;
  referenceNow?: number;
}

export function DashboardView({
  records,
  ready,
  configured,
  lastSyncAt,
  cursor,
  tasks = null,
  referenceNow = Date.now(),
}: DashboardViewProps) {
  const defaultBounds = useMemo(() => mobileStatsRange('7d', referenceNow), [referenceNow]);
  const [range, setRange] = useState<DashboardRangeChoice>('7d');
  const [customStart, setCustomStart] = useState(() => dayKey(defaultBounds.start));
  const [customEnd, setCustomEnd] = useState(() => dayKey(defaultBounds.end - 1));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const customBounds = useMemo(
    () => mobileCustomStatsRange(customStart, customEnd),
    [customEnd, customStart],
  );
  const bounds = useMemo(
    () =>
      range === 'custom' ? (customBounds ?? defaultBounds) : mobileStatsRange(range, referenceNow),
    [customBounds, defaultBounds, range, referenceNow],
  );
  const rangeAnalytics = useMemo(
    () => buildMobileDashboardInRange(records, bounds, referenceNow),
    [bounds, records, referenceNow],
  );
  const selectedLedger = useMemo(
    () => selectMobileDashboardLedger(rangeAnalytics.dayLedgers, selectedDate),
    [rangeAnalytics.dayLedgers, selectedDate],
  );
  const analytics = useMemo(
    () =>
      selectedDate && selectedLedger
        ? buildMobileDashboardInRange(
            records,
            { start: selectedLedger.dayStartedAt, end: selectedLedger.dayEndedAt },
            referenceNow,
          )
        : rangeAnalytics,
    [records, referenceNow, rangeAnalytics, selectedDate, selectedLedger],
  );
  const dashboardFocus = analytics.totals.focusMs + analytics.totals.estimatedFocusMs;
  const dashboardPause = analytics.totals.pauseMs + analytics.totals.estimatedPauseMs;
  const [focusRate, pauseRate, gapRate] = largestRemainderPercentages([
    dashboardFocus,
    dashboardPause,
    analytics.totals.gapMs,
  ]);
  const taskAllocation = useMemo(
    () => buildDashboardTaskAllocation(analytics.tasks, dashboardFocus),
    [analytics.tasks, dashboardFocus],
  );
  const visibleBounds =
    selectedDate && selectedLedger
      ? { start: selectedLedger.dayStartedAt, end: selectedLedger.dayEndedAt }
      : bounds;
  const visibleRecords = records.filter((record) => sessionOverlaps(record, visibleBounds));
  const scopeLabel =
    selectedDate && selectedLedger
      ? formatFullDate(selectedLedger.date)
      : formatRangeLabel(bounds.start, bounds.end, range);

  const selectRange = (nextRange: DashboardRangeChoice) => {
    setRange(nextRange);
    setSelectedDate(null);
  };

  const updateCustomStart = (value: string) => {
    setCustomStart(value);
    if (value && customEnd && value > customEnd) setCustomEnd(value);
    setSelectedDate(null);
  };

  const updateCustomEnd = (value: string) => {
    setCustomEnd(value);
    if (value && customStart && value < customStart) setCustomStart(value);
    setSelectedDate(null);
  };

  return (
    <section className="dashboard-view view-surface" aria-labelledby="mobile-dashboard-title">
      <header className="dashboard-heading view-heading">
        <div>
          <p className="eyebrow">DAY LEDGER</p>
          <h2 id="mobile-dashboard-title">时间账本</h2>
        </div>
        <div className="dashboard-range-shell">
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
            <button
              type="button"
              className={`dashboard-custom-range-trigger ${range === 'custom' ? 'is-active' : ''}`}
              aria-pressed={range === 'custom'}
              onClick={() => selectRange('custom')}
            >
              <CalendarDays aria-hidden="true" />
              <span>自定义</span>
            </button>
          </div>
          {range === 'custom' && (
            <div className="dashboard-custom-range" role="group" aria-label="自定义统计日期">
              <label>
                <span>开始日期</span>
                <input
                  type="date"
                  value={customStart}
                  max={dayKey(referenceNow)}
                  aria-invalid={customBounds === null}
                  onChange={(event) => updateCustomStart(event.target.value)}
                />
              </label>
              <i aria-hidden="true">至</i>
              <label>
                <span>结束日期</span>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart || undefined}
                  max={dayKey(referenceNow)}
                  aria-invalid={customBounds === null}
                  onChange={(event) => updateCustomEnd(event.target.value)}
                />
              </label>
              {customBounds === null && <p role="alert">请选择有效的开始和结束日期。</p>}
            </div>
          )}
        </div>
      </header>

      {!ready ? (
        <DashboardSkeleton />
      ) : (
        <>
          <section className="dashboard-hero ledger-dashboard-hero" aria-label="有效日结论">
            <div className="dashboard-primary">
              <span>{dashboardScopeTitle(range, selectedDate)}</span>
              <strong>{formatClockDuration(dashboardFocus)}</strong>
              <p>{dashboardConclusion(selectedLedger, dashboardFocus, analytics.totals.gapMs)}</p>
              {analytics.estimated && (
                <small className="dashboard-estimated">含 estimated 旧记录</small>
              )}
            </div>
            <TimeBudgetDonut
              focusMs={dashboardFocus}
              pauseMs={dashboardPause}
              gapMs={analytics.totals.gapMs}
              focusRate={focusRate}
              pauseRate={pauseRate}
              gapRate={gapRate}
              estimated={analytics.estimated}
            />
          </section>

          <div className="dashboard-kpis" aria-label="有效日核心指标">
            <DashboardMetric
              label="有效专注"
              value={formatClockDuration(dashboardFocus)}
              tone="focus"
            />
            <DashboardMetric
              label="暂停损耗"
              value={formatClockDuration(dashboardPause)}
              tone="pause"
            />
            <DashboardMetric label="观察空档" value={formatClockDuration(analytics.totals.gapMs)} />
            <DashboardMetric label="活跃日" value={`${analytics.activeDays} 天`} />
          </div>

          {rangeAnalytics.dayLedgers.length > 1 && (
            <section
              className="dashboard-band ledger-days-band"
              aria-labelledby="ledger-days-title"
            >
              <AnalyticsHeading
                id="ledger-days-title"
                title="每日时间构成"
                detail="专注 / 暂停 / 空档"
              />
              <DailyLedgerTrend
                ledgers={rangeAnalytics.dayLedgers}
                selectedDate={selectedDate}
                onSelect={(date) => setSelectedDate((current) => (current === date ? null : date))}
              />
              {selectedDate && selectedLedger && (
                <SelectedDaySummary ledger={selectedLedger} onClear={() => setSelectedDate(null)} />
              )}
            </section>
          )}

          <div className="dashboard-analysis-grid ledger-analysis-grid">
            <DayLedgerTimeline
              key={selectedLedger?.date ?? 'no-ledger'}
              ledger={selectedLedger}
              records={records}
              tasks={tasks}
            />
            <section
              className="dashboard-band task-allocation-band"
              aria-labelledby="dashboard-task-allocation-title"
            >
              <AnalyticsHeading
                id="dashboard-task-allocation-title"
                title="任务投入"
                detail="已关联 / 未关联 / estimated"
              />
              <MobileTaskAllocation allocation={taskAllocation} />
            </section>
          </div>

          <GapLedger ledger={selectedLedger} />

          <MobileTimeBudget
            focusMs={dashboardFocus}
            pauseMs={dashboardPause}
            gapMs={analytics.totals.gapMs}
            focusRate={focusRate}
            pauseRate={pauseRate}
            gapRate={gapRate}
            estimated={analytics.estimated}
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

function TimeBudgetDonut({
  focusMs,
  pauseMs,
  gapMs,
  focusRate,
  pauseRate,
  gapRate,
  estimated,
}: {
  focusMs: number;
  pauseMs: number;
  gapMs: number;
  focusRate: number;
  pauseRate: number;
  gapRate: number;
  estimated: boolean;
}) {
  const total = focusMs + pauseMs + gapMs;
  const label =
    total > 0
      ? `时间构成${estimated ? '，含 estimated 旧记录' : ''}：专注 ${formatClockDuration(focusMs)}，暂停 ${formatClockDuration(pauseMs)}，空档 ${formatClockDuration(gapMs)}`
      : '尚无可绘制的观察区间';
  return (
    <div className="mobile-time-donut-wrap">
      <svg className="mobile-time-donut" viewBox="0 0 100 100" role="img" aria-label={label}>
        <circle className="track" cx="50" cy="50" r="38" pathLength="100" />
        {total > 0 && (
          <>
            <circle
              className="segment focus"
              cx="50"
              cy="50"
              r="38"
              pathLength="100"
              strokeDasharray={`${focusRate} ${100 - focusRate}`}
            />
            <circle
              className="segment pause"
              cx="50"
              cy="50"
              r="38"
              pathLength="100"
              strokeDasharray={`${pauseRate} ${100 - pauseRate}`}
              strokeDashoffset={-focusRate}
            />
            <circle
              className="segment gap"
              cx="50"
              cy="50"
              r="38"
              pathLength="100"
              strokeDasharray={`${gapRate} ${100 - gapRate}`}
              strokeDashoffset={-(focusRate + pauseRate)}
            />
          </>
        )}
        <text x="50" y="48" textAnchor="middle">
          {total > 0 ? `${focusRate}%` : '—'}
        </text>
        <text className="caption" x="50" y="61" textAnchor="middle">
          时间利用
        </text>
      </svg>
      <div className="chart-legend mobile-time-legend" aria-hidden="true">
        <span className="legend-focus">专注 {focusRate}%</span>
        <span className="legend-pause">暂停 {pauseRate}%</span>
        <span className="legend-gap">空档 {gapRate}%</span>
      </div>
    </div>
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

function DailyLedgerTrend({
  ledgers,
  selectedDate,
  onSelect,
}: {
  ledgers: readonly DayLedgerAnalytics[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const max = Math.max(
    1,
    ...ledgers.map(
      (ledger) =>
        ledger.totals.focusMs +
        ledger.totals.estimatedFocusMs +
        ledger.totals.pauseMs +
        ledger.totals.estimatedPauseMs +
        ledger.totals.gapMs,
    ),
  );
  const labelStep = Math.max(1, Math.ceil(ledgers.length / 7));
  return (
    <div className="daily-ledger-trend" role="group" aria-label="每日专注、暂停与空档">
      {ledgers.map((ledger, index) => {
        const focus = ledger.totals.focusMs + ledger.totals.estimatedFocusMs;
        const pause = ledger.totals.pauseMs + ledger.totals.estimatedPauseMs;
        const total = focus + pause + ledger.totals.gapMs;
        const shares = largestRemainderPercentages([focus, pause, ledger.totals.gapMs]);
        const selected = selectedDate === ledger.date;
        return (
          <button
            type="button"
            key={ledger.date}
            className={selected ? 'is-selected' : ''}
            aria-pressed={selected}
            aria-label={`${formatFullDate(ledger.date)}，专注 ${formatClockDuration(focus)}，暂停 ${formatClockDuration(pause)}，空档 ${formatClockDuration(ledger.totals.gapMs)}${ledger.estimated ? '，含 estimated' : ''}`}
            onClick={() => onSelect(ledger.date)}
          >
            <span className="daily-ledger-bar" aria-hidden="true">
              <span
                className="daily-ledger-stack"
                style={{ '--ledger-day-scale': total / max } as CSSProperties}
              >
                <i className="focus" style={{ flexBasis: `${shares[0]}%` }} />
                <i className="pause" style={{ flexBasis: `${shares[1]}%` }} />
                <i className="gap" style={{ flexBasis: `${shares[2]}%` }} />
              </span>
            </span>
            <small>
              {index % labelStep === 0 || index === ledgers.length - 1
                ? formatShortDate(ledger.date)
                : ''}
            </small>
          </button>
        );
      })}
    </div>
  );
}

function DayLedgerTimeline({
  ledger,
  records,
  tasks,
}: {
  ledger: DayLedgerAnalytics | undefined;
  records: readonly CachedBundle[];
  tasks: readonly SyncedTask[] | null;
}) {
  const [selectedIntervalKey, setSelectedIntervalKey] = useState<string | null>(null);
  const intervalEntries = (ledger?.intervals ?? []).map((interval) => {
    const details = resolveMobileTimelineTasks(interval, records, tasks);
    return {
      interval,
      details,
      key: timelineIntervalKey(interval),
      label: `${intervalLabel(interval)}；${details
        .map((detail) => `${detail.title}（${timelineTaskStateLabel(detail.state)}）`)
        .join('、')}`,
    };
  });
  const span = ledger ? Math.max(1, ledger.dayEndedAt - ledger.dayStartedAt) : 1;
  const observation =
    ledger?.observationStartedAt === null || ledger?.observationStartedAt === undefined
      ? '尚未形成观察区间'
      : `${formatClock(ledger.observationStartedAt)}–${formatClock(ledger.observationEndedAt)}`;
  const timelineLabel = ledger
    ? `${ledger.date} 全天时间轴，07:00 至 22:00 为默认有效日；${ledger.intervals.map(intervalLabel).join('；') || observation}`
    : '尚无共享日账本数据';
  const hourTicks = Array.from({ length: 25 }, (_, hour) => hour);
  const nowPosition = ledger?.isToday
    ? Math.min(100, Math.max(0, ((ledger.observationEndedAt - ledger.dayStartedAt) / span) * 100))
    : null;
  return (
    <section className="dashboard-band mobile-ledger-band" aria-labelledby="mobile-ledger-title">
      <AnalyticsHeading id="mobile-ledger-title" title="24 小时时间轴" detail={observation} />
      {ledger ? (
        <div className="mobile-day-ledger" aria-label={timelineLabel}>
          <div className="mobile-day-map-scroll" tabIndex={0} aria-label="横向查看 24 小时">
            <div className="mobile-day-map">
              <div className="mobile-day-periods" aria-hidden="true">
                {DAY_PERIODS.map((period, index) => (
                  <span
                    key={`${period.label}-${index}`}
                    style={{
                      left: `${(period.startHour / 24) * 100}%`,
                      width: `${((period.endHour - period.startHour) / 24) * 100}%`,
                    }}
                  >
                    {period.label}
                  </span>
                ))}
              </div>
              <div className="mobile-day-map-axis" aria-hidden="true">
                {hourTicks.map((hour) => (
                  <span
                    key={hour}
                    className={hour % 6 === 0 ? 'major' : hour % 2 === 0 ? 'labelled' : ''}
                    style={{ left: `${(hour / 24) * 100}%` }}
                  >
                    {hour % 2 === 0 ? String(hour).padStart(2, '0') : ''}
                  </span>
                ))}
              </div>
              <div className="mobile-day-map-grid" aria-hidden="true">
                {hourTicks.slice(0, 24).map((hour) => (
                  <i key={hour} className={hour < 7 || hour >= 22 ? 'night' : 'day'} />
                ))}
              </div>
              {(['focus', 'pause', 'gap'] as const).map((kind) => {
                const entries = intervalEntries.filter((entry) => entry.interval.kind === kind);
                const totalMs = entries.reduce(
                  (total, entry) => total + entry.interval.durationMs,
                  0,
                );
                return (
                  <div className={`mobile-day-lane ${kind}`} key={kind}>
                    <span className="mobile-day-lane-label">
                      <strong>
                        {kind === 'focus' ? '专注' : kind === 'pause' ? '暂停' : '空档'}
                      </strong>
                      <small>{formatLaneDuration(totalMs)}</small>
                    </span>
                    <div
                      className="mobile-day-lane-track"
                      onClick={(event) =>
                        selectTimelineIntervalAt(
                          event,
                          entries,
                          ledger.dayStartedAt,
                          span,
                          setSelectedIntervalKey,
                        )
                      }
                    >
                      {entries.map(({ interval, key, label }) => {
                        const width = (interval.durationMs / span) * 100;
                        return (
                          <span
                            key={key}
                            className={`ledger-interval ${interval.kind} ${selectedIntervalKey === key ? 'is-selected' : ''}`}
                            title={label}
                            aria-hidden="true"
                            style={{
                              left: `${((interval.startedAt - ledger.dayStartedAt) / span) * 100}%`,
                              width: `${Math.max(0.22, width)}%`,
                            }}
                          >
                            {width >= 5 && <small>{formatClock(interval.startedAt)}</small>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {nowPosition !== null && (
                <div className="mobile-day-now-layer" aria-hidden="true">
                  <i className="mobile-day-now" style={{ left: `${nowPosition}%` }}>
                    <span>{formatClock(ledger.observationEndedAt)}</span>
                  </i>
                </div>
              )}
            </div>
          </div>
          {intervalEntries.length > 0 && (
            <div className="mobile-timeline-interval-list" role="group" aria-label="时间段明细入口">
              {intervalEntries.map(({ interval, key, label, details }) => (
                <button
                  type="button"
                  key={key}
                  className={`timeline-interval-choice ${interval.kind}`}
                  aria-label={label}
                  aria-pressed={selectedIntervalKey === key}
                  onClick={() => setSelectedIntervalKey(key)}
                >
                  <i aria-hidden="true" />
                  <span>
                    {formatClock(interval.startedAt)}–{formatClock(interval.endedAt)}
                  </span>
                  <small>{details.map(formatTimelineTaskDetail).join('；')}</small>
                </button>
              ))}
            </div>
          )}
          {selectedIntervalKey &&
            (() => {
              const selected = intervalEntries.find((entry) => entry.key === selectedIntervalKey);
              if (!selected) return null;
              return (
                <TimelineIntervalDetail
                  interval={selected.interval}
                  details={selected.details}
                  onClose={() => setSelectedIntervalKey(null)}
                />
              );
            })()}
          <div className="chart-legend mobile-ledger-legend" aria-hidden="true">
            <span className="legend-focus">专注</span>
            <span className="legend-pause">暂停</span>
            <span className="legend-gap">空档</span>
            <span className="legend-sleep">非统计</span>
          </div>
        </div>
      ) : (
        <p className="analytics-empty">尚无共享日账本数据。</p>
      )}
      <p className="dashboard-ledger-caption">
        每格 1 小时；专注、暂停、空档共用 00:00–24:00 比例，夜间底色不计入空档。
      </p>
    </section>
  );
}

function formatTimelineTaskDetail(detail: MobileTimelineTaskDetail): string {
  return `${detail.title}，${timelineTaskStateLabel(detail.state)}`;
}

function timelineIntervalKey(interval: DayLedgerInterval): string {
  return `${interval.kind}-${interval.startedAt}-${interval.endedAt}`;
}

function selectTimelineIntervalAt(
  event: MouseEvent<HTMLDivElement>,
  entries: ReadonlyArray<{ interval: DayLedgerInterval; key: string }>,
  dayStartedAt: number,
  span: number,
  select: (key: string) => void,
): void {
  const bounds = event.currentTarget.getBoundingClientRect();
  if (bounds.width <= 0) return;
  const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
  const timestamp = dayStartedAt + ratio * span;
  const selectedInterval = mobileTimelineIntervalAt(
    entries.map((entry) => entry.interval),
    timestamp,
  );
  const selected = entries.find((entry) => entry.interval === selectedInterval);
  if (selected) select(selected.key);
}

function timelineTaskStateLabel(state: MobileTimelineTaskDetail['state']): string {
  switch (state) {
    case 'completed':
      return '任务已完成';
    case 'pending':
      return '任务待办';
    case 'missing':
      return '任务已不在当前清单';
    case 'unknown':
      return '任务状态待同步';
    case 'unlinked':
      return '未关联任务';
    case 'not-applicable':
      return '不适用';
  }
}

function TimelineIntervalDetail({
  interval,
  details,
  onClose,
}: {
  interval: DayLedgerInterval;
  details: readonly MobileTimelineTaskDetail[];
  onClose: () => void;
}) {
  const kind = interval.kind === 'focus' ? '专注' : interval.kind === 'pause' ? '暂停' : '空档';
  return (
    <aside className={`mobile-timeline-detail ${interval.kind}`} aria-label="时间段详情">
      <div className="mobile-timeline-detail-heading">
        <div>
          <span>{kind}时间段</span>
          <strong>
            {formatClockWithDate(interval.startedAt)}–{formatClockWithDate(interval.endedAt)}
          </strong>
        </div>
        <button type="button" className="icon-button" aria-label="关闭时间段详情" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <p className="mobile-timeline-detail-duration">
        持续 {formatClockDuration(interval.durationMs)}
      </p>
      {details.length > 0 && (
        <ul className="mobile-timeline-task-details">
          {details.map((detail) => (
            <li key={detail.key}>
              <span>{detail.title}</span>
              <strong className={`task-state-${detail.state}`}>
                {timelineTaskStateLabel(detail.state)}
              </strong>
            </li>
          ))}
        </ul>
      )}
      <p className="mobile-timeline-detail-note">
        任务状态来自最近任务同步；专注记录结束不代表任务自动完成。
      </p>
    </aside>
  );
}

function SelectedDaySummary({
  ledger,
  onClear,
}: {
  ledger: DayLedgerAnalytics;
  onClear: () => void;
}) {
  const focus = ledger.totals.focusMs + ledger.totals.estimatedFocusMs;
  const pause = ledger.totals.pauseMs + ledger.totals.estimatedPauseMs;
  return (
    <div className="selected-day-summary" role="status" aria-live="polite">
      <div>
        <span>已选日期</span>
        <strong>{formatFullDate(ledger.date)}</strong>
      </div>
      <dl>
        <div>
          <dt>专注</dt>
          <dd>{formatClockDuration(focus)}</dd>
        </div>
        <div>
          <dt>暂停</dt>
          <dd>{formatClockDuration(pause)}</dd>
        </div>
        <div>
          <dt>空档</dt>
          <dd>{formatClockDuration(ledger.totals.gapMs)}</dd>
        </div>
      </dl>
      <button type="button" className="selected-day-clear" onClick={onClear}>
        <X aria-hidden="true" />
        <span>返回范围</span>
      </button>
    </div>
  );
}

function formatLaneDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${hours >= 10 || Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h`;
}

function GapLedger({ ledger }: { ledger: DayLedgerAnalytics | undefined }) {
  return (
    <section className="dashboard-band mobile-gap-ledger" aria-labelledby="mobile-gap-title">
      <AnalyticsHeading
        id="mobile-gap-title"
        title="精确空档"
        detail={ledger?.date ?? '所选日期'}
      />
      {ledger && ledger.gaps.length > 0 ? (
        <ol>
          {ledger.gaps.map((gap) => (
            <li
              key={`${gap.startedAt}-${gap.endedAt}`}
              aria-label={`${formatClock(gap.startedAt)} 至 ${formatClock(gap.endedAt)}，空档 ${formatClockDuration(gap.durationMs)}`}
            >
              <time>{formatClock(gap.startedAt)}</time>
              <i aria-hidden="true" />
              <time>{formatClock(gap.endedAt)}</time>
              <strong>{formatClockDuration(gap.durationMs)}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p role="status">{gapEmptyMessage(ledger)}</p>
      )}
    </section>
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
            style={{ width: `${item.width}%`, '--allocation-alpha': item.alpha } as CSSProperties}
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

function MobileTimeBudget({
  focusMs,
  pauseMs,
  gapMs,
  focusRate,
  pauseRate,
  gapRate,
  estimated,
}: {
  focusMs: number;
  pauseMs: number;
  gapMs: number;
  focusRate: number;
  pauseRate: number;
  gapRate: number;
  estimated: boolean;
}) {
  return (
    <section className="dashboard-pause-cost" aria-label="专注、暂停与空档时间守恒">
      <div>
        <span>专注</span>
        <strong>{formatClockDuration(focusMs)}</strong>
      </div>
      <div>
        <span>暂停</span>
        <strong className="tone-pause">{formatClockDuration(pauseMs)}</strong>
      </div>
      <div>
        <span>空档</span>
        <strong>{formatClockDuration(gapMs)}</strong>
      </div>
      <div
        className="mobile-pause-cost-track"
        role="img"
        aria-label={`已分类时间${estimated ? '，含 estimated 旧记录' : ''}：专注 ${focusRate}%，暂停 ${pauseRate}%，空档 ${gapRate}%`}
      >
        <i className="focus" style={{ width: `${focusRate}%` }} />
        <i className="pause" style={{ left: `${focusRate}%`, width: `${pauseRate}%` }} />
        <i className="gap" style={{ left: `${focusRate + pauseRate}%`, width: `${gapRate}%` }} />
      </div>
    </section>
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

function dashboardConclusion(
  ledger: DayLedgerAnalytics | undefined,
  focusMs: number,
  gapMs: number,
): string {
  if (ledger?.status === 'estimated-only') {
    return '旧记录缺少精确边界，只保留 estimated 时长，不伪造空档。';
  }
  if (!ledger || ledger.status === 'not-started') {
    return ledger?.isToday ? '今日尚未启动，不把全天计算为空档。' : '所选日期没有真实专注起点。';
  }
  if (gapMs <= 0) return '观察区间连续，当前没有可列出的空档。';
  return `已记录 ${formatClockDuration(focusMs)} 专注；空档按共享日账本精确列出。`;
}

function gapEmptyMessage(ledger: DayLedgerAnalytics | undefined): string {
  if (!ledger) return '尚无共享日账本数据。';
  if (ledger.status === 'estimated-only') return '旧记录缺少精确边界，只显示 estimated 时长。';
  if (ledger.status === 'not-started') {
    return ledger.isToday ? '今日尚未启动，不把全天计算为空档。' : '当日没有真实专注起点。';
  }
  return '观察区间内没有空档。';
}

function intervalLabel(interval: DayLedgerInterval): string {
  const kind = interval.kind === 'focus' ? '专注' : interval.kind === 'pause' ? '暂停' : '空档';
  return `${kind} ${formatClock(interval.startedAt)}–${formatClock(interval.endedAt)}，${formatClockDuration(interval.durationMs)}`;
}

function sessionOverlaps(record: CachedBundle, bounds: { start: number; end: number }): boolean {
  const { session } = record.bundle;
  const end = session.endedAt ?? session.startedAt + Math.max(1, session.wallElapsedMs);
  return session.startedAt < bounds.end && end > bounds.start;
}

function dashboardScopeTitle(range: DashboardRangeChoice, selectedDate: string | null): string {
  if (selectedDate) return `${formatFullDate(selectedDate)}有效专注`;
  switch (range) {
    case 'today':
      return '今日有效专注';
    case 'yesterday':
      return '昨日有效专注';
    case 'custom':
      return '自定义范围有效专注';
    default:
      return '范围内有效专注';
  }
}

function formatRangeLabel(start: number, end: number, range: DashboardRangeChoice): string {
  if (range === 'today' || range === 'yesterday') return formatFullDate(dayKey(start));
  return `${formatShortDate(dayKey(start))} - ${formatShortDate(dayKey(end - 1))}`;
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatClockWithDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${formatClock(timestamp)}`;
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

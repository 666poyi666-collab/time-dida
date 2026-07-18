// 统计 Dashboard - 先给结论，再展开节律 / 去向 / 单次质量 / 当日轨迹。
// 数据全部来自只读的 sessions.analytics(range) 契约；零数据时渲染明确的空状态，
// 不用伪造柱形、环形或会话来填满画布。
import { useMemo, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import type { FocusSession } from '@shared/types';
import type { SessionAnalyticsResult, SessionAnalyticsTimelineItem } from '@shared/ipc/api';
import { Icon } from '../../ui/Icon';
import { formatClock, formatMinutes } from '../../lib/time';
import {
  groupByDay,
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
  /** 单日导航方向：-1 前一天 / 1 后一天 / 0 预设或自定义切换 */
  slideDirection: -1 | 0 | 1;
  /** 零状态里的快捷范围切换 */
  onSelectRange: (preset: RangePreset) => void;
}

interface DailyPoint {
  label: string;
  active: number;
  count: number;
}

interface HourlyPoint {
  hour: number;
  active: number;
  pause: number;
}

/** 轴标签：默认 M/D；范围跨年时补两位年份，保证跨年可读。 */
function shortDay(label: string, crossYear: boolean): string {
  const [year, month, day] = label.split('-');
  if (crossYear) return `${year.slice(2)}/${Number(month)}/${Number(day)}`;
  return `${Number(month)}/${Number(day)}`;
}

/** 无障碍与提示用的完整日期：2026年7月18日。 */
function fullDay(label: string): string {
  const [year, month, day] = label.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}

/** 单次强度标签：必须含完整开始–结束时间；跨年时补年份。 */
function sessionLabel(session: FocusSession, referenceYear: number): string {
  const start = new Date(session.startedAt);
  const end = new Date(session.endedAt ?? session.startedAt + session.wallElapsedMs);
  const date =
    start.getFullYear() !== referenceYear
      ? `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()}`
      : `${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  return `${date} ${formatClock(start.getTime())}–${formatClock(end.getTime())}`;
}

export function HistoryInsights({
  sessions,
  summary,
  range,
  analytics,
  slideDirection,
  onSelectRange,
}: HistoryInsightsProps) {
  const isEmpty = summary.count === 0;
  const tracked = Math.max(0, summary.active + summary.pause);
  const focusRatio = tracked > 0 ? (summary.active / tracked) * 100 : 0;
  const stability = analytics?.stability ?? null;
  // 单日范围内方差恒为 0，稳定分没有推断意义，降级为「—」并说明，不作误导性展示。
  const stabilityReady = !isEmpty && (stability?.calendarDays ?? 0) >= 2;

  // 范围切换：图表体按范围 key 重挂载，从基线连续重绘 + 带方向感的滑动；
  // 画布容器与表头保持挂载，避免整块闪烁。
  const rangeKey = `${range.start}-${range.end}`;
  const slideVars = {
    '--slide-x': `${slideDirection * 10}px`,
    '--slide-y': slideDirection === 0 ? '6px' : '0px',
  } as CSSProperties;

  return (
    <section
      className={`history-insights-grid${isEmpty ? ' is-empty' : ''}`}
      aria-label="专注数据图表"
    >
      <header className="history-visual-header">
        <div className="history-conclusion">
          <small>统计结论</small>
          <span>
            {isEmpty
              ? '这里会直接告诉你时间花在了哪里'
              : `${formatMinutes(summary.active)} 有效专注 · ${summary.count} 次 · 专注率 ${Math.round(focusRatio)}%`}
          </span>
          <p>
            {stabilityReady && stability
              ? `日均 ${formatMinutes(stability.averageDailyActiveMs)} · 活跃 ${stability.activeDays}/${stability.calendarDays} 天 · 稳定度 ${stability.score}`
              : isEmpty
                ? '完成一次专注后，结论、节律和时间去向会同时出现。'
                : '单日数据不推断稳定性；下方展示真实时段与每次专注质量。'}
          </p>
        </div>
        <div className="history-visual-summary">
          <span>
            <small>有效专注</small>
            <strong>{formatMinutes(summary.active)}</strong>
          </span>
          <span>
            <small>暂停</small>
            <strong className="pause">{formatMinutes(summary.pause)}</strong>
          </span>
          <span>
            <small>会话</small>
            <strong>{summary.count}</strong>
          </span>
          <span>
            <small>专注率</small>
            <strong>{isEmpty ? '—' : `${Math.round(focusRatio)}%`}</strong>
          </span>
        </div>
      </header>

      {isEmpty && (
        <div className="history-insights-empty state-block" role="status">
          <div className="state-block-icon">
            <Icon.Calendar size="lg" />
          </div>
          <p className="state-block-title">当前时间范围没有专注记录</p>
          <p className="state-block-desc">
            换一个时间范围，或回到专注页开始一次新的专注。产生记录后，节律、构成与时间轴会在这里展开。
          </p>
          <div className="state-block-actions">
            <button
              type="button"
              className="btn-outline motion-press"
              onClick={() => onSelectRange('7d')}
            >
              近 7 天
            </button>
            <button
              type="button"
              className="btn-outline motion-press"
              onClick={() => onSelectRange('15d')}
            >
              半个月
            </button>
            <button
              type="button"
              className="btn-outline motion-press"
              onClick={() => onSelectRange('30d')}
            >
              1 个月
            </button>
          </div>
        </div>
      )}

      {!isEmpty && (
        <>
          <DailyTrendCard
            sessions={sessions}
            range={range}
            analytics={analytics}
            isEmpty={false}
            rangeKey={rangeKey}
            slideVars={slideVars}
          />
          <TaskDestinationCard analytics={analytics} />
          <SessionRankCard sessions={sessions} isEmpty={false} rangeEnd={range.end} />
          <DayTimelineBand analytics={analytics} slideVars={slideVars} />
        </>
      )}
    </section>
  );
}

/* ── 每日专注趋势（柱 + 线 + 面积） + 任务去向 ─────────────── */

function DailyTrendCard({
  sessions,
  range,
  analytics,
  isEmpty,
  rangeKey,
  slideVars,
}: {
  sessions: FocusSession[];
  range: TimeRange;
  analytics: SessionAnalyticsResult | null;
  isEmpty: boolean;
  rangeKey: string;
  slideVars: CSSProperties;
}) {
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const daily: DailyPoint[] = useMemo(
    () =>
      analytics
        ? analytics.daily.map((item) => ({
            label: item.date,
            active: item.activeMs,
            count: item.sessionCount,
          }))
        : groupByDay(sessions, range).slice().reverse(),
    [analytics, range, sessions],
  );
  const maxDaily = Math.max(1, ...daily.map((item) => item.active));
  const averageDaily =
    daily.length === 0 ? 0 : daily.reduce((sum, item) => sum + item.active, 0) / daily.length;
  const crossYear =
    daily.length > 1 && daily[0].label.slice(0, 4) !== daily[daily.length - 1].label.slice(0, 4);
  const labelStep = daily.length > 16 ? 5 : daily.length > 9 ? 3 : 1;
  const chartCeiling = Math.max(1, maxDaily * 1.24);
  const chartPoints = daily.map((item, index) => {
    const x = daily.length === 1 ? 360 : 48 + index * (624 / Math.max(1, daily.length - 1));
    const y = 184 - (item.active / chartCeiling) * 144;
    return { ...item, x, y };
  });
  const trendPath = chartPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const areaPath = chartPoints.length
    ? `${trendPath} L ${chartPoints.at(-1)?.x ?? 672} 184 L ${chartPoints[0]?.x ?? 48} 184 Z`
    : '';
  const activePoint = chartPoints.find((point) => point.label === activeDay) ?? null;
  const hourly = useMemo<HourlyPoint[]>(() => {
    const start = new Date(range.start);
    start.setHours(0, 0, 0, 0);
    const dayStart = start.getTime();
    const bins = Array.from({ length: 24 }, (_, hour) => ({ hour, active: 0, pause: 0 }));
    for (const item of analytics?.timeline ?? []) {
      const itemStart = Math.max(item.startedAt, dayStart);
      const itemEnd = Math.min(
        item.endedAt ?? item.startedAt + item.durationMs,
        dayStart + 24 * 60 * 60_000,
      );
      for (let hour = 0; hour < 24; hour += 1) {
        const hourStart = dayStart + hour * 60 * 60_000;
        const overlap = Math.max(
          0,
          Math.min(itemEnd, hourStart + 60 * 60_000) - Math.max(itemStart, hourStart),
        );
        if (item.kind === 'focus') bins[hour].active += overlap;
        else bins[hour].pause += overlap;
      }
    }
    return bins;
  }, [analytics?.timeline, range.start]);
  const maxHourly = Math.max(1, ...hourly.map((item) => item.active + item.pause));
  const isSingleDay = daily.length === 1;

  return (
    <article className="history-insight-card history-daily-card">
      <header className="history-insight-header">
        <span>
          <Icon.BarChart size="sm" />
          {isSingleDay ? '今日专注节律' : '每日专注趋势'}
        </span>
        <small
          title={crossYear ? `${daily[0]?.label} ~ ${daily[daily.length - 1]?.label}` : undefined}
        >
          最高 {formatMinutes(maxDaily)}
        </small>
      </header>
      {isEmpty ? (
        // 空图表骨架：仅网格与等低骨架柱，明确是占位形态而非数据。
        <div className="history-column-chart is-skeleton" aria-hidden="true">
          <svg viewBox="0 0 720 224" preserveAspectRatio="none">
            {[40, 112, 184].map((y) => (
              <line key={y} className="history-chart-gridline" x1="48" x2="672" y1={y} y2={y} />
            ))}
            {chartPoints.map((point, index) => {
              const barWidth = Math.max(8, Math.min(28, 410 / Math.max(7, chartPoints.length)));
              const showLabel = index % labelStep === 0 || index === chartPoints.length - 1;
              return (
                <g key={point.label} className="history-column is-skeleton">
                  <rect
                    className="history-chart-bar"
                    x={point.x - barWidth / 2}
                    width={barWidth}
                    rx={barWidth / 2}
                    y={174}
                    height={10}
                  />
                  {showLabel && (
                    <text className="history-chart-label" x={point.x} y="214" textAnchor="middle">
                      {shortDay(point.label, crossYear)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      ) : isSingleDay ? (
        <div className="history-hourly-wrap">
          <div className="history-hourly-chart" role="list" aria-label="当天每小时专注与暂停分布">
            {hourly.map((point) => {
              const total = point.active + point.pause;
              const activeHeight = (point.active / maxHourly) * 100;
              const pauseHeight = (point.pause / maxHourly) * 100;
              const label = `${String(point.hour).padStart(2, '0')}:00，专注 ${formatMinutes(point.active)}，暂停 ${formatMinutes(point.pause)}`;
              return (
                <button
                  type="button"
                  className={`history-hourly-column ${total > 0 ? 'has-data' : ''}`}
                  key={point.hour}
                  role="listitem"
                  aria-label={label}
                  title={label}
                >
                  <span className="history-hourly-stack">
                    <motion.i
                      className="focus"
                      initial={{ height: 0 }}
                      animate={{ height: `${activeHeight}%` }}
                      transition={{ duration: 0.48, delay: point.hour * 0.012 }}
                    />
                    <motion.i
                      className="pause"
                      initial={{ height: 0 }}
                      animate={{ height: `${pauseHeight}%` }}
                      transition={{ duration: 0.48, delay: point.hour * 0.012 + 0.04 }}
                    />
                  </span>
                  {point.hour % 3 === 0 && <small>{String(point.hour).padStart(2, '0')}</small>}
                </button>
              );
            })}
          </div>
          <p className="history-chart-readout">
            24 小时真实分布 · 绿色为专注，琥珀斜纹为暂停 · 聚焦柱条读取精确值
          </p>
        </div>
      ) : (
        <>
          <div className="history-chart-slide" key={rangeKey} style={slideVars}>
            <div className="history-column-chart">
              <svg
                viewBox="0 0 720 224"
                preserveAspectRatio="none"
                role="list"
                aria-label="每日专注时长柱状图，Tab 可逐日读取"
              >
                <defs>
                  <linearGradient id="focus-chart-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--app-success))" stopOpacity="0.12" />
                    <stop offset="100%" stopColor="rgb(var(--app-success))" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="focus-chart-bar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--app-success))" />
                    <stop offset="100%" stopColor="rgb(var(--app-success))" stopOpacity="0.35" />
                  </linearGradient>
                </defs>
                {[40, 112, 184].map((y) => (
                  <line key={y} className="history-chart-gridline" x1="48" x2="672" y1={y} y2={y} />
                ))}
                {areaPath && <path className="history-chart-area" d={areaPath} />}
                {chartPoints.map((point, index) => {
                  const showLabel = index % labelStep === 0 || index === chartPoints.length - 1;
                  const barWidth = Math.max(8, Math.min(28, 410 / Math.max(7, chartPoints.length)));
                  const barHeight = point.active > 0 ? Math.max(5, 184 - point.y) : 2;
                  const readout = `${fullDay(point.label)}：专注 ${formatMinutes(point.active)}，${point.count} 次会话`;
                  return (
                    <g
                      key={point.label}
                      className={`history-column ${point.active > 0 ? 'has-data' : ''}`}
                      role="listitem"
                      tabIndex={0}
                      aria-label={readout}
                      onMouseEnter={() => setActiveDay(point.label)}
                      onMouseLeave={() => setActiveDay(null)}
                      onFocus={() => setActiveDay(point.label)}
                      onBlur={() => setActiveDay(null)}
                    >
                      <title>{readout}</title>
                      <motion.rect
                        className="history-chart-bar"
                        x={point.x - barWidth / 2}
                        width={barWidth}
                        rx={barWidth / 2}
                        initial={{ y: 184, height: 0, opacity: 0.28 }}
                        animate={{
                          y: 184 - barHeight,
                          height: barHeight,
                          opacity: point.active > 0 ? 1 : 0.34,
                        }}
                        transition={{
                          duration: 0.58,
                          delay: Math.min(index * 0.018, 0.22),
                          ease: [0.16, 1, 0.3, 1],
                        }}
                      />
                      {showLabel && (
                        <text
                          className="history-chart-label"
                          x={point.x}
                          y="214"
                          textAnchor="middle"
                        >
                          {shortDay(point.label, crossYear)}
                        </text>
                      )}
                    </g>
                  );
                })}
                {trendPath && (
                  <motion.path
                    className="history-chart-trend"
                    d={trendPath}
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  />
                )}
                {chartPoints
                  .filter((point) => point.active > 0)
                  .map((point) => (
                    <circle
                      key={`${point.label}-point`}
                      className="history-chart-point"
                      cx={point.x}
                      cy={point.y}
                      r="4"
                    />
                  ))}
              </svg>
              <span className="history-chart-scale top">{formatMinutes(chartCeiling)}</span>
              <span className="history-chart-scale bottom">0</span>
            </div>
          </div>
          <p className="history-chart-readout" aria-hidden="true">
            {activePoint
              ? `${fullDay(activePoint.label)} · 专注 ${formatMinutes(activePoint.active)} · ${activePoint.count} 次会话`
              : daily.length > 1
                ? `日均 ${formatMinutes(averageDaily)} · 最高 ${formatMinutes(maxDaily)} · 聚焦柱条可读精确值`
                : '移动指针或按 Tab 聚焦柱条，读取精确数值'}
          </p>
        </>
      )}
    </article>
  );
}

/* ── 时间去向：独立成块，不再埋在节律图下方。 ─────────────── */

function TaskDestinationCard({ analytics }: { analytics: SessionAnalyticsResult | null }) {
  const tasks = analytics?.tasks ?? [];
  const topTasks = tasks.slice(0, 6);
  const rest = tasks.slice(6);
  const maxTask = Math.max(1, ...topTasks.map((task) => task.activeMs));
  const total = tasks.reduce((sum, task) => sum + task.activeMs, 0);

  return (
    <article className="history-insight-card history-task-card">
      <header className="history-insight-header">
        <span>
          <Icon.ListTodo size="sm" />
          时间去向
        </span>
        <small>按任务聚合 · 共 {formatMinutes(total)}</small>
      </header>
      {topTasks.length === 0 ? (
        <p className="history-task-empty">范围内没有可聚合的任务片段。</p>
      ) : (
        <div className="history-task-distribution" role="list" aria-label="按任务聚合的专注时长">
          {topTasks.map((task, index) => (
            <div className="history-task-row" key={task.key} role="listitem">
              <span className="history-task-title" title={task.title}>
                {task.title}
              </span>
              <div className="history-task-track">
                <motion.i
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(4, (task.activeMs / maxTask) * 100)}%` }}
                  transition={{ duration: 0.5, delay: index * 0.04 }}
                />
              </div>
              <strong>{formatMinutes(task.activeMs)}</strong>
            </div>
          ))}
          {rest.length > 0 && <p className="history-task-more">另有 {rest.length} 个任务</p>}
        </div>
      )}
    </article>
  );
}

/* ── 单次专注强度排行 ─────────────────────────────────────── */

function SessionRankCard({
  sessions,
  isEmpty,
  rangeEnd,
}: {
  sessions: FocusSession[];
  isEmpty: boolean;
  rangeEnd: number;
}) {
  const longestSessions = useMemo(
    () =>
      sessions
        .slice()
        .sort((a, b) => b.activeElapsedMs - a.activeElapsedMs)
        .slice(0, 5),
    [sessions],
  );
  const referenceYear = new Date(rangeEnd).getFullYear();

  return (
    <article className="history-insight-card history-session-rank-card">
      <header className="history-insight-header">
        <span>
          <Icon.TrendingUp size="sm" />
          单次专注质量
        </span>
        <small>{isEmpty ? '暂无记录' : `最近高投入 ${longestSessions.length} 次`}</small>
      </header>
      {isEmpty ? (
        <div className="history-skel-rows" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="skeleton history-skel-line"
              style={{ width: `${92 - index * 18}%` }}
            />
          ))}
        </div>
      ) : (
        <div className="history-rank-list" role="list" aria-label="单次专注强度排行">
          {longestSessions.map((session, index) => {
            const label = sessionLabel(session, referenceYear);
            const pauseText =
              session.pauseElapsedMs > 0 ? `，暂停 ${formatMinutes(session.pauseElapsedMs)}` : '';
            const quality =
              session.wallElapsedMs > 0
                ? Math.round((session.activeElapsedMs / session.wallElapsedMs) * 100)
                : 0;
            return (
              <div
                className="history-rank-row"
                key={session.id}
                role="listitem"
                tabIndex={0}
                title={`${label} · 专注 ${formatMinutes(session.activeElapsedMs)}${pauseText}`}
                aria-label={`第 ${index + 1} 名：${label}，专注 ${formatMinutes(session.activeElapsedMs)}${pauseText}`}
              >
                <span className="history-rank-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="history-rank-content">
                  <div>
                    <span>{label}</span>
                    <strong>
                      {formatMinutes(session.activeElapsedMs)} · {quality}%
                    </strong>
                  </div>
                  <div className="history-rank-track">
                    <motion.i
                      initial={{ width: 0 }}
                      animate={{
                        width: `${Math.max(5, quality)}%`,
                      }}
                      transition={{
                        duration: 0.52,
                        delay: index * 0.045,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

/* ── 当天 Session/Segment/暂停混合时间轴 ───────────────────── */

interface TimelineEntry {
  item: SessionAnalyticsTimelineItem;
  start: number;
  end: number;
  left: number;
  width: number;
}

function DayTimelineBand({
  analytics,
  slideVars,
}: {
  analytics: SessionAnalyticsResult | null;
  slideVars: CSSProperties;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const timeline = analytics?.timeline ?? [];
  const timelineStart = analytics?.range.timelineStart ?? analytics?.range.start ?? 0;
  const timelineEnd = analytics?.range.timelineEnd ?? analytics?.range.end ?? 0;
  const span = Math.max(1, timelineEnd - timelineStart);
  const bandKey = `${timelineStart}-${timelineEnd}`;

  const dayDate = new Date(timelineStart);
  const dayLabel = dayDate.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  const weekday = dayDate.toLocaleDateString('zh-CN', { weekday: 'short' });
  const isToday = timelineStart > 0 && isSameLocalDay(timelineStart, Date.now());

  // 真实时钟定位：位置与宽度都按时间轴窗口比例计算，仅做最小可视宽度钳制。
  const entries: TimelineEntry[] = timeline.map((item) => {
    const start = Math.min(Math.max(item.startedAt, timelineStart), timelineEnd);
    const rawEnd = item.endedAt ?? Math.min(Date.now(), timelineEnd);
    const end = Math.min(Math.max(rawEnd, start), timelineEnd);
    const left = ((start - timelineStart) / span) * 100;
    const width = Math.min(Math.max(((end - start) / span) * 100, 0.9), 100 - left);
    return { item, start, end, left, width };
  });
  const active = entries.find((entry) => entry.item.id === activeId) ?? null;
  const focusCount = timeline.filter((item) => item.kind === 'focus').length;
  const pauseCount = timeline.length - focusCount;

  const describeEntry = (entry: TimelineEntry): string => {
    const kind = entry.item.kind === 'focus' ? '专注' : '暂停';
    const endText = entry.item.endedAt ? formatClock(entry.end) : '进行中';
    return `${kind} · ${entry.item.title} · ${formatClock(entry.start)}–${endText} · ${formatMinutes(entry.item.durationMs)}`;
  };

  const tickHours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
  const tickLabelHours = new Set([0, 6, 12, 18, 24]);

  return (
    <div className="history-timeline-band">
      <header className="history-insight-header">
        <span>
          <Icon.Activity size="sm" />
          当天时间轴
          <small className="history-timeline-day">
            {dayLabel} · {weekday}
            {isToday ? ' · 今天' : ''}
          </small>
        </span>
        <small>
          {entries.length > 0 ? `${focusCount} 段专注 · ${pauseCount} 次暂停` : '暂无记录'}
        </small>
      </header>
      <div className="history-chart-slide" key={bandKey} style={slideVars}>
        <div
          className={`history-mixed-timeline${entries.length === 0 ? ' is-empty' : ''}`}
          role="list"
          aria-label={`${dayLabel}的专注与暂停混合时间轴，Tab 可逐段读取`}
        >
          <div className="history-timeline-lane" aria-hidden="true" />
          {tickHours.map((hour) => (
            <i
              key={hour}
              className="history-timeline-tick"
              style={{ left: hour === 24 ? 'calc(100% - 1px)' : `${(hour / 24) * 100}%` }}
              aria-hidden="true"
            />
          ))}
          {tickHours
            .filter((hour) => tickLabelHours.has(hour))
            .map((hour) => (
              <span
                key={hour}
                className={`history-timeline-tick-label${hour === 0 ? ' is-first' : ''}${hour === 24 ? ' is-last' : ''}`}
                style={{ left: `${(hour / 24) * 100}%` }}
                aria-hidden="true"
              >
                {`${String(hour).padStart(2, '0')}:00`}
              </span>
            ))}
          {entries.map((entry, index) => (
            <div
              key={entry.item.id}
              className={`history-timeline-item ${entry.item.kind}`}
              role="listitem"
              tabIndex={0}
              style={{
                left: `${entry.left}%`,
                width: `${entry.width}%`,
                animationDelay: `${Math.min(index * 45, 400)}ms`,
              }}
              title={describeEntry(entry)}
              aria-label={describeEntry(entry)}
              onMouseEnter={() => setActiveId(entry.item.id)}
              onMouseLeave={() => setActiveId(null)}
              onFocus={() => setActiveId(entry.item.id)}
              onBlur={() => setActiveId(null)}
            >
              {entry.width > 8 && <span>{formatMinutes(entry.item.durationMs)}</span>}
            </div>
          ))}
        </div>
        <p className="history-timeline-readout" aria-hidden="true">
          {active ? (
            <>
              <i className={`kind-dot ${active.item.kind}`} />
              {describeEntry(active)}
            </>
          ) : entries.length > 0 ? (
            '移动指针或按 Tab 聚焦色块，读取每段的精确起止与时长'
          ) : (
            '这一天没有专注与暂停记录'
          )}
        </p>
      </div>
    </div>
  );
}

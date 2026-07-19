// 统计 Dashboard：熟悉的 KPI → 主趋势 → 时间去向 → 最近会话。
// 不再让用户先理解抽象图形或切换“分析玩法”；所有信息在一个明确阅读路径里完成。
import { useMemo } from 'react';
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

function duration(ms: number): string {
  return formatMinutes(Math.max(0, ms));
}

function percentage(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function HistoryInsights({
  sessions,
  summary,
  range,
  analytics,
  onSelectRange,
  onOpenSession,
}: HistoryInsightsProps) {
  const isEmpty = summary.count === 0;
  const singleDay = isSameLocalDay(range.start, range.end - 1);
  const tracked = Math.max(0, summary.active + summary.pause);
  const focusRate = percentage(summary.active, tracked);
  const average = summary.count > 0 ? summary.active / summary.count : 0;
  const longest = sessions.reduce((best, session) => Math.max(best, session.activeElapsedMs), 0);

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
    <section className="history-insights analytics-dashboard" aria-label="专注统计 Dashboard">
      <header className="analytics-heading">
        <div>
          <span className="analytics-eyebrow">{singleDay ? 'DAY REPORT' : 'RANGE REPORT'}</span>
          <h2>{singleDay ? '今天的专注概况' : '这段时间的专注概况'}</h2>
        </div>
        <p>
          {singleDay
            ? `你把 ${duration(summary.active)} 真正投入了专注。`
            : `${analytics?.stability.activeDays ?? 0} 个活跃日，共完成 ${summary.count} 次专注。`}
        </p>
      </header>

      <div className="analytics-kpis" aria-label="核心指标">
        <Kpi label="有效专注" value={duration(summary.active)} note="不含暂停" tone="accent" />
        <Kpi label="专注率" value={`${focusRate}%`} note="专注 ÷ 已记录时间" />
        <Kpi label="完成轮次" value={`${summary.count}`} note={`平均 ${duration(average)}`} />
        <Kpi
          label="最长一轮"
          value={duration(longest)}
          note={`暂停 ${duration(summary.pause)}`}
          tone="pause"
        />
      </div>

      <div className="analytics-grid">
        <div className="analytics-primary">
          {singleDay ? (
            <DayTimeline
              range={range}
              timeline={analytics?.timeline ?? []}
              onOpenSession={onOpenSession}
            />
          ) : (
            <DailyTrend daily={analytics?.daily ?? []} />
          )}
        </div>
        <TaskBreakdown analytics={analytics} totalActive={summary.active} />
      </div>

      <SessionTable sessions={sessions} onOpenSession={onOpenSession} />
    </section>
  );
}

function Kpi({
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
    <div className={`analytics-kpi tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function DayTimeline({
  range,
  timeline,
  onOpenSession,
}: {
  range: TimeRange;
  timeline: SessionAnalyticsTimelineItem[];
  onOpenSession?: (sessionId: string) => void;
}) {
  const dayStart = useMemo(() => {
    const day = new Date(range.start);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  }, [range.start]);
  const nowPosition = Math.min(100, Math.max(0, ((Date.now() - dayStart) / DAY_MS) * 100));

  return (
    <article className="analytics-panel analytics-day-panel">
      <div className="analytics-panel-head">
        <div>
          <span className="analytics-panel-kicker">24 小时</span>
          <h3>专注发生在什么时候</h3>
        </div>
        <div className="analytics-legend">
          <span className="is-focus">专注</span>
          <span className="is-pause">暂停</span>
        </div>
      </div>
      <div className="day-timeline weave-canvas" role="img" aria-label="今天 24 小时专注时间轴">
        <div className="day-timeline-hours" aria-hidden="true">
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => (
            <span key={hour} style={{ left: `${(hour / 24) * 100}%` }}>
              {String(hour).padStart(2, '0')}
            </span>
          ))}
        </div>
        <div className="day-timeline-grid" aria-hidden="true">
          {Array.from({ length: 25 }, (_, hour) => (
            <i key={hour} style={{ left: `${(hour / 24) * 100}%` }} />
          ))}
        </div>
        <div className="day-timeline-lane focus-lane">
          <span className="lane-label">专注</span>
          {timeline
            .filter((item) => item.kind === 'focus')
            .map((item) => (
              <TimelineSegment
                key={item.id}
                item={item}
                dayStart={dayStart}
                onOpenSession={onOpenSession}
              />
            ))}
        </div>
        <div className="day-timeline-lane pause-lane">
          <span className="lane-label">暂停</span>
          {timeline
            .filter((item) => item.kind === 'pause')
            .map((item) => (
              <TimelineSegment
                key={item.id}
                item={item}
                dayStart={dayStart}
                onOpenSession={onOpenSession}
              />
            ))}
        </div>
        {isSameLocalDay(dayStart, Date.now()) && (
          <span className="day-now" style={{ left: `${nowPosition}%` }} aria-label="现在">
            <i />
          </span>
        )}
      </div>
      <p className="analytics-caption">时间轴按真实开始与结束时间绘制；点击色块可展开对应会话。</p>
    </article>
  );
}

function TimelineSegment({
  item,
  dayStart,
  onOpenSession,
}: {
  item: SessionAnalyticsTimelineItem;
  dayStart: number;
  onOpenSession?: (sessionId: string) => void;
}) {
  const end = item.endedAt ?? item.startedAt + item.durationMs;
  const left = Math.max(0, ((item.startedAt - dayStart) / DAY_MS) * 100);
  const right = Math.min(100, ((end - dayStart) / DAY_MS) * 100);
  const width = Math.max(0.28, right - left);
  const title = `${item.kind === 'focus' ? '专注' : '暂停'} ${formatClock(item.startedAt)}–${formatClock(end)} · ${duration(item.durationMs)}${item.title ? ` · ${item.title}` : ''}`;
  return (
    <button
      type="button"
      className={`timeline-segment ${item.kind}`}
      style={{ left: `${left}%`, width: `${width}%` }}
      title={title}
      aria-label={title}
      onClick={() => onOpenSession?.(item.sessionId)}
    />
  );
}

function DailyTrend({ daily }: { daily: SessionAnalyticsResult['daily'] }) {
  const max = Math.max(1, ...daily.map((day) => day.activeMs + day.pauseMs));
  return (
    <article className="analytics-panel analytics-trend-panel">
      <div className="analytics-panel-head">
        <div>
          <span className="analytics-panel-kicker">每日趋势</span>
          <h3>投入是否持续</h3>
        </div>
        <span className="analytics-panel-note">强调色 = 专注 · 红色 = 暂停</span>
      </div>
      <div className="daily-trend matrix-canvas" role="img" aria-label="每日专注与暂停趋势">
        {daily.map((day) => {
          return (
            <div
              className="daily-column"
              key={day.date}
              title={`${day.date} · 专注 ${duration(day.activeMs)} · 暂停 ${duration(day.pauseMs)}`}
            >
              <div className="daily-value">{day.activeMs > 0 ? duration(day.activeMs) : '—'}</div>
              <div className="daily-bar-track">
                <span
                  className="daily-bar-pause"
                  style={{ height: `${(day.pauseMs / max) * 100}%` }}
                />
                <span
                  className="daily-bar-focus"
                  style={{ height: `${(day.activeMs / max) * 100}%` }}
                />
              </div>
              <span className="daily-label">{day.date.slice(5).replace('-', '/')}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function TaskBreakdown({
  analytics,
  totalActive,
}: {
  analytics: SessionAnalyticsResult | null;
  totalActive: number;
}) {
  const tasks = useMemo(
    () =>
      (analytics?.tasks ?? [])
        .slice()
        .sort((a, b) => b.activeMs - a.activeMs)
        .slice(0, 6),
    [analytics],
  );
  const max = Math.max(1, ...tasks.map((task) => task.activeMs));
  return (
    <article className="analytics-panel analytics-tasks-panel">
      <div className="analytics-panel-head">
        <div>
          <span className="analytics-panel-kicker">时间去向</span>
          <h3>专注投入了什么</h3>
        </div>
      </div>
      <div className="task-ranking mosaic">
        {tasks.map((task, index) => (
          <div className="task-ranking-row" key={task.key}>
            <span className="task-rank">{String(index + 1).padStart(2, '0')}</span>
            <div className="task-ranking-main">
              <div className="task-ranking-copy">
                <strong>{task.title}</strong>
                <span>{percentage(task.activeMs, totalActive)}%</span>
              </div>
              <div className="task-ranking-track">
                <i style={{ width: `${(task.activeMs / max) * 100}%` }} />
              </div>
            </div>
            <span className="task-ranking-time">{duration(task.activeMs)}</span>
          </div>
        ))}
        {tasks.length === 0 && <p className="analytics-empty-copy">还没有可归类的任务时间。</p>}
      </div>
    </article>
  );
}

function SessionTable({
  sessions,
  onOpenSession,
}: {
  sessions: FocusSession[];
  onOpenSession?: (sessionId: string) => void;
}) {
  const rows = sessions
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 6);
  const max = Math.max(1, ...rows.map((session) => session.activeElapsedMs));
  return (
    <article className="analytics-panel analytics-sessions-panel beads-canvas">
      <div className="analytics-panel-head">
        <div>
          <span className="analytics-panel-kicker">最近会话</span>
          <h3>每一轮是否有效</h3>
        </div>
        <span className="analytics-panel-note">按开始时间倒序</span>
      </div>
      <div className="session-performance-head" aria-hidden="true">
        <span>开始</span>
        <span>任务</span>
        <span>有效专注</span>
        <span>专注率</span>
        <span>暂停</span>
      </div>
      <div className="session-performance-list">
        {rows.map((session) => {
          const tracked = session.activeElapsedMs + session.pauseElapsedMs;
          const rate = percentage(session.activeElapsedMs, tracked);
          return (
            <button
              type="button"
              className="session-performance-row"
              key={session.id}
              onClick={() => onOpenSession?.(session.id)}
            >
              <span className="session-start">{formatClock(session.startedAt)}</span>
              <strong title={session.defaultTaskTitle ?? '未关联任务'}>
                {session.defaultTaskTitle ?? '未关联任务'}
              </strong>
              <span className="session-duration-cell">
                <i style={{ width: `${(session.activeElapsedMs / max) * 100}%` }} />
                <b>{duration(session.activeElapsedMs)}</b>
              </span>
              <span className="session-rate">{rate}%</span>
              <span className="session-pause">{duration(session.pauseElapsedMs)}</span>
            </button>
          );
        })}
      </div>
    </article>
  );
}

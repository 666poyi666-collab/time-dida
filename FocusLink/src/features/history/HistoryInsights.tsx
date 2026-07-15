import { useMemo, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import type { FocusSession } from '@shared/types';
import { Icon } from '../../ui/Icon';
import { formatMinutes } from '../../lib/time';
import { groupByDay, type SessionSummary, type TimeRange } from './historyStats';

interface HistoryInsightsProps {
  sessions: FocusSession[];
  summary: SessionSummary;
  range: TimeRange;
}

function shortDay(label: string): string {
  const [, month, day] = label.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function sessionLabel(session: FocusSession): string {
  const date = new Date(session.startedAt);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

export function HistoryInsights({ sessions, summary, range }: HistoryInsightsProps) {
  const daily = useMemo(() => groupByDay(sessions, range).slice().reverse(), [range, sessions]);
  const longestSessions = useMemo(
    () =>
      sessions
        .slice()
        .sort((a, b) => b.activeElapsedMs - a.activeElapsedMs)
        .slice(0, 5),
    [sessions],
  );

  const tracked = Math.max(1, summary.active + summary.pause);
  const focusRatio = summary.active > 0 ? (summary.active / tracked) * 100 : 0;
  const pauseRatio = summary.pause > 0 ? (summary.pause / tracked) * 100 : 0;
  const maxDaily = Math.max(1, ...daily.map((item) => item.active));
  const maxSession = Math.max(1, ...longestSessions.map((item) => item.activeElapsedMs));
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
  const ringStyle = {
    '--focus-angle': `${focusRatio * 3.6}deg`,
    '--pause-angle': `${(focusRatio + pauseRatio) * 3.6}deg`,
  } as CSSProperties;

  return (
    <section className="history-insights-grid" aria-label="专注数据图表">
      <header className="history-visual-header">
        <div>
          <span>专注脉络</span>
          <small>从时间构成到每日节奏</small>
        </div>
        <div className="history-visual-summary">
          <span>
            <small>有效专注</small>
            <strong>{formatMinutes(summary.active)}</strong>
          </span>
          <span>
            <small>会话</small>
            <strong>{summary.count}</strong>
          </span>
          <span>
            <small>专注率</small>
            <strong>{Math.round(focusRatio)}%</strong>
          </span>
        </div>
      </header>
      <article className="history-insight-card history-focus-ring-card">
        <header className="history-insight-header">
          <span>
            <Icon.PieChart size="sm" />
            时间构成
          </span>
          <small>{summary.count} 次记录</small>
        </header>
        <div className="history-focus-ring-wrap">
          <motion.div
            className="history-focus-ring"
            style={ringStyle}
            initial={{ rotate: -18, scale: 0.92, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            <div>
              <strong>{Math.round(focusRatio)}%</strong>
              <span>有效专注</span>
            </div>
          </motion.div>
          <div className="history-ring-legend">
            <span className="focus">
              <i />
              专注 <strong>{formatMinutes(summary.active)}</strong>
            </span>
            <span className="pause">
              <i />
              暂停 <strong>{formatMinutes(summary.pause)}</strong>
            </span>
          </div>
        </div>
      </article>

      <article className="history-insight-card history-daily-card">
        <header className="history-insight-header">
          <span>
            <Icon.BarChart size="sm" />
            每日专注趋势
          </span>
          <small>最高 {formatMinutes(maxDaily)}</small>
        </header>
        <div className="history-column-chart" role="img" aria-label="每日专注时长柱线组合图">
          <svg viewBox="0 0 720 224" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="focus-chart-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(var(--app-accent))" stopOpacity="0.2" />
                <stop offset="100%" stopColor="rgb(var(--app-accent))" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="focus-chart-bar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(var(--app-accent))" />
                <stop
                  offset="100%"
                  stopColor="rgb(var(--app-accent-companion))"
                  stopOpacity="0.54"
                />
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
              return (
                <g
                  key={point.label}
                  className={`history-column ${point.active > 0 ? 'has-data' : ''}`}
                >
                  <title>{`${point.label} · ${formatMinutes(point.active)} · ${point.count} 次`}</title>
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
                    <text className="history-chart-label" x={point.x} y="214" textAnchor="middle">
                      {shortDay(point.label)}
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
      </article>

      <article className="history-insight-card history-session-rank-card">
        <header className="history-insight-header">
          <span>
            <Icon.TrendingUp size="sm" />
            单次专注强度
          </span>
          <small>最长 5 次</small>
        </header>
        <div className="history-rank-list">
          {longestSessions.map((session, index) => (
            <div className="history-rank-row" key={session.id}>
              <span className="history-rank-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="history-rank-content">
                <div>
                  <span>{sessionLabel(session)}</span>
                  <strong>{formatMinutes(session.activeElapsedMs)}</strong>
                </div>
                <div className="history-rank-track">
                  <motion.i
                    initial={{ width: 0 }}
                    animate={{
                      width: `${Math.max(5, (session.activeElapsedMs / maxSession) * 100)}%`,
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
          ))}
        </div>
      </article>
    </section>
  );
}

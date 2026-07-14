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
  const ringStyle = {
    '--focus-angle': `${focusRatio * 3.6}deg`,
    '--pause-angle': `${(focusRatio + pauseRatio) * 3.6}deg`,
  } as CSSProperties;

  return (
    <section className="history-insights-grid" aria-label="专注数据图表">
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
        <div className="history-column-chart" role="img" aria-label="每日专注时长柱状图">
          <div className="history-chart-guide top" />
          <div className="history-chart-guide middle" />
          {daily.map((item, index) => {
            const height = item.active > 0 ? Math.max(7, (item.active / maxDaily) * 100) : 2;
            const showLabel = index % labelStep === 0 || index === daily.length - 1;
            return (
              <div
                key={item.label}
                className={`history-column ${item.active > 0 ? 'has-data' : ''}`}
                title={`${item.label} · ${formatMinutes(item.active)} · ${item.count} 次`}
              >
                <div className="history-column-track">
                  <motion.i
                    initial={{ height: 0, opacity: 0.25 }}
                    animate={{ height: `${height}%`, opacity: 1 }}
                    transition={{
                      duration: 0.48,
                      delay: Math.min(index * 0.018, 0.22),
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                </div>
                <span>{showLabel ? shortDay(item.label) : ''}</span>
              </div>
            );
          })}
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

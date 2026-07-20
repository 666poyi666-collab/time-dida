import { useMemo, useState } from 'react';
import type { DeviceSyncSessionBundle } from '@shared/sync/deviceProtocol';
import type { CachedBundle } from './cache';
import { formatClockDuration } from './runtimeModel';

export interface SessionLedgerProps {
  records: readonly CachedBundle[];
  ready: boolean;
  configured: boolean;
  lastSyncAt: number | null;
  cursor: string | null;
}

export function SessionLedger({
  records,
  ready,
  configured,
  lastSyncAt,
  cursor,
}: SessionLedgerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const totals = useMemo(() => summarize(records), [records]);

  const toggleExpanded = (entityId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  };

  return (
    <section className="ledger-section" aria-labelledby="session-ledger-title">
      <header className="section-heading">
        <div>
          <p className="eyebrow">COMPLETED LEDGER</p>
          <h2 id="session-ledger-title">已结束账本</h2>
        </div>
        <span>{records.length} 场本机副本</span>
      </header>

      <div className="summary-band" aria-label="已结束会话汇总">
        <SummaryMetric label="有效专注" value={formatClockDuration(totals.activeMs)} tone="focus" />
        <SummaryMetric label="累计暂停" value={formatClockDuration(totals.pauseMs)} tone="pause" />
        <SummaryMetric label="会话" value={`${totals.sessions} 场`} />
        <SummaryMetric label="专注率" value={formatPercent(totals.focusRate)} />
      </div>

      {!ready ? (
        <LedgerSkeleton />
      ) : records.length === 0 ? (
        <EmptyLedger configured={configured} />
      ) : (
        <div className="ledger-list">
          {records.map((record, index) => (
            <SessionLedgerRow
              key={record.entityId}
              record={record}
              ordinal={records.length - index}
              expanded={expanded.has(record.entityId)}
              onToggle={() => toggleExpanded(record.entityId)}
            />
          ))}
        </div>
      )}

      <footer className="ledger-footer">
        <div>
          <span>上次账本确认</span>
          <strong>{lastSyncAt ? formatDateTime(lastSyncAt) : '尚未确认'}</strong>
        </div>
        <div>
          <span>本机游标</span>
          <strong className="cursor-value">{cursor ? compactId(cursor) : '初始'}</strong>
        </div>
      </footer>
    </section>
  );
}

function SessionLedgerRow({
  record,
  ordinal,
  expanded,
  onToggle,
}: {
  record: CachedBundle;
  ordinal: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { session, segments, pauses } = record.bundle;
  const taskContext = sessionTaskContext(record.bundle);
  const focusRate = session.wallElapsedMs > 0 ? session.activeElapsedMs / session.wallElapsedMs : 0;
  const timeline = useMemo(() => {
    return [
      ...segments.map((segment) => ({
        id: segment.id,
        type: 'focus' as const,
        startedAt: segment.startedAt,
        durationMs: segment.activeElapsedMs,
        title: segment.title?.trim() || '未关联任务',
        associated: Boolean(segment.taskId),
      })),
      ...pauses.map((pause) => ({
        id: pause.id,
        type: 'pause' as const,
        startedAt: pause.pauseStartedAt,
        durationMs: pause.durationMs,
        title: pause.reason?.trim() || '暂停',
        associated: false,
      })),
    ].sort((left, right) => left.startedAt - right.startedAt);
  }, [pauses, segments]);

  return (
    <article className={`session-row ${expanded ? 'expanded' : ''}`}>
      <button className="session-summary" type="button" onClick={onToggle} aria-expanded={expanded}>
        <span className="session-index">{String(ordinal).padStart(2, '0')}</span>
        <span className="session-date">
          <strong>{formatDay(session.startedAt)}</strong>
          <small>{formatTime(session.startedAt)}</small>
        </span>
        <span className="session-main">
          <strong>{taskContext.title}</strong>
          <small>{taskContext.associationLabel}</small>
        </span>
        <span className="session-duration">
          <strong>{formatClockDuration(session.activeElapsedMs)}</strong>
          <small>有效专注</small>
        </span>
        <ChevronIcon expanded={expanded} />
      </button>

      {expanded && (
        <div className="session-detail">
          <div className="detail-metrics">
            <DetailMetric
              label="专注"
              value={formatClockDuration(session.activeElapsedMs)}
              tone="focus"
            />
            <DetailMetric
              label="暂停"
              value={formatClockDuration(session.pauseElapsedMs)}
              tone="pause"
            />
            <DetailMetric label="总历时" value={formatClockDuration(session.wallElapsedMs)} />
            <DetailMetric label="专注率" value={formatPercent(focusRate)} />
          </div>
          <div className="detail-meta">
            <span>{session.status === 'aborted' ? '已中止' : '已结束'}</span>
            <span>版本 {record.revision}</span>
            <span>{segments.length} 个专注片段</span>
          </div>
          <div className="timeline-list">
            {timeline.length === 0 ? (
              <p className="timeline-empty">这场会话没有片段明细。</p>
            ) : (
              timeline.map((item, index) => (
                <div className={`timeline-row type-${item.type}`} key={item.id}>
                  <span className="timeline-spine">
                    <i />
                  </span>
                  <span className="timeline-time">{formatTime(item.startedAt)}</span>
                  <span className="timeline-title">
                    <strong>
                      {item.type === 'focus'
                        ? `专注 ${String(index + 1).padStart(2, '0')}`
                        : '暂停'}
                    </strong>
                    <small>{item.title}</small>
                  </span>
                  <span className="timeline-link">
                    {item.type === 'pause' ? '暂停段' : item.associated ? '已关联' : '未关联'}
                  </span>
                  <span className="timeline-duration">{formatClockDuration(item.durationMs)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function SummaryMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'focus' | 'pause';
}) {
  return (
    <div className={`summary-metric ${tone ? `tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'focus' | 'pause';
}) {
  return (
    <div className={`detail-metric ${tone ? `tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyLedger({ configured }: { configured: boolean }) {
  return (
    <div className="empty-ledger">
      <span className="empty-mark">00</span>
      <strong>{configured ? '云端还没有已结束会话' : '连接后查看多端会话'}</strong>
      <p>
        {configured
          ? '结束一场专注后，完成账本会自动收敛到这里；断网时仍可查看本机缓存。'
          : '配置同步服务地址和访问令牌，实时控制与已结束账本使用同一账号连接。'}
      </p>
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div className="ledger-skeleton" aria-label="正在读取缓存">
      <i />
      <i />
      <i />
    </div>
  );
}

function summarize(records: readonly CachedBundle[]) {
  const result = records.reduce(
    (total, record) => {
      total.activeMs += record.bundle.session.activeElapsedMs;
      total.pauseMs += record.bundle.session.pauseElapsedMs;
      total.wallMs += record.bundle.session.wallElapsedMs;
      return total;
    },
    { activeMs: 0, pauseMs: 0, wallMs: 0 },
  );
  return {
    ...result,
    sessions: records.length,
    focusRate: result.wallMs > 0 ? result.activeMs / result.wallMs : 0,
  };
}

function sessionTaskContext(bundle: DeviceSyncSessionBundle): {
  title: string;
  associationLabel: string;
} {
  const linkedSegments = bundle.segments.filter((segment) => segment.taskId);
  const firstLinked = linkedSegments.find((segment) => segment.title?.trim());
  const title =
    bundle.session.defaultTaskTitle?.trim() ||
    firstLinked?.title?.trim() ||
    bundle.session.title?.trim() ||
    '未命名专注';

  if (bundle.session.defaultTaskId) return { title, associationLabel: '本次默认任务已关联' };
  if (linkedSegments.length > 0) {
    return {
      title,
      associationLabel: `${linkedSegments.length}/${bundle.segments.length} 个片段已关联`,
    };
  }
  return { title, associationLabel: '未关联' };
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatDay(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(timestamp);
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function compactId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className={`chevron ${expanded ? 'expanded' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8 10 4 4 4-4" />
    </svg>
  );
}

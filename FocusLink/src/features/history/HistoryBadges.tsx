// 历史记录 - 状态徽章 + 统计小组件
import { Icon } from '../../ui/Icon';
import { formatDuration, formatDateTime } from '../../lib/time';
import type { FocusSession, FocusSegment } from '@shared/types';
import type { SessionSyncState } from './syncPresentation';

export { SyncBadge } from './HistoryTimeline';

export function SessionLinkPreview({
  session,
  segments,
}: {
  session: FocusSession;
  segments?: FocusSegment[];
}) {
  if (segments) {
    const linked = segments.filter((seg) => seg.taskId && seg.taskSource);
    const ticktick = linked.filter((seg) => seg.taskSource === 'ticktick');
    if (ticktick.length > 0) {
      return (
        <span className="status-chip border-success/25 bg-success/10 text-success">
          <Icon.CheckCircleFilled size="xs" /> 已关联滴答 {ticktick.length} 段
        </span>
      );
    }
    if (linked.length > 0) {
      return (
        <span className="status-chip border-border/60 bg-bg-subtle/60 text-fg-subtle">
          <Icon.Link size="xs" /> 已关联本地 {linked.length} 段
        </span>
      );
    }
    return (
      <span className="status-chip border-warning/25 bg-warning/10 text-warning">
        <Icon.Link size="xs" /> 片段未关联
      </span>
    );
  }
  const ticktickCount = session.ticktickLinkedSegmentCount ?? 0;
  const linkedCount = session.linkedSegmentCount ?? 0;
  const segmentCount = session.segmentCount ?? 0;
  if (ticktickCount > 0) {
    return (
      <span className="status-chip border-success/25 bg-success/10 text-success">
        <Icon.CheckCircleFilled size="xs" /> 已关联滴答 {ticktickCount} 段
      </span>
    );
  }
  if (linkedCount > 0) {
    return (
      <span className="status-chip border-border/60 bg-bg-subtle/60 text-fg-subtle">
        <Icon.Link size="xs" /> 已关联本地 {linkedCount} 段
      </span>
    );
  }
  if (segmentCount > 0) {
    return (
      <span className="status-chip border-warning/25 bg-warning/10 text-warning">
        <Icon.Link size="xs" /> 片段未关联
      </span>
    );
  }
  if (session.defaultTaskSource === 'local') {
    return (
      <span className="status-chip border-border/60 bg-bg-subtle/60 text-fg-subtle">
        <Icon.Link size="xs" /> 本地记录
      </span>
    );
  }
  if (session.defaultTaskSource === 'ticktick') {
    return (
      <span className="status-chip border-success/25 bg-success/10 text-success">
        <Icon.CheckCircleFilled size="xs" /> 默认任务已关联
      </span>
    );
  }
  return (
    <span className="status-chip border-border/60 bg-bg-subtle/60 text-fg-subtle">
      <Icon.Link size="xs" /> 展开查看片段
    </span>
  );
}

export interface SessionDetail {
  session: FocusSession;
  segments: FocusSegment[];
  pauses: import('@shared/types').PauseEvent[];
}

export function SessionDetailHeader({
  detail,
  syncState,
  syncing,
  syncMode,
}: {
  detail: SessionDetail;
  syncState: SessionSyncState;
  syncing: boolean;
  syncMode: 'focus-record' | 'comment' | 'local-only';
}) {
  const { session, segments, pauses } = detail;
  const linked = segments.filter((seg) => seg.taskId && seg.taskSource);
  const ticktick = linked.filter((seg) => seg.taskSource === 'ticktick');
  const unlinked = Math.max(0, segments.length - linked.length);
  const ticktickMs = ticktick.reduce((sum, seg) => sum + seg.activeElapsedMs, 0);

  return (
    <div className="rounded-lg border border-border/60 bg-bg-subtle/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="timer-digit text-[15px] font-semibold text-fg">
              {formatDuration(session.activeElapsedMs)}
            </p>
            {session.endedAt && session.wallElapsedMs > session.activeElapsedMs + 60000 ? (
              <span className="text-[11px] text-fg-subtle">
                {formatDateTime(session.startedAt)} 开始 · 专注{' '}
                {formatDuration(session.activeElapsedMs)} · 总历时{' '}
                {formatDuration(session.wallElapsedMs)}
              </span>
            ) : (
              <span className="text-[11px] text-fg-subtle">
                {formatDateTime(session.startedAt)}
                {session.endedAt && ` - ${formatDateTime(session.endedAt)}`}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <TinyStatusChip
              tone="ok"
              icon={<Icon.CheckCircleFilled size="xs" />}
              text="本地已保存"
              title="Session、专注片段、暂停片段已写入本地 SQLite"
            />
            <TinyStatusChip
              tone={
                syncMode === 'local-only'
                  ? 'muted'
                  : syncing
                    ? 'warn'
                    : syncState.tone === 'ok'
                      ? 'ok'
                      : ticktick.length > 0
                        ? 'warn'
                        : 'muted'
              }
              icon={<Icon.Refresh size="xs" />}
              text={
                syncing
                  ? '滴答同步中'
                  : syncMode === 'local-only'
                    ? '滴答同步已关闭'
                    : syncState.tone === 'ok'
                      ? `滴答已同步 · ${formatDuration(ticktickMs)}`
                      : ticktick.length > 0
                        ? `滴答未同步 · ${ticktick.length} 段`
                        : '无滴答片段'
              }
              title={
                syncing
                  ? '正在处理同步队列'
                  : syncMode === 'local-only'
                    ? '当前同步模式为仅本地'
                    : syncState.tone === 'ok'
                      ? '最近一次同步已完成'
                      : ticktick.length > 0
                        ? '已有滴答关联片段，但还没有成功同步记录'
                        : '当前没有关联到滴答任务的专注片段'
              }
            />
            <TinyStatusChip
              tone={unlinked > 0 ? 'warn' : 'muted'}
              icon={<Icon.AlertCircle size="xs" />}
              text={unlinked > 0 ? `未关联 ${unlinked}` : '片段已关联'}
            />
          </div>
        </div>
        <div className="grid min-w-[240px] flex-1 grid-cols-3 gap-1.5 sm:flex-none">
          <TinyStat label="总历时" value={formatDuration(session.wallElapsedMs)} />
          <TinyStat label="暂停" value={formatDuration(session.pauseElapsedMs)} tone="pause" />
          <TinyStat label="片段" value={`${segments.length}+${pauses.length}`} />
        </div>
      </div>
    </div>
  );
}

export function TinyStatusChip({
  tone,
  icon,
  text,
  title,
}: {
  tone: 'ok' | 'warn' | 'muted';
  icon: React.ReactNode;
  text: string;
  title?: string;
}) {
  const cls =
    tone === 'ok'
      ? 'border-success/20 bg-success/10 text-success'
      : tone === 'warn'
        ? 'border-warning/25 bg-warning/10 text-warning'
        : 'border-border/60 bg-bg-card/50 text-fg-subtle';
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium ${cls}`}
    >
      {icon}
      {text}
    </span>
  );
}

export function TinyStat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warning' | 'pause';
}) {
  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        tone === 'warning'
          ? 'border-warning/25 bg-warning/10'
          : tone === 'pause'
            ? 'border-pause/20 bg-pause/10'
            : 'border-border/60 bg-bg-card/50'
      }`}
    >
      <div
        className={`timer-digit text-[12px] font-semibold ${
          tone === 'warning' ? 'text-warning' : tone === 'pause' ? 'text-pause' : 'text-fg'
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10.5px] font-medium text-fg-subtle">{label}</div>
    </div>
  );
}

export function DetailStat({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: string;
  tone?: 'muted' | 'warn' | 'pause';
}) {
  const cls =
    tone === 'warn'
      ? 'border-warning/25 bg-warning/10'
      : tone === 'pause'
        ? 'border-pause/20 bg-pause/10'
        : 'border-border/60 bg-bg-subtle/30';
  const textCls = tone === 'warn' ? 'text-warning' : tone === 'pause' ? 'text-pause' : 'text-fg';
  return (
    <div className={`motion-base rounded-md border px-2.5 py-2 text-left ${cls}`}>
      <div className={`timer-digit text-[13px] font-semibold ${textCls}`}>{value}</div>
      <div className="mt-0.5 text-[10.5px] font-medium text-fg-subtle">{label}</div>
    </div>
  );
}

// 次级片段操作区。
export function BatchLinkPanel({
  segments,
  linking,
  filter,
  onFilterChange,
  onBatchUnlinked,
  onBatchAll,
}: {
  segments: FocusSegment[];
  linking: boolean;
  filter: 'all' | 'unlinked' | 'linked';
  onFilterChange: (f: 'all' | 'unlinked' | 'linked') => void;
  onBatchUnlinked: () => void;
  onBatchAll: () => void;
}) {
  const unlinkedCount = segments.filter((s) => !s.taskId || !s.taskSource).length;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 flex items-center gap-1 text-[10.5px] font-medium text-fg-subtle">
        <Icon.Filter size="xs" />
        片段
      </span>
      <button
        className="btn-outline motion-press !text-[11px] !min-h-[28px] !py-1 !px-2.5"
        disabled={linking || unlinkedCount === 0}
        onClick={onBatchUnlinked}
        title={unlinkedCount === 0 ? '没有未关联片段' : '只更新未关联任务的 segment'}
      >
        <Icon.Refresh size="xs" />
        关联未关联片段{unlinkedCount > 0 ? `（${unlinkedCount}）` : ''}
      </button>
      <button
        className="btn-ghost motion-press !text-[11px] !min-h-[28px] !py-1 !px-2.5"
        disabled={linking || segments.length === 0}
        onClick={onBatchAll}
        title="覆盖所有 segment（含已关联），需确认"
      >
        <Icon.Link size="xs" />
        全部设为同一任务
      </button>
      <div className="ml-auto flex items-center gap-0.5 rounded-md border border-border/50 bg-bg-card/40 p-0.5">
        <FilterChip active={filter === 'all'} onClick={() => onFilterChange('all')} label="全部" />
        <FilterChip
          active={filter === 'unlinked'}
          onClick={() => onFilterChange('unlinked')}
          label="未关联"
        />
        <FilterChip
          active={filter === 'linked'}
          onClick={() => onFilterChange('linked')}
          label="已关联"
        />
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      className={`motion-base rounded px-2 py-0.5 text-[10.5px] font-medium transition-colors ${
        active ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

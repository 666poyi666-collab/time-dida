// 历史时间线 - 片段时间线列表 + 专注行 + 暂停行
import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { Icon } from '../../ui/Icon';
import { formatDuration, formatDateTime } from '../../lib/time';
import { NOT_SYNCED_STATE, type SessionSyncState } from './syncPresentation';
import { inferTomatodoSubject, resolveSegmentSubject } from '@shared/tomatodoPolicy';
import { TomatodoSubjectChips } from './TomatodoSubjectChips';
import type { FocusSegment, PauseEvent, TomatodoSubject } from '@shared/types';

export interface TomatodoSegmentStatus {
  subject: TomatodoSubject;
  synced: boolean;
  writtenLocally: boolean;
  cloudSynced: boolean;
  state: 'not-written' | 'local-pending' | 'cloud-synced';
  source: 'manual' | 'auto' | 'fallback';
}

export type SegmentFilter = 'all' | 'unlinked' | 'linked';

type HistoryTimelineItem =
  | { type: 'focus'; segment: FocusSegment; index: number; startedAt: number }
  | { type: 'pause'; pause: PauseEvent; index: number; startedAt: number };

export function HistoryTimelineList({
  sessionId,
  segments,
  pauses,
  filter,
  linking,
  defaultSubject,
  onLink,
  onClear,
  onComplete,
  onResync,
  onSetSubject,
  tomatodoStatus,
  syncStates,
  syncMode,
  tomatodoEnabled,
  completedTaskIds,
}: {
  sessionId: string;
  segments: FocusSegment[];
  pauses: PauseEvent[];
  filter: SegmentFilter;
  linking: boolean;
  defaultSubject: TomatodoSubject;
  onLink: (segmentId: string, index: number) => void;
  onClear: (segmentId: string) => void;
  onComplete: (seg: FocusSegment) => void;
  onResync: (seg: FocusSegment) => void;
  onSetSubject: (sessionId: string, segmentId: string, subject: TomatodoSubject | null) => void;
  tomatodoStatus: Record<string, TomatodoSegmentStatus>;
  syncStates: Record<string, SessionSyncState>;
  syncMode: 'focus-record' | 'comment' | 'local-only';
  tomatodoEnabled: boolean;
  completedTaskIds: Set<string>;
}) {
  const segmentItems: HistoryTimelineItem[] = segments
    .map((segment, index) => ({
      type: 'focus' as const,
      segment,
      index,
      startedAt: segment.startedAt,
    }))
    .filter(({ segment }) => {
      const hasTask = !!segment.taskId && !!segment.taskSource;
      if (filter === 'linked') return hasTask;
      if (filter === 'unlinked') return !hasTask;
      return true;
    });
  const pauseItems: HistoryTimelineItem[] =
    filter === 'all'
      ? pauses.map((pause, index) => ({
          type: 'pause' as const,
          pause,
          index,
          startedAt: pause.pauseStartedAt,
        }))
      : [];
  const items = [...segmentItems, ...pauseItems].sort((a, b) => a.startedAt - b.startedAt);

  return (
    <section className="history-segment-ledger" aria-label="片段时间线">
      <header className="history-segment-header">
        <div className="history-segment-heading-group">
          <Icon.Activity size="sm" tone="accent" />
          <p className="eyebrow">片段时间线</p>
          <span className="history-segment-count tone-focus">专注 {segments.length}</span>
          {pauses.length > 0 && (
            <span className="history-segment-count tone-pause">暂停 {pauses.length}</span>
          )}
        </div>
        {filter !== 'all' && (
          <span className="history-segment-filter-note">暂停片段仅在“全部”中显示</span>
        )}
      </header>

      {items.length === 0 ? (
        <div className="history-segment-empty">当前筛选条件下没有片段</div>
      ) : (
        <div className="history-segment-list">
          {items.map((item, itemIndex) =>
            item.type === 'focus' ? (
              <HistoryFocusTimelineRow
                key={item.segment.id}
                seg={item.segment}
                index={item.index}
                staggerIndex={itemIndex}
                linking={linking}
                defaultSubject={defaultSubject}
                onLink={() => onLink(item.segment.id, item.index)}
                onClear={() => onClear(item.segment.id)}
                onComplete={() => onComplete(item.segment)}
                onResync={() => onResync(item.segment)}
                onSetSubject={(subject) => onSetSubject(sessionId, item.segment.id, subject)}
                resolvedSubject={tomatodoStatus[item.segment.id]?.subject}
                resolvedSubjectSource={tomatodoStatus[item.segment.id]?.source}
                tomatodoStatus={tomatodoStatus[item.segment.id]}
                syncState={syncStates[item.segment.id]}
                showTomatodo={tomatodoEnabled}
                showDidaSync={syncMode !== 'local-only'}
                allowCloudResync={syncMode === 'focus-record' && !!item.segment.cloudFocusId}
                isTaskCompleted={!!item.segment.taskId && completedTaskIds.has(item.segment.taskId)}
              />
            ) : (
              <HistoryPauseTimelineRow
                key={item.pause.id}
                pause={item.pause}
                index={item.index}
                staggerIndex={itemIndex}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}

function HistoryFocusTimelineRow({
  seg,
  index,
  staggerIndex,
  linking,
  defaultSubject,
  onLink,
  onClear,
  onComplete,
  onResync,
  onSetSubject,
  resolvedSubject,
  resolvedSubjectSource,
  tomatodoStatus,
  syncState,
  showTomatodo,
  showDidaSync,
  allowCloudResync,
  isTaskCompleted,
}: {
  seg: FocusSegment;
  index: number;
  staggerIndex: number;
  linking: boolean;
  defaultSubject: TomatodoSubject;
  onLink: () => void;
  onClear: () => void;
  onComplete: () => void;
  onResync: () => void;
  onSetSubject: (subject: TomatodoSubject | null) => void;
  resolvedSubject?: TomatodoSubject;
  resolvedSubjectSource?: TomatodoSegmentStatus['source'];
  tomatodoStatus?: TomatodoSegmentStatus;
  syncState?: SessionSyncState;
  showTomatodo: boolean;
  showDidaSync: boolean;
  allowCloudResync: boolean;
  isTaskCompleted: boolean;
}) {
  const hasTask = !!seg.taskId && !!seg.taskSource;
  const displayedSyncState =
    syncState ??
    (seg.cloudFocusId
      ? { label: '已同步', tone: 'ok' as const, title: '已写入滴答清单' }
      : NOT_SYNCED_STATE);
  return (
    <div
      className={`history-segment-row hm-stagger-in tone-focus ${hasTask ? 'is-linked' : 'is-unlinked'}`}
      style={{ '--hm-delay': `${Math.min(staggerIndex * 24, 120)}ms` } as CSSProperties}
    >
      <div className="history-segment-marker" aria-hidden="true">
        <span>F</span>
        <strong>{String(index + 1).padStart(2, '0')}</strong>
      </div>
      <div className="history-segment-content">
        <div className="history-segment-primary">
          <span className="history-segment-type">专注片段</span>
          <span className="history-segment-duration timer-digit">
            {formatDuration(seg.activeElapsedMs)}
          </span>
          <span className="history-segment-time">
            {formatDateTime(seg.startedAt)}
            {seg.endedAt && ` → ${formatDateTime(seg.endedAt)}`}
          </span>
          {showDidaSync && seg.taskSource === 'ticktick' && (
            <SyncBadge state={displayedSyncState} />
          )}
        </div>
        <div className="history-segment-task">
          {hasTask ? (
            <>
              <Icon.Link size="xs" tone="accent" />
              <span className="history-segment-task-title">{seg.title}</span>
              {seg.taskSource === 'ticktick' && (
                <span className="history-segment-source">滴答</span>
              )}
            </>
          ) : (
            <span className="history-segment-unlinked">任务未关联</span>
          )}
        </div>
        {showTomatodo && (
          <TomatodoSubjectControl
            segment={seg}
            defaultSubject={defaultSubject}
            resolvedSubject={resolvedSubject}
            resolvedSubjectSource={resolvedSubjectSource}
            writtenLocally={tomatodoStatus?.writtenLocally === true}
            cloudSynced={tomatodoStatus?.cloudSynced === true || tomatodoStatus?.synced === true}
            disabled={linking}
            onSetSubject={onSetSubject}
          />
        )}
      </div>
      <div className="history-segment-actions">
        <button
          className="motion-press rounded-md border border-border/50 bg-bg-card/50 px-1.5 py-1 text-[10.5px] text-fg-muted hover:bg-bg-subtle hover:text-fg disabled:opacity-40"
          disabled={linking}
          onClick={onLink}
        >
          {hasTask ? '更换' : '关联'}
        </button>
        {hasTask && (
          <>
            <button
              className="motion-press rounded-md border border-danger/25 bg-danger/10 px-1.5 py-1 text-[10.5px] text-danger hover:bg-danger/15 disabled:opacity-40"
              disabled={linking}
              onClick={onClear}
            >
              清除
            </button>
            <button
              className="motion-press rounded-md border border-success/20 bg-success/10 px-1.5 py-1 text-[10.5px] text-success hover:bg-success/15 disabled:opacity-40"
              disabled={linking || isTaskCompleted}
              onClick={onComplete}
              title="在任务来源中完成该任务"
            >
              {isTaskCompleted ? '已完成' : '完成'}
            </button>
            {allowCloudResync && (
              <button
                className="motion-press rounded-md border border-accent/20 bg-accent/5 px-1.5 py-1 text-[10.5px] text-accent hover:bg-accent/10 disabled:opacity-40"
                disabled={linking}
                onClick={onResync}
                title="删除现有云端专注记录并重新同步"
              >
                重新同步
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TomatodoSubjectControl({
  segment,
  defaultSubject,
  resolvedSubject,
  resolvedSubjectSource,
  writtenLocally,
  cloudSynced,
  disabled,
  onSetSubject,
}: {
  segment: FocusSegment;
  defaultSubject: TomatodoSubject;
  resolvedSubject?: TomatodoSubject;
  resolvedSubjectSource?: TomatodoSegmentStatus['source'];
  writtenLocally: boolean;
  cloudSynced: boolean;
  disabled: boolean;
  onSetSubject: (subject: TomatodoSubject | null) => void;
}) {
  const inferred = inferTomatodoSubject(segment.title);
  const subject =
    segment.tomatodoSubject ?? resolvedSubject ?? resolveSegmentSubject(segment, defaultSubject);
  const manual = segment.tomatodoSubject !== null;
  const source = manual ? 'manual' : (resolvedSubjectSource ?? (inferred ? 'auto' : 'fallback'));
  const label = manual
    ? `已手动调整 · ${subject}`
    : source === 'auto'
      ? `自动匹配 · ${subject}`
      : `未识别 · ${subject}`;
  const tone = manual
    ? 'border-success/25 bg-success/10 text-success'
    : source === 'auto'
      ? 'border-accent/25 bg-accent/10 text-accent'
      : 'border-warning/25 bg-warning/10 text-warning';

  const selectSubject = (next: TomatodoSubject) => {
    onSetSubject(next);
  };

  return (
    <div className="tomatodo-subject-control mt-2">
      <div className="tomatodo-subject-status">
        <span className="text-[10.5px] text-fg-subtle">番茄分类</span>
        <span className={`rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium ${tone}`}>
          {label}
        </span>
        {cloudSynced ? (
          <span
            className="rounded-md border border-success/20 bg-success/10 px-1.5 py-0.5 text-[10px] text-success"
            title="番茄 Todo 客户端已确认上传；FocusLink 不做独立云端回读"
          >
            上传已确认
          </span>
        ) : writtenLocally ? (
          <>
            <span className="rounded-md border border-success/20 bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
              已写入本地
            </span>
            <span
              className="rounded-md border border-warning/25 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning"
              title="记录已写入番茄 Todo 本地，等待客户端上传确认"
            >
              待上传
            </span>
          </>
        ) : null}
      </div>
      <div className="tomatodo-subject-actions" aria-label="手动选择番茄 Todo 学科">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={!manual}
          onClick={() => onSetSubject(null)}
          className={`motion-press rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-40 ${
            !manual
              ? 'border-accent/35 bg-accent/10 text-accent'
              : 'border-border/50 bg-bg-card/50 text-fg-muted hover:bg-bg-subtle hover:text-fg'
          }`}
        >
          自动
        </button>
        <TomatodoSubjectChips
          value={manual ? subject : null}
          onChange={selectSubject}
          disabled={disabled}
          compact
        />
      </div>
    </div>
  );
}

function HistoryPauseTimelineRow({
  pause,
  index,
  staggerIndex,
}: {
  pause: PauseEvent;
  index: number;
  staggerIndex: number;
}) {
  return (
    <div
      className="history-segment-row hm-stagger-in tone-pause"
      style={{ '--hm-delay': `${Math.min(staggerIndex * 24, 120)}ms` } as CSSProperties}
    >
      <div className="history-segment-marker" aria-hidden="true">
        <span>P</span>
        <strong>{String(index + 1).padStart(2, '0')}</strong>
      </div>
      <div className="history-segment-content">
        <div className="history-segment-primary">
          <span className="history-segment-type">暂停片段</span>
          <span className="history-segment-duration timer-digit">
            {formatDuration(pause.durationMs)}
          </span>
          <span className="history-segment-time">
            {formatDateTime(pause.pauseStartedAt)}
            {pause.pauseEndedAt ? ` → ${formatDateTime(pause.pauseEndedAt)}` : ' → 进行中'}
          </span>
        </div>
        <p className="history-segment-note">仅计入暂停损耗，不参与任务同步</p>
      </div>
    </div>
  );
}

export function SyncBadge({ state }: { state: SessionSyncState }) {
  const cls =
    state.tone === 'ok'
      ? 'border-success/25 bg-success/10 text-success'
      : state.tone === 'error'
        ? 'border-danger/25 bg-danger/10 text-danger'
        : state.tone === 'warn'
          ? 'border-warning/25 bg-warning/10 text-warning'
          : 'border-border/60 bg-bg-subtle/60 text-fg-subtle';
  const StateIcon =
    state.tone === 'ok'
      ? Icon.CheckCircleFilled
      : state.tone === 'error'
        ? Icon.AlertCircle
        : state.tone === 'warn'
          ? Icon.Refresh
          : Icon.Clock;

  return (
    <motion.span
      key={`${state.tone}:${state.label}`}
      initial={{ scale: 0.72, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      title={state.title}
      className={`status-chip inline-flex items-center gap-1 ${cls}`}
    >
      <StateIcon size="xs" />
      {state.label}
    </motion.span>
  );
}

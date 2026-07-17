// 历史时间线 - 片段时间线列表 + 专注行 + 暂停行
import { useState } from 'react';
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
    <div className="rounded-lg border border-border/60 bg-bg-card/50 p-3">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon.Activity size="sm" tone="accent" />
          <p className="eyebrow">片段时间线</p>
          <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
            专注 {segments.length}
          </span>
          {pauses.length > 0 && (
            <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10.5px] font-medium text-warning">
              暂停 {pauses.length}
            </span>
          )}
        </div>
        {filter !== 'all' && (
          <span className="text-[10.5px] text-fg-subtle">暂停片段仅在"全部"视图展示</span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 bg-bg-subtle/20 py-4 text-center text-[11px] text-fg-subtle">
          当前筛选条件下没有片段
        </div>
      ) : (
        <div className="relative space-y-1">
          <div className="absolute bottom-2 left-[15px] top-2 w-px bg-border/60" />
          {items.map((item) =>
            item.type === 'focus' ? (
              <HistoryFocusTimelineRow
                key={item.segment.id}
                seg={item.segment}
                index={item.index}
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
              <HistoryPauseTimelineRow key={item.pause.id} pause={item.pause} index={item.index} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function HistoryFocusTimelineRow({
  seg,
  index,
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
      className={`relative flex gap-2.5 rounded-md border px-2.5 py-2 ${
        hasTask ? 'border-border/50 bg-bg-subtle/20' : 'border-warning/30 bg-warning/5'
      }`}
    >
      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-accent/20 bg-accent/10 text-accent">
        <Icon.Activity size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-semibold text-fg">专注片段 {index + 1}</span>
          <span className="timer-digit text-[12px] font-semibold text-accent">
            {formatDuration(seg.activeElapsedMs)}
          </span>
          <span className="truncate text-[11px] text-fg-subtle">
            {formatDateTime(seg.startedAt)}
            {seg.endedAt && ` - ${formatDateTime(seg.endedAt)}`}
          </span>
          {showDidaSync && seg.taskSource === 'ticktick' && (
            <SyncBadge state={displayedSyncState} />
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {hasTask ? (
            <>
              <Icon.Link size="xs" tone="accent" />
              <span className="max-w-[320px] truncate text-[12px] font-medium text-fg">
                {seg.title}
              </span>
              {seg.taskSource === 'ticktick' && (
                <span className="rounded-md bg-success/10 px-1 py-0.5 text-[10px] text-success">
                  滴答
                </span>
              )}
            </>
          ) : (
            <span className="text-[12px] font-medium text-warning">任务未关联</span>
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
      <div className="flex shrink-0 items-center gap-1 self-center">
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
  const [editing, setEditing] = useState(false);
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
    setEditing(false);
  };

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[10.5px] text-fg-subtle">番茄 Todo</span>
      <span className={`rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium ${tone}`}>
        {label}
      </span>
      {cloudSynced ? (
        <span
          className="rounded-md border border-success/20 bg-success/10 px-1.5 py-0.5 text-[10px] text-success"
          title="番茄 Todo 已确认上传云端"
        >
          云端已同步
        </span>
      ) : writtenLocally ? (
        <>
          <span className="rounded-md border border-success/20 bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
            已写入本地
          </span>
          <span
            className="rounded-md border border-warning/25 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning"
            title="本地记录尚未收到番茄 Todo 云端上传确认"
          >
            云端未同步
          </span>
        </>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing((value) => !value)}
        className="motion-press rounded-md border border-border/50 bg-bg-card/50 px-1.5 py-0.5 text-[10.5px] text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg disabled:opacity-40"
      >
        {editing ? '收起' : '调整'}
      </button>
      {editing && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/50 bg-bg-card/70 p-1.5">
          <TomatodoSubjectChips
            value={manual ? subject : null}
            onChange={selectSubject}
            disabled={disabled}
            compact
          />
          {manual && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onSetSubject(null);
                setEditing(false);
              }}
              className="motion-press rounded-md border border-border/50 px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-bg-subtle hover:text-fg disabled:opacity-40"
            >
              恢复自动
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryPauseTimelineRow({ pause, index }: { pause: PauseEvent; index: number }) {
  return (
    <div className="relative flex gap-2.5 rounded-md border border-pause/15 bg-pause/5 px-2.5 py-2">
      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-pause/20 bg-pause/10 text-pause">
        <Icon.Coffee size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-semibold text-pause">暂停片段 {index + 1}</span>
          <span className="timer-digit text-[12px] font-semibold text-pause">
            {formatDuration(pause.durationMs)}
          </span>
          <span className="truncate text-[11px] text-fg-subtle">
            {formatDateTime(pause.pauseStartedAt)}
            {pause.pauseEndedAt ? ` - ${formatDateTime(pause.pauseEndedAt)}` : ' - 进行中'}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-fg-subtle">暂停记录只计入休息时间，不参与任务同步。</p>
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
    <span title={state.title} className={`status-chip ${cls}`}>
      <StateIcon size="xs" />
      {state.label}
    </span>
  );
}

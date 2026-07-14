// 历史记录 - Session 列表 + 详情 + 导出 + 删除 + Segment 任务关联/后补/批量
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from '../../ui/Icon';
import { useStore } from '../../app/store';
import { formatDuration, formatDateTime, formatRelative, formatMinutes } from '../../lib/time';
import {
  filterSessionsByRange,
  formatShortDate,
  getRange,
  summarizeSessions,
  toDateInput,
  type RangePreset,
} from './historyStats';
import {
  buildSessionSyncStateMap,
  NOT_SYNCED_STATE,
  queueItemToSessionSyncState,
  type SessionSyncState,
} from './syncPresentation';
import type {
  FocusSession,
  FocusSegment,
  SyncQueueItem,
  Task,
  TomatodoSubject,
} from '@shared/types';
import { TaskPicker } from '../tasks/TaskPicker';
import {
  HistoryTimelineList,
  SyncBadge,
  type TomatodoSegmentStatus,
  type SegmentFilter,
} from './HistoryTimeline';
import {
  SessionLinkPreview,
  SessionDetailHeader,
  BatchLinkPanel,
  type SessionDetail,
} from './HistoryBadges';
import { HistoryInsights } from './HistoryInsights';

function buildSegmentSyncStateMap(queue: SyncQueueItem[]): Record<string, SessionSyncState> {
  const latest = new Map<string, SyncQueueItem>();
  for (const item of queue) {
    try {
      const payload = JSON.parse(item.payload) as { segmentId?: string };
      if (!payload.segmentId) continue;
      const previous = latest.get(payload.segmentId);
      if (!previous || item.updatedAt >= previous.updatedAt) latest.set(payload.segmentId, item);
    } catch {
      // 无效队列项不应影响历史账本。
    }
  }
  return Object.fromEntries(
    Array.from(latest, ([segmentId, item]) => [segmentId, queueItemToSessionSyncState(item)]),
  );
}

const SessionSyncBadge = SyncBadge;

/** TaskPicker 弹窗目标类型 */
type PickerTarget =
  | { kind: 'segment'; segmentId: string; title: string }
  | { kind: 'session-default'; sessionId: string; title: string }
  | { kind: 'batch-unlinked'; sessionId: string; title: string }
  | { kind: 'batch-all'; sessionId: string; title: string };

const RANGE_PRESETS: Array<{ id: RangePreset; label: string }> = [
  { id: 'today', label: '今天' },
  { id: 'yesterday', label: '昨天' },
  { id: '7d', label: '近 7 天' },
  { id: '15d', label: '半个月' },
  { id: '30d', label: '1 个月' },
  { id: 'custom', label: '自定义' },
];

export function HistoryPanel() {
  // Elapsed time changes every second while focusing. History only needs the identity/state of the
  // current session, so primitive selectors keep the full ledger from rerendering on every tick.
  const currentSessionId = useStore((state) => state.snapshot?.sessionId ?? null);
  const currentTimerState = useStore((state) => state.snapshot?.state ?? 'idle');
  const settings = useStore((state) => state.settings);
  const addToast = useStore((state) => state.addToast);
  const setSnapshot = useStore((state) => state.setSnapshot);
  const syncQueue = useStore((state) => state.syncQueue);
  const setSyncQueue = useStore((state) => state.setSyncQueue);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const expandedRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailLoadError, setDetailLoadError] = useState<{
    sessionId: string;
    message: string;
  } | null>(null);
  const detailRequestIdRef = useRef(0);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [linking, setLinking] = useState(false);
  const [syncingSessionId, setSyncingSessionId] = useState<string | null>(null);
  const [syncingKind, setSyncingKind] = useState<'dida' | 'tomatodo' | null>(null);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(() => new Set());
  const [sessionSyncMeta, setSessionSyncMeta] = useState<Record<string, SessionSyncState>>({});
  const [sessionSegmentsById, setSessionSegmentsById] = useState<Record<string, FocusSegment[]>>(
    {},
  );
  const [tomatodoStatusBySession, setTomatodoStatusBySession] = useState<
    Record<string, Record<string, TomatodoSegmentStatus>>
  >({});
  const [rangePreset, setRangePreset] = useState<RangePreset>('7d');
  const [customStart, setCustomStart] = useState(toDateInput(Date.now()));
  const [customEnd, setCustomEnd] = useState(toDateInput(Date.now()));
  const [segmentFilter, setSegmentFilter] = useState<Record<string, SegmentFilter>>({});
  const tomatodoDefaultSubject: TomatodoSubject = settings?.tomatodo.defaultSubject ?? '学习';

  const range = useMemo(
    () => getRange(rangePreset, customStart, customEnd),
    [rangePreset, customStart, customEnd],
  );
  const filteredSessions = useMemo(() => filterSessionsByRange(sessions, range), [sessions, range]);
  const rangeStats = useMemo(() => summarizeSessions(filteredSessions), [filteredSessions]);
  const persistedSyncStates = useMemo(() => buildSessionSyncStateMap(syncQueue), [syncQueue]);
  const segmentSyncStates = useMemo(() => buildSegmentSyncStateMap(syncQueue), [syncQueue]);

  const getDisplayedSyncState = (sessionId: string) =>
    sessionSyncMeta[sessionId] ?? persistedSyncStates[sessionId] ?? NOT_SYNCED_STATE;

  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (!window.focuslink) {
        throw new Error('FocusLink 桌面接口未就绪');
      }
      const [list, queue] = await Promise.all([
        window.focuslink.sessions.list(100),
        window.focuslink.sync.list(),
      ]);
      const sessionList = list as FocusSession[];
      setSessions(sessionList);
      setSyncQueue(queue as SyncQueueItem[]);
      setSessionSyncMeta({});
      setSessionSegmentsById({});
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [setSyncQueue]);

  useEffect(() => {
    void load();
    return () => {
      // Invalidate a late IPC response after this route has unmounted.
      detailRequestIdRef.current += 1;
      expandedRef.current = null;
    };
  }, [load]);

  const refreshTomatodoStatus = async (sessionId: string) => {
    try {
      const status = await window.focuslink.tomatodo.status(sessionId);
      const segmentStatus = Object.fromEntries(
        status.segments.map((segment: TomatodoSegmentStatus & { segmentId: string }) => [
          segment.segmentId,
          {
            subject: segment.subject,
            synced: segment.synced,
            writtenLocally: segment.writtenLocally,
            cloudSynced: segment.cloudSynced,
            state: segment.state,
            source: segment.source,
          },
        ]),
      );
      setTomatodoStatusBySession((prev) => ({ ...prev, [sessionId]: segmentStatus }));
    } catch {
      // 番茄 Todo 未安装或路径不可读不应阻断历史账本。
    }
  };

  const reloadDetail = async (id: string) => {
    // A slower mutation can finish after the user has already opened another row. Never let that
    // stale callback restart loading for a row which is no longer the active detail target.
    if (expandedRef.current !== id) return;
    const requestId = ++detailRequestIdRef.current;
    setDetailLoadingId(id);
    setDetailLoadError(null);
    try {
      const d = await window.focuslink.sessions.get(id);
      if (requestId !== detailRequestIdRef.current || expandedRef.current !== id) return;
      if (!d) throw new Error('这条专注记录已不存在，请刷新统计列表。');
      setDetail(d);
      setSessionSegmentsById((prev) => ({
        ...prev,
        [id]: d.segments,
      }));
      void refreshTomatodoStatus(id);
    } catch (error) {
      if (requestId !== detailRequestIdRef.current || expandedRef.current !== id) return;
      setDetail(null);
      setDetailLoadError({
        sessionId: id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (requestId === detailRequestIdRef.current && expandedRef.current === id) {
        setDetailLoadingId(null);
      }
    }
  };

  const refreshSyncQueue = async () => {
    const queue = (await window.focuslink.sync.list()) as SyncQueueItem[];
    setSyncQueue(queue);
    return queue;
  };

  const applyPersistedSessionSyncState = (sessionId: string, queue: SyncQueueItem[]) => {
    const state = buildSessionSyncStateMap(queue)[sessionId] ?? NOT_SYNCED_STATE;
    setSessionSyncMeta((prev) => ({ ...prev, [sessionId]: state }));
    return state;
  };

  const getSessionSegmentsForEdit = (sessionId: string) =>
    (detail?.session.id === sessionId ? detail.segments : sessionSegmentsById[sessionId]) ?? [];

  const replaceSessionSegments = (sessionId: string, nextSegments: FocusSegment[]) => {
    setSessionSegmentsById((prev) => ({
      ...prev,
      [sessionId]: nextSegments,
    }));
    setDetail((prev) =>
      prev?.session.id === sessionId
        ? {
            ...prev,
            segments: nextSegments,
          }
        : prev,
    );
  };

  const toggleExpand = async (id: string) => {
    if (expandedRef.current === id) {
      detailRequestIdRef.current += 1;
      expandedRef.current = null;
      setExpanded(null);
      setDetail(null);
      setDetailLoadingId(null);
      setDetailLoadError(null);
      return;
    }
    expandedRef.current = id;
    setExpanded(id);
    setDetail(null);
    setDetailLoadError(null);
    await reloadDetail(id);
  };

  const handleDelete = async (id: string) => {
    const isCurrentSession = currentSessionId === id;
    if (isCurrentSession && (currentTimerState === 'running' || currentTimerState === 'paused')) {
      addToast('当前专注仍在进行中，请先结束专注后再删除这条记录。', 'error');
      return;
    }
    if (!confirm('确认删除这条专注记录？本地记录和已同步到滴答云端的专注记录都将被删除。')) return;
    try {
      const freshSnapshot = await window.focuslink.sessions.delete(id);
      if (freshSnapshot) {
        setSnapshot(freshSnapshot);
      }
      await load();
      if (expandedRef.current === id) {
        expandedRef.current = null;
        detailRequestIdRef.current += 1;
        setExpanded(null);
        setDetail(null);
        setDetailLoadingId(null);
        setDetailLoadError(null);
      }
      addToast('已删除（含云端记录）', 'success');
    } catch (e) {
      addToast('删除失败：' + (e as Error).message, 'error');
    }
  };

  const handleExport = async (id: string, format: 'json' | 'csv' | 'markdown') => {
    try {
      const content = await window.focuslink.sessions.export(id, format);
      const blob = new Blob([content], {
        type: format === 'json' ? 'application/json' : 'text/plain',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `focuslink-${id.slice(0, 8)}.${format === 'markdown' ? 'md' : format}`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('已导出', 'success');
    } catch (e) {
      addToast('导出失败：' + (e as Error).message, 'error');
    }
  };

  const handlePick = async (task: Task | null) => {
    const target = pickerTarget;
    setPickerTarget(null);
    if (!task || !target) return;
    setLinking(true);
    try {
      let linkedSessionId: string | null = null;
      if (target.kind === 'segment') {
        await window.focuslink.timer.linkTask(target.segmentId, task.id, task.source, task.title);
        linkedSessionId =
          detail?.segments.find((seg) => seg.id === target.segmentId)?.sessionId ?? expanded;
        addToast(`已关联：${task.title}`, 'success');
      } else if (target.kind === 'session-default') {
        await window.focuslink.timer.linkSessionTask(
          target.sessionId,
          task.id,
          task.source,
          task.title,
        );
        linkedSessionId = target.sessionId;
        addToast(`已设为默认任务：${task.title}`, 'success');
      } else if (target.kind === 'batch-unlinked') {
        const count = await window.focuslink.timer.linkSegmentsBatch(
          target.sessionId,
          task.id,
          task.source,
          task.title,
          true,
        );
        linkedSessionId = target.sessionId;
        addToast(`已批量关联 ${count} 个未关联片段到：${task.title}`, 'success');
      } else if (target.kind === 'batch-all') {
        if (!confirm('确认把本次所有专注片段（含已关联）都改为同一任务？')) return;
        const count = await window.focuslink.timer.linkSegmentsBatch(
          target.sessionId,
          task.id,
          task.source,
          task.title,
          false,
        );
        linkedSessionId = target.sessionId;
        addToast(`已把全部 ${count} 个片段关联到：${task.title}`, 'success');
      }
      if (expanded) await reloadDetail(expanded);
      if (task.source === 'ticktick' && linkedSessionId) {
        void autoSyncLinkedSession(linkedSessionId);
      }
    } catch (e) {
      addToast('关联失败：' + (e as Error).message, 'error');
    } finally {
      setLinking(false);
    }
  };

  const handleClearSegment = async (segmentId: string) => {
    setLinking(true);
    try {
      await window.focuslink.timer.clearSegmentTask(segmentId);
      addToast('已清除该片段任务关联', 'info');
      if (expanded) await reloadDetail(expanded);
    } catch (e) {
      addToast('清除失败：' + (e as Error).message, 'error');
    } finally {
      setLinking(false);
    }
  };

  const handleClearSessionDefault = async (sessionId: string) => {
    setLinking(true);
    try {
      await window.focuslink.timer.clearSessionDefaultTask(sessionId);
      addToast('已清除本次默认任务', 'info');
      if (expanded) await reloadDetail(expanded);
    } catch (e) {
      addToast('清除失败：' + (e as Error).message, 'error');
    } finally {
      setLinking(false);
    }
  };

  const handleCompleteTask = async (seg: FocusSegment) => {
    if (!seg.taskId || !seg.taskSource) return;
    setLinking(true);
    try {
      await window.focuslink.tasks.complete({
        id: seg.taskId,
        source: seg.taskSource,
        externalId: seg.taskId.replace(/^ticktick:/, ''),
        projectId: null,
        title: seg.title ?? '未命名任务',
        status: null,
        priority: null,
        dueDate: null,
        tags: [],
        content: null,
      });
      setCompletedTaskIds((prev) => new Set(prev).add(seg.taskId!));
      addToast(`已完成任务：${seg.title ?? seg.taskId}`, 'success');
    } catch (e) {
      addToast('完成任务失败：' + (e as Error).message, 'error');
    } finally {
      setLinking(false);
    }
  };

  const handleResyncSegment = async (seg: FocusSegment) => {
    if (!seg.taskId || seg.taskSource !== 'ticktick') {
      addToast('该片段未关联滴答任务，无法重新同步', 'error');
      return;
    }
    if (
      !confirm(
        `确认删除该片段已同步到滴答云端的专注记录，并重新同步？\n\n这会先删除云端记录，再以当前关联的任务重新上传。\n本地数据保留不变。`,
      )
    )
      return;
    setLinking(true);
    try {
      const result = await window.focuslink.sync.resyncSegment(seg.id);
      if (result.ok) {
        addToast('已删除云端记录并重新同步', 'success');
      } else if (result.queued) {
        addToast(result.error ?? '旧云端记录已删除，重新同步已排队', 'info');
      } else {
        addToast('重新同步失败：' + (result.error ?? '未知错误'), 'error');
      }
      if (expanded) await reloadDetail(expanded);
      await refreshSyncQueue();
    } catch (e) {
      addToast('重新同步失败：' + (e as Error).message, 'error');
    } finally {
      setLinking(false);
    }
  };

  const autoSyncLinkedSession = async (sessionId: string) => {
    if (syncingSessionId) return;
    setSyncingSessionId(sessionId);
    setSyncingKind('dida');
    setSessionSyncMeta((prev) => ({
      ...prev,
      [sessionId]: {
        label: '同步中',
        tone: 'warn',
        title: '已关联滴答任务，正在同步到滴答清单',
      },
    }));
    try {
      await window.focuslink.sync.enqueueSession(sessionId);
      await window.focuslink.sync.runPending();
      const queue = await refreshSyncQueue();
      const state = applyPersistedSessionSyncState(sessionId, queue);
      if (expanded) await reloadDetail(expanded);
      if (state.tone === 'error') {
        addToast('任务已关联，但自动同步失败；可在同步队列重试。', 'error');
        return;
      }
      if (state.tone === 'ok') {
        addToast('已自动同步全部专注记录到滴答清单', 'success');
      } else {
        addToast('同步仍在队列中，将在冷却结束后继续', 'info');
      }
    } catch (e) {
      await refreshSyncQueue().catch(() => undefined);
      setSessionSyncMeta((prev) => ({
        ...prev,
        [sessionId]: {
          label: '同步失败',
          tone: 'error',
          title: (e as Error).message,
        },
      }));
      addToast('自动同步失败：' + (e as Error).message, 'error');
    } finally {
      setSyncingSessionId(null);
      setSyncingKind(null);
    }
  };

  const handleSyncSession = async (sessionId: string) => {
    if (syncingSessionId) return;
    setSyncingSessionId(sessionId);
    setSyncingKind('dida');
    try {
      const detailForSync: SessionDetail | null =
        detail?.session.id === sessionId ? detail : await window.focuslink.sessions.get(sessionId);
      const ticktickSegments =
        detailForSync?.segments.filter(
          (seg) => seg.taskId && seg.taskSource === 'ticktick' && seg.endedAt,
        ) ?? [];
      const runningSegments =
        detailForSync?.segments.filter(
          (seg) => seg.taskId && seg.taskSource === 'ticktick' && !seg.endedAt,
        ) ?? [];

      if (ticktickSegments.length === 0 && runningSegments.length === 0) {
        setSessionSyncMeta((prev) => ({
          ...prev,
          [sessionId]: {
            label: '未同步',
            tone: 'warn',
            title: '先把片段关联到滴答任务后再同步',
          },
        }));
        addToast('没有已关联滴答任务的片段；先把片段关联到滴答任务。', 'info');
        return;
      }

      if (ticktickSegments.length === 0 && runningSegments.length > 0) {
        addToast('专注仍在进行中，请先结束后再同步', 'info');
        return;
      }

      await window.focuslink.sync.enqueueSession(sessionId);
      const result = await window.focuslink.sync.runPending();
      const queue = await refreshSyncQueue();
      const state = applyPersistedSessionSyncState(sessionId, queue);
      if (state.tone === 'error') {
        addToast(
          `同步完成 ${result.succeeded} 条，失败 ${result.failed} 条；请检查同步队列。`,
          'error',
        );
      } else if (state.tone === 'ok') {
        addToast('该会话的全部专注记录已同步到滴答清单', 'success');
      } else {
        addToast('仍有记录在同步队列中，将在冷却结束后继续', 'info');
      }
    } catch (e) {
      await refreshSyncQueue().catch(() => undefined);
      setSessionSyncMeta((prev) => ({
        ...prev,
        [sessionId]: {
          label: '同步失败',
          tone: 'error',
          title: (e as Error).message,
        },
      }));
      addToast('同步失败：' + (e as Error).message, 'error');
    } finally {
      setSyncingSessionId(null);
      setSyncingKind(null);
    }
  };

  const handleSyncTomatodo = async (sessionId: string) => {
    if (syncingSessionId) return;
    setSyncingSessionId(sessionId);
    setSyncingKind('tomatodo');
    try {
      const result = await window.focuslink.tomatodo.syncSession(sessionId);
      if (result.total === 0) {
        addToast('没有符合同步条件的专注片段（需要已结束且有专注时长）', 'info');
        return;
      }
      const cloudSynced = result.results.filter(
        (item: { cloudSynced?: boolean }) => item.cloudSynced,
      ).length;
      const localPending = result.results.filter(
        (item: { localWritten?: boolean; cloudSynced?: boolean }) =>
          item.localWritten && !item.cloudSynced,
      ).length;
      if (result.failed > 0) {
        addToast(
          `番茄 Todo 同步：云端已同步 ${cloudSynced} 条，本地待同步 ${localPending} 条，失败 ${result.failed} 条`,
          'error',
        );
      } else if (cloudSynced > 0 && localPending === 0) {
        addToast(`已同步 ${cloudSynced} 条专注记录到番茄 Todo 云端`, 'success');
      } else if (localPending > 0) {
        addToast(`已写入本地 ${localPending} 条，等待番茄 Todo 上传云端`, 'info');
      } else {
        addToast('番茄 Todo 记录已存在且无需重复同步', 'info');
      }
      await refreshTomatodoStatus(sessionId);
      if (expanded) await reloadDetail(expanded);
    } catch (e) {
      addToast('番茄 Todo 同步失败：' + (e as Error).message, 'error');
    } finally {
      setSyncingSessionId(null);
      setSyncingKind(null);
    }
  };

  const handleSetSubject = async (
    sessionId: string,
    segmentId: string,
    subject: TomatodoSubject | null,
  ) => {
    const prevSegments = getSessionSegmentsForEdit(sessionId);
    if (prevSegments.length === 0) return;
    const nextSegments = prevSegments.map((segment) =>
      segment.id === segmentId ? { ...segment, tomatodoSubject: subject } : segment,
    );
    replaceSessionSegments(sessionId, nextSegments);
    try {
      const result = await window.focuslink.tomatodo.setSubject(segmentId, subject);
      await refreshTomatodoStatus(sessionId);
      if (!result.ok) {
        addToast(
          `学科已保存到本地，但番茄 Todo 更新失败：${result.error ?? '请稍后补同步'}`,
          'error',
        );
      } else if (result.externalUpdatedCount > 0) {
        addToast('已更新番茄 Todo 学科记录', 'success');
      }
    } catch (e) {
      replaceSessionSegments(sessionId, prevSegments);
      addToast('设置学科失败：' + (e as Error).message, 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-fg-subtle">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-bg-subtle/60">
          <Icon.Loader size="lg" className="motion-spin text-accent" />
        </div>
        <p className="text-[12px] font-medium text-fg-muted">加载中...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-fg-subtle">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-danger/10 text-danger">
          <Icon.AlertCircle size="xl" />
        </div>
        <div className="text-center">
          <p className="text-[13px] font-medium text-fg-muted">加载失败</p>
          <p className="mt-1 max-w-[360px] text-[11px] text-fg-subtle">{loadError}</p>
        </div>
        <button className="btn-outline motion-press" onClick={() => load()}>
          <Icon.Refresh size="xs" />
          重试
        </button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-fg-subtle">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-bg-subtle/60">
          <Icon.Inbox size="xl" className="opacity-50" />
        </div>
        <div className="text-center">
          <p className="text-[13px] font-medium text-fg-muted">还没有专注记录</p>
          <p className="mt-1 text-[11px] text-fg-subtle">开始第一次专注后会出现在这里</p>
        </div>
      </div>
    );
  }

  return (
    <div className="history-page h-full overflow-y-auto px-6 py-4">
      <div className="history-shell mx-auto max-w-5xl">
        {/* 筛选 */}
        <div className="history-toolbar mb-3 pb-3">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[14px] font-semibold text-fg">
              <Icon.Calendar size="sm" tone="accent" />
              时间筛选
            </div>
            <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
              <span>
                {formatShortDate(range.start)} - {formatShortDate(range.end)}
              </span>
              <span className="rounded-md border border-border/60 bg-bg-subtle/40 px-1.5 py-0.5">
                {filteredSessions.length} / {sessions.length} 条
              </span>
            </div>
          </div>
          <div className="history-filter-row flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {RANGE_PRESETS.map((item) => (
                <button
                  key={item.id}
                  className={`motion-press rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    rangePreset === item.id
                      ? 'bg-accent text-accent-fg'
                      : 'border border-border/60 bg-bg-subtle/50 text-fg-muted hover:bg-bg-subtle hover:text-fg'
                  }`}
                  onClick={() => setRangePreset(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {filteredSessions.length > 0 && (
              <div className="history-inline-stats" aria-label="筛选范围统计">
                <span>
                  专注 <strong>{formatDuration(rangeStats.active)}</strong>
                </span>
                <span className="pause">
                  暂停 <strong>{formatDuration(rangeStats.pause)}</strong>
                </span>
                <span>
                  <strong>{rangeStats.count}</strong> 次
                </span>
              </div>
            )}
          </div>
          {rangePreset === 'custom' && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border/50 pt-2.5">
              <input
                type="date"
                className="input !w-auto !py-1.5 text-[12px]"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              <span className="text-[12px] text-fg-subtle">至</span>
              <input
                type="date"
                className="input !w-auto !py-1.5 text-[12px]"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
          )}
        </div>

        {filteredSessions.length > 0 && (
          <HistoryInsights sessions={filteredSessions} summary={rangeStats} range={range} />
        )}

        {/* 筛选范围内无数据 */}
        {filteredSessions.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/60 bg-bg-subtle/20 py-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-bg-subtle/60 text-fg-subtle">
              <Icon.Inbox size="xl" />
            </div>
            <p className="text-[13px] font-medium text-fg-muted">当前时间范围没有专注记录</p>
            <p className="mt-1 text-[11px] text-fg-subtle">
              换一个筛选范围，或者开始一次新的专注。
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {(['7d', '15d', '30d'] as const).map((preset) => (
                <button
                  key={preset}
                  className="motion-press rounded-md border border-border/60 bg-bg-card/50 px-3 py-1 text-[11.5px] font-medium text-fg-muted hover:text-fg"
                  onClick={() => setRangePreset(preset)}
                >
                  {preset === '7d' ? '近7天' : preset === '15d' ? '半个月' : '1个月'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Session 列表 */}
        {filteredSessions.length > 0 && (
          <div className="space-y-1.5">
            {filteredSessions.map((session) => {
              const syncState = getDisplayedSyncState(session.id);
              const rowSegments =
                detail?.session.id === session.id
                  ? detail.segments
                  : sessionSegmentsById[session.id];
              const hasTicktickSegments = rowSegments
                ? rowSegments.some((segment) => segment.taskId && segment.taskSource === 'ticktick')
                : (session.ticktickLinkedSegmentCount ?? 0) > 0;
              const measuredMs = Math.max(
                1,
                session.wallElapsedMs,
                session.activeElapsedMs + session.pauseElapsedMs,
              );
              const activeRatio = Math.min(100, (session.activeElapsedMs / measuredMs) * 100);
              const pauseRatio = Math.min(
                100 - activeRatio,
                (session.pauseElapsedMs / measuredMs) * 100,
              );
              return (
                <motion.div key={session.id} className="history-session overflow-hidden">
                  <button
                    className="motion-base flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-bg-subtle/40"
                    onClick={() => toggleExpand(session.id)}
                  >
                    <Icon.ChevronRight
                      size="sm"
                      tone="subtle"
                      className={`shrink-0 text-fg-subtle transition-transform duration-[var(--motion-normal)] ease-[var(--ease-out)] ${
                        expanded === session.id ? 'rotate-90' : ''
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="timer-digit text-[14px] font-semibold text-fg">
                          {formatMinutes(session.activeElapsedMs)}
                        </span>
                        <span className="text-[12px] text-fg-subtle">
                          {formatRelative(session.startedAt)}
                        </span>
                      </div>
                      {session.endedAt &&
                      session.wallElapsedMs > session.activeElapsedMs + 60000 ? (
                        <div className="mt-0.5 text-[12px] leading-relaxed text-fg-subtle">
                          {formatDateTime(session.startedAt)} 开始 · 专注{' '}
                          {formatDuration(session.activeElapsedMs)}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[12px] leading-relaxed text-fg-subtle">
                          {formatDateTime(session.startedAt)}
                          {session.endedAt && ` → ${formatDateTime(session.endedAt)}`}
                        </div>
                      )}
                      <div className="history-ratio-track" aria-hidden="true">
                        <span className="focus" style={{ width: `${activeRatio}%` }} />
                        <span className="pause" style={{ width: `${pauseRatio}%` }} />
                      </div>
                      {session.defaultTaskTitle && (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-400/80">
                          <Icon.Star size="xs" />
                          <span className="truncate">{session.defaultTaskTitle}</span>
                        </div>
                      )}
                    </div>
                    <div className="hidden items-center gap-2 text-[11px] text-fg-muted sm:flex">
                      <SessionLinkPreview session={session} segments={rowSegments} />
                      {hasTicktickSegments && settings?.syncMode !== 'local-only' && (
                        <SessionSyncBadge state={syncState} />
                      )}
                      {hasTicktickSegments && settings?.syncMode === 'local-only' && (
                        <span className="status-chip border-border/60 bg-bg-subtle/60 text-fg-subtle">
                          仅本地
                        </span>
                      )}
                      <span>专注 {formatDuration(session.activeElapsedMs)}</span>
                      {session.pauseElapsedMs > 0 && (
                        <span>暂停 {formatDuration(session.pauseElapsedMs)}</span>
                      )}
                    </div>
                  </button>

                  <AnimatePresence initial={false} mode="sync">
                    {expanded === session.id &&
                      detailLoadingId === session.id &&
                      detail?.session.id !== session.id && (
                        <motion.div
                          key={`detail-loading-${session.id}`}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden border-t border-border/60"
                        >
                          <div className="flex items-center gap-2 px-4 py-4 text-[11.5px] text-fg-subtle">
                            <Icon.Loader size="sm" className="motion-spin text-accent" />
                            正在读取这次专注的片段与同步状态…
                          </div>
                        </motion.div>
                      )}
                    {expanded === session.id && detailLoadError?.sessionId === session.id && (
                      <motion.div
                        key={`detail-error-${session.id}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden border-t border-danger/20"
                      >
                        <div className="flex items-center gap-2.5 px-4 py-3 text-[11.5px] text-danger">
                          <Icon.AlertCircle size="sm" />
                          <span className="min-w-0 flex-1 break-words">
                            详情读取失败：{detailLoadError.message}
                          </span>
                          <button
                            type="button"
                            className="btn-outline motion-press !min-h-[28px] !px-2 !py-1 !text-[11px]"
                            onClick={() => void reloadDetail(session.id)}
                          >
                            <Icon.Refresh size="xs" />
                            重试
                          </button>
                        </div>
                      </motion.div>
                    )}
                    {expanded === session.id && detail?.session.id === session.id && (
                      <motion.div
                        key={`detail-${session.id}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                        className="border-t border-border/60"
                      >
                        <div className="space-y-3 p-4">
                          <SessionDetailHeader
                            detail={detail}
                            syncState={syncState}
                            syncing={syncingSessionId === session.id}
                            syncMode={settings?.syncMode ?? 'local-only'}
                          />
                          <HistoryTimelineList
                            sessionId={session.id}
                            segments={detail.segments}
                            pauses={detail.pauses}
                            filter={segmentFilter[session.id] ?? 'all'}
                            linking={linking}
                            defaultSubject={tomatodoDefaultSubject}
                            onLink={(segId, idx) =>
                              setPickerTarget({
                                kind: 'segment',
                                segmentId: segId,
                                title: `专注片段 ${idx + 1} 关联任务`,
                              })
                            }
                            onClear={handleClearSegment}
                            onComplete={handleCompleteTask}
                            onResync={handleResyncSegment}
                            onSetSubject={handleSetSubject}
                            tomatodoStatus={tomatodoStatusBySession[session.id] ?? {}}
                            syncStates={segmentSyncStates}
                            syncMode={settings?.syncMode ?? 'local-only'}
                            tomatodoEnabled={settings?.tomatodo.enabled === true}
                            completedTaskIds={completedTaskIds}
                          />
                          <div className="rounded-lg border border-border/50 bg-bg-subtle/20 px-3 py-2.5">
                            <BatchLinkPanel
                              segments={detail.segments}
                              linking={linking}
                              filter={segmentFilter[session.id] ?? 'all'}
                              onFilterChange={(f) =>
                                setSegmentFilter((prev) => ({ ...prev, [session.id]: f }))
                              }
                              onBatchUnlinked={() =>
                                setPickerTarget({
                                  kind: 'batch-unlinked',
                                  sessionId: session.id,
                                  title: '把所有未关联片段关联到某任务',
                                })
                              }
                              onBatchAll={() =>
                                setPickerTarget({
                                  kind: 'batch-all',
                                  sessionId: session.id,
                                  title: '把所有片段改为同一任务',
                                })
                              }
                            />
                            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2 text-[11px]">
                              <span className="text-fg-subtle">本次默认任务</span>
                              <span className="max-w-[280px] truncate font-medium text-fg">
                                {detail.session.defaultTaskTitle ?? '未设置'}
                              </span>
                              <button
                                className="btn-ghost motion-press !min-h-[26px] !px-2 !py-0.5 !text-[11px]"
                                disabled={linking}
                                onClick={() =>
                                  setPickerTarget({
                                    kind: 'session-default',
                                    sessionId: session.id,
                                    title: '设置本次专注默认任务',
                                  })
                                }
                              >
                                {detail.session.defaultTaskTitle ? '更换' : '关联'}
                              </button>
                              {detail.session.defaultTaskTitle && (
                                <button
                                  className="btn-ghost motion-press !min-h-[26px] !px-2 !py-0.5 !text-[11px] text-danger"
                                  disabled={linking}
                                  onClick={() => handleClearSessionDefault(session.id)}
                                >
                                  清除
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2">
                            {settings?.syncMode !== 'local-only' && (
                              <button
                                className="btn-primary motion-press !min-h-[30px] !px-3 !py-1.5 !text-[12px]"
                                disabled={linking || syncingSessionId === session.id}
                                onClick={() => handleSyncSession(session.id)}
                                title="把本次已关联滴答任务的专注时间同步到滴答清单"
                              >
                                <Icon.Refresh
                                  size="xs"
                                  className={
                                    syncingSessionId === session.id && syncingKind === 'dida'
                                      ? 'animate-spin'
                                      : ''
                                  }
                                />
                                {syncingSessionId === session.id && syncingKind === 'dida'
                                  ? '同步中'
                                  : '同步到滴答清单'}
                              </button>
                            )}
                            {settings?.tomatodo.enabled && (
                              <button
                                className="btn-outline motion-press !min-h-[30px] !px-3 !py-1.5 !text-[12px]"
                                disabled={linking || syncingSessionId === session.id}
                                onClick={() => handleSyncTomatodo(session.id)}
                                title="补写入或重试番茄 Todo 同步"
                              >
                                <Icon.Refresh
                                  size="xs"
                                  className={
                                    syncingSessionId === session.id && syncingKind === 'tomatodo'
                                      ? 'animate-spin'
                                      : ''
                                  }
                                />
                                {syncingSessionId === session.id && syncingKind === 'tomatodo'
                                  ? '写入中'
                                  : '补写入番茄 Todo'}
                              </button>
                            )}
                            {settings?.syncMode !== 'local-only' &&
                              detail.segments.some(
                                (segment) => segment.taskId && segment.taskSource === 'ticktick',
                              ) && <SessionSyncBadge state={syncState} />}
                            <div className="ml-auto flex items-center gap-1.5">
                              <details className="relative">
                                <summary className="btn-ghost motion-press flex min-h-[28px] cursor-pointer list-none items-center gap-1 px-2 py-1 text-[11px]">
                                  <Icon.Download size="xs" />
                                  导出
                                </summary>
                                <div className="absolute bottom-full right-0 z-20 mb-1 w-32 rounded-lg border border-border/60 bg-bg-elevated p-1 shadow-lg">
                                  {(['markdown', 'csv', 'json'] as const).map((format) => (
                                    <button
                                      key={format}
                                      className="block w-full rounded-md px-2 py-1.5 text-left text-[11px] text-fg-muted hover:bg-bg-subtle hover:text-fg"
                                      onClick={() => handleExport(session.id, format)}
                                    >
                                      {format === 'markdown' ? 'Markdown' : format.toUpperCase()}
                                    </button>
                                  ))}
                                </div>
                              </details>
                              <button
                                className="history-icon-action danger motion-press"
                                onClick={() => handleDelete(session.id)}
                                title="删除记录"
                                aria-label="删除记录"
                              >
                                <Icon.Trash size="xs" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {pickerTarget && <TaskPicker onPick={handlePick} title={pickerTarget.title} />}
    </div>
  );
}

// 历史记录 - Session 列表 + 详情 + 导出 + 删除 + Segment 任务关联/后补/批量
import '../../styles/history-motion.css';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from '../../ui/Icon';
import { useStore } from '../../app/store';
import { formatClock, formatDuration, formatRelative, formatMinutes } from '../../lib/time';
import {
  formatDayLabel,
  formatShortDate,
  getDayRange,
  getRange,
  isSameLocalDay,
  shiftLocalDay,
  startOfDay,
  summarizeAnalyticsRange,
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
import type { SessionAnalyticsResult } from '@shared/ipc/api';
import { TaskPicker } from '../tasks/TaskPicker';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
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
import { createRequestGate } from './requestGate';

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

/** ConfirmDialog 确认目标类型：替代原生 confirm() 的三处确认流 */
type ConfirmTarget =
  | { kind: 'delete-session'; sessionId: string }
  | { kind: 'batch-all'; sessionId: string; task: Task }
  | { kind: 'resync-segment'; segment: FocusSegment };

const RANGE_PRESETS: Array<{ id: RangePreset; label: string }> = [
  { id: 'today', label: '单日' },
  { id: '7d', label: '近 7 天' },
  { id: '15d', label: '半个月' },
  { id: '30d', label: '1 个月' },
  { id: 'custom', label: '自定义' },
];

/** 空 Session 列表的模块级稳定引用：避免 `analytics?.sessions ?? []` 每次渲染
    产生新数组，导致下游 useMemo 依赖不稳定（react-hooks/exhaustive-deps）。 */
const EMPTY_SESSIONS: FocusSession[] = [];

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
  const [analytics, setAnalytics] = useState<SessionAnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsRefreshing, setAnalyticsRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const expandedRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailLoadError, setDetailLoadError] = useState<{
    sessionId: string;
    message: string;
  } | null>(null);
  const detailRequestGate = useRef(createRequestGate()).current;
  const analyticsRequestGate = useRef(createRequestGate()).current;
  const hasAnalyticsRef = useRef(false);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
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
  const [rangePreset, setRangePreset] = useState<RangePreset>('today');
  const [dayCursor, setDayCursor] = useState(() => startOfDay(Date.now()));
  // 单日导航方向：-1 前一天 / 1 后一天 / 0 预设或自定义切换；供图表做有方向感的滑动入场。
  const [slideDirection, setSlideDirection] = useState<-1 | 0 | 1>(0);
  const [customStart, setCustomStart] = useState(toDateInput(Date.now()));
  const [customEnd, setCustomEnd] = useState(toDateInput(Date.now()));
  const [segmentFilter, setSegmentFilter] = useState<Record<string, SegmentFilter>>({});
  const tomatodoDefaultSubject: TomatodoSubject = settings?.tomatodo.defaultSubject ?? '学习';

  const range = useMemo(
    () =>
      rangePreset === 'today'
        ? getDayRange(dayCursor)
        : getRange(rangePreset, customStart, customEnd),
    [rangePreset, customStart, customEnd, dayCursor],
  );
  const sessions = analytics?.sessions ?? EMPTY_SESSIONS;
  // analytics.sessions is already the authoritative overlap result for the requested range.
  // Filtering again by startedAt would drop a session which began before midnight but continued
  // into the selected day, while the chart buckets correctly retained its clipped contribution.
  const filteredSessions = sessions;
  const rangeStats = useMemo(
    () => summarizeAnalyticsRange(analytics?.daily ?? [], filteredSessions.length),
    [analytics?.daily, filteredSessions.length],
  );
  const persistedSyncStates = useMemo(() => buildSessionSyncStateMap(syncQueue), [syncQueue]);
  const segmentSyncStates = useMemo(() => buildSegmentSyncStateMap(syncQueue), [syncQueue]);

  // 时间线按自然日分组（保持原有倒序，最新的一天在最上面）。
  const sessionGroups = useMemo(() => {
    const activeBySession = new Map(
      (analytics?.sessionActive ?? []).map((item) => [item.sessionId, item.activeMs]),
    );
    const groups: Array<{
      key: string;
      label: string;
      weekday: string;
      sessions: FocusSession[];
      activeMs: number;
    }> = [];
    for (const session of filteredSessions) {
      // 跨午夜会话进入单日范围时归到当前范围日，不再显示在范围外的原始开始日。
      const displayedAt = Math.max(session.startedAt, range.start);
      const key = formatDayLabel(displayedAt);
      let group = groups.find((item) => item.key === key);
      if (!group) {
        const date = new Date(displayedAt);
        group = {
          key,
          label: date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }),
          weekday: date.toLocaleDateString('zh-CN', { weekday: 'short' }),
          sessions: [],
          activeMs: 0,
        };
        groups.push(group);
      }
      group.sessions.push(session);
      group.activeMs += activeBySession.get(session.id) ?? 0;
    }
    return groups;
  }, [analytics?.sessionActive, filteredSessions, range.start]);

  // 会话条目交错入场序号：按时间线展示顺序展开，逐项延迟 40ms（封顶 560ms，总时长 ~800ms）。
  const sessionStaggerIndex = useMemo(() => {
    const map = new Map<string, number>();
    let index = 0;
    for (const group of sessionGroups) {
      for (const session of group.sessions) {
        map.set(session.id, index);
        index += 1;
      }
    }
    return map;
  }, [sessionGroups]);

  const getDisplayedSyncState = (sessionId: string) =>
    sessionSyncMeta[sessionId] ?? persistedSyncStates[sessionId] ?? NOT_SYNCED_STATE;

  const [loadError, setLoadError] = useState<string | null>(null);

  const dayCursorIsToday = isSameLocalDay(dayCursor, Date.now());
  const dayCursorDate = new Date(dayCursor);
  const dayCursorLabel = dayCursorDate.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const dayCursorWeekday = dayCursorDate.toLocaleDateString('zh-CN', { weekday: 'short' });
  const dayCursorFullLabel = `${dayCursorLabel} · ${dayCursorWeekday}`;

  const selectRangePreset = (next: RangePreset) => {
    setSlideDirection(0);
    if (next === 'today') setDayCursor(startOfDay(Date.now()));
    setRangePreset(next);
  };

  const moveSingleDay = (amount: -1 | 1) => {
    setSlideDirection(amount);
    setDayCursor((current) => {
      const next = startOfDay(shiftLocalDay(current, amount));
      return Math.min(next, startOfDay(Date.now()));
    });
  };

  const load = useCallback(async () => {
    const requestId = analyticsRequestGate.issue();
    if (!hasAnalyticsRef.current) setLoading(true);
    setAnalyticsRefreshing(true);
    setLoadError(null);
    try {
      if (!window.focuslink) {
        throw new Error('FocusLink 桌面接口未就绪');
      }
      // 混合时间轴窗口：单日视图跟随 dayCursor；多天/自定义范围锚定范围最后一天
      // （近 7/15/30 天的范围末日即今天），保证时间轴始终展示一个有意义的自然日。
      const timelineRange = getDayRange(rangePreset === 'today' ? dayCursor : range.end);
      const [nextAnalytics, queue] = await Promise.all([
        window.focuslink.sessions.analytics({
          start: range.start,
          end: range.end,
          timelineStart: timelineRange.start,
          timelineEnd: timelineRange.end,
        }),
        window.focuslink.sync.list(),
      ]);
      if (!analyticsRequestGate.isCurrent(requestId)) return;
      setAnalytics(nextAnalytics);
      hasAnalyticsRef.current = true;
      setSyncQueue(queue as SyncQueueItem[]);
      setSessionSyncMeta({});
      setSessionSegmentsById({});
    } catch (err) {
      if (!analyticsRequestGate.isCurrent(requestId)) return;
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (analyticsRequestGate.isCurrent(requestId)) {
        setLoading(false);
        setAnalyticsRefreshing(false);
      }
    }
  }, [dayCursor, rangePreset, range.end, range.start, setSyncQueue, analyticsRequestGate]);

  useEffect(() => {
    void load();
    return () => {
      // Invalidate a late IPC response after this route has unmounted.
      detailRequestGate.invalidate();
      analyticsRequestGate.invalidate();
      expandedRef.current = null;
    };
  }, [load, detailRequestGate, analyticsRequestGate]);

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
    const requestId = detailRequestGate.issue();
    setDetailLoadingId(id);
    setDetailLoadError(null);
    try {
      const d = await window.focuslink.sessions.get(id);
      if (!detailRequestGate.isCurrent(requestId) || expandedRef.current !== id) return;
      if (!d) throw new Error('这条专注记录已不存在，请刷新统计列表。');
      setDetail(d);
      setSessionSegmentsById((prev) => ({
        ...prev,
        [id]: d.segments,
      }));
      void refreshTomatodoStatus(id);
    } catch (error) {
      if (!detailRequestGate.isCurrent(requestId) || expandedRef.current !== id) return;
      setDetail(null);
      setDetailLoadError({
        sessionId: id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (detailRequestGate.isCurrent(requestId) && expandedRef.current === id) {
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
      detailRequestGate.invalidate();
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

  const handleDelete = (id: string) => {
    const isCurrentSession = currentSessionId === id;
    if (isCurrentSession && (currentTimerState === 'running' || currentTimerState === 'paused')) {
      addToast('当前专注仍在进行中，请先结束专注后再删除这条记录。', 'error');
      return;
    }
    setConfirmTarget({ kind: 'delete-session', sessionId: id });
  };

  const performDeleteSession = async (id: string) => {
    try {
      const freshSnapshot = await window.focuslink.sessions.delete(id);
      if (freshSnapshot) {
        setSnapshot(freshSnapshot);
      }
      await load();
      if (expandedRef.current === id) {
        expandedRef.current = null;
        detailRequestGate.invalidate();
        setExpanded(null);
        setDetail(null);
        setDetailLoadingId(null);
        setDetailLoadError(null);
      }
      addToast('已删除本地记录；已同步的滴答记录已清理，番茄 To-do 仅清理本机记录', 'success');
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
        // 覆盖已关联片段属于破坏性操作，先经 ConfirmDialog 确认再执行
        setConfirmTarget({ kind: 'batch-all', sessionId: target.sessionId, task });
        return;
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

  /** 批量改关联确认后的实际执行：与原 handlePick 的 batch-all 分支逻辑一致 */
  const performBatchLinkAll = async (sessionId: string, task: Task) => {
    setLinking(true);
    try {
      const count = await window.focuslink.timer.linkSegmentsBatch(
        sessionId,
        task.id,
        task.source,
        task.title,
        false,
      );
      addToast(`已把全部 ${count} 个片段关联到：${task.title}`, 'success');
      if (expanded) await reloadDetail(expanded);
      if (task.source === 'ticktick') {
        void autoSyncLinkedSession(sessionId);
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

  const handleResyncSegment = (seg: FocusSegment) => {
    if (!seg.taskId || seg.taskSource !== 'ticktick') {
      addToast('该片段未关联滴答任务，无法重新同步', 'error');
      return;
    }
    setConfirmTarget({ kind: 'resync-segment', segment: seg });
  };

  const performResyncSegment = async (seg: FocusSegment) => {
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

  /** ConfirmDialog 文案：保留操作语义，并明确本地、滴答与番茄 To-do 的不同后果。 */
  const confirmCopy = (() => {
    if (!confirmTarget) return null;
    switch (confirmTarget.kind) {
      case 'delete-session': {
        const session = sessions.find((item) => item.id === confirmTarget.sessionId);
        return {
          title: '删除专注记录',
          description: session
            ? `${formatClock(session.startedAt)} 开始 · 有效专注 ${formatDuration(session.activeElapsedMs)}\n\n将永久删除 FocusLink 本地记录，并删除已同步到滴答清单的对应专注记录。番茄 To-do 只清理本机记录，当前无法验证远端删除。`
            : '将永久删除 FocusLink 本地记录，并删除已同步到滴答清单的对应专注记录。番茄 To-do 只清理本机记录，当前无法验证远端删除。',
          confirmLabel: '永久删除',
        };
      }
      case 'batch-all':
        return {
          title: '批量改关联',
          description: '确认把本次所有专注片段（含已关联）都改为同一任务？',
          confirmLabel: '全部改关联',
        };
      case 'resync-segment':
        return {
          title: '重新同步到滴答清单',
          description:
            '确认删除该片段已同步到滴答云端的专注记录，并重新同步？\n\n这会先删除云端记录，再以当前关联的任务重新上传。\n本地数据保留不变。',
          confirmLabel: '重新同步',
        };
    }
  })();

  const handleConfirmDialog = () => {
    const target = confirmTarget;
    setConfirmTarget(null);
    if (!target) return;
    if (target.kind === 'delete-session') {
      void performDeleteSession(target.sessionId);
    } else if (target.kind === 'batch-all') {
      void performBatchLinkAll(target.sessionId, target.task);
    } else {
      void performResyncSegment(target.segment);
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
        // 番茄 Todo 语义：cloudSynced = 客户端已确认上传；本地已写未确认 = 待上传；不宣称独立云端回读。
        addToast(
          `番茄 Todo 同步：上传已确认 ${cloudSynced} 条，待上传 ${localPending} 条，失败 ${result.failed} 条`,
          'error',
        );
      } else if (cloudSynced > 0 && localPending === 0) {
        addToast(`番茄 Todo 已确认上传 ${cloudSynced} 条专注记录`, 'success');
      } else if (localPending > 0) {
        addToast(`已写入本地 ${localPending} 条，待番茄 Todo 上传`, 'info');
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

  return (
    <div className="history-page h-full overflow-y-auto px-6 py-4">
      <div className="history-shell">
        {/* 页面头：标题 + 范围筛选 + 单日导航 */}
        <header className="history-header">
          <div className="history-header-lead">
            <h1 className="text-page-title">统计</h1>
            <p className="history-subtitle">
              {rangePreset === 'today' ? (
                <>
                  <span>单日视图</span>
                  <i />
                  <span>{filteredSessions.length} 条记录</span>
                </>
              ) : (
                <>
                  <span>
                    {formatShortDate(range.start)} – {formatShortDate(range.end)}
                  </span>
                  <i />
                  <span>
                    {filteredSessions.length} / {sessions.length} 条记录
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="history-header-controls">
            <span
              className={`history-range-refresh ${analyticsRefreshing ? 'is-visible' : ''}`}
              role="status"
              aria-live="polite"
            >
              <Icon.Loader size="xs" className={analyticsRefreshing ? 'motion-spin' : ''} />
              更新数据
            </span>
            <div className="history-filter-row">
              <span className="history-filter-label">时间范围</span>
              <div className="history-filter-buttons" role="group" aria-label="时间范围筛选">
                {RANGE_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`motion-press ${
                      rangePreset === item.id ? 'bg-accent text-accent-fg' : ''
                    }`}
                    onClick={() => selectRangePreset(item.id)}
                    aria-pressed={rangePreset === item.id}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            {rangePreset === 'today' && (
              <div className="history-day-navigator" aria-label="单日日期导航">
                <button
                  type="button"
                  className="motion-press"
                  onClick={() => moveSingleDay(-1)}
                  aria-label="前一天"
                  title="前一天"
                >
                  <Icon.ChevronLeft size="sm" />
                </button>
                <button
                  type="button"
                  className="history-day-current motion-press"
                  onClick={() => setDayCursor(startOfDay(Date.now()))}
                  aria-label={dayCursorIsToday ? `当前日期：${dayCursorFullLabel}` : '回到今天'}
                  title={dayCursorIsToday ? dayCursorFullLabel : '回到今天'}
                >
                  <strong>{dayCursorFullLabel}</strong>
                  <span>{dayCursorIsToday ? '今天' : '回到今天'}</span>
                </button>
                <button
                  type="button"
                  className="motion-press"
                  onClick={() => moveSingleDay(1)}
                  disabled={dayCursorIsToday}
                  aria-label="后一天"
                  title={dayCursorIsToday ? '今天之后没有统计数据' : '后一天'}
                >
                  <Icon.ChevronRight size="sm" />
                </button>
              </div>
            )}
            {rangePreset === 'custom' && (
              <div className="history-custom-range">
                <input
                  type="date"
                  className="input"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
                <span>至</span>
                <input
                  type="date"
                  className="input"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </div>
            )}
          </div>
        </header>

        {/* 统一分析画布：零数据时同样渲染，由 HistoryInsights 提供完整零状态
            （state-block 说明 + 空图表骨架），不隐藏统计区域。 */}
        <HistoryInsights
          summary={rangeStats}
          range={range}
          analytics={analytics}
          slideDirection={slideDirection}
          onSelectRange={selectRangePreset}
          onOpenSession={toggleExpand}
        />

        {/* 会话时间线（按日分组） */}
        {filteredSessions.length > 0 && (
          <section className="history-timeline" aria-label="历史会话时间线">
            <header className="history-timeline-header">
              <span className="history-section-title">
                <Icon.History size="sm" tone="accent" />
                会话时间线
              </span>
              <span className="history-timeline-meta">
                {filteredSessions.length} 次会话 · 展开查看片段与同步状态
              </span>
            </header>
            {sessionGroups.map((group) => (
              <div className="history-day-group" key={group.key}>
                <header className="history-day-header">
                  <span className="history-day-title">
                    {group.label}
                    <small>{group.weekday}</small>
                  </span>
                  <span className="history-day-meta">
                    专注 <strong>{formatMinutes(group.activeMs)}</strong> · {group.sessions.length}{' '}
                    次
                  </span>
                </header>
                <div className="history-day-sessions">
                  {group.sessions.map((session) => {
                    const syncState = getDisplayedSyncState(session.id);
                    const rowSegments =
                      detail?.session.id === session.id
                        ? detail.segments
                        : sessionSegmentsById[session.id];
                    const hasTicktickSegments = rowSegments
                      ? rowSegments.some(
                          (segment) => segment.taskId && segment.taskSource === 'ticktick',
                        )
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
                      <div
                        key={session.id}
                        className="history-session hm-stagger-in"
                        style={
                          {
                            '--hm-delay': `${Math.min((sessionStaggerIndex.get(session.id) ?? 0) * 40, 560)}ms`,
                          } as CSSProperties
                        }
                      >
                        <button
                          type="button"
                          className="history-session-row"
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
                                {formatClock(session.startedAt)} 开始 · 专注{' '}
                                {formatDuration(session.activeElapsedMs)}
                              </div>
                            ) : (
                              <div className="mt-0.5 text-[12px] leading-relaxed text-fg-subtle">
                                {formatClock(session.startedAt)}
                                {session.endedAt && ` → ${formatClock(session.endedAt)}`}
                              </div>
                            )}
                            <div className="history-ratio-track" aria-hidden="true">
                              <span className="focus" style={{ width: `${activeRatio}%` }} />
                              <span className="pause" style={{ width: `${pauseRatio}%` }} />
                            </div>
                            {session.defaultTaskTitle && (
                              <div className="mt-1 flex items-center gap-1 text-[11px] text-success">
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
                                className="history-session-detail"
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
                              className="history-session-detail error"
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
                              className="history-session-detail"
                            >
                              <div className="history-session-detail-body">
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
                                <div className="history-batch-section">
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
                                <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2.5">
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
                                          syncingSessionId === session.id &&
                                          syncingKind === 'tomatodo'
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
                                      (segment) =>
                                        segment.taskId && segment.taskSource === 'ticktick',
                                    ) && <SessionSyncBadge state={syncState} />}
                                  <div className="ml-auto flex items-center gap-1.5">
                                    <details className="relative">
                                      <summary className="btn-ghost motion-press flex min-h-[28px] cursor-pointer list-none items-center gap-1 px-2 py-1 text-[11px]">
                                        <Icon.Download size="xs" />
                                        导出
                                      </summary>
                                      <div className="absolute bottom-full right-0 z-20 mb-1 w-32 rounded-lg border border-border/60 bg-bg-elevated p-1">
                                        {(['markdown', 'csv', 'json'] as const).map((format) => (
                                          <button
                                            key={format}
                                            className="block w-full rounded-md px-2 py-1.5 text-left text-[11px] text-fg-muted hover:bg-bg-subtle hover:text-fg"
                                            onClick={() => handleExport(session.id, format)}
                                          >
                                            {format === 'markdown'
                                              ? 'Markdown'
                                              : format.toUpperCase()}
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
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      {pickerTarget && <TaskPicker onPick={handlePick} title={pickerTarget.title} />}
      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmCopy?.title ?? ''}
        description={confirmCopy?.description}
        confirmLabel={confirmCopy?.confirmLabel}
        danger
        onConfirm={handleConfirmDialog}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}

// 历史记录 - Session 列表 + 详情 + 导出 + 删除 + Segment 任务关联/后补/批量
// v0.4.0 Calm Studio 重设计：
//   - 发丝边框、surface 阶梯分层、8px 卡片圆角、6px 小元素圆角
//   - 克制的文字层级：heading 15px / body 13px / meta 11px / eyebrow 10.5px
//   - 统一按钮系统 btn / btn-primary / btn-outline / btn-ghost
//   - status-chip 状态徽章、kbd-chip 键位、eyebrow 分类标签
//   - 动效更克制：移除 lift/shimmer/card-float 等装饰性动效
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from './Icon';
import { useStore } from '../store/useStore';
import { formatDuration, formatDateTime, formatRelative, formatMinutes } from '../lib/time';
import {
  filterSessionsByRange,
  formatShortDate,
  getRange,
  groupByDay,
  groupByWeek,
  summarizeSessions,
  toDateInput,
  type PeriodSummary,
  type RangePreset,
} from '../lib/historyStats';
import {
  buildSessionSyncStateMap,
  NOT_SYNCED_STATE,
  type SessionSyncState,
} from '../lib/syncStatus';
import type { FocusSession, FocusSegment, PauseEvent, SyncQueueItem, Task } from '@shared/types';
import { TaskPicker } from './TaskPicker';

interface SessionDetail {
  session: FocusSession;
  segments: FocusSegment[];
  pauses: PauseEvent[];
}

/** TaskPicker 弹窗目标类型 */
type PickerTarget =
  | { kind: 'segment'; segmentId: string; title: string }
  | { kind: 'session-default'; sessionId: string; title: string }
  | { kind: 'batch-unlinked'; sessionId: string; title: string }
  | { kind: 'batch-all'; sessionId: string; title: string };

/** 专注片段过滤模式 */
type SegmentFilter = 'all' | 'unlinked' | 'linked';

export function HistoryPanel() {
  const { snapshot, addToast, setSnapshot } = useStore();
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [linking, setLinking] = useState(false);
  const [syncingSessionId, setSyncingSessionId] = useState<string | null>(null);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(() => new Set());
  const [sessionSyncMeta, setSessionSyncMeta] = useState<Record<string, SessionSyncState>>({});
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [sessionSegmentsById, setSessionSegmentsById] = useState<Record<string, FocusSegment[]>>(
    {},
  );
  const [rangePreset, setRangePreset] = useState<RangePreset>('today');
  const [customStart, setCustomStart] = useState(toDateInput(Date.now()));
  const [customEnd, setCustomEnd] = useState(toDateInput(Date.now()));
  // 每个 Session 的专注片段过滤模式
  const [segmentFilter, setSegmentFilter] = useState<Record<string, SegmentFilter>>({});
  // 每个 Session 的暂停记录展开状态（默认折叠）
  const [pausesExpanded, setPausesExpanded] = useState<Record<string, boolean>>({});

  const range = useMemo(
    () => getRange(rangePreset, customStart, customEnd),
    [rangePreset, customStart, customEnd],
  );
  const filteredSessions = useMemo(
    () => filterSessionsByRange(sessions, range),
    [sessions, range.start, range.end],
  );
  const rangeStats = useMemo(() => summarizeSessions(filteredSessions), [filteredSessions]);
  const dailyStats = useMemo(
    () => groupByDay(filteredSessions, range),
    [filteredSessions, range.start, range.end],
  );
  const weeklyStats = useMemo(
    () => groupByWeek(filteredSessions, range),
    [filteredSessions, range.start, range.end],
  );
  const persistedSyncStates = useMemo(() => buildSessionSyncStateMap(syncQueue), [syncQueue]);

  const getDisplayedSyncState = (sessionId: string) =>
    sessionSyncMeta[sessionId] ?? persistedSyncStates[sessionId] ?? NOT_SYNCED_STATE;

  const load = async () => {
    const [list, queue] = await Promise.all([
      window.focuslink.sessions.list(100),
      window.focuslink.sync.list(),
    ]);
    const sessionList = list as FocusSession[];
    setSessions(sessionList);
    setSyncQueue(queue as SyncQueueItem[]);
    const segmentEntries = await Promise.all(
      sessionList.map(async (session) => {
        try {
          const d = await window.focuslink.sessions.get(session.id);
          return [session.id, d?.segments ?? []] as const;
        } catch {
          return [session.id, []] as const;
        }
      }),
    );
    setSessionSegmentsById(Object.fromEntries(segmentEntries));
  };

  useEffect(() => {
    load();
  }, []);

  const reloadDetail = async (id: string) => {
    const d = await window.focuslink.sessions.get(id);
    setDetail(d);
    setSessionSegmentsById((prev) => ({
      ...prev,
      [id]: d?.segments ?? [],
    }));
  };

  const refreshSyncQueue = async () => {
    const queue = await window.focuslink.sync.list();
    setSyncQueue(queue as SyncQueueItem[]);
  };

  const toggleExpand = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(id);
    setDetail(null);
    const d = await window.focuslink.sessions.get(id);
    setDetail(d);
  };

  const handleDelete = async (id: string) => {
    const isCurrentSession = snapshot?.sessionId === id;
    if (
      isCurrentSession &&
      snapshot &&
      (snapshot.state === 'running' || snapshot.state === 'paused')
    ) {
      addToast('当前专注仍在进行中，请先结束专注后再删除这条记录。', 'error');
      return;
    }
    if (!confirm('确认删除这条专注记录？本地记录和已同步到滴答云端的专注记录都将被删除。')) return;
    try {
      // sessions:delete 会先删除云端专注记录，再删除本地数据
      const freshSnapshot = await window.focuslink.sessions.delete(id);
      // 始终用最新快照更新 UI，防止计时界面空白
      if (freshSnapshot) {
        setSnapshot(freshSnapshot);
      }
      await load();
      if (expanded === id) {
        setExpanded(null);
        setDetail(null);
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

  // TaskPicker 确认回调：根据 target 类型路由到不同 IPC
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
      // 刷新详情
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

  // 清除某 segment 的任务关联
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

  // 清除 session 默认任务
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

  /** 删除单个片段的云端专注记录并重新同步（保留本地数据） */
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
      const result = await window.focuslink.sync.runPending();
      await refreshSyncQueue();
      if (result.failed > 0) {
        setSessionSyncMeta((prev) => ({
          ...prev,
          [sessionId]: {
            label: `失败 ${result.failed} 条`,
            tone: 'error',
            title: '同步队列里有失败项，请检查设置、CLI 或网络',
          },
        }));
        addToast('任务已关联，但自动同步失败；可在同步队列重试。', 'error');
        return;
      }
      setSessionSyncMeta((prev) => ({
        ...prev,
        [sessionId]: {
          label: result.succeeded > 0 ? `已同步 ${result.succeeded} 条` : '未同步',
          tone: result.succeeded > 0 ? 'ok' : 'muted',
          title:
            result.succeeded > 0
              ? '同步到滴答清单已完成'
              : '没有新的未同步队列项；可能已同步，或没有有效滴答片段',
        },
      }));
      if (result.succeeded > 0) {
        addToast(`已自动同步 ${result.succeeded} 条专注记录到滴答清单`, 'success');
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
    }
  };

  const handleSyncSession = async (sessionId: string) => {
    if (syncingSessionId) return;
    setSyncingSessionId(sessionId);
    try {
      const detailForSync: SessionDetail | null =
        detail?.session.id === sessionId ? detail : await window.focuslink.sessions.get(sessionId);
      // 只同步已结束、已关联滴答任务的片段（运行中的片段无法同步）
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
            label: '无滴答片段',
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

      // 检测已同步的片段：如果存在，询问是否删除云端旧记录并重新同步
      // （修复云端时间偏大等历史错误记录）
      const alreadySyncedSegments = ticktickSegments.filter((seg) => seg.cloudFocusId);
      const unsyncedSegments = ticktickSegments.filter((seg) => !seg.cloudFocusId);

      let useResync = false;
      if (alreadySyncedSegments.length > 0) {
        const msg =
          alreadySyncedSegments.length === ticktickSegments.length
            ? `本次 ${ticktickSegments.length} 个片段都已同步到云端。\n\n如果云端记录有误（如时间偏大），可以删除云端旧记录并重新上传正确的专注时长。\n\n点击"确定"删除云端旧记录并重新同步；点击"取消"则跳过已同步的片段。`
            : `本次有 ${alreadySyncedSegments.length} 个片段已同步、${unsyncedSegments.length} 个未同步。\n\n如果云端记录有误（如时间偏大），可以删除云端旧记录并重新上传正确的专注时长。\n\n点击"确定"删除云端旧记录并重新同步全部片段；点击"取消"则只同步未同步的片段。`;
        useResync = confirm(msg);
      }

      if (useResync) {
        // 走重新同步路径：对每个片段先删云端再重新上传
        setSessionSyncMeta((prev) => ({
          ...prev,
          [sessionId]: {
            label: '重新同步中',
            tone: 'warn',
            title: '正在删除云端记录并重新上传',
          },
        }));
        let succeeded = 0;
        let failed = 0;
        for (const seg of ticktickSegments) {
          try {
            const result = await window.focuslink.sync.resyncSegment(seg.id);
            if (result.ok) succeeded++;
            else failed++;
          } catch {
            failed++;
          }
        }
        await refreshSyncQueue();
        if (expanded) await reloadDetail(expanded);
        if (failed === 0) {
          setSessionSyncMeta((prev) => ({
            ...prev,
            [sessionId]: {
              label: `已重新同步 ${succeeded} 条`,
              tone: 'ok',
              title: '云端记录已删除并重新上传',
            },
          }));
          addToast(`已删除云端记录并重新同步 ${succeeded} 条`, 'success');
        } else {
          setSessionSyncMeta((prev) => ({
            ...prev,
            [sessionId]: {
              label: `成功 ${succeeded} / 失败 ${failed}`,
              tone: 'error',
              title: '部分片段重新同步失败，请查看日志',
            },
          }));
          addToast(`重新同步完成：成功 ${succeeded} 条，失败 ${failed} 条`, 'error');
        }
        return;
      }

      await window.focuslink.sync.enqueueSession(sessionId);
      const result = await window.focuslink.sync.runPending();
      await refreshSyncQueue();
      if (result.failed > 0) {
        setSessionSyncMeta((prev) => ({
          ...prev,
          [sessionId]: {
            label: `失败 ${result.failed} 条`,
            tone: 'error',
            title: '同步队列里有失败项，请检查设置或网络',
          },
        }));
        addToast(
          `同步完成 ${result.succeeded} 条，失败 ${result.failed} 条；请检查同步队列。`,
          'error',
        );
      } else if (result.succeeded > 0) {
        setSessionSyncMeta((prev) => ({
          ...prev,
          [sessionId]: {
            label: `已同步 ${result.succeeded} 条`,
            tone: 'ok',
            title: '本次同步已成功写入滴答云端',
          },
        }));
        addToast(`已同步 ${result.succeeded} 条专注记录到滴答清单`, 'success');
      } else {
        setSessionSyncMeta((prev) => ({
          ...prev,
          [sessionId]: {
            label: '未同步',
            tone: 'warn',
            title: '没有新的未同步队列项（可能已全部同步）',
          },
        }));
        addToast('没有需要同步的滴答任务记录（可能已全部同步）', 'info');
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
    }
  };

  /** 会话级重新同步：删除所有已关联滴答任务的片段的云端记录，然后重新上传 */
  const handleResyncSession = async (sessionId: string) => {
    if (syncingSessionId) return;
    setSyncingSessionId(sessionId);
    try {
      const detailForSync: SessionDetail | null =
        detail?.session.id === sessionId ? detail : await window.focuslink.sessions.get(sessionId);
      const ticktickSegments =
        detailForSync?.segments.filter(
          (seg) => seg.taskId && seg.taskSource === 'ticktick' && seg.endedAt,
        ) ?? [];

      if (ticktickSegments.length === 0) {
        addToast('没有已关联滴答任务且已结束的片段', 'info');
        return;
      }

      if (
        !confirm(
          `确认删除本次 ${ticktickSegments.length} 个片段已同步到滴答云端的专注记录，并重新同步？\n\n这会先删除云端记录，再以当前关联的任务和正确的专注时长重新上传。\n本地数据保留不变。\n\n适用于修复云端时间偏大等错误记录。`,
        )
      )
        return;

      setSessionSyncMeta((prev) => ({
        ...prev,
        [sessionId]: {
          label: '重新同步中',
          tone: 'warn',
          title: '正在删除云端记录并重新上传',
        },
      }));

      let succeeded = 0;
      let failed = 0;
      for (const seg of ticktickSegments) {
        try {
          const result = await window.focuslink.sync.resyncSegment(seg.id);
          if (result.ok) succeeded++;
          else failed++;
        } catch {
          failed++;
        }
      }

      await refreshSyncQueue();
      if (expanded) await reloadDetail(expanded);

      if (failed === 0) {
        setSessionSyncMeta((prev) => ({
          ...prev,
          [sessionId]: {
            label: `已重新同步 ${succeeded} 条`,
            tone: 'ok',
            title: '云端记录已删除并重新上传',
          },
        }));
        addToast(`已删除云端记录并重新同步 ${succeeded} 条`, 'success');
      } else {
        setSessionSyncMeta((prev) => ({
          ...prev,
          [sessionId]: {
            label: `成功 ${succeeded} / 失败 ${failed}`,
            tone: 'error',
            title: '部分片段重新同步失败，请查看日志',
          },
        }));
        addToast(`重新同步完成：成功 ${succeeded} 条，失败 ${failed} 条`, 'error');
      }
    } catch (e) {
      await refreshSyncQueue().catch(() => undefined);
      setSessionSyncMeta((prev) => ({
        ...prev,
        [sessionId]: {
          label: '重新同步失败',
          tone: 'error',
          title: (e as Error).message,
        },
      }));
      addToast('重新同步失败：' + (e as Error).message, 'error');
    } finally {
      setSyncingSessionId(null);
    }
  };

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
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto max-w-4xl">
        {/* 页头 */}
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-fg">历史记录</h2>
            <p className="mt-0.5 text-[11px] text-fg-subtle">
              按日期和周期查看专注时间，以及每个片段花在哪个任务上。
            </p>
          </div>
          <span className="rounded-md border border-border/60 bg-bg-card/50 px-2 py-0.5 text-[11px] font-medium text-fg-muted">
            {filteredSessions.length} / {sessions.length} 条记录
          </span>
        </div>

        {/* 筛选与统计 */}
        <div className="mb-3 space-y-2.5">
          {/* 时间筛选卡片 */}
          <div className="rounded-lg border border-border/70 bg-bg-card/60 p-3">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                <Icon.Calendar size="sm" tone="accent" />
                时间筛选
              </div>
              <span className="text-[11px] text-fg-subtle">
                {formatShortDate(range.start)} - {formatShortDate(range.end)}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {RANGE_PRESETS.map((item) => (
                <button
                  key={item.id}
                  className={`motion-press rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
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

          {/* 四项统计 */}
          <div className="grid gap-2 md:grid-cols-4">
            <DetailStat label="筛选专注" value={formatDuration(rangeStats.active)} />
            <DetailStat label="暂停" value={formatDuration(rangeStats.pause)} tone="warn" />
            <DetailStat label="总历时" value={formatDuration(rangeStats.wall)} />
            <DetailStat label="Session" value={String(rangeStats.count)} />
          </div>

          {/* 按天/按周 */}
          <div className="grid gap-2.5 lg:grid-cols-2">
            <SummaryPanel title="按天" icon={<Icon.BarChart size="sm" />} items={dailyStats} />
            <SummaryPanel title="按周" icon={<Icon.Calendar size="sm" />} items={weeklyStats} />
          </div>
        </div>

        {/* Session 列表 */}
        {filteredSessions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-bg-subtle/20 py-10 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-bg-subtle/60 text-fg-subtle">
              <Icon.Inbox size="xl" />
            </div>
            <p className="text-[13px] font-medium text-fg-muted">当前时间范围没有专注记录</p>
            <p className="mt-1 text-[11px] text-fg-subtle">换一个筛选范围，或者开始一次新的专注。</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredSessions.map((session) => {
              const syncState = getDisplayedSyncState(session.id);
              return (
                <motion.div
                  key={session.id}
                  layout
                  className="rounded-lg border border-border/70 bg-bg-card/60 overflow-hidden transition-colors hover:border-border"
                >
                  <button
                    className="motion-base flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg-subtle/50"
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
                        <span className="timer-digit text-[13px] font-semibold text-fg">
                          {formatMinutes(session.activeElapsedMs)}
                        </span>
                        <span className="text-[11px] text-fg-subtle">
                          {formatRelative(session.startedAt)}
                        </span>
                      </div>
                      {session.endedAt &&
                      session.wallElapsedMs > session.activeElapsedMs + 60000 ? (
                        /* 总历时远大于专注时长（含大量暂停）：避免 "开始→结束" 时间段误导 */
                        <div className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
                          {formatDateTime(session.startedAt)} 开始 · 专注{' '}
                          {formatDuration(session.activeElapsedMs)}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
                          {formatDateTime(session.startedAt)}
                          {session.endedAt && ` → ${formatDateTime(session.endedAt)}`}
                        </div>
                      )}
                      {/* 默认任务标题预览 */}
                      {session.defaultTaskTitle && (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-400/80">
                          <Icon.Star size="xs" />
                          <span className="truncate">{session.defaultTaskTitle}</span>
                        </div>
                      )}
                    </div>
                    <div className="hidden items-center gap-2 text-[11px] text-fg-muted sm:flex">
                      <SessionLinkPreview
                        session={session}
                        segments={
                          detail?.session.id === session.id
                            ? detail.segments
                            : sessionSegmentsById[session.id]
                        }
                      />
                      <SessionSyncBadge state={syncState} />
                      <span>专注 {formatDuration(session.activeElapsedMs)}</span>
                      {session.pauseElapsedMs > 0 && (
                        <span>暂停 {formatDuration(session.pauseElapsedMs)}</span>
                      )}
                    </div>
                  </button>

                  <AnimatePresence>
                    {expanded === session.id && detail?.session.id === session.id && (
                      <motion.div
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
                          />

                          <HistoryTimelineList
                            segments={detail.segments}
                            pauses={detail.pauses}
                            filter={segmentFilter[session.id] ?? 'all'}
                            linking={linking}
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
                            completedTaskIds={completedTaskIds}
                          />

                          <div className="grid gap-3 xl:grid-cols-[1fr_280px]">
                            <BatchLinkPanel
                              sessionId={session.id}
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

                            <SessionDefaultTaskCard
                              detail={detail}
                              linking={linking}
                              onSet={() =>
                                setPickerTarget({
                                  kind: 'session-default',
                                  sessionId: session.id,
                                  title: '设置本次专注默认任务',
                                })
                              }
                              onClear={() => handleClearSessionDefault(session.id)}
                            />
                          </div>

                          {/* 操作栏 */}
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            <button
                              className="btn-primary motion-press !text-[12px] !min-h-[30px] !py-1.5 !px-3"
                              disabled={linking || syncingSessionId === session.id}
                              onClick={() => handleSyncSession(session.id)}
                              title="把本次已关联滴答任务的专注时间同步到滴答云端；已存在的会跳过"
                            >
                              <Icon.Refresh
                                size="xs"
                                className={syncingSessionId === session.id ? 'animate-spin' : ''}
                              />
                              {syncingSessionId === session.id ? '同步中' : '同步到滴答清单'}
                            </button>
                            <button
                              className="btn-outline motion-press !text-[12px] !min-h-[30px] !py-1.5 !px-3 border-accent/30 text-accent hover:bg-accent/10"
                              disabled={linking || syncingSessionId === session.id}
                              onClick={() => handleResyncSession(session.id)}
                              title="删除云端专注记录并以正确的专注时长重新上传（修复云端时间偏大等错误）"
                            >
                              <Icon.Refresh
                                size="xs"
                                className={syncingSessionId === session.id ? 'animate-spin' : ''}
                              />
                              重新同步
                            </button>
                            <SessionSyncBadge state={syncState} />
                            <div className="ml-auto flex items-center gap-1">
                              <button
                                className="btn-ghost motion-press !text-[11px] !min-h-[28px] !py-1 !px-2"
                                onClick={() => handleExport(session.id, 'markdown')}
                              >
                                <Icon.Download size="xs" /> MD
                              </button>
                              <button
                                className="btn-ghost motion-press !text-[11px] !min-h-[28px] !py-1 !px-2"
                                onClick={() => handleExport(session.id, 'csv')}
                              >
                                <Icon.Download size="xs" /> CSV
                              </button>
                              <button
                                className="btn-ghost motion-press !text-[11px] !min-h-[28px] !py-1 !px-2"
                                onClick={() => handleExport(session.id, 'json')}
                              >
                                <Icon.Download size="xs" /> JSON
                              </button>
                              <button
                                className="btn-ghost motion-press !text-[11px] !min-h-[28px] !py-1 !px-2 text-rose-400 hover:bg-rose-500/10"
                                onClick={() => handleDelete(session.id)}
                              >
                                <Icon.Trash size="xs" /> 删除
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

      {/* TaskPicker 弹窗 */}
      {pickerTarget && (
        <TaskPicker onPick={handlePick} title={pickerTarget.title} confirmLabel="关联" />
      )}
    </div>
  );
}

const RANGE_PRESETS: Array<{ id: RangePreset; label: string }> = [
  { id: 'today', label: '今天' },
  { id: 'yesterday', label: '昨天' },
  { id: '7d', label: '近 7 天' },
  { id: '15d', label: '半个月' },
  { id: '30d', label: '1 个月' },
  { id: 'custom', label: '自定义' },
];

/* ─── 子组件 ─── */

function SessionLinkPreview({
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

function SessionSyncBadge({ state }: { state: SessionSyncState }) {
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
    <span
      title={state.title}
      className={`status-chip ${cls}`}
    >
      <StateIcon size="xs" />
      {state.label}
    </span>
  );
}

function SessionDetailHeader({
  detail,
  syncState,
  syncing,
}: {
  detail: SessionDetail;
  syncState: SessionSyncState;
  syncing: boolean;
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
            <SessionSyncBadge
              state={
                syncing ? { label: '同步中', tone: 'warn', title: '正在处理同步队列' } : syncState
              }
            />
            <TinyStatusChip
              tone="ok"
              icon={<Icon.CheckCircleFilled size="xs" />}
              text="本地已保存"
              title="Session、专注片段、暂停片段已写入本地 SQLite"
            />
            <TinyStatusChip
              tone={syncState.tone === 'ok' ? 'ok' : ticktick.length > 0 ? 'warn' : 'muted'}
              icon={<Icon.Refresh size="xs" />}
              text={
                syncState.tone === 'ok'
                  ? `滴答已同步 · ${formatDuration(ticktickMs)}`
                  : ticktick.length > 0
                    ? `滴答未同步 · ${ticktick.length} 段`
                    : '无滴答片段'
              }
              title={
                syncState.tone === 'ok'
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
          <TinyStat label="暂停" value={formatDuration(session.pauseElapsedMs)} tone="warning" />
          <TinyStat label="片段" value={`${segments.length}+${pauses.length}`} />
        </div>
      </div>
    </div>
  );
}

function TinyStatusChip({
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

function TinyStat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        tone === 'warning' ? 'border-warning/25 bg-warning/10' : 'border-border/60 bg-bg-card/50'
      }`}
    >
      <div
        className={`timer-digit text-[12px] font-semibold ${
          tone === 'warning' ? 'text-warning' : 'text-fg'
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10.5px] font-medium text-fg-subtle">{label}</div>
    </div>
  );
}

function SessionDefaultTaskCard({
  detail,
  linking,
  onSet,
  onClear,
}: {
  detail: SessionDetail;
  linking: boolean;
  onSet: () => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg-card/50 p-3">
      <div className="flex h-full flex-col justify-between gap-2.5">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-1">
            <Icon.Star size="xs" tone="accent" />
            本次默认任务
          </p>
          <p className="mt-1.5 truncate text-[13px] font-medium text-fg">
            {detail.session.defaultTaskTitle ?? '未设置'}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
            继续专注时，新专注片段会沿用这个任务。
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="btn-outline motion-press !text-[11px] !min-h-[28px] !py-1 !px-2.5"
            disabled={linking}
            onClick={onSet}
          >
            <Icon.Star size="xs" />
            {detail.session.defaultTaskTitle ? '更换' : '设置'}
          </button>
          {detail.session.defaultTaskTitle && (
            <button
              className="btn-ghost motion-press !text-[11px] !min-h-[28px] !py-1 !px-2 text-rose-400 hover:bg-rose-500/10"
              disabled={linking}
              onClick={onClear}
              title="清除默认任务"
            >
              <Icon.Unlink size="xs" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type HistoryTimelineItem =
  | { type: 'focus'; segment: FocusSegment; index: number; startedAt: number }
  | { type: 'pause'; pause: PauseEvent; index: number; startedAt: number };

function HistoryTimelineList({
  segments,
  pauses,
  filter,
  linking,
  onLink,
  onClear,
  onComplete,
  onResync,
  completedTaskIds,
}: {
  segments: FocusSegment[];
  pauses: PauseEvent[];
  filter: SegmentFilter;
  linking: boolean;
  onLink: (segmentId: string, index: number) => void;
  onClear: (segmentId: string) => void;
  onComplete: (seg: FocusSegment) => void;
  onResync: (seg: FocusSegment) => void;
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
      const hasTask = !!segment.taskId && !!segment.title;
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
                onLink={() => onLink(item.segment.id, item.index)}
                onClear={() => onClear(item.segment.id)}
                onComplete={() => onComplete(item.segment)}
                onResync={() => onResync(item.segment)}
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
  onLink,
  onClear,
  onComplete,
  onResync,
  isTaskCompleted,
}: {
  seg: FocusSegment;
  index: number;
  linking: boolean;
  onLink: () => void;
  onClear: () => void;
  onComplete: () => void;
  onResync: () => void;
  isTaskCompleted: boolean;
}) {
  const hasTask = !!seg.taskId && !!seg.title;
  const isSynced = !!seg.cloudFocusId;
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
          {isSynced && (
            <span
              className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10.5px] text-accent"
              title="已同步到滴答云端"
            >
              已同步
            </span>
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
              className="motion-press rounded-md border border-border/50 bg-bg-card/50 px-1.5 py-1 text-[10.5px] text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"
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
            <button
              className="motion-press rounded-md border border-accent/20 bg-accent/5 px-1.5 py-1 text-[10.5px] text-accent hover:bg-accent/10 disabled:opacity-40"
              disabled={linking}
              onClick={onResync}
              title="删除云端专注记录并以当前任务重新同步"
            >
              重新同步
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function HistoryPauseTimelineRow({ pause, index }: { pause: PauseEvent; index: number }) {
  return (
    <div className="relative flex gap-2.5 rounded-md border border-warning/15 bg-warning/5 px-2.5 py-2">
      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-warning/20 bg-warning/10 text-warning">
        <Icon.Coffee size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-semibold text-warning">暂停片段 {index + 1}</span>
          <span className="timer-digit text-[12px] font-semibold text-warning">
            {formatDuration(pause.durationMs)}
          </span>
          <span className="truncate text-[11px] text-fg-subtle">
            {formatDateTime(pause.pauseStartedAt)}
            {pause.pauseEndedAt ? ` - ${formatDateTime(pause.pauseEndedAt)}` : ' - 进行中'}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-fg-subtle">
          暂停记录只计入休息时间，不参与任务同步。
        </p>
      </div>
    </div>
  );
}

// ─── A. Session 总览（备用组件，保留以备扩展） ────────────────────
function SessionOverview({ detail }: { detail: SessionDetail }) {
  const { session, segments, pauses } = detail;
  const linkedCount = segments.filter((s) => s.taskId && s.title).length;
  const unlinkedCount = segments.length - linkedCount;
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
      <DetailStat label="总历时" value={formatDuration(session.wallElapsedMs)} />
      <DetailStat label="累计专注" value={formatDuration(session.activeElapsedMs)} />
      <DetailStat label="累计暂停" value={formatDuration(session.pauseElapsedMs)} tone="warn" />
      <DetailStat label="专注片段" value={String(segments.length)} />
      <DetailStat label="暂停片段" value={String(pauses.length)} />
      <DetailStat
        label="未关联"
        value={String(unlinkedCount)}
        tone={unlinkedCount > 0 ? 'warn' : 'muted'}
      />
    </div>
  );
}

// ─── B. 本地 / 云端状态（备用组件） ──────────────────────────────
function LocalCloudStatePanel({ detail }: { detail: SessionDetail }) {
  const { segments } = detail;
  const linked = segments.filter((seg) => seg.taskId && seg.taskSource);
  const ticktick = linked.filter((seg) => seg.taskSource === 'ticktick');
  const unlinked = Math.max(0, segments.length - linked.length);
  const ticktickMs = ticktick.reduce((sum, seg) => sum + seg.activeElapsedMs, 0);

  return (
    <div className="rounded-lg border border-border/60 bg-bg-subtle/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-fg-muted">
            <Icon.Cloud size="sm" tone="subtle" />
            本地 / 云端状态
          </div>
          <div className="mt-2 space-y-0.5 text-[11px] leading-relaxed">
            <div className="flex items-center gap-1.5">
              <Icon.CheckCircleFilled size="xs" tone="success" />
              <span className="text-fg-muted">本地记录：已保存</span>
            </div>
            <div className="flex items-center gap-1.5">
              {unlinked > 0 ? (
                <>
                  <Icon.AlertCircle size="xs" tone="warning" />
                  <span className="text-warning">本地任务关联：有 {unlinked} 个未关联</span>
                </>
              ) : (
                <>
                  <Icon.CheckCircleFilled size="xs" tone="success" />
                  <span className="text-fg-muted">本地任务关联：已保存</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Icon.CloudOff size="xs" className="text-danger/80" />
              <span className="text-danger/80">滴答清单专注记录：未写入</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Icon.Refresh
                size="xs"
                tone={ticktick.length > 0 ? 'success' : 'subtle'}
              />
              <span className="text-fg-muted">
                滴答清单同步：未同步 {ticktick.length} 个片段（{formatDuration(ticktickMs)}）
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── C. 批量任务关联区域 ──────────────────────────────────────────
function BatchLinkPanel({
  sessionId: _sessionId,
  segments,
  linking,
  filter,
  onFilterChange,
  onBatchUnlinked,
  onBatchAll,
}: {
  sessionId: string;
  segments: FocusSegment[];
  linking: boolean;
  filter: SegmentFilter;
  onFilterChange: (f: SegmentFilter) => void;
  onBatchUnlinked: () => void;
  onBatchAll: () => void;
}) {
  const unlinkedCount = segments.filter((s) => !s.taskId || !s.title).length;
  return (
    <div className="rounded-lg border border-border/60 bg-bg-subtle/20 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon.Filter size="xs" />
        <p className="eyebrow">批量任务关联</p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button
          className="btn-outline motion-press !text-[11px] !min-h-[28px] !py-1 !px-2.5"
          disabled={linking || unlinkedCount === 0}
          onClick={onBatchUnlinked}
          title={unlinkedCount === 0 ? '没有未关联片段' : '只更新未关联任务的 segment'}
        >
          <Icon.Refresh size="xs" />
          批量关联未关联{unlinkedCount > 0 ? `（${unlinkedCount}）` : ''}
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
          <FilterChip
            active={filter === 'all'}
            onClick={() => onFilterChange('all')}
            label="全部"
          />
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

// ─── D. 紧凑专注片段列表（备用组件） ────────────────────────────
function CompactSegmentList({
  segments,
  filter,
  linking,
  onLink,
  onClear,
  onComplete,
  completedTaskIds,
}: {
  segments: FocusSegment[];
  filter: SegmentFilter;
  linking: boolean;
  onLink: (segmentId: string, index: number) => void;
  onClear: (segmentId: string) => void;
  onComplete: (seg: FocusSegment) => void;
  completedTaskIds: Set<string>;
}) {
  const unlinkedCount = segments.filter((s) => !s.taskId || !s.title).length;
  const filtered = segments.filter((seg) => {
    const hasTask = !!seg.taskId && !!seg.title;
    if (filter === 'unlinked') return !hasTask;
    if (filter === 'linked') return hasTask;
    return true;
  });

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Icon.Activity size="sm" tone="accent" />
        <p className="eyebrow text-accent">专注片段 ({segments.length})</p>
        {unlinkedCount > 0 && (
          <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10.5px] font-medium text-warning">
            {unlinkedCount} 个未关联
          </span>
        )}
        {filter !== 'all' && (
          <span className="text-[10.5px] text-fg-subtle">· 筛选显示 {filtered.length} 条</span>
        )}
      </div>
      <div className="space-y-1">
        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 bg-bg-card/20 py-3 text-center text-[11px] text-fg-subtle">
            当前筛选条件下没有片段
          </div>
        ) : (
          filtered.map((seg) => {
            const originalIndex = segments.indexOf(seg);
            return (
              <CompactSegmentRow
                key={seg.id}
                seg={seg}
                index={originalIndex}
                linking={linking}
                onLink={() => onLink(seg.id, originalIndex)}
                onClear={() => onClear(seg.id)}
                onComplete={() => onComplete(seg)}
                isTaskCompleted={!!seg.taskId && completedTaskIds.has(seg.taskId)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

/** 紧凑专注片段行（备用） */
function CompactSegmentRow({
  seg,
  index,
  linking,
  onLink,
  onClear,
  onComplete,
  isTaskCompleted,
}: {
  seg: FocusSegment;
  index: number;
  linking: boolean;
  onLink: () => void;
  onClear: () => void;
  onComplete: () => void;
  isTaskCompleted: boolean;
}) {
  const hasTask = !!seg.taskId && !!seg.title;
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={`motion-base rounded-md border px-2 py-1.5 text-[12px] ${
        hasTask ? 'border-border/50 bg-bg-subtle/20' : 'border-dashed border-warning/30 bg-warning/5'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10.5px] font-semibold text-fg-subtle">#{index + 1}</span>
        <span className="shrink-0 text-[10.5px] text-fg-subtle">专注片段</span>
        <span className="truncate text-[11px] text-fg-muted">
          {formatDateTime(seg.startedAt)}
          {seg.endedAt && ` → ${formatDateTime(seg.endedAt)}`}
        </span>
        <span className="timer-digit ml-auto shrink-0 text-[11px] font-semibold text-fg">
          {formatDuration(seg.activeElapsedMs)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1">
        {hasTask ? (
          <>
            <Icon.Link size="xs" tone="accent" className="shrink-0 text-accent" />
            <span className="truncate text-[11px] font-medium text-fg">{seg.title}</span>
          </>
        ) : (
          <span className="text-[11px] text-warning">任务：未关联</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {hasTask ? (
            <>
              <button
                className="motion-press rounded border border-border/50 bg-bg-card/40 px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-bg-subtle hover:text-fg disabled:opacity-40"
                disabled={linking}
                onClick={onLink}
                title="更换任务"
              >
                更换
              </button>
              <button
                className="motion-press rounded border border-border/50 bg-bg-card/40 px-1.5 py-0.5 text-[10px] text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"
                disabled={linking}
                onClick={onClear}
                title="清除关联"
              >
                清除
              </button>
              <div className="relative">
                <button
                  className="motion-base rounded p-0.5 text-fg-subtle hover:bg-bg-subtle hover:text-fg"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((v) => !v);
                  }}
                  title="更多"
                >
                  <Icon.MoreVertical size="xs" />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="motion-fade-in absolute right-0 top-5 z-20 w-32 rounded-md border border-border/60 bg-bg-card py-0.5 shadow-sm">
                      <button
                        className="motion-base flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                        disabled={linking || isTaskCompleted}
                        onClick={() => {
                          setMenuOpen(false);
                          onComplete();
                        }}
                      >
                        <Icon.CheckCircleFilled size="xs" />
                        {isTaskCompleted ? '已完成' : '完成任务'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <button
              className="motion-press rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/15 disabled:opacity-40"
              disabled={linking}
              onClick={onLink}
              title="关联任务"
            >
              <Icon.Link size="xs" className="inline" /> 关联
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── E. 暂停记录折叠（备用组件） ─────────────────────────────────
function CollapsiblePauseList({
  pauses,
  expanded,
  onToggle,
  onLinkPause,
}: {
  pauses: PauseEvent[];
  expanded: boolean;
  onToggle: () => void;
  onLinkPause: () => void;
}) {
  const totalPauseMs = pauses.reduce((sum, p) => sum + p.durationMs, 0);
  return (
    <div className="opacity-80">
      <button
        className="motion-base flex w-full items-center gap-2 rounded-md border border-danger/15 bg-danger/5 px-2.5 py-2 text-left hover:bg-danger/10"
        onClick={onToggle}
      >
        <Icon.Coffee size="xs" className="text-danger/70" />
        <span className="eyebrow text-danger/80">暂停记录 ({pauses.length})</span>
        <span className="text-[10.5px] text-fg-subtle">· 总暂停 {formatDuration(totalPauseMs)}</span>
        <Icon.ChevronDown
          size="sm"
          tone="subtle"
          className={`ml-auto text-fg-subtle transition-transform duration-[var(--motion-normal)] ease-[var(--ease-out)] ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1 space-y-1">
              {pauses.map((p, i) => (
                <PauseRow key={p.id} pause={p} index={i} onLinkPause={onLinkPause} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 暂停记录行（备用） */
function PauseRow({
  pause,
  index,
  onLinkPause,
}: {
  pause: PauseEvent;
  index: number;
  onLinkPause: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="relative flex items-center justify-between rounded-md border border-danger/15 bg-danger/5 px-2 py-1 text-[12px]">
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon.Coffee size="xs" className="shrink-0 text-danger/70" />
        <span className="text-[10.5px] text-fg-muted">
          暂停 {index + 1} · {formatDateTime(pause.pauseStartedAt)}
          {pause.pauseEndedAt ? ` → ${formatDateTime(pause.pauseEndedAt)}` : ' → 进行中'}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span className="timer-digit shrink-0 text-[10.5px] text-danger/80">
          {formatDuration(pause.durationMs)}
        </span>
        <button
          className="motion-base rounded p-0.5 text-fg-subtle hover:bg-danger/10 hover:text-danger"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          title="更多操作"
        >
          <Icon.MoreVertical size="xs" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="motion-fade-in absolute right-0 top-5 z-20 w-36 rounded-md border border-border/60 bg-bg-card py-0.5 shadow-sm">
              <button
                className="motion-base flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-fg-muted hover:bg-danger/10 hover:text-danger"
                onClick={() => {
                  setMenuOpen(false);
                  onLinkPause();
                }}
              >
                <Icon.Link size="xs" />
                关联到任务
              </button>
              <button
                className="motion-base flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-fg-muted hover:bg-bg-subtle hover:text-fg"
                onClick={() => setMenuOpen(false)}
              >
                <Icon.Clock size="xs" />
                添加备注
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── 通用统计组件 ─── */

function DetailStat({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: string;
  tone?: 'muted' | 'warn';
}) {
  const cls = tone === 'warn' ? 'border-warning/25 bg-warning/10' : 'border-border/60 bg-bg-subtle/30';
  const textCls = tone === 'warn' ? 'text-warning' : 'text-fg';
  return (
    <div className={`motion-base rounded-md border px-2.5 py-2 text-left ${cls}`}>
      <div className={`timer-digit text-[13px] font-semibold ${textCls}`}>{value}</div>
      <div className="mt-0.5 text-[10.5px] font-medium text-fg-subtle">{label}</div>
    </div>
  );
}

function SummaryPanel({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: PeriodSummary[];
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-bg-card/60 p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-fg-muted">
          {icon}
          {title}
        </span>
        <span className="text-[10.5px] font-normal text-fg-subtle">{items.length} 项</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-fg-subtle">暂无数据</p>
      ) : (
        <div className="max-h-60 space-y-0.5 overflow-y-auto pr-1">
          {items.map((item) => (
            <div
              key={item.label}
              className={`motion-base flex items-center justify-between rounded-md px-2.5 py-1.5 transition-colors ${
                item.count > 0
                  ? 'bg-bg-subtle/30 text-fg-muted hover:bg-bg-subtle/50'
                  : 'bg-bg-card/20 text-fg-subtle'
              }`}
            >
              <span className="truncate text-[12px] text-fg-muted">{item.label}</span>
              <span className="timer-digit text-[12px] font-semibold text-fg">
                {formatDuration(item.active)}
                <span className="ml-1.5 font-sans text-[10.5px] font-normal text-fg-subtle">
                  {item.count} 次
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

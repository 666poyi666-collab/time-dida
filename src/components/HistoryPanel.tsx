// 历史记录 - Session 列表 + 详情 + 导出 + 删除 + Segment 任务关联/后补/批量
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  Trash2,
  Download,
  Inbox,
  Link2,
  Unlink,
  Star,
  RefreshCw,
  CalendarDays,
  BarChart3,
  CheckCircle2,
  PieChart,
  Clock3,
  AlertCircle,
  MoreVertical,
  Coffee,
  Activity,
} from 'lucide-react';
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

export function HistoryPanel() {
  const { addToast } = useStore();
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [linking, setLinking] = useState(false);
  const [syncingSessionId, setSyncingSessionId] = useState<string | null>(null);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(() => new Set());
  const [sessionSyncMeta, setSessionSyncMeta] = useState<Record<string, SessionSyncState>>({});
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [rangePreset, setRangePreset] = useState<RangePreset>('today');
  const [customStart, setCustomStart] = useState(toDateInput(Date.now()));
  const [customEnd, setCustomEnd] = useState(toDateInput(Date.now()));

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
    setSessions(list);
    setSyncQueue(queue as SyncQueueItem[]);
  };

  useEffect(() => {
    load();
  }, []);

  const reloadDetail = async (id: string) => {
    const d = await window.focuslink.sessions.get(id);
    setDetail(d);
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
    if (!confirm('确认删除这条专注记录？此操作不可撤销。')) return;
    try {
      await window.focuslink.sessions.delete(id);
      await load();
      if (expanded === id) {
        setExpanded(null);
        setDetail(null);
      }
      addToast('已删除', 'success');
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
      if (target.kind === 'segment') {
        await window.focuslink.timer.linkTask(target.segmentId, task.id, task.source, task.title);
        addToast(`已关联：${task.title}`, 'success');
      } else if (target.kind === 'session-default') {
        await window.focuslink.timer.linkSessionTask(
          target.sessionId,
          task.id,
          task.source,
          task.title,
        );
        addToast(`已设为默认任务：${task.title}`, 'success');
      } else if (target.kind === 'batch-unlinked') {
        const count = await window.focuslink.timer.linkSegmentsBatch(
          target.sessionId,
          task.id,
          task.source,
          task.title,
          true,
        );
        addToast(`已批量关联 ${count} 个未关联片段到：${task.title}`, 'success');
      } else if (target.kind === 'batch-all') {
        const count = await window.focuslink.timer.linkSegmentsBatch(
          target.sessionId,
          task.id,
          task.source,
          task.title,
          false,
        );
        addToast(`已把全部 ${count} 个片段关联到：${task.title}`, 'success');
      }
      // 刷新详情
      if (expanded) await reloadDetail(expanded);
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

  const handleSyncSession = async (sessionId: string) => {
    if (syncingSessionId) return;
    setSyncingSessionId(sessionId);
    try {
      const detailForSync: SessionDetail | null =
        detail?.session.id === sessionId ? detail : await window.focuslink.sessions.get(sessionId);
      const ticktickSegments =
        detailForSync?.segments.filter((seg) => seg.taskId && seg.taskSource === 'ticktick') ?? [];

      if (ticktickSegments.length === 0) {
        setSessionSyncMeta((prev) => ({
          ...prev,
          [sessionId]: {
            label: '无滴答片段',
            tone: 'warn',
            title: '先把片段关联到滴答任务后再同步',
          },
        }));
        addToast('没有可同步到滴答的片段；先把片段关联到滴答任务。', 'info');
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
            title: '本次同步已成功写入滴答任务备注',
          },
        }));
        addToast(`已同步 ${result.succeeded} 条专注记录到滴答备注`, 'success');
      } else {
        setSessionSyncMeta((prev) => ({
          ...prev,
          [sessionId]: {
            label: '无待同步项',
            tone: 'warn',
            title: '没有新的待同步队列项',
          },
        }));
        addToast('没有需要同步的滴答任务记录', 'info');
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

  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-fg-subtle">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-bg-subtle/60">
          <Inbox size={28} className="opacity-50" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-fg-muted">还没有专注记录</p>
          <p className="mt-1 text-xs text-fg-subtle">开始第一次专注后会出现在这里</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-fg">历史记录</h2>
            <p className="mt-1 text-xs text-fg-subtle">
              按日期和周期查看专注时间，以及每个 Segment 花在哪个任务上。
            </p>
          </div>
          <span className="rounded-md border border-border bg-bg-subtle px-2.5 py-1 text-xs text-fg-muted">
            {filteredSessions.length} / {sessions.length} 条记录
          </span>
        </div>

        <div className="mb-4 space-y-3">
          <div className="card p-3.5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-fg">
                <CalendarDays size={15} className="text-accent" />
                时间筛选
              </div>
              <span className="text-[11px] text-fg-subtle">
                {formatShortDate(range.start)} - {formatShortDate(range.end)}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RANGE_PRESETS.map((item) => (
                <button
                  key={item.id}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    rangePreset === item.id
                      ? 'bg-accent text-accent-fg'
                      : 'border border-border bg-bg-subtle text-fg-muted hover:text-fg'
                  }`}
                  onClick={() => setRangePreset(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {rangePreset === 'custom' && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <input
                  type="date"
                  className="input !w-auto !py-1.5 text-xs"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
                <span className="text-xs text-fg-subtle">至</span>
                <input
                  type="date"
                  className="input !w-auto !py-1.5 text-xs"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            <DetailStat label="筛选专注" value={formatDuration(rangeStats.active)} />
            <DetailStat label="暂停" value={formatDuration(rangeStats.pause)} />
            <DetailStat label="总历时" value={formatDuration(rangeStats.wall)} />
            <DetailStat label="Session" value={String(rangeStats.count)} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <SummaryPanel title="按天" icon={<BarChart3 size={14} />} items={dailyStats} />
            <SummaryPanel title="按周" icon={<CalendarDays size={14} />} items={weeklyStats} />
          </div>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-bg-card/40 py-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-bg-subtle text-fg-subtle">
              <Inbox size={22} />
            </div>
            <p className="text-sm font-medium text-fg-muted">当前时间范围没有专注记录</p>
            <p className="mt-1 text-xs text-fg-subtle">换一个筛选范围，或者开始一次新的专注。</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSessions.map((session) => {
              const syncState = getDisplayedSyncState(session.id);
              return (
                <motion.div key={session.id} layout className="card overflow-hidden">
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-bg-subtle/40"
                    onClick={() => toggleExpand(session.id)}
                  >
                    <ChevronRight
                      size={15}
                      className={`shrink-0 text-fg-subtle transition-transform duration-200 ${
                        expanded === session.id ? 'rotate-90' : ''
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="timer-digit text-sm font-semibold text-fg">
                          {formatMinutes(session.activeElapsedMs)}
                        </span>
                        <span className="text-xs text-fg-subtle">
                          {formatRelative(session.startedAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs leading-relaxed text-fg-subtle">
                        {formatDateTime(session.startedAt)}
                        {session.endedAt && ` → ${formatDateTime(session.endedAt)}`}
                      </div>
                      {/* 默认任务标题预览 */}
                      {session.defaultTaskTitle && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400/80">
                          <Star size={10} />
                          <span className="truncate">{session.defaultTaskTitle}</span>
                        </div>
                      )}
                    </div>
                    <div className="hidden items-center gap-3 text-[11px] text-fg-muted sm:flex">
                      <SessionSyncPreview session={session} />
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
                        transition={{ duration: 0.2 }}
                        className="border-t border-border"
                      >
                        <div className="space-y-4 p-4">
                          {/* 时间统计 */}
                          <div className="grid grid-cols-3 gap-2">
                            <DetailStat
                              label="专注时长"
                              value={formatDuration(detail.session.activeElapsedMs)}
                            />
                            <DetailStat
                              label="暂停时长"
                              value={formatDuration(detail.session.pauseElapsedMs)}
                            />
                            <DetailStat
                              label="总历时"
                              value={formatDuration(detail.session.wallElapsedMs)}
                            />
                          </div>

                          <TaskBreakdownPanel segments={detail.segments} />
                          <SyncVisibilityPanel segments={detail.segments} />

                          {/* Session 默认任务 + 批量操作 */}
                          <div className="rounded-lg border border-border bg-bg-subtle/30 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[10px] uppercase tracking-widest text-fg-subtle">
                                  本次专注默认任务
                                </p>
                                <p className="mt-0.5 truncate text-sm font-medium text-fg">
                                  {detail.session.defaultTaskTitle ?? '未设置'}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <button
                                  className="btn-outline text-[11px]"
                                  disabled={linking}
                                  onClick={() =>
                                    setPickerTarget({
                                      kind: 'session-default',
                                      sessionId: session.id,
                                      title: '设置本次专注默认任务',
                                    })
                                  }
                                  title="设置/更换默认任务"
                                >
                                  <Star size={11} />
                                  {detail.session.defaultTaskTitle ? '更换' : '设置'}
                                </button>
                                {detail.session.defaultTaskTitle && (
                                  <button
                                    className="btn-ghost text-[11px] text-rose-400 hover:bg-rose-500/10"
                                    disabled={linking}
                                    onClick={() => handleClearSessionDefault(session.id)}
                                    title="清除默认任务"
                                  >
                                    <Unlink size={11} />
                                  </button>
                                )}
                              </div>
                            </div>
                            {/* 批量关联操作 */}
                            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                              <button
                                className="btn-outline text-[11px]"
                                disabled={linking}
                                onClick={() =>
                                  setPickerTarget({
                                    kind: 'batch-unlinked',
                                    sessionId: session.id,
                                    title: '把所有未关联片段关联到某任务',
                                  })
                                }
                                title="只更新未关联任务的 segment"
                              >
                                <RefreshCw size={11} />
                                批量补关联未关联片段
                              </button>
                              <button
                                className="btn-ghost text-[11px]"
                                disabled={linking}
                                onClick={() =>
                                  setPickerTarget({
                                    kind: 'batch-all',
                                    sessionId: session.id,
                                    title: '把所有片段改为同一任务',
                                  })
                                }
                                title="覆盖所有 segment（含已关联）"
                              >
                                <Link2 size={11} />
                                全部片段改为同一任务
                              </button>
                            </div>
                          </div>

                          {/* 专注片段 - 优先展示，重点突出，默认提供关联任务入口 */}
                          {detail.segments.length > 0 && (
                            <div>
                              <div className="mb-2 flex items-center gap-2">
                                <Activity size={13} className="text-accent" />
                                <p className="text-[11px] font-bold uppercase tracking-widest text-accent">
                                  专注片段 ({detail.segments.length})
                                </p>
                              </div>
                              <div className="space-y-1.5">
                                {detail.segments.map((seg, i) => (
                                  <SegmentRow
                                    key={seg.id}
                                    seg={seg}
                                    index={i}
                                    linking={linking}
                                    onLink={() =>
                                      setPickerTarget({
                                        kind: 'segment',
                                        segmentId: seg.id,
                                        title: `专注片段 ${i + 1} 关联任务`,
                                      })
                                    }
                                    onClear={() => handleClearSegment(seg.id)}
                                    onComplete={() => handleCompleteTask(seg)}
                                    isTaskCompleted={
                                      !!seg.taskId && completedTaskIds.has(seg.taskId)
                                    }
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 暂停记录 - 弱化显示，红色，默认不提供关联入口，三点菜单可选关联 */}
                          {detail.pauses.length > 0 && (
                            <div className="opacity-70">
                              <div className="mb-1.5 flex items-center gap-2">
                                <Coffee size={12} className="text-danger" />
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-danger/80">
                                  暂停记录 ({detail.pauses.length})
                                </p>
                              </div>
                              <div className="space-y-1">
                                {detail.pauses.map((p, i) => (
                                  <PauseRow
                                    key={p.id}
                                    pause={p}
                                    index={i}
                                    onLinkPause={() =>
                                      addToast(
                                        '暂停片段关联任务需要扩展数据结构，当前版本暂不支持。',
                                        'info',
                                      )
                                    }
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 操作 */}
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              className="btn-primary text-xs"
                              disabled={linking || syncingSessionId === session.id}
                              onClick={() => handleSyncSession(session.id)}
                              title="把本次已关联滴答任务的专注时间同步到任务备注"
                            >
                              <RefreshCw
                                size={12}
                                className={syncingSessionId === session.id ? 'animate-spin' : ''}
                              />
                              {syncingSessionId === session.id ? '同步中' : '同步到滴答'}
                            </button>
                            <SessionSyncBadge state={syncState} />
                            <button
                              className="btn-outline text-xs"
                              onClick={() => handleExport(session.id, 'markdown')}
                            >
                              <Download size={12} /> Markdown
                            </button>
                            <button
                              className="btn-outline text-xs"
                              onClick={() => handleExport(session.id, 'csv')}
                            >
                              <Download size={12} /> CSV
                            </button>
                            <button
                              className="btn-outline text-xs"
                              onClick={() => handleExport(session.id, 'json')}
                            >
                              <Download size={12} /> JSON
                            </button>
                            <button
                              className="btn-ghost ml-auto text-xs text-rose-400 hover:bg-rose-500/10"
                              onClick={() => handleDelete(session.id)}
                            >
                              <Trash2 size={12} /> 删除
                            </button>
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

function SessionSyncPreview({ session }: { session: FocusSession }) {
  if (session.defaultTaskSource === 'ticktick') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-success/20 bg-success/10 px-2 py-1 text-success">
        <CheckCircle2 size={10} /> 滴答可同步
      </span>
    );
  }
  if (session.defaultTaskSource === 'local') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-subtle px-2 py-1 text-fg-subtle">
        <Link2 size={10} /> 本地记录
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-warning/20 bg-warning/10 px-2 py-1 text-warning">
      <Link2 size={10} /> 未关联
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
          : 'border-border bg-bg-subtle text-fg-subtle';
  const Icon =
    state.tone === 'ok'
      ? CheckCircle2
      : state.tone === 'error'
        ? AlertCircle
        : state.tone === 'warn'
          ? RefreshCw
          : Clock3;

  return (
    <span
      title={state.title}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${cls}`}
    >
      <Icon size={10} />
      {state.label}
    </span>
  );
}

function SyncVisibilityPanel({ segments }: { segments: FocusSegment[] }) {
  const linked = segments.filter((seg) => seg.taskId && seg.taskSource);
  const ticktick = linked.filter((seg) => seg.taskSource === 'ticktick');
  const local = linked.filter((seg) => seg.taskSource === 'local');
  const unlinked = Math.max(0, segments.length - linked.length);
  const ticktickMs = ticktick.reduce((sum, seg) => sum + seg.activeElapsedMs, 0);

  return (
    <div className="rounded-lg border border-border bg-bg-subtle/25 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
            <RefreshCw
              size={14}
              className={ticktick.length > 0 ? 'text-success' : 'text-fg-subtle'}
            />
            同步可见性
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
            {ticktick.length > 0
              ? '点击“同步到滴答”会把已关联滴答任务的专注时间追加到任务备注；本地或未关联片段只保存在 FocusLink。'
              : '这条记录暂时没有可同步到滴答的片段；先把片段关联到滴答任务后再同步。'}
          </p>
        </div>
        <span
          className={`timer-digit shrink-0 rounded-md border px-2 py-1 text-[11px] ${
            ticktick.length > 0
              ? 'border-success/25 bg-success/10 text-success'
              : 'border-border bg-bg-card/45 text-fg-subtle'
          }`}
        >
          {formatDuration(ticktickMs)}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <SyncScopeStat
          label="滴答片段"
          value={String(ticktick.length)}
          tone={ticktick.length > 0 ? 'ok' : 'muted'}
        />
        <SyncScopeStat label="本地片段" value={String(local.length)} tone="muted" />
        <SyncScopeStat
          label="未关联"
          value={String(unlinked)}
          tone={unlinked > 0 ? 'warn' : 'muted'}
        />
      </div>
    </div>
  );
}

function SyncScopeStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'muted';
}) {
  const cls =
    tone === 'ok'
      ? 'border-success/25 bg-success/10 text-success'
      : tone === 'warn'
        ? 'border-warning/25 bg-warning/10 text-warning'
        : 'border-border bg-bg-card/45 text-fg-subtle';
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <div className="timer-digit text-sm font-semibold">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium opacity-80">{label}</div>
    </div>
  );
}

function TaskBreakdownPanel({ segments }: { segments: FocusSegment[] }) {
  const items = groupSegmentsByTask(segments);
  const total = items.reduce((sum, item) => sum + item.active, 0);
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-bg-subtle/25 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
          <PieChart size={14} className="text-accent" />
          任务时间分布
        </div>
        <span className="timer-digit text-[11px] text-fg-subtle">{formatDuration(total)}</span>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => {
          const pct = total > 0 ? Math.round((item.active / total) * 100) : 0;
          return (
            <div
              key={item.label}
              className="rounded-lg border border-border/70 bg-bg-card/45 px-3 py-2"
            >
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/10 text-[10px] font-semibold text-accent">
                    {index + 1}
                  </span>
                  <span className="truncate text-xs font-medium text-fg">{item.label}</span>
                </div>
                <span className="timer-digit shrink-0 text-xs text-fg-muted">
                  {formatDuration(item.active)} · {pct}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-subtle">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(6, pct)}%` }}
                />
              </div>
              <div className="mt-1 flex items-center gap-1 text-[10px] text-fg-subtle">
                <Clock3 size={10} />
                {item.count} 个片段
              </div>
            </div>
          );
        })}
      </div>
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
    <div className="card p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2 text-xs font-semibold text-fg-muted">
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
        <span className="text-[10px] font-normal text-fg-subtle">{items.length} 项</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-fg-subtle">暂无数据</p>
      ) : (
        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {items.map((item) => (
            <div
              key={item.label}
              className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                item.count > 0 ? 'bg-bg-subtle/45 text-fg-muted' : 'bg-bg-card/25 text-fg-subtle'
              }`}
            >
              <span className="truncate text-xs text-fg-muted">{item.label}</span>
              <span className="timer-digit text-xs font-semibold text-fg">
                {formatDuration(item.active)}
                <span className="ml-2 font-sans text-[10px] font-normal text-fg-subtle">
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

function groupSegmentsByTask(segments: FocusSegment[]) {
  const map = new Map<string, { label: string; active: number; count: number }>();
  for (const seg of segments) {
    const label = seg.title ?? '未关联任务';
    const item = map.get(label) ?? { label, active: 0, count: 0 };
    item.active += seg.activeElapsedMs;
    item.count += 1;
    map.set(label, item);
  }
  return Array.from(map.values()).sort((a, b) => b.active - a.active);
}

/** Segment 行：时间 + 任务 + 更换/清除按钮 */
function SegmentRow({
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
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${hasTask ? 'border-border bg-bg-subtle/35' : 'border-dashed border-warning/30 bg-warning/5'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-fg-subtle">#{index + 1}</span>
            <span className="text-[13px] text-fg">
              {formatDateTime(seg.startedAt)}
              {seg.endedAt && ` → ${formatDateTime(seg.endedAt)}`}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            {hasTask ? (
              <>
                <Link2 size={11} className="shrink-0 text-accent" />
                <span className="truncate text-xs font-medium text-fg">{seg.title}</span>
              </>
            ) : (
              <span className="text-xs text-warning">未关联任务</span>
            )}
          </div>
        </div>
        <span className="timer-digit shrink-0 text-xs text-fg-muted">
          {formatDuration(seg.activeElapsedMs)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 border-t border-border/50 pt-2">
        {hasTask ? (
          <>
            <button
              className="btn-outline text-[10px]"
              disabled={linking}
              onClick={onLink}
              title="更换任务"
            >
              <Link2 size={10} />
              更换任务
            </button>
            <button
              className="btn-ghost text-[10px] text-rose-400 hover:bg-rose-500/10"
              disabled={linking}
              onClick={onClear}
              title="清除关联"
            >
              <Unlink size={10} />
              清除关联
            </button>
            <button
              className="btn-ghost text-[10px] text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-70"
              disabled={linking || isTaskCompleted}
              onClick={onComplete}
              title={isTaskCompleted ? '任务已完成' : '完成任务并同步到任务来源'}
            >
              <CheckCircle2 size={10} />
              {isTaskCompleted ? '已完成' : '完成任务'}
            </button>
          </>
        ) : (
          <button
            className="btn-primary text-[10px]"
            disabled={linking}
            onClick={onLink}
            title="关联任务"
          >
            <Link2 size={10} />
            关联任务
          </button>
        )}
      </div>
    </div>
  );
}

/** 暂停记录行 - 红色弱化显示，三点菜单提供可选关联入口 */
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
    <div className="relative flex items-center justify-between rounded-lg border border-danger/15 bg-danger/5 px-3 py-1.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <Coffee size={11} className="shrink-0 text-danger/70" />
        <span className="text-fg-muted">
          暂停 {index + 1} · {formatDateTime(pause.pauseStartedAt)}
          {pause.pauseEndedAt ? ` → ${formatDateTime(pause.pauseEndedAt)}` : ' → 进行中'}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="timer-digit shrink-0 text-danger/80">
          {formatDuration(pause.durationMs)}
        </span>
        <button
          className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-danger/10 hover:text-danger"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          title="更多操作"
        >
          <MoreVertical size={12} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-7 z-20 w-40 rounded-lg border border-border bg-bg-card py-1 shadow-lg">
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-fg-muted transition-colors hover:bg-danger/10 hover:text-danger"
                onClick={() => {
                  setMenuOpen(false);
                  onLinkPause();
                }}
              >
                <Link2 size={11} />
                关联到任务
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
                onClick={() => setMenuOpen(false)}
              >
                <Clock3 size={11} />
                添加备注
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-subtle/40 px-3 py-2.5 text-left">
      <div className="timer-digit text-sm font-semibold text-fg">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium text-fg-subtle">{label}</div>
    </div>
  );
}

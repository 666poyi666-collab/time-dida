// 历史记录 - Session 列表 + 详情 + 导出 + 删除 + Segment 任务关联/后补/批量
// v0.2.0 信息密度优化：
//   - Session 总览：总历时 / 累计专注 / 累计暂停 / 片段数 / 关联数 / 未关联数
//   - 本地 / 云端状态：明确显示"云端专注记录：未实现"
//   - 批量关联区域：批量补关联 / 全部改为同一任务 / 只显示未关联 / 只显示已关联
//   - 专注片段：紧凑单行 + 小按钮，未关联高亮
//   - 暂停记录：默认折叠，展开后紧凑红色列表，三点菜单
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  ChevronDown,
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
  Clock3,
  AlertCircle,
  MoreVertical,
  Coffee,
  Activity,
  Filter,
  Cloud,
  CloudOff,
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

/** 专注片段过滤模式 */
type SegmentFilter = 'all' | 'unlinked' | 'linked';

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
        if (!confirm('确认把本次所有专注片段（含已关联）都改为同一任务？')) return;
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
          <div className="card motion-lift p-3.5">
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
                  className={`motion-press rounded-lg px-3 py-1.5 text-xs font-medium ${
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
          <div className="motion-fade-in rounded-lg border border-dashed border-border bg-bg-card/40 py-12 text-center">
            <div className="motion-breathe mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-bg-subtle text-fg-subtle">
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
                <motion.div key={session.id} layout className="card motion-lift overflow-hidden">
                  <button
                    className="motion-base flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-bg-subtle/40"
                    onClick={() => toggleExpand(session.id)}
                  >
                    <ChevronRight
                      size={15}
                      className={`shrink-0 text-fg-subtle transition-transform duration-[var(--motion-normal)] ease-[var(--ease-out)] ${
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
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                        className="border-t border-border"
                      >
                        <div className="space-y-4 p-4">
                          {/* A. Session 总览：6 项统计 */}
                          <SessionOverview detail={detail} />

                          {/* B. 本地 / 云端状态 */}
                          <LocalCloudStatePanel detail={detail} />

                          {/* C. 批量任务关联区域 */}
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

                          {/* Session 默认任务 */}
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
                                  className="btn-outline motion-press text-[11px]"
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
                                    className="btn-ghost motion-press text-[11px] text-rose-400 hover:bg-rose-500/10"
                                    disabled={linking}
                                    onClick={() => handleClearSessionDefault(session.id)}
                                    title="清除默认任务"
                                  >
                                    <Unlink size={11} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* D. 专注片段列表（紧凑行） */}
                          {detail.segments.length > 0 && (
                            <CompactSegmentList
                              segments={detail.segments}
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
                              completedTaskIds={completedTaskIds}
                            />
                          )}

                          {/* E. 暂停记录（默认折叠） */}
                          {detail.pauses.length > 0 && (
                            <CollapsiblePauseList
                              pauses={detail.pauses}
                              expanded={!!pausesExpanded[session.id]}
                              onToggle={() =>
                                setPausesExpanded((prev) => ({
                                  ...prev,
                                  [session.id]: !prev[session.id],
                                }))
                              }
                              onLinkPause={() =>
                                addToast(
                                  '暂停片段关联任务需要扩展数据结构，当前版本暂不支持。',
                                  'info',
                                )
                              }
                            />
                          )}

                          {/* 操作 */}
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              className="btn-primary motion-press text-xs"
                              disabled={linking || syncingSessionId === session.id}
                              onClick={() => handleSyncSession(session.id)}
                              title="把本次已关联滴答任务的专注时间同步到任务备注"
                            >
                              <RefreshCw
                                size={12}
                                className={syncingSessionId === session.id ? 'animate-spin' : ''}
                              />
                              {syncingSessionId === session.id ? '同步中' : '同步到滴答备注'}
                            </button>
                            <SessionSyncBadge state={syncState} />
                            <button
                              className="btn-outline motion-press text-xs"
                              onClick={() => handleExport(session.id, 'markdown')}
                            >
                              <Download size={12} /> Markdown
                            </button>
                            <button
                              className="btn-outline motion-press text-xs"
                              onClick={() => handleExport(session.id, 'csv')}
                            >
                              <Download size={12} /> CSV
                            </button>
                            <button
                              className="btn-outline motion-press text-xs"
                              onClick={() => handleExport(session.id, 'json')}
                            >
                              <Download size={12} /> JSON
                            </button>
                            <button
                              className="btn-ghost motion-press ml-auto text-xs text-rose-400 hover:bg-rose-500/10"
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

// ─── A. Session 总览：6 项统计 ───────────────────────────────────
function SessionOverview({ detail }: { detail: SessionDetail }) {
  const { session, segments, pauses } = detail;
  const linkedCount = segments.filter((s) => s.taskId && s.title).length;
  const unlinkedCount = segments.length - linkedCount;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <DetailStat label="总历时" value={formatDuration(session.wallElapsedMs)} />
      <DetailStat label="累计专注" value={formatDuration(session.activeElapsedMs)} />
      <DetailStat label="累计暂停" value={formatDuration(session.pauseElapsedMs)} />
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

// ─── B. 本地 / 云端状态 ──────────────────────────────────────────
// 明确区分：本地记录已保存 / 本地任务关联状态 / 滴答云端专注记录未实现 / 可同步备注片段数
function LocalCloudStatePanel({ detail }: { detail: SessionDetail }) {
  const { segments } = detail;
  const linked = segments.filter((seg) => seg.taskId && seg.taskSource);
  const ticktick = linked.filter((seg) => seg.taskSource === 'ticktick');
  const unlinked = Math.max(0, segments.length - linked.length);
  const ticktickMs = ticktick.reduce((sum, seg) => sum + seg.activeElapsedMs, 0);

  return (
    <div className="rounded-lg border border-border bg-bg-subtle/25 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
            <Cloud size={14} className="text-fg-subtle" />
            本地 / 云端状态
          </div>
          <div className="mt-2 space-y-1 text-[11px] leading-relaxed">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={10} className="text-success" />
              <span className="text-fg-muted">本地记录：已保存</span>
            </div>
            <div className="flex items-center gap-1.5">
              {unlinked > 0 ? (
                <>
                  <AlertCircle size={10} className="text-warning" />
                  <span className="text-warning">本地任务关联：有 {unlinked} 个未关联</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={10} className="text-success" />
                  <span className="text-fg-muted">本地任务关联：已保存</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <CloudOff size={10} className="text-danger/80" />
              <span className="text-danger/80">滴答清单云端专注记录：未实现</span>
            </div>
            <div className="flex items-center gap-1.5">
              <RefreshCw
                size={10}
                className={ticktick.length > 0 ? 'text-success' : 'text-fg-subtle'}
              />
              <span className="text-fg-muted">
                可同步到滴答任务备注的片段：{ticktick.length} 个（{formatDuration(ticktickMs)}）
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
    <div className="rounded-lg border border-border bg-bg-subtle/30 p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-fg-subtle">
        <Filter size={11} />
        批量任务关联
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          className="btn-outline motion-press text-[11px]"
          disabled={linking || unlinkedCount === 0}
          onClick={onBatchUnlinked}
          title={unlinkedCount === 0 ? '没有未关联片段' : '只更新未关联任务的 segment'}
        >
          <RefreshCw size={11} />
          批量关联未关联片段{unlinkedCount > 0 ? `（${unlinkedCount}）` : ''}
        </button>
        <button
          className="btn-ghost motion-press text-[11px]"
          disabled={linking || segments.length === 0}
          onClick={onBatchAll}
          title="覆盖所有 segment（含已关联），需确认"
        >
          <Link2 size={11} />
          全部设为同一任务
        </button>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-bg-card/50 p-0.5">
          <FilterChip
            active={filter === 'all'}
            onClick={() => onFilterChange('all')}
            label="全部"
          />
          <FilterChip
            active={filter === 'unlinked'}
            onClick={() => onFilterChange('unlinked')}
            label="只看未关联"
          />
          <FilterChip
            active={filter === 'linked'}
            onClick={() => onFilterChange('linked')}
            label="只看已关联"
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
      className={`motion-base rounded-md px-2 py-1 text-[10px] font-medium ${
        active ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

// ─── D. 专注片段列表（紧凑单行 + 小按钮） ────────────────────────
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
      <div className="mb-2 flex items-center gap-2">
        <Activity size={13} className="text-accent" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-accent">
          专注片段 ({segments.length})
        </p>
        {unlinkedCount > 0 && (
          <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
            {unlinkedCount} 个未关联
          </span>
        )}
        {filter !== 'all' && (
          <span className="text-[10px] text-fg-subtle">· 筛选显示 {filtered.length} 条</span>
        )}
      </div>
      <div className="space-y-1">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-bg-card/30 py-4 text-center text-[11px] text-fg-subtle">
            当前筛选条件下没有片段
          </div>
        ) : (
          filtered.map((seg) => {
            // 显示原始 index（在 segments 数组中的位置）
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

/** 紧凑专注片段行：单行 + 小按钮，未关联高亮 */
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
      className={`motion-base rounded-md border px-2.5 py-1.5 text-xs ${
        hasTask ? 'border-border bg-bg-subtle/30' : 'border-dashed border-warning/40 bg-warning/5'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] font-semibold text-fg-subtle">#{index + 1}</span>
        <span className="shrink-0 text-[10px] text-fg-subtle">专注片段</span>
        <span className="truncate text-[11px] text-fg-muted">
          {formatDateTime(seg.startedAt)}
          {seg.endedAt && ` → ${formatDateTime(seg.endedAt)}`}
        </span>
        <span className="timer-digit motion-digit ml-auto shrink-0 text-[11px] font-semibold text-fg">
          {formatDuration(seg.activeElapsedMs)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        {hasTask ? (
          <>
            <Link2 size={10} className="shrink-0 text-accent" />
            <span className="truncate text-[11px] font-medium text-fg">{seg.title}</span>
          </>
        ) : (
          <span className="text-[11px] text-warning">任务：未关联</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {hasTask ? (
            <>
              <button
                className="motion-press rounded border border-border bg-bg-card/50 px-1.5 py-0.5 text-[10px] text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:opacity-40"
                disabled={linking}
                onClick={onLink}
                title="更换任务"
              >
                更换
              </button>
              <button
                className="motion-press rounded border border-border bg-bg-card/50 px-1.5 py-0.5 text-[10px] text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"
                disabled={linking}
                onClick={onClear}
                title="清除关联"
              >
                清除
              </button>
              <div className="relative">
                <button
                  className="motion-base rounded p-0.5 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((v) => !v);
                  }}
                  title="更多"
                >
                  <MoreVertical size={11} />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="motion-fade-in absolute right-0 top-6 z-20 w-36 rounded-lg border border-border bg-bg-card py-1 shadow-lg">
                      <button
                        className="motion-base flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[10px] text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                        disabled={linking || isTaskCompleted}
                        onClick={() => {
                          setMenuOpen(false);
                          onComplete();
                        }}
                      >
                        <CheckCircle2 size={11} />
                        {isTaskCompleted ? '已完成' : '完成任务'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <button
              className="motion-press rounded border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20 disabled:opacity-40"
              disabled={linking}
              onClick={onLink}
              title="关联任务"
            >
              <Link2 size={10} className="inline" /> 关联
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── E. 暂停记录（默认折叠） ─────────────────────────────────────
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
        className="motion-base flex w-full items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-left hover:bg-danger/10"
        onClick={onToggle}
      >
        <Coffee size={12} className="text-danger/70" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-danger/80">
          暂停记录 ({pauses.length})
        </span>
        <span className="text-[10px] text-fg-subtle">· 总暂停 {formatDuration(totalPauseMs)}</span>
        <ChevronDown
          size={13}
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
    <div className="relative flex items-center justify-between rounded-md border border-danger/15 bg-danger/5 px-2.5 py-1 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <Coffee size={10} className="shrink-0 text-danger/70" />
        <span className="text-[10px] text-fg-muted">
          暂停 {index + 1} · {formatDateTime(pause.pauseStartedAt)}
          {pause.pauseEndedAt ? ` → ${formatDateTime(pause.pauseEndedAt)}` : ' → 进行中'}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="timer-digit motion-digit shrink-0 text-[10px] text-danger/80">
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
          <MoreVertical size={11} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="motion-fade-in absolute right-0 top-6 z-20 w-40 rounded-lg border border-border bg-bg-card py-1 shadow-lg">
              <button
                className="motion-base flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-fg-muted hover:bg-danger/10 hover:text-danger"
                onClick={() => {
                  setMenuOpen(false);
                  onLinkPause();
                }}
              >
                <Link2 size={11} />
                关联到任务
              </button>
              <button
                className="motion-base flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-fg-muted hover:bg-bg-subtle hover:text-fg"
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

function DetailStat({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: string;
  tone?: 'muted' | 'warn';
}) {
  const cls = tone === 'warn' ? 'border-warning/30 bg-warning/10' : 'border-border bg-bg-subtle/40';
  const textCls = tone === 'warn' ? 'text-warning' : 'text-fg';
  return (
    <div className={`motion-base rounded-lg border px-3 py-2.5 text-left ${cls}`}>
      <div className={`timer-digit motion-digit text-sm font-semibold ${textCls}`}>{value}</div>
      <div className="mt-0.5 text-[10px] font-medium text-fg-subtle">{label}</div>
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
    <div className="card motion-lift p-3.5">
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
              className={`motion-base flex items-center justify-between rounded-lg px-3 py-2 ${
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

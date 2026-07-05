// 右侧任务区 - v0.4.4 Linear 风格极简重构
// 设计原则：单一品牌色克制 · 发丝边框分层 · hover显现次要操作 · 密度即设计
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from './Icon';
import { useStore } from '../store/useStore';
import type { Task, Project, SyncQueueItem } from '@shared/types';

type TaskSource = 'local' | 'ticktick-cli' | 'ticktick-oauth';

export function TaskPanel({ inDrawer = false }: { inDrawer?: boolean }) {
  const {
    snapshot,
    localTasks,
    ticktickTasks,
    ticktickProjects,
    ticktickConnected,
    settings,
    setLocalTasks,
    setTicktickTasks,
    setTicktickProjects,
    addToast,
  } = useStore();

  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState('');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [cliConnected, setCliConnected] = useState<boolean | null>(null);
  const [cliError, setCliError] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const initializedRef = useRef<Set<string>>(new Set());
  const beforeSearchRef = useRef<Record<string, boolean> | null>(null);

  const taskSource: TaskSource = settings?.taskSource ?? 'local';

  useEffect(() => {
    if (taskSource === 'ticktick-cli') {
      handleRefresh({ silent: true });
    } else if (taskSource === 'ticktick-oauth' && ticktickConnected) {
      handleRefresh({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskSource]);

  useEffect(() => {
    const initNewParents = (tasks: Task[]) => {
      for (const t of tasks) {
        if (t.children && t.children.length > 0) {
          if (!initializedRef.current.has(t.id)) {
            initializedRef.current.add(t.id);
            setCollapsed((prev) => (prev[t.id] === undefined ? { ...prev, [t.id]: true } : prev));
          }
          initNewParents(t.children);
        }
      }
    };
    initNewParents(ticktickTasks);
    initNewParents(localTasks);
  }, [ticktickTasks, localTasks]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      if (beforeSearchRef.current !== null) {
        setCollapsed(beforeSearchRef.current);
        beforeSearchRef.current = null;
      }
      return;
    }
    if (beforeSearchRef.current === null) {
      beforeSearchRef.current = { ...collapsed };
    }
    const next: Record<string, boolean> = { ...collapsed };
    const ql = q.toLowerCase();
    const expandMatching = (tasks: Task[]) => {
      for (const t of tasks) {
        if (t.children && t.children.length > 0) {
          const childMatch = t.children.some((c) => c.title.toLowerCase().includes(ql));
          const selfMatch = t.title.toLowerCase().includes(ql);
          if (childMatch || selfMatch) next[t.id] = false;
          expandMatching(t.children);
        }
      }
    };
    expandMatching(ticktickTasks);
    expandMatching(localTasks);
    setCollapsed(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const handleCreateLocal = async () => {
    if (!creating.trim()) return;
    try {
      const task = await window.focuslink.tasks.createLocal(creating.trim());
      setLocalTasks([task, ...localTasks]);
      setCreating('');
      addToast('已创建本地任务', 'success');
    } catch (e) {
      addToast('创建失败：' + (e as Error).message, 'error');
    }
  };

  const handleRefresh = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    setLoadingTasks(true);
    setCliError(null);
    try {
      if (taskSource === 'local') {
        const tasks = await window.focuslink.tasks.listLocal();
        setLocalTasks(tasks);
        if (!silent) addToast(`已同步 ${tasks.length} 个本地任务`, 'success');
      } else if (taskSource === 'ticktick-cli') {
        const projRes = await window.focuslink.cli.listProjects();
        if (!projRes.ok) {
          setCliConnected(false);
          setCliError(projRes.error);
          addToast('CLI 项目读取失败：' + projRes.error, 'error');
          return;
        }
        setTicktickProjects(projRes.data);
        setCliConnected(true);
        const taskRes = await window.focuslink.cli.listTasks(selectedProject || undefined);
        if (!taskRes.ok) {
          setCliConnected(false);
          setCliError(taskRes.error);
          addToast('CLI 任务读取失败：' + taskRes.error, 'error');
          return;
        }
        setTicktickTasks(taskRes.data);
        setCliConnected(true);
        const completedCount = countCompleted(taskRes.data);
        if (!silent) {
          addToast(
            `CLI 已同步 ${taskRes.data.length} 个任务${completedCount > 0 ? `（已隐藏 ${completedCount} 个已完成）` : ''}`,
            'success',
          );
        }
      } else if (taskSource === 'ticktick-oauth') {
        if (!ticktickConnected) {
          addToast('TickTick 未连接，请在设置中登录', 'info');
          return;
        }
        const projects = await window.focuslink.ticktick.listProjects();
        setTicktickProjects(projects);
        const tasks = await window.focuslink.ticktick.listTasks(selectedProject || undefined);
        setTicktickTasks(tasks);
        if (!silent) addToast(`已同步 ${tasks.length} 个任务`, 'success');
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (taskSource === 'ticktick-cli') {
        setCliConnected(false);
        setCliError(msg);
      }
      addToast('同步失败：' + msg, 'error');
    } finally {
      setLoadingTasks(false);
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    if (taskSource === 'ticktick-cli') {
      setLoadingTasks(true);
      try {
        const res = await window.focuslink.cli.searchTasks(query.trim());
        if (res.ok) {
          setTicktickTasks(res.data);
          addToast(`搜索到 ${res.data.length} 个任务`, 'success');
        } else {
          addToast('搜索失败：' + res.error, 'error');
        }
      } catch (e) {
        addToast('搜索异常：' + (e as Error).message, 'error');
      } finally {
        setLoadingTasks(false);
      }
    }
  };

  const handleLinkSegment = async (task: Task) => {
    if (!snapshot?.currentSegmentId) {
      addToast('当前没有进行中的片段', 'info');
      return;
    }
    try {
      await window.focuslink.timer.linkTask(
        snapshot.currentSegmentId,
        task.id,
        task.source,
        task.title,
      );
      addToast(`已关联到当前片段：${task.title}`, 'success');
    } catch (e) {
      addToast('关联失败：' + (e as Error).message, 'error');
    }
  };

  const handleLinkSession = async (task: Task) => {
    if (!snapshot?.sessionId) {
      addToast('当前没有进行中的会话', 'info');
      return;
    }
    try {
      await window.focuslink.timer.linkSessionTask(
        snapshot.sessionId,
        task.id,
        task.source,
        task.title,
      );
      addToast(`已设为会话默认任务：${task.title}`, 'success');
    } catch (e) {
      addToast('关联失败：' + (e as Error).message, 'error');
    }
  };

  const handleCompleteTask = async (task: Task) => {
    if (task.isCompleted) return;
    try {
      const completed = await window.focuslink.tasks.complete(task);
      if (task.source === 'local') {
        setLocalTasks(markTaskCompleted(localTasks, completed));
      } else {
        setTicktickTasks(markTaskCompleted(ticktickTasks, completed));
      }
      addToast(`已完成任务：${task.title}`, 'success');
    } catch (e) {
      addToast('完成任务失败：' + (e as Error).message, 'error');
    }
  };

  const toggleCollapse = (taskId: string) => {
    setCollapsed((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const isCli = taskSource === 'ticktick-cli';
  const isOAuth = taskSource === 'ticktick-oauth';
  const isLocal = taskSource === 'local';
  const remoteConnected = isCli ? cliConnected : ticktickConnected;
  const sourceTasks = isLocal ? localTasks : ticktickTasks;

  const { filteredTree, completedHidden } = useMemo(() => {
    return filterAndBuildTree(sourceTasks, query, selectedProject, showCompleted);
  }, [sourceTasks, query, selectedProject, showCompleted]);

  const currentProjectName = useMemo(() => {
    if (!selectedProject) return null;
    const p = ticktickProjects.find((pr) => pr.externalId === selectedProject);
    return p?.name ?? null;
  }, [selectedProject, ticktickProjects]);

  const currentSegmentTaskId = useMemo(() => {
    if (!snapshot?.currentSegmentId || !snapshot.segments) return null;
    const seg = snapshot.segments.find((s) => s.id === snapshot.currentSegmentId);
    return seg?.taskId ?? null;
  }, [snapshot?.currentSegmentId, snapshot?.segments]);
  const sessionDefaultTaskId = snapshot?.sessionDefaultTaskId ?? null;
  const totalTaskCount = useMemo(() => countTasks(sourceTasks), [sourceTasks]);
  const visibleTaskCount = useMemo(() => countTasks(filteredTree), [filteredTree]);
  const activeTaskTitle = useMemo(
    () => findTaskTitle(sourceTasks, currentSegmentTaskId ?? sessionDefaultTaskId),
    [sourceTasks, currentSegmentTaskId, sessionDefaultTaskId],
  );

  const sourceLabel = isLocal ? '本地' : isCli ? (remoteConnected ? 'dida CLI' : 'CLI 未连接') : (remoteConnected ? 'TickTick' : '未连接');

  return (
    <div className={`flex h-full min-h-0 flex-col ${inDrawer ? 'p-3' : ''}`}>
      {/* ── 紧凑头部：来源 + 统计 + 刷新 ── */}
      <div className="task-header flex items-center justify-between gap-2 px-1 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`task-source-dot ${remoteConnected ? 'connected' : ''}`} />
          <span className="text-[12px] font-semibold text-fg">{sourceLabel}</span>
          {currentProjectName && (
            <>
              <span className="text-fg-subtle/40">/</span>
              <span className="truncate text-[11.5px] text-fg-muted">{currentProjectName}</span>
            </>
          )}
          <span className="task-count-pill">{visibleTaskCount}{visibleTaskCount !== totalTaskCount ? `/${totalTaskCount}` : ''}</span>
        </div>
        <button
          className="task-refresh-btn motion-press"
          onClick={() => handleRefresh()}
          disabled={loadingTasks || (isOAuth && !ticktickConnected)}
          title="刷新任务列表"
        >
          <Icon.Refresh size="xs" spin={loadingTasks} />
        </button>
      </div>

      {/* CLI 错误提示 */}
      {cliError && (
        <div className="motion-fade-in mb-2 flex items-start gap-1.5 rounded-md border border-danger/20 bg-danger/8 px-2.5 py-1.5">
          <Icon.AlertCircle size="xs" className="mt-0.5 flex-shrink-0 text-danger/70" />
          <p className="text-[11px] leading-relaxed text-danger/80">{cliError}</p>
        </div>
      )}

      {/* ── 搜索行 + 过滤 ── */}
      <div className="mb-1.5 space-y-1.5">
        <div className="task-search-row">
          <Icon.Search size="xs" tone="subtle" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            className="task-search-input"
            placeholder="搜索任务…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && isCli && handleSearch()}
          />
          {query ? (
            <button
              className="task-search-clear motion-press"
              onClick={() => setQuery('')}
            >
              <Icon.X size="xs" />
            </button>
          ) : (
            !isLocal && ticktickProjects.length > 0 && (
              <select
                className="task-project-select"
                value={selectedProject}
                onChange={(e) => {
                  setSelectedProject(e.target.value);
                  setTimeout(() => handleRefresh(), 0);
                }}
                title="选择清单"
              >
                <option value="">全部</option>
                {ticktickProjects.map((p: Project) => (
                  <option key={p.id} value={p.externalId}>{p.name}</option>
                ))}
              </select>
            )
          )}
        </div>

        <div className="flex items-center justify-between px-0.5">
          <button
            className="task-toggle-completed motion-press"
            onClick={() => setShowCompleted((v) => !v)}
          >
            {showCompleted ? <Icon.Eye size="xs" /> : <Icon.EyeOff size="xs" />}
            <span>{showCompleted ? '显示已完成' : '隐藏已完成'}</span>
            {completedHidden > 0 && !showCompleted && (
              <span className="task-hidden-count">+{completedHidden}</span>
            )}
          </button>
          {activeTaskTitle && (
            <span className="task-active-label" title={activeTaskTitle}>
              <Icon.Link size="xs" />
              <span className="truncate max-w-[100px]">{activeTaskTitle}</span>
            </span>
          )}
        </div>

        {isLocal && (
          <div className="task-create-row">
            <input
              className="task-create-input"
              placeholder="新建任务…"
              value={creating}
              onChange={(e) => setCreating(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateLocal()}
            />
            <button
              className="task-create-btn motion-press"
              onClick={handleCreateLocal}
              disabled={!creating.trim()}
            >
              <Icon.Plus size="xs" />
            </button>
          </div>
        )}
      </div>

      {/* ── 任务列表（Linear 风格极简行） ── */}
      <div className="task-list-scroll min-h-0 flex-1 overflow-y-auto">
        {filteredTree.length === 0 ? (
          <div className="motion-fade-in flex flex-col items-center justify-center gap-2 py-12 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-subtle/40 text-fg-subtle">
              <Icon.ListTree size="md" />
            </div>
            <div className="space-y-0.5">
              <p className="text-[12.5px] font-medium text-fg-muted">
                {sourceTasks.length === 0
                  ? isCli ? '点击刷新加载任务' : '暂无任务'
                  : '没有匹配的任务'}
              </p>
              <p className="text-[11px] text-fg-subtle">
                {sourceTasks.length === 0
                  ? isCli ? '或检查 CLI 配置' : '创建你的第一个任务'
                  : '调整搜索或切换清单'}
              </p>
            </div>
          </div>
        ) : (
          <div className="task-tree">
            {filteredTree.map((task) => (
              <TaskTreeItem
                key={task.id}
                task={task}
                depth={0}
                collapsed={collapsed}
                onToggleCollapse={toggleCollapse}
                onLinkSegment={handleLinkSegment}
                onLinkSession={handleLinkSession}
                onCompleteTask={handleCompleteTask}
                currentSegmentId={snapshot?.currentSegmentId}
                currentSegmentTaskId={currentSegmentTaskId}
                sessionDefaultTaskId={sessionDefaultTaskId}
                showCompleted={showCompleted}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── 底部同步状态（极简一行） ── */}
      <SyncBar />
    </div>
  );
}

/** 递归过滤 + 构建树 */
function filterAndBuildTree(
  tasks: Task[],
  query: string,
  projectId: string,
  showCompleted: boolean,
): { filteredTree: Task[]; completedHidden: number } {
  const q = query.trim().toLowerCase();
  let completedHidden = 0;
  const byProject = projectId ? filterTreeByProject(tasks, projectId) : tasks;

  const recurse = (list: Task[]): Task[] => {
    const out: Task[] = [];
    for (const t of list) {
      if (t.isCompleted && !showCompleted) completedHidden++;
      const children = t.children ? recurse(t.children) : [];
      const selfMatch = !q || t.title.toLowerCase().includes(q);
      const childHasMatch = children.length > 0;
      const passCompletedFilter = showCompleted || !t.isCompleted;
      if (!passCompletedFilter) continue;
      if (q && !selfMatch && !childHasMatch) continue;
      out.push({ ...t, children: children.length > 0 ? children : undefined });
    }
    return out;
  };

  const sortTasks = (list: Task[]): Task[] => {
    const sorted = [...list].sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;
      if (a.sortOrder != null && b.sortOrder != null && a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return 0;
    });
    return sorted.map((t) => ({ ...t, children: t.children ? sortTasks(t.children) : undefined }));
  };

  return { filteredTree: sortTasks(recurse(byProject)), completedHidden };
}

function filterTreeByProject(tasks: Task[], projectId: string): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    const children = t.children ? filterTreeByProject(t.children, projectId) : [];
    const selfMatch = t.projectId === projectId;
    if (selfMatch || children.length > 0) {
      out.push({ ...t, children: children.length > 0 ? children : undefined });
    }
  }
  return out;
}

function markTaskCompleted(tasks: Task[], completed: Task): Task[] {
  const matches = (task: Task) =>
    task.id === completed.id ||
    task.externalId === completed.externalId ||
    task.id === completed.externalId ||
    task.externalId === completed.id;
  return tasks.map((task) => {
    const children = task.children ? markTaskCompleted(task.children, completed) : undefined;
    if (matches(task)) return { ...task, status: 'completed', isCompleted: true, children };
    return children ? { ...task, children } : task;
  });
}

function countTasks(tasks: Task[]): number {
  let n = 0;
  for (const t of tasks) {
    n++;
    if (t.children) n += countTasks(t.children);
  }
  return n;
}

function findTaskTitle(tasks: Task[], id?: string | null): string | null {
  if (!id) return null;
  for (const task of tasks) {
    if (task.id === id || task.externalId === id) return task.title;
    const child = task.children ? findTaskTitle(task.children, id) : null;
    if (child) return child;
  }
  return null;
}

function countCompleted(tasks: Task[]): number {
  let n = 0;
  for (const t of tasks) {
    if (t.isCompleted) n++;
    if (t.children) n += countCompleted(t.children);
  }
  return n;
}

/** Linear 风格任务树节点 */
function TaskTreeItem({
  task,
  depth,
  collapsed,
  onToggleCollapse,
  onLinkSegment,
  onLinkSession,
  onCompleteTask,
  currentSegmentId,
  currentSegmentTaskId,
  sessionDefaultTaskId,
  showCompleted,
}: {
  task: Task;
  depth: number;
  collapsed: Record<string, boolean>;
  onToggleCollapse: (id: string) => void;
  onLinkSegment: (t: Task) => void;
  onLinkSession: (t: Task) => void;
  onCompleteTask: (t: Task) => void;
  currentSegmentId?: string | null;
  currentSegmentTaskId?: string | null;
  sessionDefaultTaskId?: string | null;
  showCompleted: boolean;
}) {
  const hasChildren = task.children && task.children.length > 0;
  const isCollapsed = collapsed[task.id] === true;
  const isCompleted = task.isCompleted === true;
  const isCurrentSegmentTask = currentSegmentTaskId === task.id;
  const isSessionDefaultTask = sessionDefaultTaskId === task.id;
  const isHighlighted = isCurrentSegmentTask || isSessionDefaultTask;
  const childCount = task.children?.length ?? 0;

  // 优先级颜色映射
  const priorityColor = task.priority != null && task.priority > 0
    ? task.priority >= 3 ? 'var(--danger)' : task.priority === 2 ? 'var(--warning)' : 'var(--info)'
    : null;

  return (
    <>
      <div
        className={`task-row-linear group ${isHighlighted ? 'task-row-highlighted' : ''} ${isCompleted ? 'task-row-done' : ''}`}
        data-depth={depth}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        {/* 折叠箭头 / 连接点 */}
        {hasChildren ? (
          <button
            className="task-chevron motion-press"
            onClick={() => onToggleCollapse(task.id)}
            title={isCollapsed ? '展开' : '收起'}
          >
            <motion.span animate={{ rotate: isCollapsed ? 0 : 90 }} transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}>
              <Icon.ChevronRight size="xs" />
            </motion.span>
          </button>
        ) : (
          <span className="task-leaf-dot" style={{ left: depth * 16 + 14 }} />
        )}

        {/* 复选框 — Linear 风格 16px 1.5px stroke */}
        <button
          className={`task-checkbox ${isCompleted ? 'checked' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!isCompleted) onCompleteTask(task);
          }}
          disabled={isCompleted}
          title={isCompleted ? '已完成' : '完成'}
        >
          {isCompleted && <Icon.Check size="xs" />}
        </button>

        {/* 优先级色点 */}
        {priorityColor && !isCompleted && (
          <span className="task-priority-dot" style={{ background: priorityColor }} title={`P${task.priority}`} />
        )}

        {/* 标题 */}
        <span className={`task-title ${isCompleted ? 'done' : ''} ${depth === 0 ? 'parent' : ''}`}>
          {task.title}
        </span>

        {/* 元信息 — 极简内联 */}
        <div className="task-meta-inline">
          {hasChildren && (
            <span className="task-child-count">{childCount}</span>
          )}
          {task.dueDate && !isCompleted && (
            <span className="task-due-mini">
              {new Date(task.dueDate).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
            </span>
          )}
        </div>

        {/* 关联标记 — 极简色点 */}
        {isCurrentSegmentTask && (
          <span className="task-link-badge segment" title="当前片段">
            <Icon.Link size="xs" />
          </span>
        )}
        {isSessionDefaultTask && !isCurrentSegmentTask && (
          <span className="task-link-badge session" title="会话默认">
            <Icon.Star size="xs" />
          </span>
        )}

        {/* hover 操作 — 次要按钮才显现 */}
        <div className="task-actions">
          <button
            className="task-action-btn motion-press"
            onClick={() => onLinkSegment(task)}
            disabled={!currentSegmentId}
            title="关联片段"
          >
            <Icon.Link size="xs" />
          </button>
          <button
            className="task-action-btn motion-press"
            onClick={() => onLinkSession(task)}
            title="设为默认"
          >
            <Icon.Star size="xs" />
          </button>
        </div>
      </div>

      {/* 子任务递归 */}
      {hasChildren && !isCollapsed && (
        <AnimatePresence initial={false}>
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="task-children-wrap overflow-hidden"
          >
            {task.children!.map((child) => (
              <TaskTreeItem
                key={child.id}
                task={child}
                depth={depth + 1}
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
                onLinkSegment={onLinkSegment}
                onLinkSession={onLinkSession}
                onCompleteTask={onCompleteTask}
                currentSegmentId={currentSegmentId}
                currentSegmentTaskId={currentSegmentTaskId}
                sessionDefaultTaskId={sessionDefaultTaskId}
                showCompleted={showCompleted}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      )}
    </>
  );
}

/** 极简同步状态栏 */
function SyncBar() {
  const { addToast } = useStore();
  const [queue, setQueue] = useState<SyncQueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refreshQueue = async () => {
    const items = (await window.focuslink.sync.list()) as SyncQueueItem[];
    setQueue(items);
  };

  useEffect(() => {
    void refreshQueue();
  }, []);

  const counts = useMemo(() => {
    const failedItems = queue.filter(
      (item) => item.status === 'failed' || (item.status === 'pending' && !!item.lastError),
    );
    return {
      pending: queue.filter((item) => item.status === 'pending').length,
      failed: failedItems.length,
      synced: queue.filter((item) => item.status === 'synced').length,
    };
  }, [queue]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      if (counts.pending === 0 && counts.failed > 0) {
        for (const item of queue.filter((q) => q.status === 'failed')) {
          await window.focuslink.sync.retry(item.id);
        }
      }
      const res = await window.focuslink.sync.runPending();
      await refreshQueue();
      if (res.failed > 0) {
        addToast(`同步：${res.succeeded} 成功，${res.failed} 失败`, 'error');
      } else if (res.processed > 0) {
        addToast(`同步：${res.succeeded} 项成功`, 'success');
      } else {
        addToast('无未同步记录', 'info');
      }
    } catch (e) {
      addToast('同步失败：' + (e as Error).message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const hasProblem = counts.failed > 0;
  const hasPending = counts.pending > 0;
  const statusColor = hasProblem ? 'danger' : hasPending ? 'warning' : 'success';
  const statusText = hasProblem ? `${counts.failed} 失败` : hasPending ? `${counts.pending} 待同步` : counts.synced > 0 ? `${counts.synced} 已同步` : '无队列';

  return (
    <div className="sync-bar flex items-center justify-between px-1 pt-2">
      <div className="flex items-center gap-1.5">
        <span className={`sync-status-dot ${statusColor}`} />
        <span className="text-[10.5px] font-medium text-fg-subtle">{statusText}</span>
      </div>
      <button
        className="sync-action-btn motion-press"
        onClick={handleSync}
        disabled={syncing || (!hasPending && !hasProblem)}
      >
        <Icon.Refresh size="xs" spin={syncing} />
        <span>{hasProblem && !hasPending ? '重试' : '同步'}</span>
      </button>
    </div>
  );
}

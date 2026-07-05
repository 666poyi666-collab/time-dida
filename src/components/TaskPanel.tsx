// 右侧任务区 - 根据 settings.taskSource 选择任务来源（本地 / dida CLI / TickTick OAuth）
// 任务树展示 + 默认隐藏已完成 + 折叠展开 + 搜索展开匹配父任务
import { useEffect, useMemo, useRef, useState } from 'react';
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
  // 折叠状态：按 taskId 记录；true=已折叠，false/未定义=展开
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // 已初始化过的父任务 id 集合，避免覆盖用户手动展开的状态
  const initializedRef = useRef<Set<string>>(new Set());
  // 搜索前的折叠状态快照，清空搜索时恢复
  const beforeSearchRef = useRef<Record<string, boolean> | null>(null);

  const taskSource: TaskSource = settings?.taskSource ?? 'local';

  // 启动时根据 taskSource 自动刷新一次
  useEffect(() => {
    if (taskSource === 'ticktick-cli') {
      handleRefresh({ silent: true });
    } else if (taskSource === 'ticktick-oauth' && ticktickConnected) {
      handleRefresh({ silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskSource]);

  // 任务列表变化时，对新出现的父任务初始化为折叠状态（默认折叠）
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

  // 搜索时自动展开包含匹配项的父任务；清空搜索时恢复快照
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      // 清空搜索 → 恢复搜索前的折叠快照
      if (beforeSearchRef.current !== null) {
        setCollapsed(beforeSearchRef.current);
        beforeSearchRef.current = null;
      }
      return;
    }
    // 进入搜索 → 保存当前折叠快照（仅首次进入时保存）
    if (beforeSearchRef.current === null) {
      beforeSearchRef.current = { ...collapsed };
    }
    const next: Record<string, boolean> = { ...collapsed };
    const ql = q.toLowerCase();
    // 对所有有 children 的父任务，如果任意子任务匹配或自身匹配，则展开
    const expandMatching = (tasks: Task[]) => {
      for (const t of tasks) {
        if (t.children && t.children.length > 0) {
          const childMatch = t.children.some((c) => c.title.toLowerCase().includes(ql));
          const selfMatch = t.title.toLowerCase().includes(ql);
          if (childMatch || selfMatch) {
            next[t.id] = false; // 展开
          }
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

  /** 根据 taskSource 切换调用路径 */
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

  // 状态卡数据
  const isCli = taskSource === 'ticktick-cli';
  const isOAuth = taskSource === 'ticktick-oauth';
  const isLocal = taskSource === 'local';
  const remoteConnected = isCli ? cliConnected : ticktickConnected;

  // 选择当前列表（按 taskSource）
  const sourceTasks = isLocal ? localTasks : ticktickTasks;

  // 应用过滤：按清单 + 已完成 + 搜索（搜索在当前清单范围内）
  const { filteredTree, completedHidden } = useMemo(() => {
    return filterAndBuildTree(sourceTasks, query, selectedProject, showCompleted);
  }, [sourceTasks, query, selectedProject, showCompleted]);

  // 当前清单名称（用于状态卡显示）
  const currentProjectName = useMemo(() => {
    if (!selectedProject) return null;
    const p = ticktickProjects.find((pr) => pr.externalId === selectedProject);
    return p?.name ?? null;
  }, [selectedProject, ticktickProjects]);

  // 当前清单下的任务总数（未过滤已完成，仅按清单筛选）
  const currentProjectTaskCount = useMemo(() => {
    if (!selectedProject) return null;
    const count = (tasks: Task[]): number => {
      let n = 0;
      for (const t of tasks) {
        if (t.projectId === selectedProject) n++;
        if (t.children) n += count(t.children);
      }
      return n;
    };
    return count(sourceTasks);
  }, [sourceTasks, selectedProject]);

  // 用于高亮：当前 segment 的 taskId（区别于 session 默认）
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

  return (
    <div className={`flex h-full min-h-0 flex-col gap-3.5 ${inDrawer ? 'p-4' : ''}`}>
      {/* 任务来源状态卡 */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`motion-state-bg flex h-9 w-9 items-center justify-center rounded-xl border ${
                remoteConnected
                  ? 'border-accent/20 bg-accent/10 text-accent'
                  : 'border-border bg-bg-subtle text-fg-subtle'
              }`}
            >
              {isLocal ? (
                <Icon.HardDrive size="md" />
              ) : isCli ? (
                <Icon.Terminal size="md" />
              ) : remoteConnected ? (
                <Icon.Cloud size="md" />
              ) : (
                <Icon.CloudOff size="md" />
              )}
            </div>
            <div>
              <p className="text-sm font-bold leading-tight text-fg">
                {isLocal && '本地任务'}
                {isCli && (remoteConnected ? 'dida CLI 已连接' : 'dida CLI 未连接')}
                {isOAuth && (remoteConnected ? 'TickTick 已连接' : 'TickTick 未连接')}
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-fg-subtle">
                {isLocal && '在设置页可切换为 dida CLI 或 TickTick OAuth'}
                {isCli &&
                  (remoteConnected
                    ? currentProjectName
                      ? `当前清单：${currentProjectName} · 共 ${currentProjectTaskCount ?? 0} 个任务`
                      : '通过命令行同步滴答清单'
                    : '请检查 CLI 配置')}
                {isOAuth && (remoteConnected ? '通过 OAuth 实时同步' : '请在设置中登录')}
              </p>
            </div>
          </div>
          <button
            className="btn-ghost motion-press flex h-8 w-8 items-center justify-center rounded-lg !p-0 text-fg-muted"
            onClick={() => handleRefresh()}
            disabled={loadingTasks || (isOAuth && !ticktickConnected)}
            title="刷新任务列表"
          >
            <Icon.Refresh size="md" spin={loadingTasks} />
          </button>
        </div>

        {cliError && (
          <div className="motion-fade-in mt-3 flex items-start gap-2 rounded-xl border border-danger/15 bg-danger/10 px-3.5 py-2.5">
            <Icon.AlertCircle size="sm" className="mt-0.5 flex-shrink-0 text-danger/70" />
            <p className="text-xs leading-relaxed text-danger/80">{cliError}</p>
          </div>
        )}

        {!isLocal && ticktickProjects.length > 0 && (
          <div className="mt-3">
            <select
              className="input !py-2 text-xs"
              value={selectedProject}
              onChange={(e) => {
                setSelectedProject(e.target.value);
                setTimeout(() => handleRefresh(), 0);
              }}
            >
              <option value="">所有清单</option>
              {ticktickProjects.map((p: Project) => (
                <option key={p.id} value={p.externalId}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <TaskMetric icon={<Icon.Layers3 size="sm" />} label="总任务" value={String(totalTaskCount)} />
        <TaskMetric
          icon={<Icon.ListTree size="sm" />}
          label="当前可见"
          value={String(visibleTaskCount)}
        />
        <TaskMetric
          icon={<Icon.Link size="sm" />}
          label="专注关联"
          value={activeTaskTitle ? '已定位' : '未关联'}
          tone={activeTaskTitle ? 'accent' : 'muted'}
          title={activeTaskTitle ?? undefined}
        />
      </div>

      {/* 搜索 + 显示已完成开关 */}
      <div className="space-y-2.5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Icon.Search
              size="md"
              tone="subtle"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
            />
            <input
              className="input !pl-10 !pr-9"
              placeholder="搜索任务标题..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && isCli && handleSearch()}
            />
            {query && (
              <button
                className="motion-base absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-fg-subtle hover:bg-bg-subtle hover:text-fg"
                onClick={() => setQuery('')}
                title="清除搜索"
              >
                <Icon.X size="sm" />
              </button>
            )}
          </div>
          {isCli && (
            <button
              className="btn-outline motion-press flex h-10 items-center gap-1.5 !px-4 !py-0"
              onClick={handleSearch}
              disabled={loadingTasks || !query.trim()}
              title="按 Enter 也可搜索"
            >
              <Icon.Search size="sm" />
              搜索
            </button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <button
            className="motion-base status-chip border-border bg-bg-card text-fg-muted hover:bg-bg-subtle hover:text-fg"
            onClick={() => setShowCompleted((v) => !v)}
            title="默认隐藏已完成任务"
          >
            {showCompleted ? <Icon.Eye size="xs" /> : <Icon.EyeOff size="xs" />}
            {showCompleted ? '已显示已完成任务' : '已隐藏已完成任务'}
          </button>
          {completedHidden > 0 && !showCompleted && (
            <span className="rounded-full bg-bg-subtle px-2.5 py-1 text-[11px] font-medium text-fg-subtle">
              已隐藏 {completedHidden} 个已完成
            </span>
          )}
        </div>

        {isLocal && (
          <div className="flex gap-2">
            <input
              className="input !py-2"
              placeholder="新建本地任务..."
              value={creating}
              onChange={(e) => setCreating(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateLocal()}
            />
            <button
              className="btn-primary motion-press flex h-10 items-center justify-center !gap-1.5 !px-4 !py-0"
              onClick={handleCreateLocal}
              title="新建本地任务"
              disabled={!creating.trim()}
            >
              <Icon.Plus size="md" />
              新建
            </button>
          </div>
        )}
      </div>

      {/* 任务树列表 */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
        {filteredTree.length === 0 ? (
          <div className="motion-fade-in flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-bg-card/55 py-12 text-center">
            <div className="motion-breathe flex h-12 w-12 items-center justify-center rounded-xl bg-bg-subtle text-fg-subtle">
              <Icon.ListTree size="xl" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-fg-muted">
                {sourceTasks.length === 0
                  ? isCli
                    ? '点击刷新加载 dida 任务'
                    : '暂无任务'
                  : selectedProject && currentProjectTaskCount === 0
                    ? '当前清单暂无未完成任务'
                    : '没有匹配的任务'}
              </p>
              <p className="text-xs text-fg-subtle">
                {sourceTasks.length === 0
                  ? isCli
                    ? '或检查设置页 CLI 诊断面板'
                    : '点击上方输入框创建你的第一个任务'
                  : selectedProject && currentProjectTaskCount === 0
                    ? '该清单下没有未完成任务，可切换为"所有清单"查看全部'
                    : '尝试调整搜索关键词或切换筛选条件'}
              </p>
            </div>
          </div>
        ) : (
          filteredTree.map((task) => (
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
          ))
        )}
      </div>

      <SyncStatus />
    </div>
  );
}

/** 递归过滤 + 构建树：按清单 + 默认隐藏已完成 + 搜索时匹配则保留父链 */
function filterAndBuildTree(
  tasks: Task[],
  query: string,
  projectId: string,
  showCompleted: boolean,
): { filteredTree: Task[]; completedHidden: number } {
  const q = query.trim().toLowerCase();
  let completedHidden = 0;

  // 先按清单过滤（本地过滤；子任务继承父 projectId，cliProvider 已处理继承）
  const byProject = projectId ? filterTreeByProject(tasks, projectId) : tasks;

  const recurse = (list: Task[]): Task[] => {
    const out: Task[] = [];
    for (const t of list) {
      // 统计已完成但被隐藏的任务
      if (t.isCompleted && !showCompleted) {
        completedHidden++;
      }

      // 处理子任务
      const children = t.children ? recurse(t.children) : [];

      // 是否保留该任务
      const selfMatch = !q || t.title.toLowerCase().includes(q);
      const childHasMatch = children.length > 0;
      const passCompletedFilter = showCompleted || !t.isCompleted;

      if (!passCompletedFilter) {
        continue;
      }
      if (q) {
        if (!selfMatch && !childHasMatch) {
          continue;
        }
      } else {
        if (children.length === 0 && t.children) {
          // 保留但 children 为空
        }
      }

      out.push({ ...t, children: children.length > 0 ? children : undefined });
    }
    return out;
  };

  // 排序：未完成在前，按 sortOrder（dida 排序字段，负值表示更靠前）
  const sortTasks = (list: Task[]): Task[] => {
    const sorted = [...list].sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;
      if (a.sortOrder != null && b.sortOrder != null && a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return 0;
    });
    return sorted.map((t) => ({
      ...t,
      children: t.children ? sortTasks(t.children) : undefined,
    }));
  };

  const filtered = recurse(byProject);
  const sorted = sortTasks(filtered);
  return { filteredTree: sorted, completedHidden };
}

/** 按 projectId 过滤任务树：保留父链，子任务继承父 projectId */
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

function TaskMetric({
  icon,
  label,
  value,
  tone = 'muted',
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'accent' | 'muted';
  title?: string;
}) {
  return (
    <div
      className={`task-metric motion-base px-3 py-2.5 ${
        tone === 'accent' ? 'border-accent/25 !bg-accent/10' : ''
      }`}
      title={title}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 text-fg-subtle">
        <span className={tone === 'accent' ? 'text-accent' : ''}>{icon}</span>
        <span className="text-[10px] font-semibold">{label}</span>
      </div>
      <div className="truncate text-xs font-bold text-fg">{value}</div>
    </div>
  );
}

function markTaskCompleted(tasks: Task[], completed: Task): Task[] {
  const matches = (task: Task) =>
    task.id === completed.id ||
    task.externalId === completed.externalId ||
    task.id === completed.externalId ||
    task.externalId === completed.id;

  return tasks.map((task) => {
    const children = task.children ? markTaskCompleted(task.children, completed) : undefined;
    if (matches(task)) {
      return { ...task, status: 'completed', isCompleted: true, children };
    }
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

/** 统计已完成任务数（递归） */
function countCompleted(tasks: Task[]): number {
  let n = 0;
  for (const t of tasks) {
    if (t.isCompleted) n++;
    if (t.children) n += countCompleted(t.children);
  }
  return n;
}

/** 任务树节点（递归） */
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
  /** 当前 segment 关联的任务 id（仅当 segment 显式关联时高亮"当前片段"） */
  currentSegmentTaskId?: string | null;
  /** 本次 session 的默认任务 id（高亮"本次默认"） */
  sessionDefaultTaskId?: string | null;
  showCompleted: boolean;
}) {
  const hasChildren = task.children && task.children.length > 0;
  const isCollapsed = collapsed[task.id] === true;
  const isCompleted = task.isCompleted === true;
  const isCurrentSegmentTask = currentSegmentTaskId === task.id;
  const isSessionDefaultTask = sessionDefaultTaskId === task.id;
  const isHighlighted = isCurrentSegmentTask || isSessionDefaultTask;

  const isParent = depth === 0;
  const childCount = task.children?.length ?? 0;

  return (
    <>
      <div
        className={`
          group task-row motion-base motion-state-transition
          ${isParent ? 'task-row-parent' : 'task-row-child'}
          ${isHighlighted ? 'selected-accent' : ''}
          ${isCompleted ? 'opacity-50' : ''}
        `}
        style={isParent ? { marginLeft: 0 } : { marginLeft: depth * 12 }}
      >
        {/* 折叠/展开按钮 */}
        {hasChildren ? (
          <button
            className="motion-base flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-fg-subtle hover:bg-bg-elevated hover:text-fg"
            onClick={() => onToggleCollapse(task.id)}
            title={isCollapsed ? '展开子任务' : '收起子任务'}
          >
            {isCollapsed ? <Icon.ChevronRight size="sm" /> : <Icon.ChevronDown size="sm" />}
          </button>
        ) : (
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
            <span className="block h-1.5 w-1.5 rounded-full bg-fg-subtle/30" />
          </span>
        )}

        <div
          className={`motion-state-bg flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${hasChildren ? 'bg-accent/10 text-accent' : 'bg-bg-subtle/60 text-fg-subtle'}`}
        >
          {hasChildren ? (
            <Icon.ListTree size="sm" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
          )}
        </div>

        {/* 完成状态标记 */}
        <button
          className="motion-base flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-fg-subtle hover:bg-success/10 hover:text-success disabled:pointer-events-none"
          onClick={(e) => {
            e.stopPropagation();
            if (!isCompleted) onCompleteTask(task);
          }}
          disabled={isCompleted}
          title={isCompleted ? '已完成' : '完成任务并同步到任务来源'}
        >
          {isCompleted ? (
            <Icon.CheckCircle size="sm" className="text-success/75" />
          ) : (
            <Icon.Circle size="sm" className="text-fg-subtle/50" />
          )}
        </button>

        {/* 标题 + 元信息 */}
        <div className="min-w-0 flex-1">
          <p
            className={`motion-base truncate ${isParent ? 'text-[13px]' : 'text-[13px]'} ${
              isCompleted
                ? 'font-normal text-fg-subtle line-through decoration-fg-subtle/40'
                : isParent
                  ? 'font-semibold text-fg'
                  : 'font-normal text-fg'
            }`}
          >
            {task.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-fg-subtle">
            {task.dueDate && (
              <span className="rounded-md bg-bg-subtle px-1.5 py-px">
                {new Date(task.dueDate).toLocaleDateString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                })}
              </span>
            )}
            {hasChildren && (
              <span className="rounded-md bg-bg-subtle px-1.5 py-px text-fg-subtle">
                子任务 {childCount}
              </span>
            )}
            {isCompleted && (
              <span className="rounded-md bg-success/10 px-1.5 py-px text-success">已完成</span>
            )}
            {task.priority != null && task.priority > 0 && (
              <span className="rounded-md bg-amber-500/10 px-1.5 py-px font-medium text-amber-400">
                P{task.priority}
              </span>
            )}
          </div>
        </div>

        {/* 关联标识 - 当前片段 / 本次默认 */}
        {(isCurrentSegmentTask || isSessionDefaultTask) && (
          <div className="motion-fade-in flex flex-shrink-0 items-center gap-1">
            {isCurrentSegmentTask && (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent shadow-[0_0_8px_rgb(var(--app-accent)/0.18)]">
                <Icon.Link size="xs" /> 当前片段
              </span>
            )}
            {isSessionDefaultTask && !isCurrentSegmentTask && (
              <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                <Icon.Star size="xs" /> 本次默认
              </span>
            )}
          </div>
        )}

        {/* 操作按钮 - hover 时才显示 */}
        <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-out)] group-hover:opacity-100">
          <button
            className="motion-press flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-fg-subtle hover:bg-accent/10 hover:text-accent"
            onClick={() => onLinkSegment(task)}
            title="关联到当前片段"
            disabled={!currentSegmentId}
          >
            <Icon.Link size="xs" />
            片段
          </button>
          <button
            className="motion-press flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-fg-subtle hover:bg-accent/10 hover:text-accent"
            onClick={() => onLinkSession(task)}
            title="设为会话默认任务"
          >
            <Icon.Star size="xs" />
            默认
          </button>
        </div>
      </div>

      {/* 子任务（递归） */}
      {hasChildren && !isCollapsed && (
        <div className="task-tree-children motion-fade-in mt-1 space-y-1">
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
        </div>
      )}
    </>
  );
}

function SyncStatus() {
  const { addToast } = useStore();
  const [queue, setQueue] = useState<SyncQueueItem[]>([]);
  const [stats, setStats] = useState<{
    processed: number;
    succeeded: number;
    failed: number;
  } | null>(null);
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
      lastError: failedItems[0]?.lastError ?? null,
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
      setStats(res);
      await refreshQueue();
      if (res.failed > 0) {
        addToast(`同步完成：${res.succeeded} 成功，${res.failed} 失败`, 'error');
      } else if (res.processed > 0) {
        addToast(`同步完成：${res.succeeded} 项成功`, 'success');
      } else {
        addToast('没有未同步的记录', 'info');
      }
    } catch (e) {
      addToast('同步失败：' + (e as Error).message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const hasProblem = counts.failed > 0;
  const hasPending = counts.pending > 0;
  const statusTitle = hasProblem
    ? '同步队列有失败记录'
    : hasPending
      ? '未同步记录等待处理'
      : '同步队列空';
  const statusSub = stats
    ? `本次处理 ${stats.processed} 项，成功 ${stats.succeeded} 项`
    : hasProblem
      ? (counts.lastError ?? `${counts.failed} 项失败，${counts.pending} 项未同步`)
      : hasPending
        ? `${counts.pending} 项未同步`
        : counts.synced > 0
          ? `最近 ${counts.synced} 项已同步`
          : '暂无同步队列记录';

  return (
    <div className="card flex items-center justify-between p-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className={`motion-state-bg flex h-9 w-9 items-center justify-center rounded-xl border ${
            hasProblem
              ? 'border-danger/20 bg-danger/10 text-danger'
              : hasPending
                ? 'border-warning/25 bg-warning/10 text-warning'
                : 'border-success/20 bg-success/10 text-success'
          }`}
        >
          {hasProblem ? (
            <Icon.AlertCircle size="md" />
          ) : hasPending ? (
            <Icon.Refresh size="md" />
          ) : (
            <Icon.CheckCircleFilled size="md" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-fg">{statusTitle}</p>
          <p className="mt-0.5 truncate text-[10px] font-medium text-fg-subtle" title={statusSub}>
            {statusSub}
          </p>
        </div>
      </div>
      <button
        className="btn-ghost motion-press flex h-8 items-center gap-1.5 !px-3 text-xs"
        onClick={handleSync}
        disabled={syncing || (!hasPending && !hasProblem)}
      >
        <Icon.Refresh size="sm" spin={syncing} />
        {hasProblem && !hasPending ? '重试' : '同步'}
      </button>
    </div>
  );
}

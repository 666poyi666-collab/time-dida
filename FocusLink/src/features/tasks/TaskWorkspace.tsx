import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Project, Task, TimerState } from '@shared/types';
import { useStore } from '../../app/store';
import { Icon, Spinner } from '../../ui/Icon';
import { TaskTree, type TaskTreeRowContext } from './TaskTree';
import { countTaskTree, filterTaskTree, type TaskSortMode } from './taskTreeModel';
import { useTaskTreeCollapse } from './useTaskTreeCollapse';
import {
  FOCUSLINK_INBOX_PROJECT_ID,
  isFocusLinkInboxProject,
  TASK_PROJECT_COLOR_PALETTE,
} from '@shared/taskProjectPolicy';
import '../../styles/tasks-motion.css';

type TaskFilter = 'open' | 'completed';

const TASK_PAGE_SIZE = 120;
const COMPLETED_RANGES = [30, 90, 365] as const;
/**
 * 完成反馈时间线（与 task-workspace.css 同步）：
 * 描边 0–180ms → 填充 160–360ms → 勾线 180–380ms → 文字状态变化自 380ms 过渡
 * → 行收束 390–600ms（collapse-row，normal 档 210ms）。收束结束后再把任务移出列表。
 * 与 6 秒撤销窗口无关。
 */
const COMPLETION_GRACE_MS = 620;
const SORT_OPTIONS: Record<TaskFilter, Array<{ id: TaskSortMode; label: string }>> = {
  open: [
    { id: 'smart', label: 'FocusLink 顺序' },
    { id: 'due', label: '截止日期' },
    { id: 'title', label: '任务名称' },
  ],
  completed: [
    { id: 'completed', label: '最近完成' },
    { id: 'title', label: '任务名称' },
    { id: 'due', label: '截止日期' },
  ],
};

interface UndoCompletion {
  task: Task;
  expiresAt: number;
}

interface CompletedTaskEntry {
  task: Task;
  parentTitle: string | null;
}

export function TaskWorkspace() {
  const {
    snapshot,
    settings,
    syncQueue,
    setSyncQueue,
    setTicktickTasks,
    setTicktickProjects,
    addToast,
  } = useStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [query, setQuery] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [sortMode, setSortMode] = useState<TaskSortMode>('smart');
  const [completedDays, setCompletedDays] = useState<(typeof COMPLETED_RANGES)[number]>(90);
  const [completedLoaded, setCompletedLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [mutatingTaskIds, setMutatingTaskIds] = useState<Set<string>>(new Set());
  const [completionGraceIds, setCompletionGraceIds] = useState<Set<string>>(new Set());
  const [undoCompletion, setUndoCompletion] = useState<UndoCompletion | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(TASK_PAGE_SIZE);
  // 详情栏选中态：选择与开始是两个独立动作（与移动端树/详情双栏同一契约）。
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const undoTimerRef = useRef<number | null>(null);

  const refresh = useCallback(
    async (includeCompleted: boolean, quiet = false, rangeDays?: number, force = false) => {
      const requestId = ++requestIdRef.current;
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setLoadError(null);
      try {
        const result = await window.focuslink.tasks.refresh({
          includeCompleted,
          completedDays: includeCompleted ? rangeDays : undefined,
          force,
        });
        if (requestId !== requestIdRef.current) return;
        if (!result.ok) throw new Error(result.error);
        setTasks(result.data.tasks);
        setProjects(result.data.projects);
        setLastRefresh(result.data.refreshedAt);
        setCompletedLoaded(includeCompleted);
        setTicktickTasks(result.data.tasks);
        setTicktickProjects(result.data.projects);
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        const message = toErrorMessage(error);
        setLoadError(message);
        if (quiet) addToast(`任务刷新失败：${message}`, 'error');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [addToast, setTicktickProjects, setTicktickTasks],
  );

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  useEffect(() => {
    if (filter === 'completed') void refresh(true, false, completedDays);
  }, [completedDays, filter, refresh]);

  useEffect(() => {
    setVisibleLimit(TASK_PAGE_SIZE);
  }, [filter, query, selectedProject, sortMode, completedDays]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
    },
    [],
  );

  const counts = useMemo(() => countTasks(tasks), [tasks]);
  const filteredTree = useMemo(
    () =>
      filterTaskTree(tasks, {
        query,
        projectId: selectedProject,
        showCompleted: true,
        sort: sortMode,
      }).tasks,
    [query, selectedProject, sortMode, tasks],
  );
  const openTree = useMemo(
    () => retainOpenTree(filteredTree, completionGraceIds),
    [completionGraceIds, filteredTree],
  );
  const limitedOpenTree = useMemo(
    () => takeTaskTree(openTree, visibleLimit),
    [openTree, visibleLimit],
  );
  const openCount = useMemo(() => countTaskTree(openTree), [openTree]);
  const completedEntries = useMemo(
    () => sortCompletedEntries(flattenCompletedTasks(filteredTree), sortMode),
    [filteredTree, sortMode],
  );
  const visibleCompletedEntries = completedEntries.slice(0, visibleLimit);
  const { collapsed, toggleCollapse } = useTaskTreeCollapse(tasks, query);
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const pendingSyncCount =
    settings?.taskSource === 'local'
      ? 0
      : syncQueue.filter((item) => item.status === 'pending' || item.status === 'failed').length;
  // 已完成/未完成分组切换淡入：reduced-motion 时仅保留 140ms 透明度过渡。
  const reduceMotion = useReducedMotion();

  // 详情栏解析：优先取显式选中的任务；没有选中时回落到正在专注的当前任务。
  const selectedTask = useMemo(() => {
    const explicit = selectedTaskId ? findTaskById(tasks, selectedTaskId) : null;
    if (explicit) return explicit;
    const currentId = snapshot?.currentTaskId;
    if (!currentId) return null;
    return findTaskById(tasks, currentId);
  }, [selectedTaskId, snapshot?.currentTaskId, tasks]);
  const selectedParentTitle = useMemo(
    () => (selectedTask ? findParentTitle(tasks, selectedTask.id) : null),
    [selectedTask, tasks],
  );

  const applyUpdatedTask = useCallback(
    (updated: Task) => {
      setTasks((current) => {
        const next = replaceTask(current, updated);
        setTicktickTasks(next);
        return next;
      });
    },
    [setTicktickTasks],
  );

  const rememberUndo = useCallback((task: Task) => {
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
    setUndoCompletion({ task, expiresAt: Date.now() + 6000 });
    undoTimerRef.current = window.setTimeout(() => {
      setUndoCompletion(null);
      undoTimerRef.current = null;
    }, 6000);
  }, []);

  const toggleCompleted = async (task: Task, forceCompleted?: boolean) => {
    if (mutatingTaskIds.has(task.id)) return;
    const completed = forceCompleted ?? !task.isCompleted;
    setMutatingTaskIds((current) => new Set(current).add(task.id));
    try {
      const updated = await window.focuslink.tasks.setCompleted(task, completed);
      applyUpdatedTask(updated);
      if (completed) {
        setCompletionGraceIds((current) => new Set(current).add(task.id));
        window.setTimeout(() => {
          setCompletionGraceIds((current) => {
            const next = new Set(current);
            next.delete(task.id);
            return next;
          });
        }, COMPLETION_GRACE_MS);
        rememberUndo(updated);
      } else {
        setCompletionGraceIds((current) => {
          const next = new Set(current);
          next.delete(task.id);
          return next;
        });
        if (undoCompletion?.task.id === task.id) setUndoCompletion(null);
        addToast(`已恢复「${task.title}」`, 'success');
      }
    } catch (error) {
      addToast(`${completed ? '完成' : '恢复'}失败：${toErrorMessage(error)}`, 'error');
    } finally {
      setMutatingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  };

  const undoLastCompletion = async () => {
    const item = undoCompletion;
    if (!item) return;
    if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setUndoCompletion(null);
    await toggleCompleted(item.task, false);
  };

  const focusTask = async (task: Task) => {
    try {
      if (snapshot?.sessionId && snapshot.currentSegmentId) {
        await window.focuslink.timer.linkTask(
          snapshot.currentSegmentId,
          task.externalId || task.id,
          task.source,
          task.title,
        );
        addToast(`当前片段已关联「${task.title}」`, 'success');
      } else {
        await window.focuslink.timer.startWithTask(
          task.externalId || task.id,
          task.source,
          task.title,
        );
        addToast(`开始专注「${task.title}」`, 'success');
      }
    } catch (error) {
      addToast(`无法开始专注：${toErrorMessage(error)}`, 'error');
    }
  };

  const syncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    const [dida, tomatodo] = await Promise.allSettled([
      settings?.taskSource === 'local'
        ? Promise.resolve({ succeeded: 0, failed: 0, skipped: true })
        : window.focuslink.sync.runPending(),
      window.focuslink.tomatodo.uploadPending(),
    ]);
    try {
      setSyncQueue(await window.focuslink.sync.list());
    } catch {
      // The primary result below remains the source of truth for feedback.
    }
    const failures: string[] = [];
    if (dida.status === 'rejected') failures.push(`任务同步：${toErrorMessage(dida.reason)}`);
    else if (dida.value.failed > 0) failures.push(`任务同步：${dida.value.failed} 条失败`);
    if (tomatodo.status === 'rejected')
      failures.push(`番茄 Todo：${toErrorMessage(tomatodo.reason)}`);
    else if (!tomatodo.value.ok) failures.push(`番茄 Todo：${tomatodo.value.error ?? '上传失败'}`);
    addToast(
      failures.length > 0 ? failures.join('；') : '同步队列已检查完成',
      failures.length > 0 ? 'error' : 'success',
    );
    setSyncing(false);
  };

  const createLocalTask = async () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    try {
      await window.focuslink.tasks.create(title, selectedProject || undefined);
      setNewTaskTitle('');
      await refresh(false, true, undefined, true);
      addToast('任务已加入 FocusLink', 'success');
    } catch (error) {
      addToast(`创建任务失败：${toErrorMessage(error)}`, 'error');
    }
  };

  const createLocalProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const project = await window.focuslink.tasks.createProject(name);
      setNewProjectName('');
      await refresh(false, true, undefined, true);
      setSelectedProject(project.id);
      addToast('清单已创建', 'success');
    } catch (error) {
      addToast(`创建清单失败：${toErrorMessage(error)}`, 'error');
    }
  };

  const updateLocalProject = async (
    projectId: string,
    input: { name?: string; color?: string | null },
  ) => {
    try {
      const updated = await window.focuslink.tasks.updateProject(projectId, input);
      setProjects((current) => {
        const next = current.map((project) => (project.id === updated.id ? updated : project));
        setTicktickProjects(next);
        return next;
      });
      addToast('清单设置已保存', 'success');
    } catch (error) {
      addToast(`保存清单失败：${toErrorMessage(error)}`, 'error');
      throw error;
    }
  };

  const moveLocalTask = async (task: Task, projectId: string) => {
    if (mutatingTaskIds.has(task.id) || task.projectId === projectId) return;
    setMutatingTaskIds((current) => new Set(current).add(task.id));
    try {
      const updated = await window.focuslink.tasks.moveTask(task.id, projectId);
      applyUpdatedTask(updated);
      await refresh(filter === 'completed', true, completedDays, true);
      const destination = projectById.get(projectId)?.name ?? '收件箱';
      addToast(`已移到「${destination}」`, 'success');
    } catch (error) {
      addToast(`移动任务失败：${toErrorMessage(error)}`, 'error');
    } finally {
      setMutatingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  };

  const changeFilter = (next: TaskFilter) => {
    setFilter(next);
    setSortMode(next === 'completed' ? 'completed' : 'smart');
  };

  const displayedCount = filter === 'open' ? openCount : completedEntries.length;
  const hasMore = displayedCount > visibleLimit;

  return (
    <div className="task-workspace-page h-full overflow-hidden">
      {/* 工位横幅：视图身份 → 全局任务读数 → 同步与刷新 */}
      <header className="task-console view-console">
        <div className="console-identity">
          <span className="console-kicker">FocusLink · 任务</span>
          <span className="task-console-word">{filter === 'open' ? '今日执行' : '完成记录'}</span>
          <span className="task-console-count">
            {filter === 'completed'
              ? `最近 ${completedDays} 天 · ${displayedCount} 项`
              : `${displayedCount} 项`}
          </span>
        </div>
        <div className="console-readout">
          <span className="task-console-stat">
            待完成 <b className="timer-digit">{counts.open}</b>
          </span>
          <span className="task-console-stat">
            已完成 <b className="timer-digit">{completedLoaded ? counts.completed : '—'}</b>
          </span>
          {pendingSyncCount > 0 && (
            <span className="task-pending-label">{pendingSyncCount} 条未同步</span>
          )}
        </div>
        <div className="console-actions task-workbench-actions">
          <form
            className="task-quick-add"
            onSubmit={(event) => {
              event.preventDefault();
              void createLocalTask();
            }}
          >
            <input
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value)}
              placeholder={`添加到${selectedProject ? `「${projectById.get(selectedProject)?.name ?? '当前清单'}」` : '收件箱'}`}
              aria-label="添加 FocusLink 任务"
            />
            <button type="submit" aria-label="创建任务" title="创建任务">
              +
            </button>
          </form>
          {(settings?.taskSource !== 'local' || settings?.tomatodo.enabled) && (
            <button
              type="button"
              className="task-icon-action"
              onClick={syncAll}
              disabled={syncing}
              aria-label="同步已启用的外部服务"
              title="同步已启用的外部服务"
            >
              {syncing ? <Spinner size="sm" /> : <Icon.Cloud size="sm" />}
            </button>
          )}
          <button
            type="button"
            className="task-icon-action"
            onClick={() => refresh(filter === 'completed', true, completedDays, true)}
            disabled={refreshing}
            aria-label="刷新 FocusLink 任务"
            title="刷新 FocusLink 任务"
          >
            <Icon.Refresh size="sm" spin={refreshing} />
          </button>
        </div>
      </header>

      <div className="task-workspace-shell grid h-full overflow-hidden">
        <aside className="task-navigation" aria-label="任务视图与清单">
          <div className="task-navigation-heading">
            <span className="task-product-mark">
              <Icon.ListChecks size="sm" />
            </span>
            <div>
              <strong>任务索引</strong>
              <span>先安排，再进入专注</span>
            </div>
          </div>

          <nav className="task-view-list" aria-label="任务状态">
            <button
              type="button"
              className={filter === 'open' ? 'active' : ''}
              onClick={() => changeFilter('open')}
            >
              <Icon.Circle size="sm" />
              <span>待完成</span>
              <small>{counts.open}</small>
            </button>
            <button
              type="button"
              className={filter === 'completed' ? 'active' : ''}
              onClick={() => changeFilter('completed')}
            >
              <Icon.CheckCircle size="sm" />
              <span>已完成</span>
              <small>{completedLoaded ? counts.completed : '—'}</small>
            </button>
          </nav>

          <div className="task-navigation-divider" />
          <div className="task-navigation-label">清单</div>
          <form
            className="task-project-create"
            onSubmit={(event) => {
              event.preventDefault();
              void createLocalProject();
            }}
          >
            <input
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="新建清单"
              aria-label="新建清单"
            />
            <button type="submit" disabled={!newProjectName.trim()} aria-label="创建清单">
              +
            </button>
          </form>
          <div className="task-project-list">
            <ProjectButton
              active={!selectedProject}
              label="全部任务"
              count={filter === 'open' ? counts.open : counts.completed}
              onClick={() => setSelectedProject('')}
            />
            {projects.map((project) => (
              <ProjectButton
                key={project.id}
                active={selectedProject === project.id || selectedProject === project.externalId}
                label={project.name}
                color={project.color}
                count={countProjectTasks(tasks, project.id, filter)}
                onClick={() => setSelectedProject(project.externalId || project.id)}
                onEdit={
                  isFocusLinkInboxProject(project.id)
                    ? undefined
                    : () =>
                        setEditingProjectId((current) =>
                          current === project.id ? null : project.id,
                        )
                }
                onDropTask={(taskId) => {
                  const task = findTaskById(tasks, taskId);
                  if (task) void moveLocalTask(task, project.id);
                }}
              />
            ))}
          </div>
          {editingProjectId && projectById.get(editingProjectId) && (
            <ProjectEditor
              project={projectById.get(editingProjectId)!}
              onSave={(input) => updateLocalProject(editingProjectId, input)}
            />
          )}

          {/* 「连接正常」是一句断言，只有真的成功读到过任务才能说。首次加载完成前
              既没有 loadError 也没有 lastRefresh，旧写法会在这段时间亮着绿点说
              连接正常，下面一行却写着「正在连接」——CLI 根本不存在时也一样。 */}
          <div className="task-navigation-status">
            <span className={loadError ? 'error' : lastRefresh ? 'ready' : 'pending'} />
            <div>
              <strong>
                {loadError ? '需要检查同步' : lastRefresh ? '本地任务已就绪' : '正在读取任务'}
              </strong>
              <small>
                {loadError
                  ? '任务读取失败，可在设置里检查同步'
                  : lastRefresh
                    ? `${formatRefreshTime(lastRefresh)} 更新`
                    : '正在读取 FocusLink 任务'}
              </small>
            </div>
          </div>
        </aside>

        <section className="task-workbench">
          <div className="task-workbench-toolbar">
            <label className="task-workspace-search">
              <Icon.Search size="sm" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索任务"
                aria-label="搜索任务"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                  <Icon.X size="xs" />
                </button>
              )}
            </label>
            <label className="task-control-select">
              <span>排序</span>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as TaskSortMode)}
                aria-label="任务排序"
              >
                {SORT_OPTIONS[filter].map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {filter === 'completed' && (
              <label className="task-control-select">
                <span>范围</span>
                <select
                  value={completedDays}
                  onChange={(event) =>
                    setCompletedDays(
                      Number(event.target.value) as (typeof COMPLETED_RANGES)[number],
                    )
                  }
                  aria-label="已完成任务日期范围"
                >
                  {COMPLETED_RANGES.map((days) => (
                    <option key={days} value={days}>
                      近 {days === 365 ? '1 年' : `${days} 天`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="task-result-count">{displayedCount} 项</span>
          </div>

          <div className="task-workbench-list" aria-busy={loading || refreshing}>
            <motion.div
              key={filter}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0.14, ease: [0.4, 0, 0.2, 1] }
                  : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }
              }
            >
              {loading ? (
                <TaskSkeletonList />
              ) : loadError ? (
                <TaskEmpty
                  danger
                  icon={<Icon.CloudOff size="lg" />}
                  title="暂时读不到任务"
                  detail={loadError}
                  action="重新连接"
                  onAction={() => refresh(filter === 'completed', false, completedDays, true)}
                />
              ) : filter === 'open' ? (
                limitedOpenTree.length === 0 ? (
                  <TaskEmpty
                    icon={query ? <Icon.Search size="lg" /> : <Icon.CheckCircle size="lg" />}
                    title={query ? '没有匹配的任务' : '这里已经清空'}
                    detail={query ? '换个关键词或清单试试。' : '完成的任务会在“已完成”里保留。'}
                  />
                ) : (
                  <TaskTree
                    tasks={limitedOpenTree}
                    collapsed={collapsed}
                    onToggleCollapse={toggleCollapse}
                    className="task-workbench-tree"
                    renderRow={(context) => (
                      <WorkbenchTaskRow
                        {...context}
                        project={
                          context.task.projectId
                            ? projectById.get(context.task.projectId)
                            : undefined
                        }
                        mutating={mutatingTaskIds.has(context.task.id)}
                        checking={completionGraceIds.has(context.task.id)}
                        currentTaskId={snapshot?.currentTaskId ?? null}
                        timerState={snapshot?.state ?? 'idle'}
                        selected={selectedTask?.id === context.task.id}
                        onSelect={() => setSelectedTaskId(context.task.id)}
                        onToggleCompleted={() => toggleCompleted(context.task)}
                        onFocus={() => focusTask(context.task)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData(
                            'application/x-focuslink-task',
                            context.task.id,
                          );
                        }}
                      />
                    )}
                  />
                )
              ) : visibleCompletedEntries.length === 0 ? (
                <TaskEmpty
                  icon={<Icon.History size="lg" />}
                  title={query ? '没有匹配的已完成任务' : '这个范围内没有完成记录'}
                  detail={query ? '试试任务名称中的其他关键词。' : '可以扩大日期范围继续查找。'}
                />
              ) : (
                <CompletedTaskList
                  entries={visibleCompletedEntries}
                  projects={projectById}
                  mutatingTaskIds={mutatingTaskIds}
                  selectedTaskId={selectedTask?.id ?? null}
                  onSelect={(task) => setSelectedTaskId(task.id)}
                  onRestore={(task) => toggleCompleted(task, false)}
                />
              )}

              {hasMore && !loading && !loadError && (
                <button
                  type="button"
                  className="btn-outline task-load-more"
                  onClick={() => setVisibleLimit((current) => current + TASK_PAGE_SIZE)}
                >
                  再显示 {Math.min(TASK_PAGE_SIZE, displayedCount - visibleLimit)} 项
                </button>
              )}
            </motion.div>
          </div>
        </section>

        {/* 详情栏：选中任务的档案与主操作；选择与开始分离 */}
        <aside className="task-inspector" aria-label="任务详情">
          {selectedTask ? (
            <TaskInspector
              task={selectedTask}
              parentTitle={selectedParentTitle}
              project={selectedTask.projectId ? projectById.get(selectedTask.projectId) : undefined}
              projects={projects}
              isCurrent={
                snapshot?.currentTaskId === selectedTask.id ||
                (!!selectedTask.externalId && snapshot?.currentTaskId === selectedTask.externalId)
              }
              timerState={snapshot?.state ?? 'idle'}
              mutating={mutatingTaskIds.has(selectedTask.id)}
              onFocus={() => focusTask(selectedTask)}
              onToggleCompleted={() => toggleCompleted(selectedTask)}
              onMove={(projectId) => moveLocalTask(selectedTask, projectId)}
            />
          ) : (
            <div className="task-inspector-empty state-block">
              <span className="state-block-icon">
                <Icon.Target size="lg" />
              </span>
              <strong className="state-block-title">选中一项任务</strong>
              <p className="state-block-desc">
                在列表中点按任务查看详情；选择与「开始专注」是两个独立动作。
              </p>
            </div>
          )}
        </aside>

        <AnimatePresence>
          {undoCompletion && (
            <motion.div
              className="task-undo-bar"
              role="status"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <Icon.CheckCircle size="sm" />
              <span>
                已完成 <strong>{undoCompletion.task.title}</strong>
              </span>
              <button type="button" onClick={undoLastCompletion}>
                撤销
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function WorkbenchTaskRow({
  task,
  depth,
  hasChildren,
  isCollapsed,
  childCount,
  toggleCollapse,
  project,
  mutating,
  checking,
  currentTaskId,
  timerState,
  selected,
  onSelect,
  onToggleCompleted,
  onFocus,
  onDragStart,
}: TaskTreeRowContext & {
  project?: Project;
  mutating: boolean;
  checking: boolean;
  currentTaskId: string | null;
  timerState: TimerState;
  selected: boolean;
  onSelect: () => void;
  onToggleCompleted: () => void;
  onFocus: () => void;
  onDragStart: (event: ReactDragEvent<HTMLDivElement>) => void;
}) {
  const current = currentTaskId === task.id || currentTaskId === task.externalId;
  // 仅无子任务的行收束；已完成父任务留在树中承载子任务。
  const collapsing = checking && !hasChildren;
  // 键盘行为：Space 切换完成（镜像复选框），Enter 开始专注/关联（行主操作）。
  // 仅当事件落在行本体时响应，避免与行内按钮的按键重复触发。
  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || mutating) return;
    if (event.key === ' ') {
      event.preventDefault();
      onToggleCompleted();
    } else if (event.key === 'Enter' && !task.isCompleted) {
      event.preventDefault();
      onFocus();
    }
  };
  return (
    <div
      className={`task-workbench-row ${task.isCompleted ? 'completed' : ''} ${current ? 'current' : ''} ${selected ? 'is-selected' : ''} ${collapsing ? 'is-collapsing' : ''}`}
      style={{ '--task-depth': depth } as CSSProperties}
      tabIndex={0}
      aria-label={task.title}
      aria-selected={selected || undefined}
      draggable={task.source === 'local'}
      onDragStart={onDragStart}
      onKeyDown={onRowKeyDown}
      onClick={onSelect}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onSelect();
      }}
    >
      <div className="task-row-indent" />
      {hasChildren ? (
        <button
          type="button"
          className={`task-workbench-chevron ${isCollapsed ? '' : 'expanded'}`}
          onClick={toggleCollapse}
          aria-label={isCollapsed ? '展开子任务' : '收起子任务'}
        >
          <Icon.ChevronRight size="xs" />
        </button>
      ) : (
        <span className="task-chevron-spacer" />
      )}
      <button
        type="button"
        className={`task-complete-control ${task.isCompleted ? 'checked' : ''} ${checking ? 'is-checking' : ''}`}
        onClick={onToggleCompleted}
        disabled={mutating}
        role="checkbox"
        aria-checked={task.isCompleted === true}
        aria-label={task.isCompleted ? '取消完成' : '完成任务'}
      >
        {mutating ? <Spinner size="xs" /> : <CompleteControlGlyph />}
      </button>
      <div className="task-row-copy">
        <div className="task-row-title-line">
          <strong title={task.title}>{task.title}</strong>
          {current && (
            <span className={`task-current-chip ${timerState === 'paused' ? 'paused' : ''}`}>
              {timerState === 'running' ? '专注中' : timerState === 'paused' ? '已暂停' : '已关联'}
            </span>
          )}
          {hasChildren && (
            <span className="task-child-chip" title={`${childCount} 个直接子任务`}>
              {childCount} 项
            </span>
          )}
          {(task.priority ?? 0) > 0 && (
            <span
              className={`task-priority-mark priority-${priorityTone(task.priority)}`}
              title={priorityLabel(task.priority)}
              aria-label={priorityLabel(task.priority)}
            >
              {priorityMark(task.priority)}
            </span>
          )}
        </div>
        <div className="task-row-meta">
          {project && (
            <span
              className="task-row-project-badge"
              style={{ '--project-color': project.color ?? '#16899f' } as CSSProperties}
            >
              <i aria-hidden="true" />
              <Icon.ListTree size="xs" />
              {project.name}
            </span>
          )}
          {task.dueDate && (
            <span className={task.dueDate < Date.now() && !task.isCompleted ? 'overdue' : ''}>
              <Icon.Calendar size="xs" />
              {formatDueDate(task.dueDate)}
            </span>
          )}
          <TaskRowTags tags={task.tags} />
        </div>
      </div>
      {!task.isCompleted && (
        <button type="button" className="task-focus-action" onClick={onFocus}>
          <Icon.Play size="xs" />
          {current ? '已关联' : '开始专注'}
        </button>
      )}
    </div>
  );
}

function CompletedTaskList({
  entries,
  projects,
  mutatingTaskIds,
  selectedTaskId,
  onSelect,
  onRestore,
}: {
  entries: CompletedTaskEntry[];
  projects: Map<string, Project>;
  mutatingTaskIds: Set<string>;
  selectedTaskId: string | null;
  onSelect: (task: Task) => void;
  onRestore: (task: Task) => void;
}) {
  let previousGroup = '';
  return (
    <div className="task-completed-list">
      {entries.map(({ task, parentTitle }) => {
        const group = completedGroup(task.completedAt);
        const showHeading = group !== previousGroup;
        previousGroup = group;
        const project = task.projectId ? projects.get(task.projectId) : undefined;
        // 键盘行为与待完成行一致：Space/Enter 均为恢复（该行无主专注操作）。
        const onRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (event.target !== event.currentTarget || mutatingTaskIds.has(task.id)) return;
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            onRestore(task);
          }
        };
        return (
          <div key={task.id}>
            {showHeading && <div className="task-completed-group">{group}</div>}
            <div
              className={`task-completed-row ${selectedTaskId === task.id ? 'is-selected' : ''}`}
              tabIndex={0}
              aria-label={task.title}
              aria-selected={selectedTaskId === task.id || undefined}
              onKeyDown={onRowKeyDown}
              onClick={() => onSelect(task)}
            >
              <button
                type="button"
                className="task-complete-control checked"
                onClick={() => onRestore(task)}
                disabled={mutatingTaskIds.has(task.id)}
                role="checkbox"
                aria-checked="true"
                aria-label={`取消完成 ${task.title}`}
              >
                {mutatingTaskIds.has(task.id) ? <Spinner size="xs" /> : <CompleteControlGlyph />}
              </button>
              <div className="task-row-copy">
                <div className="task-row-title-line">
                  <strong title={task.title}>{task.title}</strong>
                </div>
                <div className="task-row-meta">
                  {parentTitle && <span>{parentTitle}</span>}
                  {project && (
                    <span
                      className="task-row-project-badge"
                      style={{ '--project-color': project.color ?? '#16899f' } as CSSProperties}
                    >
                      <i aria-hidden="true" />
                      <Icon.ListTree size="xs" />
                      {project.name}
                    </span>
                  )}
                  {task.completedAt && (
                    <span>
                      <Icon.CheckCircle size="xs" />
                      {formatCompletedDate(task.completedAt)}
                    </span>
                  )}
                  <TaskRowTags tags={task.tags} />
                </div>
              </div>
              <button type="button" className="task-restore-action" onClick={() => onRestore(task)}>
                <Icon.RotateCcw size="xs" />
                恢复
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 详情栏：选中任务的档案视图。只呈现清单里已有的字段，不新增业务数据；
 * 主操作沿用行内「开始专注」的同一 focusTask 语义（计时中=关联当前片段）。
 */
function TaskInspector({
  task,
  parentTitle,
  project,
  projects,
  isCurrent,
  timerState,
  mutating,
  onFocus,
  onToggleCompleted,
  onMove,
}: {
  task: Task;
  parentTitle: string | null;
  project?: Project;
  projects: Project[];
  isCurrent: boolean;
  timerState: TimerState;
  mutating: boolean;
  onFocus: () => void;
  onToggleCompleted: () => void;
  onMove: (projectId: string) => void;
}) {
  const timerActive = timerState === 'running' || timerState === 'paused';
  const childPreview = task.children?.slice(0, 5) ?? [];
  const hiddenChildren = (task.children?.length ?? 0) - childPreview.length;
  const overdue = !!task.dueDate && task.dueDate < Date.now() && !task.isCompleted;
  return (
    <div className="task-inspector-sheet" key={task.id}>
      <header className="task-inspector-head">
        <span className="task-inspector-kicker">
          {task.source === 'local' ? 'FocusLink 任务' : '导入任务'}
          {task.isCompleted ? ' · 已完成' : ''}
        </span>
        <h2 className="task-inspector-title">{task.title}</h2>
        {isCurrent && (
          <span className={`task-current-chip ${timerState === 'paused' ? 'paused' : ''}`}>
            {timerState === 'running' ? '专注中' : timerState === 'paused' ? '已暂停' : '已关联'}
          </span>
        )}
      </header>

      <dl className="task-inspector-meta">
        <div className="task-project-assignment">
          <dt>所属清单</dt>
          <dd>
            <span
              className="task-project-color"
              style={{ background: project?.color ?? undefined }}
            />
            <select
              value={task.projectId ?? FOCUSLINK_INBOX_PROJECT_ID}
              onChange={(event) => onMove(event.target.value)}
              disabled={mutating || task.source !== 'local'}
              aria-label="移动任务到清单"
            >
              {projects.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </dd>
        </div>
        {parentTitle && (
          <div>
            <dt>父任务</dt>
            <dd>{parentTitle}</dd>
          </div>
        )}
        {(task.priority ?? 0) > 0 && (
          <div>
            <dt>优先级</dt>
            <dd>{priorityLabel(task.priority)}</dd>
          </div>
        )}
        {task.dueDate && (
          <div>
            <dt>截止</dt>
            <dd className={overdue ? 'overdue' : ''}>
              {formatDueDate(task.dueDate)}
              {overdue ? ' · 已逾期' : ''}
            </dd>
          </div>
        )}
        {task.isCompleted && task.completedAt && (
          <div>
            <dt>完成于</dt>
            <dd>{formatCompletedDate(task.completedAt)}</dd>
          </div>
        )}
        {task.tags && task.tags.length > 0 && (
          <div>
            <dt>标签</dt>
            <dd className="task-inspector-tags">
              {task.tags.map((tag) => (
                <em className="task-tag" key={tag}>
                  #{tag}
                </em>
              ))}
            </dd>
          </div>
        )}
      </dl>

      {childPreview.length > 0 && (
        <section className="task-inspector-children">
          <h3>子任务 · {task.children?.length ?? 0} 项</h3>
          <ul>
            {childPreview.map((child) => (
              <li key={child.id} className={child.isCompleted ? 'done' : ''}>
                {child.title}
              </li>
            ))}
          </ul>
          {hiddenChildren > 0 && <p>还有 {hiddenChildren} 项子任务，在列表中展开查看。</p>}
        </section>
      )}

      <div className="task-inspector-actions">
        {!task.isCompleted && (
          <button type="button" className="btn-accent" onClick={onFocus} disabled={mutating}>
            <Icon.Play size="xs" />
            {timerActive ? '关联到当前片段' : '开始专注'}
          </button>
        )}
        <button
          type="button"
          className="btn-outline"
          onClick={onToggleCompleted}
          disabled={mutating}
        >
          {mutating ? <Spinner size="xs" /> : task.isCompleted ? '恢复任务' : '完成任务'}
        </button>
      </div>
    </div>
  );
}

/** 在任务树中按 id / externalId 查找任务（含子树）。 */
function findTaskById(tasks: Task[], id: string): Task | null {
  for (const task of tasks) {
    if (task.id === id || task.externalId === id) return task;
    if (task.children) {
      const found = findTaskById(task.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** 找到任务的直接父任务标题（详情栏面包屑用）。 */
function findParentTitle(tasks: Task[], id: string, parent: Task | null = null): string | null {
  for (const task of tasks) {
    if (task.id === id || task.externalId === id) return parent?.title ?? null;
    if (task.children) {
      const found = findParentTitle(task.children, id, task);
      if (found !== null) return found;
    }
  }
  return null;
}

function ProjectButton({
  active,
  label,
  color,
  count,
  onClick,
  onEdit,
  onDropTask,
}: {
  active: boolean;
  label: string;
  color?: string | null;
  count: number;
  onClick: () => void;
  onEdit?: () => void;
  onDropTask?: (taskId: string) => void;
}) {
  return (
    <div
      className={`task-project-entry ${active ? 'active' : ''}`}
      onDragOver={(event) => {
        if (!onDropTask) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        if (!onDropTask) return;
        event.preventDefault();
        const taskId = event.dataTransfer.getData('application/x-focuslink-task');
        if (taskId) onDropTask(taskId);
      }}
    >
      <button type="button" className="task-project-main" onClick={onClick}>
        {label === '收件箱' ? (
          <Icon.Inbox size="xs" />
        ) : (
          <i style={{ background: color ?? undefined }} />
        )}
        <span>{label}</span>
        <small>{count}</small>
      </button>
      {onEdit && (
        <button
          type="button"
          className="task-project-edit"
          onClick={onEdit}
          aria-label={`编辑清单 ${label}`}
          title="名称与颜色"
        >
          <Icon.Pencil size="xs" />
        </button>
      )}
    </div>
  );
}

function ProjectEditor({
  project,
  onSave,
}: {
  project: Project;
  onSave: (input: { name?: string; color?: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color ?? TASK_PROJECT_COLOR_PALETTE[0]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setName(project.name);
    setColor(project.color ?? TASK_PROJECT_COLOR_PALETTE[0]);
  }, [project.color, project.id, project.name]);
  return (
    <form
      className="task-project-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || saving) return;
        setSaving(true);
        void onSave({ name: name.trim(), color }).finally(() => setSaving(false));
      }}
    >
      <label>
        <span>清单名称</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
      </label>
      <fieldset>
        <legend>清单颜色</legend>
        <div className="task-project-palette">
          {TASK_PROJECT_COLOR_PALETTE.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === color ? 'selected' : ''}
              style={{ '--project-color': candidate } as CSSProperties}
              onClick={() => setColor(candidate)}
              aria-label={`选择颜色 ${candidate}`}
              aria-pressed={candidate === color}
            />
          ))}
        </div>
      </fieldset>
      <button type="submit" className="task-project-save" disabled={!name.trim() || saving}>
        {saving ? '保存中' : '保存清单'}
      </button>
    </form>
  );
}

/**
 * 行内标签：低权重 #tag 文字，最多展示 2 个，其余折叠为「+N」
 * （title 悬浮可见完整列表），随元信息行一起截断。
 */
function TaskRowTags({ tags }: { tags: string[] | null | undefined }) {
  if (!tags || tags.length === 0) return null;
  const visible = tags.slice(0, 2);
  const hiddenCount = tags.length - visible.length;
  return (
    <span className="task-row-tags">
      {visible.map((tag) => (
        <em className="task-tag" key={tag} title={tag}>
          #{tag}
        </em>
      ))}
      {hiddenCount > 0 && (
        <em className="task-tag task-tag-more" title={tags.join('、')}>
          +{hiddenCount}
        </em>
      )}
    </span>
  );
}

/**
 * 圆形完成控件的 SVG 图稿：circle 描边/填充 + check 勾线。
 * --dash-total 按实际路径长度取值（圆周 2π·7.2≈45.2→46；勾线≈10.2→11），
 * 共享 keyframes「checkbox-check」按各元素自己的 --dash-total 编排描边绘制；
 * 静态选中态 dashoffset 全为 0。
 */
function CompleteControlGlyph() {
  return (
    <svg className="task-complete-glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <circle className="task-complete-ring" cx="9" cy="9" r="7.2" />
      <path className="task-complete-check" d="M5.5 9.4l2.3 2.3 4.7-5.1" />
    </svg>
  );
}

function TaskSkeletonList() {
  const widths = [72, 58, 80, 64, 76, 52];
  return (
    <div className="task-skeleton-list" aria-label="正在读取 FocusLink 任务">
      {widths.map((width, index) => (
        <div className="task-skeleton-row" key={index}>
          <span className="task-skeleton-dot skeleton" />
          <div className="task-skeleton-lines">
            <span className="task-skeleton-line skeleton" style={{ width: `${width}%` }} />
            <span
              className="task-skeleton-line skeleton"
              style={{ width: `${Math.max(width - 34, 24)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 空/错误状态：统一使用全局 .state-block 契约（图标/标题/描述/操作四段式），
 * 错误态走 tone-error 变体；task-empty-state/danger 仅保留为冒烟测试兼容标记。
 */
function TaskEmpty({
  icon,
  title,
  detail,
  action,
  onAction,
  danger,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  action?: string;
  onAction?: () => void;
  danger?: boolean;
}) {
  return (
    <div className={`state-block task-empty-state ${danger ? 'tone-error danger' : ''}`}>
      <span className="state-block-icon">{icon}</span>
      <strong className="state-block-title">{title}</strong>
      <p className="state-block-desc">{detail}</p>
      {action && onAction && (
        <div className="state-block-actions">
          <button type="button" className="btn-outline" onClick={onAction}>
            {action}
          </button>
        </div>
      )}
    </div>
  );
}

function retainOpenTree(tasks: Task[], graceIds: Set<string>): Task[] {
  const result: Task[] = [];
  for (const task of tasks) {
    const children = task.children ? retainOpenTree(task.children, graceIds) : [];
    if (!task.isCompleted || graceIds.has(task.id) || children.length > 0) {
      result.push({ ...task, children: children.length > 0 ? children : undefined });
    }
  }
  return result;
}

function flattenCompletedTasks(
  tasks: Task[],
  parentTitle: string | null = null,
): CompletedTaskEntry[] {
  const result: CompletedTaskEntry[] = [];
  for (const task of tasks) {
    if (task.isCompleted) result.push({ task: { ...task, children: undefined }, parentTitle });
    if (task.children) result.push(...flattenCompletedTasks(task.children, task.title));
  }
  return result;
}

function sortCompletedEntries(
  entries: CompletedTaskEntry[],
  sortMode: TaskSortMode,
): CompletedTaskEntry[] {
  return [...entries].sort((a, b) => {
    if (sortMode === 'title') {
      return a.task.title.localeCompare(b.task.title, 'zh-CN', {
        numeric: true,
        sensitivity: 'base',
      });
    }
    if (sortMode === 'due') {
      return nullableDateCompare(a.task.dueDate, b.task.dueDate);
    }
    const completionOrder = nullableDateCompareDescending(a.task.completedAt, b.task.completedAt);
    if (completionOrder !== 0) return completionOrder;
    return a.task.title.localeCompare(b.task.title, 'zh-CN', {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

function nullableDateCompare(a: number | null | undefined, b: number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function nullableDateCompareDescending(
  a: number | null | undefined,
  b: number | null | undefined,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

function takeTaskTree(tasks: Task[], limit: number): Task[] {
  let remaining = limit;
  const walk = (items: Task[]): Task[] => {
    const result: Task[] = [];
    for (const task of items) {
      if (remaining <= 0) break;
      remaining -= 1;
      const children = task.children ? walk(task.children) : [];
      result.push({ ...task, children: children.length > 0 ? children : undefined });
    }
    return result;
  };
  return walk(tasks);
}

function replaceTask(tasks: Task[], updated: Task): Task[] {
  return tasks.map((task) => {
    if (task.id === updated.id || task.externalId === updated.externalId) {
      return { ...task, ...updated, children: task.children ?? updated.children };
    }
    return task.children ? { ...task, children: replaceTask(task.children, updated) } : task;
  });
}

function countTasks(tasks: Task[]): { total: number; open: number; completed: number } {
  let total = 0;
  let completed = 0;
  const walk = (items: Task[]) => {
    for (const task of items) {
      total += 1;
      if (task.isCompleted) completed += 1;
      if (task.children) walk(task.children);
    }
  };
  walk(tasks);
  return { total, completed, open: total - completed };
}

function countProjectTasks(tasks: Task[], projectId: string, filter: TaskFilter): number {
  let count = 0;
  const walk = (items: Task[]) => {
    for (const task of items) {
      if (
        (task.projectId === projectId || task.projectId === projectId.replace(/^ticktick:/, '')) &&
        (filter === 'completed' ? task.isCompleted : !task.isCompleted)
      ) {
        count += 1;
      }
      if (task.children) walk(task.children);
    }
  };
  walk(tasks);
  return count;
}

function formatDueDate(value: number): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return '今天';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

function formatCompletedDate(value: number): string {
  const date = new Date(value);
  const now = new Date();
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

function completedGroup(value: number | null | undefined): string {
  if (!value) return '更早';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return '今天';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return '更早';
}

function formatRefreshTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

function priorityLabel(priority: number | null): string {
  if ((priority ?? 0) >= 5) return '高优先级';
  if ((priority ?? 0) >= 3) return '中优先级';
  return '低优先级';
}

function priorityTone(priority: number | null): 'high' | 'medium' | 'low' {
  if ((priority ?? 0) >= 5) return 'high';
  if ((priority ?? 0) >= 3) return 'medium';
  return 'low';
}

function priorityMark(priority: number | null): string {
  if ((priority ?? 0) >= 5) return '高';
  if ((priority ?? 0) >= 3) return '中';
  return '低';
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

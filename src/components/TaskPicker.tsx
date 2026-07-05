// TaskPicker - v0.4.4 Linear 风格优雅选择器
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from './Icon';
import { useStore } from '../store/useStore';
import type { Task } from '@shared/types';

interface TaskPickerProps {
  onPick: (task: Task | null) => void;
  title?: string;
  confirmLabel?: string;
  selectedTaskId?: string | null;
  allowCompleted?: boolean;
}

export function TaskPicker({
  onPick,
  title = '选择任务',
  confirmLabel = '关联',
  selectedTaskId,
  allowCompleted = false,
}: TaskPickerProps) {
  const {
    settings,
    localTasks,
    ticktickTasks,
    ticktickProjects,
    setLocalTasks,
    setTicktickTasks,
    setTicktickProjects,
    addToast,
  } = useStore();

  const [query, setQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pickedTask, setPickedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const beforeSearchRef = useRef<Record<string, boolean> | null>(null);

  const taskSource = settings?.taskSource ?? 'local';
  const isCli = taskSource === 'ticktick-cli';
  const isOAuth = taskSource === 'ticktick-oauth';
  const isLocal = taskSource === 'local';

  useEffect(() => {
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskSource]);

  useEffect(() => {
    setCollapsed((prev) => {
      const next = { ...prev };
      let changed = false;
      const init = (tasks: Task[]) => {
        for (const t of tasks) {
          if (t.children && t.children.length > 0) {
            if (next[t.id] === undefined) {
              next[t.id] = true;
              changed = true;
            }
            init(t.children);
          }
        }
      };
      init(localTasks);
      init(ticktickTasks);
      return changed ? next : prev;
    });
  }, [localTasks, ticktickTasks]);

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

  const loadTasks = async () => {
    if (isLocal) {
      const tasks = await window.focuslink.tasks.listLocal();
      setLocalTasks(tasks);
      return;
    }
    setLoading(true);
    try {
      if (isCli) {
        const projRes = await window.focuslink.cli.listProjects();
        if (projRes.ok) setTicktickProjects(projRes.data);
        const taskRes = await window.focuslink.cli.listTasks();
        if (taskRes.ok) setTicktickTasks(taskRes.data);
      } else if (isOAuth) {
        const projects = await window.focuslink.ticktick.listProjects();
        setTicktickProjects(projects);
        const tasks = await window.focuslink.ticktick.listTasks();
        setTicktickTasks(tasks);
      }
    } catch (e) {
      addToast('加载任务失败：' + (e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const sourceTasks = isLocal ? localTasks : ticktickTasks;

  const filteredTree = useMemo(() => {
    return filterTree(sourceTasks, query, selectedProject, allowCompleted);
  }, [sourceTasks, query, selectedProject, allowCompleted]);

  const toggleCollapse = (id: string) => setCollapsed((p) => ({ ...p, [id]: !p[id] }));

  const handleConfirm = () => {
    if (!pickedTask) {
      addToast('请先选择一个任务', 'info');
      return;
    }
    onPick(pickedTask);
  };

  const handleCancel = () => onPick(null);

  const sourceLabel = isLocal ? '本地' : isCli ? 'dida CLI' : 'TickTick';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={handleCancel}>
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      />
      <motion.div
        className="picker-shell relative z-10 flex h-[68vh] w-[min(560px,92vw)] flex-col overflow-hidden rounded-xl border border-border/60 glass-elevated"
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 4 }}
        transition={{ type: 'spring', stiffness: 400, damping: 32, mass: 0.8 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 — 极简 */}
        <div className="flex items-center justify-between border-b border-border/30 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-fg">{title}</span>
            <span className="text-[10px] font-medium text-fg-subtle bg-bg-subtle/50 px-1.5 py-0.5 rounded">{sourceLabel}</span>
            <span className="text-[10.5px] text-fg-subtle">{filteredTree.length} 个可选</span>
          </div>
          <button
            className="motion-press rounded-md p-1 text-fg-subtle hover:bg-bg-subtle/60 hover:text-fg"
            onClick={handleCancel}
          >
            <Icon.X size="sm" />
          </button>
        </div>

        {/* 搜索 + 清单 — 复用 TaskPanel 风格 */}
        <div className="px-3 py-2 border-b border-border/20">
          <div className="task-search-row">
            <Icon.Search size="xs" tone="subtle" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              className="task-search-input"
              placeholder="搜索任务…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button className="task-search-clear motion-press" onClick={() => setQuery('')}>
                <Icon.X size="xs" />
              </button>
            )}
            {!isLocal && ticktickProjects.length > 0 && !query && (
              <select
                className="task-project-select"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
              >
                <option value="">全部</option>
                {ticktickProjects.map((p) => (
                  <option key={p.id} value={p.externalId}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* 任务树 — 复用 task-row-linear 风格 */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex h-full items-center justify-center text-fg-subtle">
              <Icon.Loader size="lg" spin />
            </div>
          ) : filteredTree.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-subtle">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-subtle/40">
                <Icon.Search size="md" />
              </div>
              <p className="text-[12.5px] font-medium text-fg-muted">
                {sourceTasks.length === 0 ? '暂无任务' : '没有匹配的任务'}
              </p>
            </div>
          ) : (
            <div className="task-tree">
              {filteredTree.map((task) => (
                <PickerItem
                  key={task.id}
                  task={task}
                  depth={0}
                  collapsed={collapsed}
                  onToggleCollapse={toggleCollapse}
                  pickedTask={pickedTask}
                  onPick={setPickedTask}
                  selectedTaskId={selectedTaskId}
                />
              ))}
            </div>
          )}
        </div>

        {/* 底部 — 极简确认栏 */}
        <div className="flex items-center justify-between border-t border-border/30 px-4 py-2.5">
          <span className="min-w-0 text-[11.5px] text-fg-subtle">
            {pickedTask ? (
              <span className="inline-flex items-center gap-1 text-accent">
                <Icon.Check size="xs" />
                <span className="truncate max-w-[280px]">{pickedTask.title}</span>
              </span>
            ) : '未选择'}
          </span>
          <div className="flex items-center gap-2">
            <button className="btn-ghost !text-[12.5px] !h-7" onClick={handleCancel}>取消</button>
            <button
              className="btn-primary !text-[12.5px] !h-7 disabled:opacity-40"
              onClick={handleConfirm}
              disabled={!pickedTask}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function PickerItem({
  task,
  depth,
  collapsed,
  onToggleCollapse,
  pickedTask,
  onPick,
  selectedTaskId,
}: {
  task: Task;
  depth: number;
  collapsed: Record<string, boolean>;
  onToggleCollapse: (id: string) => void;
  pickedTask: Task | null;
  onPick: (t: Task) => void;
  selectedTaskId?: string | null;
}) {
  const hasChildren = task.children && task.children.length > 0;
  const isCollapsed = collapsed[task.id] === true;
  const isCompleted = task.isCompleted === true;
  const isPicked = pickedTask?.id === task.id;
  const isSelected = selectedTaskId === task.id;
  const childCount = task.children?.length ?? 0;

  return (
    <>
      <div
        className={`task-row-linear group ${isPicked ? 'task-row-highlighted' : ''} ${isCompleted ? 'task-row-done' : ''} ${isSelected ? 'task-row-highlighted' : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => onPick(task)}
      >
        {hasChildren ? (
          <button
            className="task-chevron motion-press"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(task.id);
            }}
          >
            <motion.span animate={{ rotate: isCollapsed ? 0 : 90 }} transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}>
              <Icon.ChevronRight size="xs" />
            </motion.span>
          </button>
        ) : (
          <span className="task-leaf-dot" style={{ left: depth * 16 + 14 }} />
        )}

        {/* 选中圆圈 */}
        <span className={`task-checkbox ${isCompleted ? 'checked' : ''} ${isPicked ? 'checked' : ''}`}>
          {isCompleted && <Icon.Check size="xs" />}
          {!isCompleted && isPicked && <Icon.Check size="xs" />}
        </span>

        <span className={`task-title ${isCompleted ? 'done' : ''} ${depth === 0 ? 'parent' : ''}`}>
          {task.title}
        </span>

        <div className="task-meta-inline">
          {hasChildren && <span className="task-child-count">{childCount}</span>}
        </div>

        {isPicked && (
          <Icon.Check size="xs" tone="accent" className="flex-shrink-0" />
        )}
      </div>

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
              <PickerItem
                key={child.id}
                task={child}
                depth={depth + 1}
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
                pickedTask={pickedTask}
                onPick={onPick}
                selectedTaskId={selectedTaskId}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      )}
    </>
  );
}

function filterTree(tasks: Task[], query: string, projectId: string, allowCompleted: boolean): Task[] {
  const q = query.trim().toLowerCase();
  const byProject = projectId ? filterTreeByProject(tasks, projectId) : tasks;
  return filterAndBuildTree(byProject, q, allowCompleted);
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

function filterAndBuildTree(tasks: Task[], q: string, allowCompleted: boolean): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.isCompleted && !allowCompleted) continue;
    const children = t.children ? filterAndBuildTree(t.children, q, allowCompleted) : [];
    const selfMatch = !q || t.title.toLowerCase().includes(q);
    const childHasMatch = children.length > 0;
    if (q && !selfMatch && !childHasMatch) continue;
    out.push({ ...t, children: children.length > 0 ? children : undefined });
  }
  return out;
}

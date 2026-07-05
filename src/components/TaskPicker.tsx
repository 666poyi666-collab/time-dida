// TaskPicker - 可复用任务选择器 v0.4 Calm Studio
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
          if (childMatch || selfMatch) {
            next[t.id] = false;
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={handleCancel}
    >
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      />
      <motion.div
        className="relative z-10 flex h-[70vh] w-[min(580px,92vw)] flex-col overflow-hidden rounded-lg border border-border/70 bg-bg-card/95 backdrop-blur-xl"
        style={{ boxShadow: '0 24px 64px -20px rgb(0 0 0 / 0.5)' }}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 4 }}
        transition={{ type: 'spring', stiffness: 440, damping: 34, mass: 0.8 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-accent/20 bg-accent/10 text-accent">
              <Icon.ListTree size="sm" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-fg">{title}</span>
                <SourceBadge isLocal={isLocal} isCli={isCli} />
              </div>
              <p className="mt-0 text-[10.5px] text-fg-subtle">
                {filteredTree.length} 个可选任务
              </p>
            </div>
          </div>
          <button
            className="motion-press rounded-md p-1.5 text-fg-subtle hover:bg-bg-subtle hover:text-fg"
            onClick={handleCancel}
            title="关闭"
          >
            <Icon.X size="sm" />
          </button>
        </div>

        {/* 搜索 + 清单选择 */}
        <div className="space-y-2 border-b border-border/40 px-4 py-2.5">
          <div className="relative">
            <Icon.Search
              size="sm"
              tone="subtle"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            />
            <input
              className="input !pl-9 !pr-8 !py-1.5 text-[13px]"
              placeholder="搜索任务..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button
                className="motion-press absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-fg-subtle hover:bg-bg-subtle hover:text-fg"
                onClick={() => setQuery('')}
                title="清除搜索"
              >
                <Icon.X size="xs" />
              </button>
            )}
          </div>
          {!isLocal && ticktickProjects.length > 0 && (
            <select
              className="input !py-1.5 text-[12px]"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
            >
              <option value="">所有清单</option>
              {ticktickProjects.map((p) => (
                <option key={p.id} value={p.externalId}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 任务树 */}
        <div className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-fg-subtle">
              <Icon.Loader size="lg" spin />
            </div>
          ) : filteredTree.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/50 bg-bg-card/30 py-8 text-fg-subtle">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-bg-subtle">
                <Icon.Search size="md" />
              </div>
              <p className="text-[13px] font-medium text-fg-muted">
                {sourceTasks.length === 0 ? '暂无任务' : '没有匹配的任务'}
              </p>
              <p className="text-[11px]">
                {sourceTasks.length === 0
                  ? isLocal
                    ? '先在任务面板创建本地任务'
                    : '请检查任务来源设置'
                  : '尝试调整搜索或切换清单'}
              </p>
            </div>
          ) : (
            filteredTree.map((task) => (
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
            ))
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between border-t border-border/50 px-4 py-2.5">
          <span className="min-w-0 text-[11.5px] text-fg-subtle">
            {pickedTask ? (
              <span className="inline-flex max-w-[300px] items-center gap-1 rounded-md border border-accent/20 bg-accent/10 px-2 py-0.5 text-accent">
                <Icon.Check size="xs" />
                <span className="truncate">{pickedTask.title}</span>
              </span>
            ) : (
              '未选择任务'
            )}
          </span>
          <div className="flex items-center gap-2">
            <button className="btn-ghost !text-[12.5px]" onClick={handleCancel}>
              取消
            </button>
            <button
              className="btn-primary !text-[12.5px] disabled:opacity-40"
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
  const isParent = depth === 0;
  const childCount = task.children?.length ?? 0;

  return (
    <>
      <div
        className={`group motion-press relative flex cursor-pointer items-center gap-1.5 rounded-md border ${
          isPicked
            ? 'selected-accent'
            : isParent
              ? 'border-border/50 bg-bg-card/70 hover:bg-bg-subtle/50'
              : 'border-transparent bg-bg-card/15 hover:border-border/40 hover:bg-bg-subtle/40'
        } ${isSelected ? 'border-accent/40' : ''}`}
        style={
          isParent
            ? { marginLeft: 0, padding: '6px 8px' }
            : {
                marginLeft: depth * 16,
                padding: '5px 8px',
                borderLeftWidth: '2px',
                borderLeftColor: 'rgb(var(--border) / 0.6)',
              }
        }
        onClick={(e) => {
          e.stopPropagation();
          onPick(task);
        }}
      >
        <button
          className="motion-press flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-elevated hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleCollapse(task.id);
          }}
        >
          {hasChildren ? (
            isCollapsed ? (
              <Icon.ChevronRight size="xs" />
            ) : (
              <Icon.ChevronDown size="xs" />
            )
          ) : (
            <span className="block h-1 w-1 rounded-full bg-fg-subtle/30" />
          )}
        </button>
        <span
          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded ${hasChildren ? 'bg-accent/10 text-accent' : 'bg-bg-subtle/50 text-fg-subtle'}`}
        >
          {hasChildren ? (
            <Icon.ListTree size="xs" />
          ) : isCompleted ? (
            <Icon.CheckCircle size="xs" tone="success" className="opacity-80" />
          ) : (
            <Icon.Circle size="xs" tone="subtle" className="opacity-40" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-[12.5px] ${
              isParent ? 'font-semibold text-fg' : 'text-fg'
            } ${isCompleted ? 'line-through opacity-45' : ''}`}
          >
            {task.title}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {hasChildren && (
            <span className="rounded bg-bg-subtle px-1 py-px text-[9.5px] font-medium text-fg-subtle">
              {childCount}
            </span>
          )}
          {isPicked && (
            <Icon.Check size="xs" tone="accent" />
          )}
        </div>
      </div>
      {hasChildren && !isCollapsed && (
        <div className="space-y-0.5">
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
        </div>
      )}
    </>
  );
}

function SourceBadge({ isLocal, isCli }: { isLocal: boolean; isCli: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border/50 bg-bg-subtle/50 px-1.5 py-px text-[9.5px] font-semibold text-fg-muted">
      {isLocal ? <Icon.HardDrive size="xs" /> : isCli ? <Icon.Terminal size="xs" /> : <Icon.Cloud size="xs" />}
      {isLocal ? '本地' : isCli ? 'dida CLI' : 'TickTick'}
    </span>
  );
}

function filterTree(
  tasks: Task[],
  query: string,
  projectId: string,
  allowCompleted: boolean,
): Task[] {
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
    if (q) {
      if (!selfMatch && !childHasMatch) continue;
    }
    out.push({ ...t, children: children.length > 0 ? children : undefined });
  }
  return out;
}

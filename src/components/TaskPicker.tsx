// TaskPicker - 可复用任务选择器
// 用途：当前 Segment 关联、Session 默认任务、历史记录后补关联、批量补关联
// 支持：搜索 / 选择清单 / 隐藏已完成 / 任务树 / 点击确认 / 取消
// 规则：父任务默认折叠；搜索命中子任务时自动展开父任务；清空搜索后恢复默认折叠
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  X,
  CheckCircle,
  Circle,
  ChevronRight,
  ChevronDown,
  Loader2,
  HardDrive,
  Terminal,
  Cloud,
  ListTree,
  Check,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { Task } from '@shared/types';

interface TaskPickerProps {
  /** 打开时回调 onPick(task)，传 null 表示取消 */
  onPick: (task: Task | null) => void;
  /** 标题（可选） */
  title?: string;
  /** 确认按钮文案 */
  confirmLabel?: string;
  /** 当前已选任务 id（用于高亮，可选） */
  selectedTaskId?: string | null;
  /** 是否允许选择已完成任务（默认 false，隐藏已完成） */
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
  // 父任务默认折叠：初始化为全部父任务折叠
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pickedTask, setPickedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  // 搜索前的折叠状态快照，清空搜索时恢复
  const beforeSearchRef = useRef<Record<string, boolean> | null>(null);

  const taskSource = settings?.taskSource ?? 'local';
  const isCli = taskSource === 'ticktick-cli';
  const isOAuth = taskSource === 'ticktick-oauth';
  const isLocal = taskSource === 'local';

  // 初始化加载任务
  useEffect(() => {
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskSource]);

  // 任务列表变化时，对新出现的父任务初始化为折叠状态（默认折叠）
  // 不覆盖用户已手动展开/折叠的状态
  useEffect(() => {
    setCollapsed((prev) => {
      const next = { ...prev };
      let changed = false;
      const init = (tasks: Task[]) => {
        for (const t of tasks) {
          if (t.children && t.children.length > 0) {
            if (next[t.id] === undefined) {
              next[t.id] = true; // 默认折叠
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
    const expandMatching = (tasks: Task[]) => {
      for (const t of tasks) {
        if (t.children && t.children.length > 0) {
          const childMatch = t.children.some((c) =>
            c.title.toLowerCase().includes(ql)
          );
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

  // 本地按 projectId 过滤 + 隐藏已完成 + 搜索
  const filteredTree = useMemo(() => {
    return filterTree(sourceTasks, query, selectedProject, allowCompleted);
  }, [sourceTasks, query, selectedProject, allowCompleted]);

  const toggleCollapse = (id: string) =>
    setCollapsed((p) => ({ ...p, [id]: !p[id] }));

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm"
      onClick={handleCancel}
    >
      <div
        className="card flex h-[72vh] w-[min(640px,92vw)] flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
              <ListTree size={15} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-fg">{title}</span>
                <SourceBadge isLocal={isLocal} isCli={isCli} />
              </div>
              <p className="mt-0.5 text-[10px] font-medium text-fg-subtle">{filteredTree.length} 个可选任务</p>
            </div>
          </div>
          <button
            className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
            onClick={handleCancel}
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* 搜索 + 清单选择 */}
        <div className="space-y-2.5 border-b border-border px-5 py-3">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-subtle"
            />
            <input
              className="input !pl-10 !pr-9"
              placeholder="搜索任务标题..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button
                className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
                onClick={() => setQuery('')}
                title="清除搜索"
              >
                <X size={13} />
              </button>
            )}
          </div>
          {!isLocal && ticktickProjects.length > 0 && (
            <select
              className="input !py-2 text-xs"
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
        <div className="flex-1 space-y-1.5 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-fg-subtle">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : filteredTree.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-bg-card/50 text-fg-subtle">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-bg-subtle">
                <Search size={20} />
              </div>
              <p className="text-sm font-medium text-fg-muted">
                {sourceTasks.length === 0 ? '暂无任务' : '没有匹配的任务'}
              </p>
              <p className="text-xs">
                {sourceTasks.length === 0
                  ? isLocal
                    ? '点击下方创建本地任务'
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
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="min-w-0 text-xs text-fg-subtle">
            {pickedTask ? (
              <span className="inline-flex max-w-[360px] items-center gap-1 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-accent">
                <Check size={11} />
                <span className="truncate">{pickedTask.title}</span>
              </span>
            ) : (
              '未选择任务'
            )}
          </span>
          <div className="flex items-center gap-2">
            <button className="btn-ghost text-sm" onClick={handleCancel}>
              取消
            </button>
            <button
              className="btn-primary text-sm disabled:opacity-40"
              onClick={handleConfirm}
              disabled={!pickedTask}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PickerItem ──────────────────────────────────────────────────

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
        className={`group relative flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 transition-all duration-150 ${
          isPicked
            ? 'selected-accent ring-1 ring-accent/30'
            : isParent
              ? 'border-border bg-bg-card/90 hover:bg-bg-subtle/65'
              : 'border-transparent bg-bg-card/25 hover:border-border hover:bg-bg-subtle/55'
        } ${isSelected ? 'border-accent/50' : ''}`}
        style={
          isParent
            ? { marginLeft: 0 }
            : {
                marginLeft: depth * 18,
                borderLeftWidth: '2px',
                borderLeftColor: 'rgb(var(--border))',
              }
        }
        onClick={(e) => {
          e.stopPropagation();
          onPick(task);
        }}
      >
        <button
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-bg-elevated hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleCollapse(task.id);
          }}
        >
          {hasChildren ? (
            isCollapsed ? (
              <ChevronRight size={14} />
            ) : (
              <ChevronDown size={14} />
            )
          ) : (
            <span className="block h-1 w-1 rounded-full bg-fg-subtle/30" />
          )}
        </button>
        <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${hasChildren ? 'bg-accent/10 text-accent' : 'bg-bg-subtle/70 text-fg-subtle'}`}>
          {hasChildren ? <ListTree size={13} /> : isCompleted ? <CheckCircle size={14} className="text-success/80" /> : <Circle size={14} className="text-fg-subtle/50" />}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`truncate ${
              isParent ? 'text-[13px] font-bold text-fg' : 'text-[13px] text-fg'
            } ${isCompleted ? 'line-through opacity-50' : ''}`}
          >
            {task.title}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {hasChildren && (
            <span className="rounded-md bg-bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">
              {childCount}
            </span>
          )}
          {isPicked && (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
              <Check size={10} /> 已选
            </span>
          )}
        </div>
      </div>
      {hasChildren && !isCollapsed && (
        <div className="space-y-1">
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

// ─── SourceBadge ─────────────────────────────────────────────────

function SourceBadge({ isLocal, isCli }: { isLocal: boolean; isCli: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-[10px] font-semibold text-fg-muted">
      {isLocal ? <HardDrive size={10} /> : isCli ? <Terminal size={10} /> : <Cloud size={10} />}
      {isLocal ? '本地' : isCli ? 'dida CLI' : 'TickTick'}
    </span>
  );
}

// ─── filterTree ──────────────────────────────────────────────────

/** 按 projectId 过滤 + 隐藏已完成 + 搜索匹配，保留父链 */
function filterTree(
  tasks: Task[],
  query: string,
  projectId: string,
  allowCompleted: boolean
): Task[] {
  const q = query.trim().toLowerCase();
  // 先按 projectId 过滤（本地过滤，子任务继承父 projectId）
  const byProject = projectId
    ? filterTreeByProject(tasks, projectId)
    : tasks;
  // 再按已完成 + 搜索过滤
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

function filterAndBuildTree(
  tasks: Task[],
  q: string,
  allowCompleted: boolean
): Task[] {
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

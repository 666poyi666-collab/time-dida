// 任务树纯模型与筛选策略。
// 规则：父任务默认折叠；搜索命中任意后代时临时展开完整路径；清空搜索后恢复用户原状态。
import type { Task } from '@shared/types';

export type TaskSortMode = 'smart' | 'due' | 'title' | 'completed';

export interface TaskTreeFilterOptions {
  query?: string;
  projectId?: string;
  showCompleted?: boolean;
  /** 搜索时是否跨清单搜索。 */
  ignoreProjectWhenSearching?: boolean;
  /** true 等价于 smart；字符串模式供任务页显式选择排序方式。 */
  sort?: boolean | TaskSortMode;
}

export interface FilteredTaskTree {
  tasks: Task[];
  completedHidden: number;
}

/** 生成默认折叠状态：所有有 children 的父任务 collapsed[id] = true
 *  用于初始化或任务列表变化时设置默认折叠 */
export function createDefaultCollapsedState(tasks: Task[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const walk = (list: Task[]) => {
    for (const t of list) {
      if (t.children && t.children.length > 0) {
        out[t.id] = true; // 父任务默认折叠
        walk(t.children);
      }
    }
  };
  walk(tasks);
  return out;
}

/** 把新出现的父任务（尚未在 collapsed state 中）初始化为折叠状态。
 *  - 不覆盖用户已手动展开/折叠的状态
 *  - 返回新对象（如有变更）或原对象（无变更时避免不必要渲染） */
export function initNewParentsCollapsed(
  prev: Record<string, boolean>,
  tasks: Task[],
): Record<string, boolean> {
  const next = { ...prev };
  let changed = false;
  const walk = (list: Task[]) => {
    for (const t of list) {
      if (t.children && t.children.length > 0) {
        if (next[t.id] === undefined) {
          next[t.id] = true;
          changed = true;
        }
        walk(t.children);
      }
    }
  };
  walk(tasks);
  return changed ? next : prev;
}

/** 搜索时计算需要展开的父任务（命中子任务或自身命中的父任务设为展开）。
 *  基于当前 collapsed 状态生成新状态，仅把命中路径上的父任务设为 false（展开）。 */
export function expandMatchingParents(
  prev: Record<string, boolean>,
  tasks: Task[],
  query: string,
): Record<string, boolean> {
  const q = query.trim().toLowerCase();
  if (!q) return prev;
  const next = { ...prev };
  const walk = (list: Task[]): boolean => {
    let hasMatch = false;
    for (const t of list) {
      const selfMatch = t.title.toLowerCase().includes(q);
      if (t.children && t.children.length > 0) {
        const childMatch = walk(t.children);
        if (childMatch || selfMatch) {
          next[t.id] = false; // 展开
        }
        hasMatch = hasMatch || childMatch || selfMatch;
      } else {
        hasMatch = hasMatch || selfMatch;
      }
    }
    return hasMatch;
  };
  walk(tasks);
  return next;
}

/**
 * 递归过滤任务树，同时保留命中子任务所需的祖先节点。
 * 已完成的节点默认隐藏；若其下仍有可见子任务，则保留为树结构节点，避免子任务失去上下文。
 */
export function filterTaskTree(
  sourceTasks: Task[],
  options: TaskTreeFilterOptions = {},
): FilteredTaskTree {
  const query = options.query?.trim().toLowerCase() ?? '';
  const projectId = options.projectId ?? '';
  const showCompleted = options.showCompleted ?? false;
  const byProject =
    projectId && !(query && options.ignoreProjectWhenSearching)
      ? filterTaskTreeByProject(sourceTasks, projectId)
      : sourceTasks;
  let completedHidden = 0;

  const filter = (tasks: Task[]): Task[] => {
    const out: Task[] = [];
    for (const task of tasks) {
      const children = task.children ? filter(task.children) : [];
      const selfMatches = !query || task.title.toLowerCase().includes(query);
      const hasVisibleChildren = children.length > 0;
      const hiddenCompleted = task.isCompleted === true && !showCompleted;

      if (hiddenCompleted && !hasVisibleChildren) {
        completedHidden++;
        continue;
      }
      if (query && !selfMatches && !hasVisibleChildren) continue;

      out.push({ ...task, children: children.length > 0 ? children : undefined });
    }
    return out;
  };

  const tasks = filter(byProject);
  const sortMode = options.sort === true ? 'smart' : options.sort || null;
  return {
    tasks: sortMode ? sortTaskTree(tasks, sortMode) : tasks,
    completedHidden,
  };
}

function filterTaskTreeByProject(tasks: Task[], projectId: string): Task[] {
  const out: Task[] = [];
  for (const task of tasks) {
    const children = task.children ? filterTaskTreeByProject(task.children, projectId) : [];
    if (task.projectId === projectId || children.length > 0) {
      out.push({ ...task, children: children.length > 0 ? children : undefined });
    }
  }
  return out;
}

const titleCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function sortTaskTree(tasks: Task[], mode: TaskSortMode = 'smart'): Task[] {
  const sorted = [...tasks].sort((a, b) => compareTasks(a, b, mode));

  return sorted.map((task) => ({
    ...task,
    children: task.children ? sortTaskTree(task.children, mode) : undefined,
  }));
}

function compareTasks(a: Task, b: Task, mode: TaskSortMode): number {
  const aCompleted = a.isCompleted === true;
  const bCompleted = b.isCompleted === true;
  if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;

  if (mode === 'title') return compareTitle(a, b);
  if (mode === 'completed') {
    const byCompleted = compareNullableNumber(a.completedAt, b.completedAt, 'desc');
    return byCompleted || compareTitle(a, b);
  }
  if (mode === 'due') {
    const byDue = compareNullableNumber(a.dueDate, b.dueDate, 'asc');
    return byDue || compareTitle(a, b);
  }

  // smart：到期日优先且真正按时间升序，其后保持滴答 sortOrder、优先级和名称稳定。
  const byDue = compareNullableNumber(a.dueDate, b.dueDate, 'asc');
  if (byDue) return byDue;
  const byOrder = compareNullableNumber(a.sortOrder, b.sortOrder, 'asc');
  if (byOrder) return byOrder;
  const byPriority = (b.priority ?? 0) - (a.priority ?? 0);
  return byPriority || compareTitle(a, b);
}

function compareNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  direction: 'asc' | 'desc',
): number {
  const aMissing = a == null || !Number.isFinite(a);
  const bMissing = b == null || !Number.isFinite(b);
  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  if (aMissing || bMissing || a === b) return 0;
  return direction === 'asc' ? a - b : b - a;
}

function compareTitle(a: Task, b: Task): number {
  return titleCollator.compare(a.title, b.title) || a.id.localeCompare(b.id);
}

export function countTaskTree(tasks: Task[]): number {
  let count = 0;
  for (const task of tasks) {
    count++;
    if (task.children) count += countTaskTree(task.children);
  }
  return count;
}

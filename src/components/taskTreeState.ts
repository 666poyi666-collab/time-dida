// 任务树折叠状态工具 - 统一所有任务树组件的默认折叠行为
// 规则：父任务默认折叠；搜索命中子任务时临时展开父任务；清空搜索后恢复用户原状态
import type { Task } from '@shared/types';

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
 *  基于当前 collapsed 状态生成新状态，仅把命中匹配的父任务设为 false（展开）。 */
export function expandMatchingParents(
  prev: Record<string, boolean>,
  tasks: Task[],
  query: string,
): Record<string, boolean> {
  const q = query.trim().toLowerCase();
  if (!q) return prev;
  const next = { ...prev };
  const walk = (list: Task[]) => {
    for (const t of list) {
      if (t.children && t.children.length > 0) {
        const childMatch = t.children.some((c) => c.title.toLowerCase().includes(q));
        const selfMatch = t.title.toLowerCase().includes(q);
        if (childMatch || selfMatch) {
          next[t.id] = false; // 展开
        }
        walk(t.children);
      }
    }
  };
  walk(tasks);
  return next;
}

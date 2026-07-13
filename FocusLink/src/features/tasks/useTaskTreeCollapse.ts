// 任务树折叠交互状态；纯筛选策略位于 taskTreeModel.ts。
import { useEffect, useRef, useState } from 'react';
import type { Task } from '@shared/types';
import { expandMatchingParents, initNewParentsCollapsed } from './taskTreeModel';

/**
 * TaskPicker 使用的树形折叠状态。
 * 搜索期间不覆盖用户原有状态；清空后恢复，并为搜索期间新出现的父节点补上默认折叠状态。
 */
export function useTaskTreeCollapse(tasks: Task[], query: string) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const beforeSearchRef = useRef<Record<string, boolean> | null>(null);
  const collapsedRef = useRef(collapsed);

  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);

  useEffect(() => {
    setCollapsed((prev) => initNewParentsCollapsed(prev, tasks));
  }, [tasks]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      if (beforeSearchRef.current !== null) {
        const restored = initNewParentsCollapsed(beforeSearchRef.current, tasks);
        beforeSearchRef.current = null;
        setCollapsed(restored);
      }
      return;
    }

    if (beforeSearchRef.current === null) {
      beforeSearchRef.current = collapsedRef.current;
    }
    setCollapsed((prev) => expandMatchingParents(prev, tasks, normalizedQuery));
  }, [query, tasks]);

  const toggleCollapse = (taskId: string) => {
    setCollapsed((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  return { collapsed, toggleCollapse };
}

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import type { Task } from '@shared/types';

export interface TaskTreeRowContext {
  task: Task;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  childCount: number;
  toggleCollapse: () => void;
}

interface TaskTreeProps {
  tasks: Task[];
  collapsed: Record<string, boolean>;
  onToggleCollapse: (taskId: string) => void;
  renderRow: (context: TaskTreeRowContext) => ReactNode;
  className?: string;
}

/**
 * Shared recursive tree shell. Consumers own row-specific actions, while hierarchy,
 * collapse animation and indentation remain consistent between the drawer and picker.
 */
export function TaskTree({
  tasks,
  collapsed,
  onToggleCollapse,
  renderRow,
  className = 'task-tree',
}: TaskTreeProps) {
  return (
    <div className={className}>
      {tasks.map((task) => (
        <TaskTreeNode
          key={task.id}
          task={task}
          depth={0}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          renderRow={renderRow}
        />
      ))}
    </div>
  );
}

function TaskTreeNode({
  task,
  depth,
  collapsed,
  onToggleCollapse,
  renderRow,
}: {
  task: Task;
  depth: number;
  collapsed: Record<string, boolean>;
  onToggleCollapse: (taskId: string) => void;
  renderRow: (context: TaskTreeRowContext) => ReactNode;
}) {
  const hasChildren = Boolean(task.children?.length);
  const isCollapsed = collapsed[task.id] === true;
  // reduced-motion：子树展开/收起降级为 140ms 纯透明度淡入淡出，不做高度运动。
  const reduceMotion = useReducedMotion();

  return (
    <div className="task-tree-node" data-depth={depth}>
      {renderRow({
        task,
        depth,
        hasChildren,
        isCollapsed,
        childCount: task.children?.length ?? 0,
        toggleCollapse: () => onToggleCollapse(task.id),
      })}

      {hasChildren && (
        <AnimatePresence initial={false}>
          {!isCollapsed && (
            <motion.div
              initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0.14, ease: [0.4, 0, 0.2, 1] }
                  : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }
              }
              className="task-children-wrap overflow-hidden"
            >
              {task.children!.map((child) => (
                <TaskTreeNode
                  key={child.id}
                  task={child}
                  depth={depth + 1}
                  collapsed={collapsed}
                  onToggleCollapse={onToggleCollapse}
                  renderRow={renderRow}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

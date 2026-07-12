import { AnimatePresence, motion } from 'framer-motion';
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

  return (
    <>
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
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
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
    </>
  );
}

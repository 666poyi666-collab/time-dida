// Lightweight Dida task picker shared by focus and history flows.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Icon } from '../../ui/Icon';
import { useStore } from '../../app/store';
import type { Task } from '@shared/types';
import { TaskTree, type TaskTreeRowContext } from './TaskTree';
import { countTaskTree, filterTaskTree } from './taskTreeModel';
import { useTaskTreeCollapse } from './useTaskTreeCollapse';

interface TaskPickerProps {
  onPick: (task: Task | null) => void;
  title?: string;
  selectedTaskId?: string | null;
  allowCompleted?: boolean;
}

export function TaskPicker({
  onPick,
  title = '选择任务',
  selectedTaskId,
  allowCompleted = false,
}: TaskPickerProps) {
  const { ticktickTasks, ticktickProjects, setTicktickTasks, setTicktickProjects, addToast } =
    useStore();
  const [query, setQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [loading, setLoading] = useState(ticktickTasks.length === 0);
  const [providerLabel, setProviderLabel] = useState('滴答清单');
  const { collapsed, toggleCollapse } = useTaskTreeCollapse(ticktickTasks, query);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.focuslink.tasks.refresh({ includeCompleted: allowCompleted });
      if (!result.ok) throw new Error(result.error);
      setTicktickProjects(result.data.projects);
      setTicktickTasks(result.data.tasks);
      setProviderLabel(result.data.provider === 'dida-cli' ? '滴答清单 · CLI' : '滴答清单');
    } catch (error) {
      addToast(`加载滴答任务失败：${toErrorMessage(error)}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast, allowCompleted, setTicktickProjects, setTicktickTasks]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onPick(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onPick]);

  const filteredTree = useMemo(
    () =>
      filterTaskTree(ticktickTasks, {
        query,
        projectId: selectedProject,
        showCompleted: allowCompleted,
        ignoreProjectWhenSearching: true,
        sort: 'smart',
      }).tasks,
    [allowCompleted, query, selectedProject, ticktickTasks],
  );

  const handleCancel = () => onPick(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={handleCancel}>
      <motion.div
        className="task-picker-backdrop absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
      />
      <motion.div
        className="picker-shell relative z-10 flex h-[min(540px,76vh)] w-[min(560px,92vw)] flex-col overflow-hidden rounded-[16px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-picker-title"
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 3 }}
        transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-[58px] items-center justify-between border-b border-border/70 px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span id="task-picker-title" className="text-[14px] font-semibold text-fg">
                {title}
              </span>
              <span className="text-[11px] text-fg-subtle">{countTaskTree(filteredTree)} 项</span>
            </div>
            <p className="mt-0.5 text-[11.5px] text-fg-subtle">{providerLabel}</p>
          </div>
          <button
            className="motion-press rounded-md p-1.5 text-fg-subtle hover:bg-bg-subtle/60 hover:text-fg"
            onClick={handleCancel}
            aria-label="关闭任务选择器"
          >
            <Icon.X size="sm" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
          <label className="task-search-row flex-1">
            <Icon.Search
              size="sm"
              tone="subtle"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
            />
            <input
              className="task-search-input !text-[13px]"
              placeholder="搜索滴答任务"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
            {query && (
              <button
                className="task-search-clear motion-press"
                onClick={() => setQuery('')}
                aria-label="清空搜索"
              >
                <Icon.X size="xs" />
              </button>
            )}
          </label>
          {ticktickProjects.length > 0 && !query && (
            <select
              className="task-picker-project"
              value={selectedProject}
              onChange={(event) => setSelectedProject(event.target.value)}
              aria-label="选择清单"
            >
              <option value="">全部清单</option>
              {ticktickProjects.map((project) => (
                <option key={project.id} value={project.externalId}>
                  {project.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="task-refresh-btn"
            onClick={loadTasks}
            disabled={loading}
            aria-label="刷新任务"
          >
            <Icon.Refresh size="sm" spin={loading} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5">
          {loading ? (
            <div className="flex h-full items-center justify-center text-fg-subtle">
              <Icon.Loader size="lg" spin />
            </div>
          ) : filteredTree.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-subtle">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-bg-subtle/50">
                <Icon.Search size="md" />
              </div>
              <p className="text-[13px] font-medium text-fg-muted">
                {ticktickTasks.length === 0 ? '暂无可用任务' : '没有匹配的任务'}
              </p>
            </div>
          ) : (
            <TaskTree
              tasks={filteredTree}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
              renderRow={(context) => (
                <PickerRow context={context} selectedTaskId={selectedTaskId} onPick={onPick} />
              )}
            />
          )}
        </div>

        <div className="flex min-h-[40px] items-center justify-between border-t border-border/60 px-4 text-[11px] text-fg-subtle">
          <span>点击任务即可关联</span>
          <span>Esc 关闭</span>
        </div>
      </motion.div>
    </div>
  );
}

function PickerRow({
  context,
  selectedTaskId,
  onPick,
}: {
  context: TaskTreeRowContext;
  selectedTaskId?: string | null;
  onPick: (task: Task) => void;
}) {
  const { task, depth, hasChildren, isCollapsed, childCount, toggleCollapse } = context;
  const isCompleted = task.isCompleted === true;
  const isSelected = selectedTaskId === task.id || selectedTaskId === task.externalId;

  return (
    <div
      className={`task-row-linear group ${isSelected ? 'task-row-highlighted' : ''} ${
        isCompleted ? 'task-row-done' : ''
      }`}
      style={{ paddingLeft: depth * 17 + 8 }}
      onClick={() => onPick(task)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPick(task);
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
    >
      {hasChildren ? (
        <button
          className="task-chevron motion-press"
          onClick={(event) => {
            event.stopPropagation();
            toggleCollapse();
          }}
          title={isCollapsed ? '展开' : '收起'}
          aria-label={isCollapsed ? `展开 ${task.title}` : `收起 ${task.title}`}
        >
          <motion.span
            animate={{ rotate: isCollapsed ? 0 : 90 }}
            transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Icon.ChevronRight size="xs" />
          </motion.span>
        </button>
      ) : (
        <span className="task-chevron-spacer" aria-hidden="true" />
      )}
      <span
        className={`task-completion-status ${isCompleted ? 'completed' : ''}`}
        title={isCompleted ? '已完成' : '未完成'}
        aria-label={isCompleted ? '已完成' : '未完成'}
      >
        {isCompleted && <Icon.Check size="xs" />}
      </span>
      <span className={`task-title ${isCompleted ? 'done' : ''} ${depth === 0 ? 'parent' : ''}`}>
        {task.title}
      </span>
      <div className="task-meta-inline">
        {hasChildren && <span className="task-child-count">{childCount}</span>}
      </div>
      {isSelected ? (
        <span className="task-current-label">当前</span>
      ) : (
        <span className="task-select-arrow" aria-hidden="true">
          <Icon.ChevronRight size="xs" />
        </span>
      )}
    </div>
  );
}

function toErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

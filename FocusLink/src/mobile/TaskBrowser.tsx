import {
  ChevronDown,
  ChevronRight,
  Folder,
  Inbox,
  ListFilter,
  Play,
  Search,
  Target,
} from 'lucide-react';
import { useId, useMemo, useState, type CSSProperties } from 'react';
import type { SyncedTask, SyncedTaskProject } from '@shared/sync/taskSnapshotProtocol';
import {
  ALL_PROJECTS,
  countSyncedTaskTree,
  filterSyncedTaskForest,
  groupSyncedTasks,
  NO_PROJECT,
  projectNameForTask,
  type TaskProjectFilter,
  type SyncedTaskTreeNode,
} from './taskBrowserModel';

interface TaskBrowserProps {
  tasks: readonly SyncedTask[];
  projects: readonly SyncedTaskProject[];
  publishedAt: number | null;
  revision: number;
  selectedTaskId: string;
  canStart: boolean;
  onSelect: (task: SyncedTask) => void;
  onStart: (task: SyncedTask) => void;
}

export function TaskBrowser({
  tasks,
  projects,
  publishedAt,
  revision,
  selectedTaskId,
  canStart,
  onSelect,
  onStart,
}: TaskBrowserProps) {
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<TaskProjectFilter>(ALL_PROJECTS);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(() => new Set());
  const groupRegionPrefix = useId();
  const taskForest = useMemo(
    () => filterSyncedTaskForest(tasks, query, projectFilter),
    [projectFilter, query, tasks],
  );
  const totalOpen = useMemo(() => tasks.filter((task) => !task.isCompleted).length, [tasks]);
  const groups = useMemo(
    () => groupSyncedTasks(flattenTree(taskForest), projects),
    [projects, taskForest],
  );
  const forceGroupsOpen = query.trim().length > 0 || projectFilter !== ALL_PROJECTS;
  const selectedTask = useMemo(
    () => findTaskInForest(taskForest, selectedTaskId),
    [selectedTaskId, taskForest],
  );
  const selectedPath = useMemo(
    () =>
      findTaskPath(taskForest, selectedTaskId)
        ?.map((task) => task.title)
        .filter(Boolean) ?? [],
    [selectedTaskId, taskForest],
  );

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleTask = (key: string) => {
    setCollapsedTasks((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="task-browser view-surface" aria-labelledby="task-browser-title">
      <header className="view-heading">
        <div>
          <p className="eyebrow">TASK SNAPSHOT</p>
          <h2 id="task-browser-title">电脑任务</h2>
        </div>
        <div className="view-heading-meta">
          <strong>{totalOpen}</strong>
          <span>项待办</span>
        </div>
      </header>

      <div className="task-toolbar">
        <label className="task-search">
          <Search aria-hidden="true" />
          <span className="sr-only">搜索任务</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索任务或标签"
            autoComplete="off"
          />
        </label>
        <label className="project-filter">
          <ListFilter aria-hidden="true" />
          <span className="sr-only">按清单筛选</span>
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            <option value={ALL_PROJECTS}>全部清单</option>
            <option value={NO_PROJECT}>无清单</option>
            {projects.map((project) => (
              <option key={`${project.source}:${project.id}`} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="task-snapshot-meta">
        <span>快照 rev {revision}</span>
        <span>
          {publishedAt ? `电脑更新于 ${formatSnapshotTime(publishedAt)}` : '等待电脑发布任务'}
        </span>
      </div>

      {taskForest.length === 0 ? (
        <div className="task-empty">
          <Target aria-hidden="true" />
          <strong>{tasks.length === 0 ? '还没有电脑任务快照' : '没有符合条件的待办'}</strong>
          <p>
            {tasks.length === 0
              ? '电脑端读取第一张清单后会自动同步到这里。'
              : '调整搜索词或清单筛选。'}
          </p>
        </div>
      ) : (
        <div className="task-browser-workspace">
          <div className="task-project-list" aria-label="电脑端待办任务">
            {groups.map((group, groupIndex) => {
              const selectedInside = treeContainsTask(group.tasks, selectedTaskId);
              const open = forceGroupsOpen || expandedGroups.has(group.key) || selectedInside;
              const regionId = `${groupRegionPrefix}-group-${groupIndex}`;
              return (
                <section className={`task-project-group ${open ? 'is-open' : ''}`} key={group.key}>
                  <button
                    className="task-project-toggle"
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={open}
                    aria-controls={regionId}
                  >
                    <span className="task-project-icon" style={{ color: group.color ?? undefined }}>
                      {group.projectId ? (
                        <Folder aria-hidden="true" />
                      ) : (
                        <Inbox aria-hidden="true" />
                      )}
                    </span>
                    <strong>{group.name}</strong>
                    <span>{countSyncedTaskTree(group.tasks)}</span>
                    <ChevronRight className="task-project-chevron" aria-hidden="true" />
                  </button>
                  {open && (
                    <div className="task-list" id={regionId} role="group" aria-label={group.name}>
                      {group.tasks.map((task) => (
                        <TaskBranch
                          key={`${task.source}:${task.id}`}
                          task={task}
                          depth={0}
                          ancestorTitles={[]}
                          projects={projects}
                          selectedTaskId={selectedTaskId}
                          canStart={canStart}
                          collapsedTasks={collapsedTasks}
                          forceOpen={forceGroupsOpen}
                          onToggle={toggleTask}
                          onSelect={onSelect}
                          onStart={onStart}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          <aside className="task-selection-detail" aria-label="所选任务详情">
            {selectedTask ? (
              <>
                <div className="task-selection-kicker">SELECTED TASK</div>
                <strong>{selectedTask.title || '未命名任务'}</strong>
                <p>{selectedPath.join(' / ') || projectNameForTask(selectedTask, projects)}</p>
                {selectedTask.tags.length > 0 && (
                  <div className="task-selection-tags">
                    {selectedTask.tags.slice(0, 4).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => onStart(selectedTask)} disabled={!canStart}>
                  <Play aria-hidden="true" />
                  关联并开始专注
                </button>
              </>
            ) : (
              <p>在左侧选择一个任务，平板会在这里显示完整路径和开始操作。</p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

function TaskBranch({
  task,
  depth,
  ancestorTitles,
  projects,
  selectedTaskId,
  canStart,
  collapsedTasks,
  forceOpen,
  onToggle,
  onSelect,
  onStart,
}: {
  task: SyncedTaskTreeNode;
  depth: number;
  ancestorTitles: readonly string[];
  projects: readonly SyncedTaskProject[];
  selectedTaskId: string;
  canStart: boolean;
  collapsedTasks: ReadonlySet<string>;
  forceOpen: boolean;
  onToggle: (key: string) => void;
  onSelect: (task: SyncedTask) => void;
  onStart: (task: SyncedTask) => void;
}) {
  const key = `${task.source}:${task.id}`;
  const selected = task.id === selectedTaskId;
  const hasChildren = task.children.length > 0;
  const open = forceOpen || !collapsedTasks.has(key);
  const visibleDepth = Math.min(depth, 2);
  const parentPath = ancestorTitles.filter(Boolean).slice(-2).join(' / ');
  return (
    <div className={`task-tree-branch ${hasChildren ? 'is-parent' : 'is-leaf'}`} data-depth={depth}>
      <article
        className={`task-row ${selected ? 'is-selected' : ''} ${hasChildren ? 'has-children' : ''}`}
        style={{ '--task-depth': visibleDepth } as CSSProperties}
      >
        {hasChildren ? (
          <button
            className="task-branch-toggle"
            type="button"
            aria-label={open ? `收起 ${task.title} 的子任务` : `展开 ${task.title} 的子任务`}
            aria-expanded={open}
            onClick={() => onToggle(key)}
          >
            {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
        ) : (
          <span className="task-status-mark" aria-hidden="true" />
        )}
        <button className="task-row-main" type="button" onClick={() => onSelect(task)}>
          <span className="task-row-copy">
            <strong>{task.title}</strong>
            <small>
              {depth >= 2 && parentPath
                ? parentPath
                : hasChildren
                  ? `${countSyncedTaskTree(task.children)} 项子任务`
                  : projectNameForTask(task, projects)}
              {task.tags.length > 0 ? ` · ${task.tags.slice(0, 2).join(' · ')}` : ''}
            </small>
          </span>
          {selected && <span className="selected-label">已选择</span>}
        </button>
        <button
          className="task-start-button"
          type="button"
          onClick={() => onStart(task)}
          disabled={!canStart}
          title={canStart ? '关联并开始专注' : '仅在待机且实时连接已确认时可开始'}
        >
          <Play aria-hidden="true" />
          <span>开始</span>
        </button>
      </article>
      {hasChildren && open && (
        <div className="task-children" role="group" aria-label={`${task.title} 的子任务`}>
          {task.children.map((child) => (
            <TaskBranch
              key={`${child.source}:${child.id}`}
              task={child}
              depth={depth + 1}
              ancestorTitles={[...ancestorTitles, task.title]}
              projects={projects}
              selectedTaskId={selectedTaskId}
              canStart={canStart}
              collapsedTasks={collapsedTasks}
              forceOpen={forceOpen}
              onToggle={onToggle}
              onSelect={onSelect}
              onStart={onStart}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function treeContainsTask(nodes: readonly SyncedTaskTreeNode[], taskId: string): boolean {
  return nodes.some((node) => node.id === taskId || treeContainsTask(node.children, taskId));
}

function findTaskInForest(
  nodes: readonly SyncedTaskTreeNode[],
  taskId: string,
): SyncedTaskTreeNode | null {
  for (const node of nodes) {
    if (node.id === taskId) return node;
    const child = findTaskInForest(node.children, taskId);
    if (child) return child;
  }
  return null;
}

function findTaskPath(
  nodes: readonly SyncedTaskTreeNode[],
  taskId: string,
  ancestors: readonly SyncedTaskTreeNode[] = [],
): SyncedTaskTreeNode[] | null {
  for (const node of nodes) {
    const path = [...ancestors, node];
    if (node.id === taskId) return path;
    const childPath = findTaskPath(node.children, taskId, path);
    if (childPath) return childPath;
  }
  return null;
}

function flattenTree(nodes: readonly SyncedTaskTreeNode[]): SyncedTask[] {
  const tasks: SyncedTask[] = [];
  const visit = (items: readonly SyncedTaskTreeNode[]) => {
    for (const item of items) {
      tasks.push(item);
      visit(item.children);
    }
  };
  visit(nodes);
  return tasks;
}

function formatSnapshotTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}

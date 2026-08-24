import {
  ChevronDown,
  ChevronRight,
  Check,
  Folder,
  Inbox,
  LayoutGrid,
  ListFilter,
  Play,
  Plus,
  Search,
  Target,
} from 'lucide-react';
import { useId, useMemo, useState, type CSSProperties } from 'react';
import type { SyncedTask, SyncedTaskProject } from '@shared/sync/taskSnapshotProtocol';
import {
  ALL_PROJECTS,
  buildSyncedTaskForest,
  countSyncedTaskTree,
  findSyncedTaskPath,
  filterSyncedTaskForest,
  groupSyncedTaskForest,
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
  onCreate?: (title: string, projectId: string | null) => Promise<void>;
  onCreateProject?: (name: string) => Promise<void>;
  onToggleComplete?: (task: SyncedTask) => Promise<void>;
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
  onCreate,
  onCreateProject,
  onToggleComplete,
}: TaskBrowserProps) {
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<TaskProjectFilter>(ALL_PROJECTS);
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [projectDraft, setProjectDraft] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(() => new Set());
  const groupRegionPrefix = useId();
  const taskForest = useMemo(
    () => filterSyncedTaskForest(tasks, query, projectFilter),
    [projectFilter, query, tasks],
  );
  const totalOpen = useMemo(() => tasks.filter((task) => !task.isCompleted).length, [tasks]);
  const groups = useMemo(() => groupSyncedTaskForest(taskForest, projects), [projects, taskForest]);
  const forceGroupsOpen = query.trim().length > 0 || projectFilter !== ALL_PROJECTS;
  const allTaskForest = useMemo(() => buildSyncedTaskForest(tasks), [tasks]);
  const selectedTaskPath = useMemo(
    () => findSyncedTaskPath(allTaskForest, selectedTaskId),
    [allTaskForest, selectedTaskId],
  );
  const selectedTask = selectedTaskPath?.[selectedTaskPath.length - 1] ?? null;
  const selectedPathKeys = useMemo(
    () => new Set((selectedTaskPath ?? []).map((task) => `${task.source}:${task.id}`)),
    [selectedTaskPath],
  );
  const selectedParentPath =
    selectedTaskPath
      ?.slice(0, -1)
      .map((task) => task.title)
      .filter(Boolean) ?? [];

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
          <p className="eyebrow">FOCUSLINK · 自有任务</p>
          <h2 id="task-browser-title">我的任务</h2>
        </div>
        <div className="view-heading-meta">
          <strong>{totalOpen}</strong>
          <span>项待办</span>
        </div>
      </header>

      <div className="task-toolbar">
        <form
          className="task-mobile-create"
          onSubmit={(event) => {
            event.preventDefault();
            const title = draft.trim();
            if (!title || creating || !onCreate) return;
            setCreating(true);
            void onCreate(
              title,
              projectFilter === ALL_PROJECTS || projectFilter === NO_PROJECT ? null : projectFilter,
            )
              .then(() => setDraft(''))
              .finally(() => setCreating(false));
          }}
        >
          <Plus aria-hidden="true" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="添加 FocusLink 任务"
            aria-label="添加 FocusLink 任务"
          />
          <button type="submit" disabled={!draft.trim() || creating || !onCreate}>
            {creating ? '保存中' : '添加'}
          </button>
        </form>
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
        <div className="task-view-switch" role="group" aria-label="任务视图">
          <button
            type="button"
            className={viewMode === 'list' ? 'is-active' : ''}
            onClick={() => setViewMode('list')}
            aria-label="列表视图"
            title="列表视图"
          >
            <ListFilter aria-hidden="true" />
          </button>
          <button
            type="button"
            className={viewMode === 'board' ? 'is-active' : ''}
            onClick={() => setViewMode('board')}
            aria-label="看板视图"
            title="看板视图"
          >
            <LayoutGrid aria-hidden="true" />
          </button>
        </div>
        <form
          className="project-mobile-create"
          onSubmit={(event) => {
            event.preventDefault();
            const name = projectDraft.trim();
            if (!name || !onCreateProject || creating) return;
            setCreating(true);
            void onCreateProject(name)
              .then(() => setProjectDraft(''))
              .finally(() => setCreating(false));
          }}
        >
          <input
            value={projectDraft}
            onChange={(event) => setProjectDraft(event.target.value)}
            placeholder="新建清单"
            aria-label="新建清单"
          />
          <button type="submit" disabled={!projectDraft.trim() || !onCreateProject || creating}>
            新建清单
          </button>
        </form>
      </div>

      <div className="task-snapshot-meta">
        <span>本地任务 · rev {revision}</span>
        <span>{publishedAt ? `最近同步 ${formatSnapshotTime(publishedAt)}` : '仅保存在本机'}</span>
      </div>

      {taskForest.length === 0 ? (
        <div className="task-empty">
          <Target aria-hidden="true" />
          <strong>{tasks.length === 0 ? '还没有 FocusLink 任务' : '没有符合条件的待办'}</strong>
          <p>
            {tasks.length === 0
              ? '先在这里创建任务；登录后会自动同步到其他 FocusLink 设备。'
              : '调整搜索词或清单筛选。'}
          </p>
        </div>
      ) : viewMode === 'board' ? (
        <TaskBoard
          tasks={tasks}
          projects={projects}
          canStart={canStart}
          onStart={onStart}
          onToggleComplete={onToggleComplete}
        />
      ) : (
        <div className="task-browser-workspace">
          <div className="task-project-list" aria-label="云端待办任务">
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
                          selectedPathKeys={selectedPathKeys}
                          forceOpen={forceGroupsOpen}
                          onToggle={toggleTask}
                          onSelect={onSelect}
                          onStart={onStart}
                          onToggleComplete={onToggleComplete}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          <aside
            className={`task-selection-detail ${selectedTask ? 'has-selection' : 'is-empty'}`}
            aria-label="所选任务详情"
          >
            {selectedTask ? (
              <>
                <div className="task-selection-kicker">SELECTED TASK</div>
                <strong>{selectedTask.title || '未命名任务'}</strong>
                <p>
                  父路径：
                  {[projectNameForTask(selectedTask, projects), ...selectedParentPath].join(' / ')}
                </p>
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
              <p>选择一个任务后，这里会显示完整路径和开始操作。</p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

function TaskBoard({
  tasks,
  projects,
  canStart,
  onStart,
  onToggleComplete,
}: {
  tasks: readonly SyncedTask[];
  projects: readonly SyncedTaskProject[];
  canStart: boolean;
  onStart: (task: SyncedTask) => void;
  onToggleComplete?: (task: SyncedTask) => Promise<void>;
}) {
  const openTasks = tasks.filter((task) => !task.isCompleted);
  const columns = [
    { key: 'inbox', label: '收件箱', tasks: openTasks.filter((task) => !task.projectId) },
    ...projects.map((project) => ({
      key: project.id,
      label: project.name,
      tasks: openTasks.filter((task) => task.projectId === project.id),
    })),
  ].filter((column) => column.tasks.length > 0);
  return (
    <div className="task-board" aria-label="任务看板">
      {columns.map((column) => (
        <section className="task-board-column" key={column.key}>
          <header>
            <strong>{column.label}</strong>
            <span>{column.tasks.length}</span>
          </header>
          <div className="task-board-cards">
            {column.tasks.map((task) => (
              <article className="task-board-card" key={`${task.source}:${task.id}`}>
                <div className="task-board-card-top">
                  <button
                    className="task-board-check"
                    type="button"
                    onClick={() => void onToggleComplete?.(task)}
                    aria-label={`完成 ${task.title}`}
                  >
                    <Check />
                  </button>
                  <strong>{task.title}</strong>
                </div>
                <div className="task-board-card-meta">
                  {task.dueDate
                    ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(
                        task.dueDate,
                      )
                    : '未设截止'}
                  {task.tags.slice(0, 2).map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </div>
                <button
                  type="button"
                  className="task-board-focus"
                  onClick={() => onStart(task)}
                  disabled={!canStart}
                >
                  <Play aria-hidden="true" />
                  开始专注
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
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
  selectedPathKeys,
  forceOpen,
  onToggle,
  onSelect,
  onStart,
  onToggleComplete,
}: {
  task: SyncedTaskTreeNode;
  depth: number;
  ancestorTitles: readonly string[];
  projects: readonly SyncedTaskProject[];
  selectedTaskId: string;
  canStart: boolean;
  collapsedTasks: ReadonlySet<string>;
  selectedPathKeys: ReadonlySet<string>;
  forceOpen: boolean;
  onToggle: (key: string) => void;
  onSelect: (task: SyncedTask) => void;
  onStart: (task: SyncedTask) => void;
  onToggleComplete?: (task: SyncedTask) => Promise<void>;
}) {
  const key = `${task.source}:${task.id}`;
  const selected = task.id === selectedTaskId;
  const hasChildren = task.children.length > 0;
  const open = isTaskBranchOpen(key, collapsedTasks, selectedPathKeys, forceOpen);
  const visibleDepth = Math.min(depth, 2);
  const hiddenAncestorTitles = task.hiddenAncestorTitles ?? [];
  const parentPath = [
    projectNameForTask(task, projects),
    ...ancestorTitles,
    ...hiddenAncestorTitles,
  ]
    .filter(Boolean)
    .join(' / ');
  const actions = createTaskBranchActions(task, key, { onToggle, onSelect, onStart });
  return (
    <div className={`task-tree-branch ${hasChildren ? 'is-parent' : 'is-leaf'}`} data-depth={depth}>
      <article
        className={`task-row ${selected ? 'is-selected' : ''} ${hasChildren ? 'has-children' : ''}`}
        style={{ '--task-depth': visibleDepth } as CSSProperties}
      >
        <button
          className="task-mobile-complete"
          type="button"
          onClick={() => void onToggleComplete?.(task)}
          aria-label={`完成 ${task.title}`}
        >
          <Check aria-hidden="true" />
        </button>
        {hasChildren ? (
          <button
            className="task-branch-toggle"
            type="button"
            aria-label={open ? `收起 ${task.title} 的子任务` : `展开 ${task.title} 的子任务`}
            aria-expanded={open}
            onClick={actions.toggle}
          >
            {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
        ) : (
          <span className="task-status-mark" aria-hidden="true" />
        )}
        <button
          className="task-row-main"
          type="button"
          aria-label={`选择 ${task.title}`}
          onClick={actions.select}
        >
          <span className="task-row-copy">
            <strong>{task.title}</strong>
            <small>
              {(depth > 0 || hiddenAncestorTitles.length > 0) && parentPath
                ? `父级 ${parentPath}`
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
          aria-label={`关联 ${task.title} 并开始专注`}
          onClick={actions.start}
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
              ancestorTitles={[...ancestorTitles, ...hiddenAncestorTitles, task.title]}
              projects={projects}
              selectedTaskId={selectedTaskId}
              canStart={canStart}
              collapsedTasks={collapsedTasks}
              selectedPathKeys={selectedPathKeys}
              forceOpen={forceOpen}
              onToggle={onToggle}
              onSelect={onSelect}
              onStart={onStart}
              onToggleComplete={onToggleComplete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function createTaskBranchActions(
  task: SyncedTask,
  key: string,
  handlers: {
    onToggle: (key: string) => void;
    onSelect: (task: SyncedTask) => void;
    onStart: (task: SyncedTask) => void;
  },
) {
  return {
    toggle: () => handlers.onToggle(key),
    select: () => handlers.onSelect(task),
    start: () => handlers.onStart(task),
  };
}

/** A programmatic selection must remain reachable even after its parents were manually collapsed. */
export function isTaskBranchOpen(
  key: string,
  collapsedTasks: ReadonlySet<string>,
  selectedPathKeys: ReadonlySet<string>,
  forceOpen: boolean,
): boolean {
  return forceOpen || selectedPathKeys.has(key) || !collapsedTasks.has(key);
}

function treeContainsTask(nodes: readonly SyncedTaskTreeNode[], taskId: string): boolean {
  return nodes.some((node) => node.id === taskId || treeContainsTask(node.children, taskId));
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

import {
  ChevronDown,
  ChevronRight,
  Check,
  Folder,
  Inbox,
  LayoutGrid,
  ListFilter,
  Play,
  Palette,
  Plus,
  RotateCcw,
  Search,
  Target,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import type { SyncedTask, SyncedTaskProject } from '@shared/sync/taskSnapshotProtocol';
import {
  defaultTaskProjectColor,
  FOCUSLINK_INBOX_PROJECT_ID,
  isFocusLinkInboxProject,
  TASK_PROJECT_COLOR_PALETTE,
} from '@shared/taskProjectPolicy';
import {
  ALL_PROJECTS,
  buildSyncedTaskForest,
  countSyncedTaskTree,
  findSyncedTaskPath,
  filterSyncedTaskForest,
  filterSyncedTasks,
  groupSyncedTaskForest,
  NO_PROJECT,
  projectNameForTask,
  type TaskProjectFilter,
  type TaskStatusFilter,
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
  onUpdateProject?: (
    project: SyncedTaskProject,
    input: { name?: string; color?: string | null },
  ) => Promise<void>;
  onDeleteProject?: (project: SyncedTaskProject) => Promise<void>;
  onMoveTask?: (task: SyncedTask, projectId: string) => Promise<void>;
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
  onUpdateProject,
  onDeleteProject,
  onMoveTask,
  onToggleComplete,
}: TaskBrowserProps) {
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<TaskProjectFilter>(ALL_PROJECTS);
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>('open');
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [projectDraft, setProjectDraft] = useState('');
  const [projectComposerOpen, setProjectComposerOpen] = useState(false);
  const [movingTask, setMovingTask] = useState(false);
  const [mutationNotice, setMutationNotice] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(() => new Set());
  const groupRegionPrefix = useId();
  const taskForest = useMemo(
    () => filterSyncedTaskForest(tasks, query, projectFilter, statusFilter),
    [projectFilter, query, statusFilter, tasks],
  );
  const totalOpen = useMemo(() => tasks.filter((task) => !task.isCompleted).length, [tasks]);
  const totalCompleted = useMemo(() => tasks.filter((task) => task.isCompleted).length, [tasks]);
  const boardTasks = useMemo(
    () => filterSyncedTasks(tasks, query, projectFilter, statusFilter),
    [projectFilter, query, statusFilter, tasks],
  );
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
  const selectStatusFilter = (next: TaskStatusFilter) => {
    setStatusFilter(next);
    setDetailOpen(false);
  };
  const selectTask = (task: SyncedTask) => {
    setDetailOpen(true);
    onSelect(task);
  };
  const mutationError = (action: string, error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    setMutationNotice(`${action}失败：${detail}`);
  };
  const updateProjectWithNotice = onUpdateProject
    ? async (project: SyncedTaskProject, input: { name?: string; color?: string | null }) => {
        setMutationNotice(null);
        try {
          await onUpdateProject(project, input);
        } catch (error) {
          mutationError('保存清单', error);
          throw error;
        }
      }
    : undefined;
  const deleteProjectWithNotice = onDeleteProject
    ? async (project: SyncedTaskProject) => {
        if (isFocusLinkInboxProject(project.id)) return;
        if (
          !window.confirm(
            `确定删除清单「${project.name}」吗？其中的任务和子任务会移到收件箱，不会被删除。`,
          )
        ) {
          return;
        }
        setMutationNotice(null);
        try {
          await onDeleteProject(project);
        } catch (error) {
          mutationError('删除清单', error);
          throw error;
        }
      }
    : undefined;
  const toggleCompleteWithNotice = onToggleComplete
    ? async (task: SyncedTask) => {
        setMutationNotice(null);
        try {
          await onToggleComplete(task);
        } catch (error) {
          mutationError(task.isCompleted ? '恢复任务' : '完成任务', error);
        }
      }
    : undefined;

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
        <div className="task-status-switch" role="group" aria-label="任务状态">
          <button
            type="button"
            className={statusFilter === 'open' ? 'is-active' : ''}
            aria-pressed={statusFilter === 'open'}
            onClick={() => selectStatusFilter('open')}
          >
            <span>待办</span>
            <strong>{totalOpen}</strong>
          </button>
          <button
            type="button"
            className={statusFilter === 'completed' ? 'is-active' : ''}
            aria-pressed={statusFilter === 'completed'}
            onClick={() => selectStatusFilter('completed')}
          >
            <span>已完成</span>
            <strong>{totalCompleted}</strong>
          </button>
        </div>
        <form
          className="task-mobile-create"
          onSubmit={(event) => {
            event.preventDefault();
            const title = draft.trim();
            if (!title || creating || !onCreate) return;
            setCreating(true);
            void onCreate(
              title,
              projectFilter === ALL_PROJECTS || projectFilter === NO_PROJECT
                ? FOCUSLINK_INBOX_PROJECT_ID
                : projectFilter,
            )
              .then(() => setDraft(''))
              .then(() => setStatusFilter('open'))
              .then(() => setMutationNotice(null))
              .catch((error) => mutationError('创建任务', error))
              .finally(() => setCreating(false));
          }}
        >
          <Plus aria-hidden="true" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="添加任务"
            aria-label="添加任务"
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
            <option value={NO_PROJECT}>收件箱</option>
            {projects
              .filter((project) => !isFocusLinkInboxProject(project.id))
              .map((project) => (
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
        <button
          className="project-create-disclosure"
          type="button"
          aria-expanded={projectComposerOpen}
          onClick={() => setProjectComposerOpen((open) => !open)}
        >
          <Folder aria-hidden="true" />
          <span>{projectComposerOpen ? '收起清单创建' : '新建清单'}</span>
          {projectComposerOpen ? <ChevronDown aria-hidden="true" /> : <Plus aria-hidden="true" />}
        </button>
        {projectComposerOpen && (
          <div className="mobile-project-manager">
            <form
              className="project-mobile-create"
              onSubmit={(event) => {
                event.preventDefault();
                const name = projectDraft.trim();
                if (!name || !onCreateProject || creating) return;
                setCreating(true);
                void onCreateProject(name)
                  .then(() => setProjectDraft(''))
                  .then(() => setMutationNotice(null))
                  .catch((error) => mutationError('创建清单', error))
                  .finally(() => setCreating(false));
              }}
            >
              <input
                value={projectDraft}
                onChange={(event) => setProjectDraft(event.target.value)}
                placeholder="清单名称"
                aria-label="清单名称"
                autoFocus
              />
              <button type="submit" disabled={!projectDraft.trim() || !onCreateProject || creating}>
                创建
              </button>
            </form>
            <div className="mobile-project-editor-list" aria-label="清单颜色设置">
              {projects
                .filter((project) => !isFocusLinkInboxProject(project.id))
                .map((project, index) => (
                  <MobileProjectEditor
                    key={project.id}
                    project={project}
                    fallbackColor={defaultTaskProjectColor(index + 1)}
                    onSave={updateProjectWithNotice}
                    onDelete={deleteProjectWithNotice}
                  />
                ))}
            </div>
          </div>
        )}
      </div>

      <div className="task-snapshot-meta">
        <span>本地任务 · rev {revision}</span>
        <span>{publishedAt ? `最近同步 ${formatSnapshotTime(publishedAt)}` : '仅保存在本机'}</span>
      </div>
      {mutationNotice && (
        <p className="task-mutation-notice" role="status" aria-live="polite">
          {mutationNotice}
        </p>
      )}

      {taskForest.length === 0 ? (
        <div className="task-empty">
          <Target aria-hidden="true" />
          <strong>
            {tasks.length === 0
              ? '还没有 FocusLink 任务'
              : statusFilter === 'completed'
                ? '没有符合条件的已完成任务'
                : '没有符合条件的待办'}
          </strong>
          <p>
            {tasks.length === 0
              ? '先在这里创建任务；设备配对后会自动同步到电脑、手机和平板。'
              : statusFilter === 'completed'
                ? '完成后的任务会保留在这里，可随时恢复为待办。'
                : '调整搜索词或清单筛选。'}
          </p>
        </div>
      ) : viewMode === 'board' ? (
        <TaskBoard
          tasks={boardTasks}
          projects={projects}
          canStart={canStart}
          onStart={onStart}
          onToggleComplete={toggleCompleteWithNotice}
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
                      {group.projectId && !isFocusLinkInboxProject(group.projectId) ? (
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
                          onSelect={selectTask}
                          onStart={onStart}
                          onToggleComplete={toggleCompleteWithNotice}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
          <aside
            className={`task-selection-detail ${selectedTask ? 'has-selection' : 'is-empty'} ${detailOpen ? 'is-open' : ''}`}
            aria-label="所选任务详情"
          >
            {selectedTask ? (
              <>
                <button
                  type="button"
                  className="task-selection-close"
                  onClick={() => setDetailOpen(false)}
                  aria-label="关闭任务详情"
                >
                  ×
                </button>
                <div className="task-selection-kicker">SELECTED TASK</div>
                <strong>{selectedTask.title || '未命名任务'}</strong>
                <p>
                  父路径：
                  {[projectNameForTask(selectedTask, projects), ...selectedParentPath].join(' / ')}
                </p>
                {onMoveTask && selectedTask.source === 'local' && (
                  <label className="task-selection-project">
                    <span>所属清单</span>
                    <select
                      value={selectedTask.projectId ?? FOCUSLINK_INBOX_PROJECT_ID}
                      disabled={movingTask}
                      onChange={(event) => {
                        setMovingTask(true);
                        setMutationNotice(null);
                        void onMoveTask(selectedTask, event.target.value)
                          .catch((error) => mutationError('移动任务', error))
                          .finally(() => setMovingTask(false));
                      }}
                    >
                      <option value={FOCUSLINK_INBOX_PROJECT_ID}>收件箱</option>
                      {projects
                        .filter((project) => !isFocusLinkInboxProject(project.id))
                        .map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {selectedTask.tags.length > 0 && (
                  <div className="task-selection-tags">
                    {selectedTask.tags.slice(0, 4).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                )}
                {!selectedTask.isCompleted && (
                  <button type="button" onClick={() => onStart(selectedTask)} disabled={!canStart}>
                    <Play aria-hidden="true" />
                    关联并开始专注
                  </button>
                )}
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

function MobileProjectEditor({
  project,
  fallbackColor,
  onSave,
  onDelete,
}: {
  project: SyncedTaskProject;
  fallbackColor: string;
  onSave?: (
    project: SyncedTaskProject,
    input: { name?: string; color?: string | null },
  ) => Promise<void>;
  onDelete?: (project: SyncedTaskProject) => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color ?? fallbackColor);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setName(project.name);
    setColor(project.color ?? fallbackColor);
  }, [fallbackColor, project.color, project.name]);
  return (
    <details className="mobile-project-editor">
      <summary>
        <Palette aria-hidden="true" />
        <i style={{ background: color }} />
        <strong>{project.name}</strong>
        <ChevronRight aria-hidden="true" />
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!onSave || !name.trim() || saving) return;
          setSaving(true);
          void onSave(project, { name: name.trim(), color })
            .catch(() => {
              setName(project.name);
              setColor(project.color ?? fallbackColor);
            })
            .finally(() => setSaving(false));
        }}
      >
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
        <div className="mobile-project-palette">
          {TASK_PROJECT_COLOR_PALETTE.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === color ? 'selected' : ''}
              style={{ '--project-color': candidate } as CSSProperties}
              onClick={() => {
                if (!onSave || candidate === color || saving) return;
                setColor(candidate);
                setSaving(true);
                void onSave(project, {
                  name: name.trim() || project.name,
                  color: candidate,
                })
                  .catch(() => setColor(project.color ?? fallbackColor))
                  .finally(() => setSaving(false));
              }}
              disabled={!onSave || saving}
              aria-label={`选择颜色 ${candidate}`}
              aria-pressed={candidate === color}
            />
          ))}
        </div>
        <button type="submit" disabled={!onSave || !name.trim() || saving}>
          {saving ? '保存中' : '保存清单'}
        </button>
        {onDelete && (
          <button
            type="button"
            className="project-delete-button"
            disabled={saving}
            onClick={() => {
              if (saving) return;
              setSaving(true);
              void onDelete(project)
                .catch(() => undefined)
                .finally(() => setSaving(false));
            }}
            aria-label={`删除清单 ${project.name}`}
          >
            删除清单（任务移到收件箱）
          </button>
        )}
      </form>
    </details>
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
  const columns = [
    {
      key: 'inbox',
      label: '收件箱',
      tasks: tasks.filter((task) => !task.projectId || isFocusLinkInboxProject(task.projectId)),
    },
    ...projects
      .filter((project) => !isFocusLinkInboxProject(project.id))
      .map((project) => ({
        key: project.id,
        label: project.name,
        tasks: tasks.filter((task) => task.projectId === project.id),
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
              <article
                className={`task-board-card ${task.isCompleted ? 'is-completed' : ''}`}
                key={`${task.source}:${task.id}`}
              >
                <div className="task-board-card-top">
                  <button
                    className={`task-board-check ${task.isCompleted ? 'is-restore' : ''}`}
                    type="button"
                    onClick={() => void onToggleComplete?.(task)}
                    aria-label={`${task.isCompleted ? '恢复' : '完成'} ${task.title}`}
                  >
                    {task.isCompleted ? <RotateCcw /> : <Check />}
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
                {!task.isCompleted && (
                  <button
                    type="button"
                    className="task-board-focus"
                    onClick={() => onStart(task)}
                    disabled={!canStart}
                  >
                    <Play aria-hidden="true" />
                    开始专注
                  </button>
                )}
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
        className={`task-row ${selected ? 'is-selected' : ''} ${task.isCompleted ? 'is-completed' : ''} ${hasChildren ? 'has-children' : ''}`}
        style={{ '--task-depth': visibleDepth } as CSSProperties}
      >
        <button
          className={`task-mobile-complete ${task.isCompleted ? 'is-restore' : ''}`}
          type="button"
          onClick={() => void onToggleComplete?.(task)}
          aria-label={`${task.isCompleted ? '恢复' : '完成'} ${task.title}`}
        >
          {task.isCompleted ? <RotateCcw aria-hidden="true" /> : <Check aria-hidden="true" />}
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
        {!task.isCompleted && (
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
        )}
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

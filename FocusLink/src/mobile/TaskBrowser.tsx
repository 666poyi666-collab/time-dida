import { ChevronRight, Folder, Inbox, ListFilter, Play, Search, Target } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { SyncedTask, SyncedTaskProject } from '@shared/sync/taskSnapshotProtocol';
import {
  ALL_PROJECTS,
  filterSyncedTasks,
  groupSyncedTasks,
  NO_PROJECT,
  projectNameForTask,
  type TaskProjectFilter,
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
  const groupRegionPrefix = useId();
  const openTasks = useMemo(
    () => filterSyncedTasks(tasks, query, projectFilter),
    [projectFilter, query, tasks],
  );
  const totalOpen = useMemo(() => tasks.filter((task) => !task.isCompleted).length, [tasks]);
  const groups = useMemo(() => groupSyncedTasks(openTasks, projects), [openTasks, projects]);
  const forceGroupsOpen = query.trim().length > 0 || projectFilter !== ALL_PROJECTS;

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
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

      {openTasks.length === 0 ? (
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
        <div className="task-project-list" aria-label="电脑端待办任务">
          {groups.map((group, groupIndex) => {
            const selectedInside = group.tasks.some((task) => task.id === selectedTaskId);
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
                    {group.projectId ? <Folder aria-hidden="true" /> : <Inbox aria-hidden="true" />}
                  </span>
                  <strong>{group.name}</strong>
                  <span>{group.tasks.length}</span>
                  <ChevronRight className="task-project-chevron" aria-hidden="true" />
                </button>
                {open && (
                  <div className="task-list" id={regionId} role="group" aria-label={group.name}>
                    {group.tasks.map((task) => {
                      const selected = task.id === selectedTaskId;
                      return (
                        <article
                          className={`task-row ${selected ? 'is-selected' : ''}`}
                          key={`${task.source}:${task.id}`}
                        >
                          <button
                            className="task-row-main"
                            type="button"
                            onClick={() => onSelect(task)}
                          >
                            <span className="task-status-mark" aria-hidden="true" />
                            <span className="task-row-copy">
                              <strong>{task.title}</strong>
                              <small>
                                {projectNameForTask(task, projects)}
                                {task.tags.length > 0
                                  ? ` · ${task.tags.slice(0, 2).join(' · ')}`
                                  : ''}
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
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
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

import type { SyncedTask, SyncedTaskProject } from '@shared/sync/taskSnapshotProtocol';

export const ALL_PROJECTS = 'all' as const;
export const NO_PROJECT = 'none' as const;

export type TaskProjectFilter = typeof ALL_PROJECTS | typeof NO_PROJECT | string;

export interface SyncedTaskGroup {
  key: string;
  projectId: string | null;
  name: string;
  color: string | null;
  tasks: SyncedTask[];
}

export function filterSyncedTasks(
  tasks: readonly SyncedTask[],
  query: string,
  projectFilter: TaskProjectFilter,
): SyncedTask[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  return tasks.filter((task) => {
    if (task.isCompleted) return false;
    if (projectFilter === NO_PROJECT && task.projectId !== null) return false;
    if (
      projectFilter !== ALL_PROJECTS &&
      projectFilter !== NO_PROJECT &&
      task.projectId !== projectFilter
    ) {
      return false;
    }
    if (!normalizedQuery) return true;
    return [task.title, ...task.tags].some((value) =>
      value.toLocaleLowerCase('zh-CN').includes(normalizedQuery),
    );
  });
}

export function projectNameForTask(
  task: SyncedTask,
  projects: readonly SyncedTaskProject[],
): string {
  if (!task.projectId) return '无清单';
  return projects.find((project) => project.id === task.projectId)?.name ?? '未知清单';
}

export function groupSyncedTasks(
  tasks: readonly SyncedTask[],
  projects: readonly SyncedTaskProject[],
): SyncedTaskGroup[] {
  const groups = new Map<string, SyncedTaskGroup>();
  for (const project of projects) {
    groups.set(project.id, {
      key: `${project.source}:${project.id}`,
      projectId: project.id,
      name: project.name,
      color: project.color,
      tasks: [],
    });
  }
  const noProject: SyncedTaskGroup = {
    key: NO_PROJECT,
    projectId: null,
    name: '无清单',
    color: null,
    tasks: [],
  };
  for (const task of tasks) {
    if (!task.projectId) {
      noProject.tasks.push(task);
      continue;
    }
    const group = groups.get(task.projectId) ?? {
      key: `unknown:${task.projectId}`,
      projectId: task.projectId,
      name: '未知清单',
      color: null,
      tasks: [],
    };
    group.tasks.push(task);
    groups.set(task.projectId, group);
  }
  return [...groups.values(), noProject].filter((group) => group.tasks.length > 0);
}

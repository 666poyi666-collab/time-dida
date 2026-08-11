import type { SyncedTask, SyncedTaskProject } from '@shared/sync/taskSnapshotProtocol';

export const ALL_PROJECTS = 'all' as const;
export const NO_PROJECT = 'none' as const;

export type TaskProjectFilter = typeof ALL_PROJECTS | typeof NO_PROJECT | string;

export interface SyncedTaskGroup {
  key: string;
  projectId: string | null;
  name: string;
  color: string | null;
  tasks: SyncedTaskTreeNode[];
}

export interface SyncedTaskTreeNode extends SyncedTask {
  children: SyncedTaskTreeNode[];
  /** Completed parents stay hidden, but their titles remain part of an open descendant's path. */
  hiddenAncestorTitles?: string[];
}

export interface SyncedTaskTreeEntry {
  task: SyncedTask;
  depth: number;
  hasChildren: boolean;
}

export function buildSyncedTaskForest(tasks: readonly SyncedTask[]): SyncedTaskTreeNode[] {
  const nodes = new Map<string, SyncedTaskTreeNode>();
  const orderedNodes: SyncedTaskTreeNode[] = [];
  for (const task of tasks) {
    const key = syncedTaskKey(task);
    // The wire protocol rejects duplicate ids. Keep the renderer defensive as cached snapshots
    // can outlive an older producer: one logical task must still render at most once.
    if (nodes.has(key)) continue;
    const node = { ...task, children: [] };
    nodes.set(key, node);
    orderedNodes.push(node);
  }

  const roots: SyncedTaskTreeNode[] = [];
  for (const node of orderedNodes) {
    const parent = node.parentId ? nodes.get(`${node.source}:${node.parentId}`) : undefined;
    if (!parent || parent === node || wouldCreateTaskCycle(node, parent, nodes)) roots.push(node);
    else parent.children.push(node);
  }
  return roots;
}

export function flattenSyncedTaskTree(tasks: readonly SyncedTask[]): SyncedTaskTreeEntry[] {
  const entries: SyncedTaskTreeEntry[] = [];
  const visit = (nodes: readonly SyncedTaskTreeNode[], depth: number) => {
    for (const node of nodes) {
      entries.push({ task: node, depth, hasChildren: node.children.length > 0 });
      visit(node.children, depth + 1);
    }
  };
  visit(buildSyncedTaskForest(tasks.filter((task) => !task.isCompleted)), 0);
  return entries;
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
  return groupSyncedTaskForest(buildSyncedTaskForest(tasks), projects);
}

/** Group an already-built forest without flattening and rebuilding its parentId links. */
export function groupSyncedTaskForest(
  forest: readonly SyncedTaskTreeNode[],
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
  for (const task of forest) {
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

export function filterSyncedTaskForest(
  tasks: readonly SyncedTask[],
  query: string,
  projectFilter: TaskProjectFilter,
): SyncedTaskTreeNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const filter = (nodes: readonly SyncedTaskTreeNode[]): SyncedTaskTreeNode[] => {
    const result: SyncedTaskTreeNode[] = [];
    for (const node of nodes) {
      const children = filter(node.children);
      // A completed or otherwise hidden parent must not make an open descendant disappear.
      // Promote the surviving children while carrying the hidden path explicitly; parentId alone
      // cannot recover a title after the completed node leaves the rendered forest.
      if (node.isCompleted) {
        result.push(
          ...children.map((child) => ({
            ...child,
            hiddenAncestorTitles: [
              ...(node.hiddenAncestorTitles ?? []),
              node.title,
              ...(child.hiddenAncestorTitles ?? []),
            ],
          })),
        );
        continue;
      }
      const projectMatches =
        projectFilter === ALL_PROJECTS ||
        (projectFilter === NO_PROJECT ? node.projectId === null : node.projectId === projectFilter);
      const queryMatches =
        !normalizedQuery ||
        [node.title, ...node.tags].some((value) =>
          value.toLocaleLowerCase('zh-CN').includes(normalizedQuery),
        );
      if ((projectMatches && queryMatches) || children.length > 0) {
        result.push({ ...node, children });
      }
    }
    return result;
  };
  return filter(buildSyncedTaskForest(tasks));
}

export function countSyncedTaskTree(tasks: readonly SyncedTaskTreeNode[]): number {
  return tasks.reduce((count, task) => count + 1 + countSyncedTaskTree(task.children), 0);
}

export function findSyncedTaskPath(
  nodes: readonly SyncedTaskTreeNode[],
  taskId: string,
  ancestors: readonly SyncedTaskTreeNode[] = [],
): SyncedTaskTreeNode[] | null {
  for (const node of nodes) {
    const path = [...ancestors, node];
    if (node.id === taskId) return path;
    const childPath = findSyncedTaskPath(node.children, taskId, path);
    if (childPath) return childPath;
  }
  return null;
}

function syncedTaskKey(task: Pick<SyncedTask, 'source' | 'id'>): string {
  return `${task.source}:${task.id}`;
}

function wouldCreateTaskCycle(
  node: SyncedTaskTreeNode,
  candidateParent: SyncedTaskTreeNode,
  nodes: ReadonlyMap<string, SyncedTaskTreeNode>,
): boolean {
  const visited = new Set<string>();
  let current: SyncedTaskTreeNode | undefined = candidateParent;
  while (current?.parentId) {
    if (current === node) return true;
    const key = `${current.source}:${current.id}`;
    if (visited.has(key)) return true;
    visited.add(key);
    current = nodes.get(`${current.source}:${current.parentId}`);
  }
  return current === node;
}

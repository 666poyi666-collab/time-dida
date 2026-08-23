// 本地任务 Provider - 在 tasks_cache 中管理本地任务（source='local'）
import crypto from 'node:crypto';
import {
  upsertTaskCache,
  listTaskCache,
  searchTaskCache,
  listLocalTaskProjects,
  upsertLocalTaskProject,
} from '../db/index.js';
import { logger } from '../logger.js';
import type { Project, Task, TaskCache, TaskSource } from '@shared/types';
import type { SyncedTask, SyncedTaskProject } from '@shared/sync/taskSnapshotProtocol';

const LOCAL_PROJECT_ID = 'local-inbox';

function ensureInbox(): void {
  if (typeof listLocalTaskProjects !== 'function' || typeof upsertLocalTaskProject !== 'function') {
    return;
  }
  if (listLocalTaskProjects().some((project) => project.id === LOCAL_PROJECT_ID)) return;
  const now = Date.now();
  upsertLocalTaskProject({
    id: LOCAL_PROJECT_ID,
    name: '收件箱',
    color: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  });
}

function cacheToTask(c: TaskCache): Task {
  return {
    id: c.id,
    source: c.source,
    externalId: c.externalId,
    projectId: c.projectId,
    parentId: c.parentId ?? null,
    title: c.title,
    status: c.status,
    priority: c.priority,
    dueDate: c.dueDate,
    tags: c.tags ? JSON.parse(c.tags) : [],
    content: c.content,
    isCompleted: c.status === 'completed',
    completedAt: c.status === 'completed' ? c.updatedAt : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export const LocalTaskProvider = {
  createProject(name: string): Project {
    const title = name.trim();
    if (!title) throw new Error('清单名称不能为空');
    ensureInbox();
    const now = Date.now();
    const id = crypto.randomUUID();
    upsertLocalTaskProject({
      id,
      name: title,
      color: null,
      sortOrder: listLocalTaskProjects().length,
      createdAt: now,
      updatedAt: now,
    });
    return { id, source: 'local', externalId: id, name: title, color: null };
  },
  create(title: string, _projectId?: string): Task {
    const now = Date.now();
    const id = crypto.randomUUID();
    const cache: TaskCache = {
      id,
      source: 'local' as TaskSource,
      externalId: id,
      projectId: _projectId ?? LOCAL_PROJECT_ID,
      title,
      status: 'incomplete',
      priority: null,
      dueDate: null,
      tags: null,
      content: null,
      rawJson: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    upsertTaskCache(cache);
    logger.info('tasks:local', `created local task: ${title}`);
    return cacheToTask(cache);
  },

  list(): Task[] {
    return listTaskCache('local').map(cacheToTask);
  },

  listProjects(): Project[] {
    ensureInbox();
    return listLocalTaskProjects().map((project) => ({
      id: project.id,
      source: 'local',
      externalId: project.id,
      name: project.name,
      color: project.color,
    }));
  },

  importExternal(projects: readonly Project[], tasks: readonly Task[]): number {
    ensureInbox();
    const now = Date.now();
    const localProjectIds = new Map<string, string>();
    projects.forEach((project, index) => {
      const id = `local-project-${project.externalId || project.id}`;
      localProjectIds.set(`${project.source}:${project.id}`, id);
      upsertLocalTaskProject({
        id,
        name: project.name,
        color: project.color,
        sortOrder: index + 1,
        createdAt: now,
        updatedAt: now,
      });
    });
    const existing = new Map(
      this.list()
        .map((task) => [task.content?.match(/external:([^\n]+)/)?.[1], task.id] as const)
        .filter(([key]) => Boolean(key)),
    );
    let imported = 0;
    const visit = (task: Task, parentLocalId: string | null = null) => {
      const externalKey = `${task.source}:${task.externalId || task.id}`;
      let localId = existing.get(externalKey);
      if (!localId) {
        const id = crypto.randomUUID();
        localId = id;
        upsertTaskCache({
          id,
          source: 'local',
          externalId: id,
          projectId: localProjectIds.get(`${task.source}:${task.projectId}`) ?? LOCAL_PROJECT_ID,
          parentId: parentLocalId,
          title: task.title,
          status: task.isCompleted ? 'completed' : 'incomplete',
          priority: task.priority,
          dueDate: task.dueDate,
          tags: JSON.stringify(task.tags),
          content: `${task.content ?? ''}${task.content ? '\n' : ''}external:${externalKey}`,
          rawJson: JSON.stringify({ importedFrom: externalKey }),
          lastSyncedAt: now,
          createdAt: task.createdAt ?? now,
          updatedAt: now,
        });
        existing.set(externalKey, localId);
        imported++;
      }
      for (const child of task.children ?? []) visit(child, localId ?? null);
    };
    tasks.forEach((task) => visit(task));
    return imported;
  },

  mergeCloudSnapshot(projects: readonly SyncedTaskProject[], tasks: readonly SyncedTask[]): number {
    ensureInbox();
    const now = Date.now();
    projects.forEach((project, index) => {
      upsertLocalTaskProject({
        id: project.id,
        name: project.name,
        color: project.color,
        sortOrder: index + 1,
        createdAt: now,
        updatedAt: now,
      });
    });
    const current = new Map(listTaskCache('local').map((task) => [task.id, task]));
    let changed = 0;
    for (const task of tasks) {
      if (task.source !== 'local') continue;
      const existing = current.get(task.id);
      if (existing && (existing.updatedAt ?? 0) >= (task.updatedAt ?? 0)) continue;
      upsertTaskCache({
        id: task.id,
        source: 'local',
        externalId: task.id,
        projectId: task.projectId,
        parentId: task.parentId,
        title: task.title,
        status: task.isCompleted ? 'completed' : (task.status ?? 'incomplete'),
        priority: task.priority,
        dueDate: task.dueDate,
        tags: JSON.stringify(task.tags),
        content: existing?.content ?? null,
        rawJson: existing?.rawJson ?? null,
        lastSyncedAt: now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: task.updatedAt ?? now,
      });
      changed++;
    }
    return changed;
  },

  search(query: string): Task[] {
    if (!query.trim()) return this.list();
    return searchTaskCache(query, 'local').map(cacheToTask);
  },

  getById(id: string): Task | null {
    const all = listTaskCache('local');
    const c = all.find((t) => t.id === id || t.externalId === id);
    return c ? cacheToTask(c) : null;
  },

  complete(id: string): Task {
    return this.setCompleted(id, true);
  },

  setCompleted(id: string, completed: boolean): Task {
    const all = listTaskCache('local');
    const c = all.find((t) => t.id === id || t.externalId === id);
    if (!c) throw new Error(`本地任务不存在: ${id}`);
    c.status = completed ? 'completed' : 'incomplete';
    c.updatedAt = Date.now();
    upsertTaskCache(c);
    logger.info('tasks:local', `${completed ? 'completed' : 'reopened'} local task: ${c.title}`);
    return cacheToTask(c);
  },
};

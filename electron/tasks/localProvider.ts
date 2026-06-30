// 本地任务 Provider - 在 tasks_cache 中管理本地任务（source='local'）
import crypto from 'node:crypto';
import {
  upsertTaskCache,
  listTaskCache,
  searchTaskCache,
} from '../db/index.js';
import { logger } from '../logger.js';
import type { Task, TaskCache, TaskSource } from '@shared/types';

const LOCAL_PROJECT_ID = 'local-inbox';

function cacheToTask(c: TaskCache): Task {
  return {
    id: c.id,
    source: c.source,
    externalId: c.externalId,
    projectId: c.projectId,
    title: c.title,
    status: c.status,
    priority: c.priority,
    dueDate: c.dueDate,
    tags: c.tags ? JSON.parse(c.tags) : [],
    content: c.content,
    isCompleted: c.status === 'completed',
  };
}

export const LocalTaskProvider = {
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
    const all = listTaskCache('local');
    const c = all.find((t) => t.id === id || t.externalId === id);
    if (!c) throw new Error(`本地任务不存在: ${id}`);
    c.status = 'completed';
    c.updatedAt = Date.now();
    upsertTaskCache(c);
    logger.info('tasks:local', `completed local task: ${c.title}`);
    return cacheToTask(c);
  },
};

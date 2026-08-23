import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskCache } from '../shared/types';

const localState = vi.hoisted(() => ({
  tasks: [] as TaskCache[],
  projects: [] as Array<{
    id: string;
    name: string;
    color: string | null;
    sortOrder: number;
    createdAt: number;
    updatedAt: number;
  }>,
}));

vi.mock('../electron/db/index.js', () => ({
  listTaskCache: vi.fn(() => localState.tasks),
  searchTaskCache: vi.fn(() => localState.tasks),
  upsertTaskCache: vi.fn((task: TaskCache) => {
    const index = localState.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) localState.tasks[index] = task;
    else localState.tasks.push(task);
  }),
  listLocalTaskProjects: vi.fn(() => localState.projects),
  upsertLocalTaskProject: vi.fn((project: (typeof localState.projects)[number]) => {
    const index = localState.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) localState.projects[index] = project;
    else localState.projects.push(project);
  }),
}));

vi.mock('../electron/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { LocalTaskProvider } from '../electron/tasks/localProvider';

beforeEach(() => {
  localState.tasks = [];
  localState.projects = [];
});

describe('local task completion mutations', () => {
  it('supports complete and reopen without replacing the task identity', () => {
    const created = LocalTaskProvider.create('本地学习任务');
    const completed = LocalTaskProvider.setCompleted(created.id, true);
    const reopened = LocalTaskProvider.setCompleted(created.id, false);

    expect(completed).toMatchObject({ id: created.id, status: 'completed', isCompleted: true });
    expect(reopened).toMatchObject({ id: created.id, status: 'incomplete', isCompleted: false });
    expect(localState.tasks).toHaveLength(1);
  });

  it('imports external tasks into the FocusLink-owned local identity once', () => {
    const external = {
      id: 'dida-1',
      source: 'ticktick' as const,
      externalId: 'dida-1',
      projectId: 'project-1',
      title: '迁移任务',
      status: 'pending',
      priority: 5,
      dueDate: null,
      tags: ['迁移'],
      content: '说明',
      isCompleted: false,
    };
    const project = {
      id: 'project-1',
      source: 'ticktick' as const,
      externalId: 'project-1',
      name: '学习',
      color: null,
    };

    expect(LocalTaskProvider.importExternal([project], [external])).toBe(1);
    expect(LocalTaskProvider.importExternal([project], [external])).toBe(0);
    expect(LocalTaskProvider.list()).toHaveLength(1);
    expect(LocalTaskProvider.list()[0]).toMatchObject({
      source: 'local',
      title: '迁移任务',
      priority: 5,
    });
  });

  it('fails precisely when the local task no longer exists', () => {
    expect(() => LocalTaskProvider.setCompleted('missing', false)).toThrow(/本地任务不存在/);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskCache } from '../shared/types';

const localState = vi.hoisted(() => ({ tasks: [] as TaskCache[] }));

vi.mock('../electron/db/index.js', () => ({
  listTaskCache: vi.fn(() => localState.tasks),
  searchTaskCache: vi.fn(() => localState.tasks),
  upsertTaskCache: vi.fn((task: TaskCache) => {
    const index = localState.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) localState.tasks[index] = task;
    else localState.tasks.push(task);
  }),
}));

vi.mock('../electron/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { LocalTaskProvider } from '../electron/tasks/localProvider';

beforeEach(() => {
  localState.tasks = [];
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

  it('fails precisely when the local task no longer exists', () => {
    expect(() => LocalTaskProvider.setCompleted('missing', false)).toThrow(/本地任务不存在/);
  });
});

import { describe, expect, it } from 'vitest';
import type { Task } from '../shared/types';
import { filterTaskTree, sortTaskTree } from '../src/features/tasks/taskTreeModel';

function task(id: string, input: Partial<Task> = {}): Task {
  return {
    id,
    source: 'ticktick',
    externalId: id,
    projectId: 'project-1',
    title: id,
    status: 'pending',
    isCompleted: false,
    completedAt: null,
    priority: null,
    dueDate: null,
    tags: [],
    content: null,
    ...input,
  };
}

describe('task tree sorting', () => {
  it('makes true an alias of smart and actually compares due-date values', () => {
    const source = [
      task('later', { dueDate: Date.parse('2026-08-20T00:00:00Z') }),
      task('none'),
      task('earlier', { dueDate: Date.parse('2026-07-20T00:00:00Z') }),
    ];

    expect(filterTaskTree(source, { sort: true }).tasks.map((item) => item.id)).toEqual([
      'earlier',
      'later',
      'none',
    ]);
    expect(filterTaskTree(source, { sort: 'due' }).tasks.map((item) => item.id)).toEqual([
      'earlier',
      'later',
      'none',
    ]);
  });

  it('sorts Chinese titles with numeric segments naturally', () => {
    const source = [task('c', { title: '任务 10' }), task('a', { title: '任务 2' })];
    expect(sortTaskTree(source, 'title').map((item) => item.title)).toEqual(['任务 2', '任务 10']);
  });

  it('sorts completed tasks newest first and leaves missing timestamps last', () => {
    const source = [
      task('old', { isCompleted: true, status: 'completed', completedAt: 100 }),
      task('unknown', { isCompleted: true, status: 'completed', completedAt: null }),
      task('new', { isCompleted: true, status: 'completed', completedAt: 300 }),
    ];
    expect(sortTaskTree(source, 'completed').map((item) => item.id)).toEqual([
      'new',
      'old',
      'unknown',
    ]);
  });

  it('applies the selected sort recursively without mutating the source tree', () => {
    const source = [
      task('parent', {
        children: [task('child-b', { title: '乙' }), task('child-a', { title: '甲' })],
      }),
    ];
    const sorted = sortTaskTree(source, 'title');

    expect(sorted[0].children?.map((item) => item.title)).toEqual(['甲', '乙']);
    expect(source[0].children?.map((item) => item.title)).toEqual(['乙', '甲']);
  });
});

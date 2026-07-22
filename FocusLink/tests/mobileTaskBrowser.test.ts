import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SyncedTask, SyncedTaskProject } from '../shared/sync/taskSnapshotProtocol';
import {
  ALL_PROJECTS,
  filterSyncedTasks,
  groupSyncedTasks,
  NO_PROJECT,
  projectNameForTask,
} from '../src/mobile/taskBrowserModel';
import { TaskBrowser } from '../src/mobile/TaskBrowser';

const tasks: SyncedTask[] = [
  makeTask({ id: 'chemistry', title: '整理化学错题', projectId: 'study', tags: ['复习'] }),
  makeTask({ id: 'english', title: 'English listening', projectId: 'study', tags: ['language'] }),
  makeTask({ id: 'inbox', title: '预约体检', projectId: null, tags: ['生活'] }),
  makeTask({ id: 'done', title: '已完成任务', projectId: 'study', isCompleted: true }),
];

const projects: SyncedTaskProject[] = [{ id: 'study', source: 'local', name: '学习', color: null }];

describe('mobile task browser model', () => {
  it('only returns open tasks for the all-project view', () => {
    expect(filterSyncedTasks(tasks, '', ALL_PROJECTS).map((task) => task.id)).toEqual([
      'chemistry',
      'english',
      'inbox',
    ]);
  });

  it('searches title and tags without case sensitivity', () => {
    expect(filterSyncedTasks(tasks, 'ENGLISH', ALL_PROJECTS).map((task) => task.id)).toEqual([
      'english',
    ]);
    expect(filterSyncedTasks(tasks, '复习', ALL_PROJECTS).map((task) => task.id)).toEqual([
      'chemistry',
    ]);
  });

  it('filters named and unassigned projects', () => {
    expect(filterSyncedTasks(tasks, '', 'study').map((task) => task.id)).toEqual([
      'chemistry',
      'english',
    ]);
    expect(filterSyncedTasks(tasks, '', NO_PROJECT).map((task) => task.id)).toEqual(['inbox']);
  });

  it('resolves project labels and keeps a fallback for stale snapshots', () => {
    expect(projectNameForTask(tasks[0], projects)).toBe('学习');
    expect(projectNameForTask(tasks[2], projects)).toBe('无清单');
    expect(projectNameForTask(makeTask({ projectId: 'removed' }), projects)).toBe('未知清单');
  });

  it('groups open tasks under collapsible project headers', () => {
    const groups = groupSyncedTasks(filterSyncedTasks(tasks, '', ALL_PROJECTS), projects);
    expect(groups.map((group) => [group.name, group.tasks.map((task) => task.id)])).toEqual([
      ['学习', ['chemistry', 'english']],
      ['无清单', ['inbox']],
    ]);
  });

  it('renders project groups collapsed before the user opens them', () => {
    const markup = renderToStaticMarkup(
      createElement(TaskBrowser, {
        tasks,
        projects,
        publishedAt: null,
        revision: 1,
        selectedTaskId: '',
        canStart: true,
        onSelect: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(markup).toContain('学习');
    expect(markup).toContain('无清单');
    expect(markup).not.toContain('整理化学错题');
    expect(markup).not.toContain('预约体检');
  });
});

function makeTask(overrides: Partial<SyncedTask> = {}): SyncedTask {
  return {
    id: 'task',
    source: 'local',
    projectId: null,
    title: '任务',
    status: null,
    priority: null,
    dueDate: null,
    tags: [],
    parentId: null,
    isCompleted: false,
    updatedAt: null,
    ...overrides,
  };
}

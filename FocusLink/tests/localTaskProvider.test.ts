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
  upsertTaskCaches: vi.fn((tasks: readonly TaskCache[]) => {
    for (const task of tasks) {
      const index = localState.tasks.findIndex((item) => item.id === task.id);
      if (index >= 0) localState.tasks[index] = task;
      else localState.tasks.push(task);
    }
  }),
  listLocalTaskProjects: vi.fn(() => localState.projects),
  upsertLocalTaskProject: vi.fn((project: (typeof localState.projects)[number]) => {
    const index = localState.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) localState.projects[index] = project;
    else localState.projects.push(project);
  }),
  deleteLocalTaskProjectAndMoveTasks: vi.fn(
    (projectId: string, inboxProjectId: string, updatedAt: number) => {
      const moved = localState.tasks.filter((task) => task.projectId === projectId);
      for (const task of moved) {
        const index = localState.tasks.findIndex((item) => item.id === task.id);
        localState.tasks[index] = { ...task, projectId: inboxProjectId, updatedAt };
      }
      localState.projects = localState.projects.filter((project) => project.id !== projectId);
      return moved.length;
    },
  ),
  restoreLocalTaskProjectDeletion: vi.fn(
    (project: (typeof localState.projects)[number], tasks: readonly TaskCache[]) => {
      localState.projects.push(project);
      for (const task of tasks) {
        const index = localState.tasks.findIndex((item) => item.id === task.id);
        if (index >= 0) localState.tasks[index] = task;
        else localState.tasks.push(task);
      }
    },
  ),
  removeStaleLocalTaskSnapshotRows: vi.fn(),
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
    expect(localState.tasks[0]?.parentId).toBeNull();
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

  it('keeps projects independent and moves a task subtree into exactly one target list', () => {
    const study = LocalTaskProvider.createProject('学习');
    const life = LocalTaskProvider.createProject('生活');
    const parent = LocalTaskProvider.create('数学复习', study.id);
    const now = Date.now();
    localState.tasks.push({
      ...localState.tasks[0],
      id: 'child-1',
      externalId: 'child-1',
      parentId: parent.id,
      title: '整理错题',
      createdAt: now,
      updatedAt: now,
    });

    const updatedProject = LocalTaskProvider.updateProject(study.id, { color: '#7957c7' });
    const moved = LocalTaskProvider.moveTask(parent.id, life.id);

    expect(updatedProject.color).toBe('#7957c7');
    expect(moved.projectId).toBe(life.id);
    expect(localState.tasks.filter((task) => task.projectId === life.id)).toHaveLength(2);
    expect(localState.tasks.find((task) => task.id === 'child-1')?.parentId).toBe(parent.id);
    expect(LocalTaskProvider.listProjects().find((project) => project.id === study.id)?.color).toBe(
      '#7957c7',
    );
  });

  it('routes quick capture to the inbox and keeps its system name fixed', () => {
    const captured = LocalTaskProvider.create('突然想到的事');
    expect(captured.projectId).toBe('local-inbox');
    expect(() => LocalTaskProvider.updateProject('local-inbox', { name: '其他名称' })).toThrow(
      /系统清单/,
    );
  });

  it('does not delete a list and moves its complete task subtree to the inbox', () => {
    const project = LocalTaskProvider.createProject('待整理');
    const parent = LocalTaskProvider.create('父任务', project.id);
    localState.tasks.push({
      ...localState.tasks[0],
      id: 'child-task',
      externalId: 'child-task',
      parentId: parent.id,
      projectId: project.id,
      title: '子任务',
    });

    const deletion = LocalTaskProvider.deleteProject(project.id);
    expect(deletion.movedTaskCount).toBe(2);
    expect(localState.projects.some((candidate) => candidate.id === project.id)).toBe(false);
    expect(localState.tasks.every((task) => task.projectId === 'local-inbox')).toBe(true);
    expect(() => LocalTaskProvider.deleteProject('local-inbox')).toThrow('收件箱不可删除');

    LocalTaskProvider.rollbackProjectDeletion(deletion);
    expect(LocalTaskProvider.listProjects().some((candidate) => candidate.id === project.id)).toBe(
      true,
    );
    expect(localState.tasks.filter((task) => task.projectId === project.id)).toHaveLength(2);
  });

  it('does not let a stale cloud snapshot overwrite a newly edited local list color', () => {
    const project = LocalTaskProvider.createProject('学习');
    LocalTaskProvider.updateProject(project.id, { color: '#7957c7' });
    const localUpdatedAt = localState.projects.find((item) => item.id === project.id)!.updatedAt;

    LocalTaskProvider.mergeCloudSnapshot(
      [{ id: project.id, source: 'local', name: '旧学习', color: '#c56a2d' }],
      [],
      localUpdatedAt - 1,
    );
    expect(LocalTaskProvider.listProjects().find((item) => item.id === project.id)).toMatchObject({
      name: '学习',
      color: '#7957c7',
    });

    LocalTaskProvider.mergeCloudSnapshot(
      [{ id: project.id, source: 'local', name: '跨端学习', color: '#c56a2d' }],
      [],
      localUpdatedAt + 1,
    );
    expect(LocalTaskProvider.listProjects().find((item) => item.id === project.id)).toMatchObject({
      name: '跨端学习',
      color: '#c56a2d',
    });
  });

  it('round-trips structured scheduling through the local cache and rolls completion', () => {
    const dueDate = Date.parse('2026-08-30T09:00:00+08:00');
    LocalTaskProvider.mergeCloudSnapshot(
      [{ id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' }],
      [
        {
          id: 'daily-local',
          source: 'local',
          projectId: 'local-inbox',
          title: '每日任务',
          status: 'incomplete',
          priority: 3,
          startDate: null,
          dueDate,
          recurrence: {
            timezone: 'Asia/Shanghai',
            frequency: 'daily',
            interval: 1,
            byWeekday: [],
            byMonthDay: [],
            endAt: null,
            count: 2,
            completedCount: 0,
            rollover: 'from_schedule',
          },
          tags: ['循环'],
          parentId: null,
          isCompleted: false,
          updatedAt: 1,
        },
      ],
      1,
    );
    expect(LocalTaskProvider.getById('daily-local')).toMatchObject({
      dueDate,
      recurrence: { frequency: 'daily', count: 2, completedCount: 0 },
    });

    const first = LocalTaskProvider.setCompleted('daily-local', true);
    expect(first).toMatchObject({
      isCompleted: false,
      recurrence: { completedCount: 1 },
    });
    expect(first.dueDate).toBe(Date.parse('2026-08-31T09:00:00+08:00'));
    const second = LocalTaskProvider.setCompleted('daily-local', true);
    expect(second).toMatchObject({ isCompleted: true, recurrence: { completedCount: 2 } });
    const repeated = LocalTaskProvider.setCompleted('daily-local', true);
    expect(repeated).toMatchObject({ isCompleted: true, recurrence: { completedCount: 2 } });
    const restored = LocalTaskProvider.setCompleted('daily-local', false);
    expect(restored).toMatchObject({ isCompleted: false, recurrence: { completedCount: 1 } });
  });

  it('preserves scheduling when an older peer sends a strict legacy task shape', () => {
    const dueDate = Date.parse('2026-08-30T09:00:00+08:00');
    LocalTaskProvider.mergeCloudSnapshot(
      [{ id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' }],
      [
        {
          id: 'legacy-preserve',
          source: 'local',
          projectId: 'local-inbox',
          title: '循环保留',
          status: 'incomplete',
          priority: null,
          dueDate,
          recurrence: {
            timezone: 'Asia/Shanghai',
            frequency: 'daily',
            interval: 1,
            byWeekday: [],
            byMonthDay: [],
            endAt: null,
            count: 4,
            completedCount: 1,
            rollover: 'from_schedule',
          },
          tags: [],
          parentId: null,
          isCompleted: false,
          updatedAt: 10,
        },
      ],
      10,
    );
    LocalTaskProvider.mergeCloudSnapshot(
      [{ id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' }],
      [
        {
          id: 'legacy-preserve',
          source: 'local',
          projectId: 'local-inbox',
          title: '旧端改名',
          status: 'incomplete',
          priority: 3,
          dueDate,
          tags: ['旧端'],
          parentId: null,
          isCompleted: false,
          updatedAt: 11,
        },
      ],
      11,
    );
    expect(LocalTaskProvider.getById('legacy-preserve')).toMatchObject({
      title: '旧端改名',
      priority: 3,
      recurrence: { count: 4, completedCount: 1 },
    });
  });

  it('fails precisely when the local task no longer exists', () => {
    expect(() => LocalTaskProvider.setCompleted('missing', false)).toThrow(/本地任务不存在/);
  });
});

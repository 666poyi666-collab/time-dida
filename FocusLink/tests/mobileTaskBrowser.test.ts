import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SyncedTask, SyncedTaskProject } from '../shared/sync/taskSnapshotProtocol';
import {
  ALL_PROJECTS,
  buildSyncedTaskForest,
  countSyncedTaskTree,
  filterSyncedTaskForest,
  filterSyncedTasks,
  findSyncedTaskPath,
  flattenSyncedTaskTree,
  groupSyncedTaskForest,
  groupSyncedTasks,
  NO_PROJECT,
  projectNameForTask,
} from '../src/mobile/taskBrowserModel';
import { createTaskBranchActions, isTaskBranchOpen, TaskBrowser } from '../src/mobile/TaskBrowser';
import {
  ANONYMOUS_BIOLOGY_EXPECTED_PREORDER,
  ANONYMOUS_BIOLOGY_PARENT_ID_TASKS,
  ANONYMOUS_BIOLOGY_PROJECTS,
} from './fixtures/anonymousBiologyParentIdTree';

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

  it('rebuilds flattened parent ids into a stable task forest', () => {
    const flat = [
      makeTask({ id: 'parent', title: '父任务', projectId: 'study' }),
      makeTask({ id: 'child', title: '子任务', projectId: 'study', parentId: 'parent' }),
      makeTask({ id: 'grandchild', title: '孙任务', projectId: 'study', parentId: 'child' }),
      makeTask({ id: 'orphan', title: '孤立任务', projectId: 'study', parentId: 'missing' }),
    ];
    const forest = buildSyncedTaskForest(flat);
    expect(forest.map((task) => task.id)).toEqual(['parent', 'orphan']);
    expect(forest[0].children[0].children[0].id).toBe('grandchild');
    expect(flattenSyncedTaskTree(flat).map(({ task, depth }) => [task.id, depth])).toEqual([
      ['parent', 0],
      ['child', 1],
      ['grandchild', 2],
      ['orphan', 0],
    ]);
  });

  it('renders every anonymous real-shape parentId task exactly once with its full path', () => {
    const forest = buildSyncedTaskForest(ANONYMOUS_BIOLOGY_PARENT_ID_TASKS);
    const entries = flattenSyncedTaskTree(ANONYMOUS_BIOLOGY_PARENT_ID_TASKS);
    const renderedIds = entries.map(({ task }) => task.id);

    expect(renderedIds).toEqual(ANONYMOUS_BIOLOGY_EXPECTED_PREORDER);
    expect(new Set(renderedIds).size).toBe(ANONYMOUS_BIOLOGY_PARENT_ID_TASKS.length);
    expect(countSyncedTaskTree(forest)).toBe(ANONYMOUS_BIOLOGY_PARENT_ID_TASKS.length);
    expect(findSyncedTaskPath(forest, 'anonymous-deep-a-1-a-i')?.map((task) => task.title)).toEqual(
      ['匿名主任务 A', '匿名子任务 A-1', '匿名叶任务 A-1-a', '匿名叶任务 A-1-a-i'],
    );

    const groups = groupSyncedTaskForest(forest, ANONYMOUS_BIOLOGY_PROJECTS);
    expect(groups).toHaveLength(1);
    expect(countSyncedTaskTree(groups[0].tasks)).toBe(ANONYMOUS_BIOLOGY_PARENT_ID_TASKS.length);
  });

  it('retains the complete ancestor chain when a deep parentId descendant matches search', () => {
    const filtered = filterSyncedTaskForest(
      ANONYMOUS_BIOLOGY_PARENT_ID_TASKS,
      'A-1-a-i',
      ALL_PROJECTS,
    );

    expect(flattenForest(filtered).map((task) => task.id)).toEqual([
      'anonymous-root-a',
      'anonymous-child-a-1',
      'anonymous-leaf-a-1-a',
      'anonymous-deep-a-1-a-i',
    ]);
  });

  it('promotes open descendants instead of losing them behind a completed parent', () => {
    const filtered = filterSyncedTaskForest(
      [
        makeTask({ id: 'completed-parent', isCompleted: true }),
        makeTask({ id: 'open-child', parentId: 'completed-parent' }),
      ],
      '',
      ALL_PROJECTS,
    );

    expect(flattenForest(filtered).map((task) => task.id)).toEqual(['open-child']);
    expect(filtered[0].hiddenAncestorTitles).toEqual(['任务']);
  });

  it('renders the hidden completed-parent title in a promoted descendant path', () => {
    const completedParentTasks = [
      makeTask({
        id: 'completed-parent',
        title: '已完成父任务',
        projectId: 'study',
        isCompleted: true,
      }),
      makeTask({
        id: 'open-child',
        title: '仍待办子任务',
        projectId: 'study',
        parentId: 'completed-parent',
      }),
    ];
    const markup = renderToStaticMarkup(
      createElement(TaskBrowser, {
        tasks: completedParentTasks,
        projects,
        publishedAt: null,
        revision: 3,
        selectedTaskId: 'open-child',
        canStart: true,
        onSelect: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup).toContain('父级 学习 / 已完成父任务');
    expect(markup).not.toContain('aria-label="选择 已完成父任务"');
  });

  it('degrades missing and cyclic parent links to roots without duplicates or loss', () => {
    const malformed = [
      makeTask({ id: 'orphan', parentId: 'missing' }),
      makeTask({ id: 'cycle-a', parentId: 'cycle-b' }),
      makeTask({ id: 'cycle-b', parentId: 'cycle-a' }),
      makeTask({ id: 'self-cycle', parentId: 'self-cycle' }),
    ];
    const renderedIds = flattenForest(buildSyncedTaskForest(malformed)).map((task) => task.id);

    expect(renderedIds).toEqual(['orphan', 'cycle-a', 'cycle-b', 'self-cycle']);
    expect(new Set(renderedIds).size).toBe(malformed.length);
  });

  it('renders checklist children as nested rows instead of project-level peers', () => {
    const nestedTasks = [
      makeTask({ id: 'parent', title: '父任务', projectId: 'study' }),
      makeTask({ id: 'child', title: '子任务', projectId: 'study', parentId: 'parent' }),
    ];
    const markup = renderToStaticMarkup(
      createElement(TaskBrowser, {
        tasks: nestedTasks,
        projects,
        publishedAt: null,
        revision: 2,
        selectedTaskId: 'parent',
        canStart: true,
        onSelect: () => undefined,
        onStart: () => undefined,
      }),
    );
    expect(markup).toContain('task-children');
    expect(markup).toContain('data-depth="1"');
    expect(markup).toContain('1 项子任务');
  });

  it('shows the anonymous deep task with an explicit full parent path', () => {
    const markup = renderToStaticMarkup(
      createElement(TaskBrowser, {
        tasks: ANONYMOUS_BIOLOGY_PARENT_ID_TASKS,
        projects: ANONYMOUS_BIOLOGY_PROJECTS,
        publishedAt: null,
        revision: 8,
        selectedTaskId: 'anonymous-deep-a-1-a-i',
        canStart: true,
        onSelect: () => undefined,
        onStart: () => undefined,
      }),
    );

    expect(markup).toContain(
      '父路径：匿名生物清单 / 匿名主任务 A / 匿名子任务 A-1 / 匿名叶任务 A-1-a',
    );
    expect(markup).toContain(
      '父级 匿名生物清单 / 匿名主任务 A / 匿名子任务 A-1 / 匿名叶任务 A-1-a',
    );
    expect(markup).toContain('data-depth="3"');
  });

  it('keeps expand, select and start as three isolated actions', () => {
    const task = ANONYMOUS_BIOLOGY_PARENT_ID_TASKS[0];
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    const onStart = vi.fn();
    const actions = createTaskBranchActions(task, 'local:anonymous-root-a', {
      onToggle,
      onSelect,
      onStart,
    });

    actions.toggle();
    expect(onToggle).toHaveBeenCalledWith('local:anonymous-root-a');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();

    actions.select();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(task);
    expect(onStart).not.toHaveBeenCalled();

    actions.start();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(task);
  });

  it('reopens the selected ancestor chain without overriding unrelated manual folds', () => {
    const collapsed = new Set(['local:root', 'local:other']);
    const selectedPath = new Set(['local:root', 'local:child']);

    expect(isTaskBranchOpen('local:root', collapsed, selectedPath, false)).toBe(true);
    expect(isTaskBranchOpen('local:child', collapsed, selectedPath, false)).toBe(true);
    expect(isTaskBranchOpen('local:other', collapsed, selectedPath, false)).toBe(false);
    expect(isTaskBranchOpen('local:other', collapsed, selectedPath, true)).toBe(true);
  });

  it('keeps selection on the task page while start alone returns to focus', () => {
    const appSource = fs.readFileSync(
      new URL('../src/mobile/MobileApp.tsx', import.meta.url),
      'utf8',
    );
    expect(appSource).toContain(`onSelect={(task) => {
                  setSelectedTaskId(task.id);
                  setTitleDraft(task.title);
                }}`);
    expect(appSource).toContain(`onStart={(task) => {
                  setSelectedTaskId(task.id);
                  setTitleDraft(task.title);
                  setActiveView('focus');`);
  });

  it('uses one cloud task-tree disclosure instead of the old select plus browse row', () => {
    const consoleSource = fs.readFileSync(
      new URL('../src/mobile/FocusConsole.tsx', import.meta.url),
      'utf8',
    );

    expect(consoleSource).toContain('从云端任务清单选择');
    expect(consoleSource).toContain('className="focus-task-disclosure"');
    expect(consoleSource).toContain('轻触展开项目与父子任务');
    expect(consoleSource).not.toContain('<select\n                    id="focus-task"');
    expect(consoleSource).not.toContain('从电脑任务清单选择');
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

function flattenForest(
  nodes: readonly ReturnType<typeof buildSyncedTaskForest>[number][],
): SyncedTask[] {
  return nodes.flatMap((node) => [node, ...flattenForest(node.children)]);
}

import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SyncedTask, SyncedTaskProject } from '../shared/sync/taskSnapshotProtocol';
import { TaskBrowser } from '../src/mobile/TaskBrowser';

describe('FocusLink list ownership UI', () => {
  it('wires desktop list color editing, drag targets and explicit move IPC', () => {
    const workspace = fs.readFileSync(
      new URL('../src/features/tasks/TaskWorkspace.tsx', import.meta.url),
      'utf8',
    );
    const preload = fs.readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    expect(workspace).toContain('TASK_PROJECT_COLOR_PALETTE.map');
    expect(workspace).toContain('application/x-focuslink-task');
    expect(workspace).toContain('window.focuslink.tasks.moveTask(task.id, projectId)');
    expect(workspace).toContain('window.focuslink.tasks.deleteProject(project.id)');
    expect(preload).toContain("ipcRenderer.invoke('tasks:update-project'");
    expect(preload).toContain("ipcRenderer.invoke('tasks:move'");
    expect(preload).toContain("ipcRenderer.invoke('tasks:delete-project'");
  });

  it('renders one inbox identity and a mobile move control for local tasks', () => {
    const projects: SyncedTaskProject[] = [
      { id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' },
      { id: 'study', source: 'local', name: '学习', color: '#7957c7' },
    ];
    const tasks: SyncedTask[] = [
      {
        id: 'task-1',
        source: 'local',
        projectId: 'local-inbox',
        title: '整理错题',
        status: 'incomplete',
        priority: null,
        dueDate: null,
        tags: [],
        parentId: null,
        isCompleted: false,
        updatedAt: 1,
      },
    ];
    const markup = renderToStaticMarkup(
      createElement(TaskBrowser, {
        tasks,
        projects,
        publishedAt: 1,
        revision: 1,
        selectedTaskId: 'task-1',
        canStart: true,
        onSelect: () => undefined,
        onStart: () => undefined,
        onMoveTask: async () => undefined,
        onUpdateProject: async () => undefined,
      }),
    );
    // Quick add and task detail each expose their own explicit inbox destination.
    expect(markup.match(/<option value="local-inbox"/g)).toHaveLength(2);
    expect(markup).toContain('所属清单');
    expect(markup).toContain('<option value="study">学习</option>');
  });

  it('exposes a safe regular-list deletion control but never renders one for the inbox', () => {
    const browser = fs.readFileSync(
      new URL('../src/mobile/TaskBrowser.tsx', import.meta.url),
      'utf8',
    );
    expect(browser).toContain('onDeleteProject?:');
    expect(browser).toContain('isFocusLinkInboxProject(project.id)');
    expect(browser).toContain('删除清单（任务移到收件箱）');
  });
});

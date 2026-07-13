import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, Project, Task } from '../shared/types';

const serviceState = vi.hoisted(() => ({
  taskSource: 'local' as AppSettings['taskSource'],
  localTasks: [] as Task[],
  cliFound: true,
  cliProjects: [] as Project[],
  cliTasks: [] as Task[],
  cliListError: null as Error | null,
  cliSetCompleted: vi.fn(),
  oauthAuthenticated: false,
  oauthProjects: [] as Project[],
  oauthTasks: [] as Task[],
  oauthSetCompleted: vi.fn(),
}));

vi.mock('../electron/settingsStore.js', () => ({
  getSettings: vi.fn(() => ({
    taskSource: serviceState.taskSource,
    ticktick: { connected: false },
  })),
}));

vi.mock('../electron/tasks/localProvider.js', () => ({
  LocalTaskProvider: {
    list: vi.fn(() => serviceState.localTasks),
    setCompleted: vi.fn((id: string, completed: boolean) => ({
      ...serviceState.localTasks.find((task) => task.id === id),
      id,
      status: completed ? 'completed' : 'incomplete',
      isCompleted: completed,
    })),
  },
}));

vi.mock('../electron/tasks/cliProvider.js', () => ({
  detectCli: vi.fn(async () => ({ found: serviceState.cliFound })),
  ticktickCliProvider: {
    listProjects: vi.fn(async () => {
      if (serviceState.cliListError) throw serviceState.cliListError;
      return serviceState.cliProjects;
    }),
    listWorkspaceTasks: vi.fn(async () => serviceState.cliTasks),
    setTaskCompleted: serviceState.cliSetCompleted,
  },
}));

vi.mock('../electron/integrations/ticktick/oauthAdapter.js', () => ({
  ticktickAdapter: {
    get isAuthenticated() {
      return serviceState.oauthAuthenticated;
    },
    listProjects: vi.fn(async () => serviceState.oauthProjects),
    listWorkspaceTasks: vi.fn(async () => serviceState.oauthTasks),
    setTaskCompleted: serviceState.oauthSetCompleted,
  },
}));

import { refreshTaskWorkspace, setTaskCompleted } from '../electron/tasks/workspaceService';
import { ticktickCliProvider } from '../electron/tasks/cliProvider';

function makeTask(id: string, source: Task['source'] = 'local'): Task {
  return {
    id,
    source,
    externalId: id,
    projectId: source === 'local' ? 'local-inbox' : 'project-1',
    title: `任务 ${id}`,
    status: 'pending',
    isCompleted: false,
    priority: null,
    dueDate: null,
    tags: [],
    content: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceState.taskSource = 'local';
  serviceState.localTasks = [];
  serviceState.cliFound = true;
  serviceState.cliProjects = [];
  serviceState.cliTasks = [];
  serviceState.cliListError = null;
  serviceState.cliSetCompleted.mockReset();
  serviceState.oauthAuthenticated = false;
  serviceState.oauthProjects = [];
  serviceState.oauthTasks = [];
  serviceState.oauthSetCompleted.mockReset();
});

describe('task workspace service', () => {
  it('treats the legacy local setting as automatic and returns the CLI workspace', async () => {
    serviceState.taskSource = 'local';
    serviceState.oauthAuthenticated = true;
    serviceState.cliProjects = [
      {
        id: 'project-1',
        source: 'ticktick',
        externalId: 'project-1',
        name: '学习',
        color: null,
      },
    ];
    serviceState.cliTasks = [makeTask('cloud-1', 'ticktick')];
    const result = await refreshTaskWorkspace({
      projectId: 'project-1',
      includeCompleted: true,
      completedDays: 14,
      force: true,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        provider: 'dida-cli',
        projects: serviceState.cliProjects,
        tasks: serviceState.cliTasks,
        refreshedAt: expect.any(Number),
      },
    });
    expect(ticktickCliProvider.listWorkspaceTasks).toHaveBeenCalledWith('project-1', {
      projectId: 'project-1',
      includeCompleted: true,
      completedDays: 14,
      force: true,
    });
  });

  it('returns an explicit CLI detection failure instead of an empty task list', async () => {
    serviceState.taskSource = 'ticktick-cli';
    serviceState.cliFound = false;
    await expect(refreshTaskWorkspace()).resolves.toEqual({
      ok: false,
      error: '未找到 dida CLI，且 TickTick OAuth 尚未登录。请先配置一种滴答连接方式。',
    });
  });

  it('falls back to OAuth only when the CLI is unavailable', async () => {
    serviceState.taskSource = 'local';
    serviceState.cliFound = false;
    serviceState.oauthAuthenticated = true;
    serviceState.oauthTasks = [makeTask('oauth-1', 'ticktick')];

    await expect(refreshTaskWorkspace({ includeCompleted: false })).resolves.toMatchObject({
      ok: true,
      data: { provider: 'ticktick-oauth', tasks: serviceState.oauthTasks },
    });
  });

  it('keeps the provider error detail when a CLI refresh fails', async () => {
    serviceState.taskSource = 'ticktick-cli';
    serviceState.cliListError = new Error('HTTP 429 Too Many Requests');
    await expect(refreshTaskWorkspace()).resolves.toEqual({
      ok: false,
      error: '滴答 CLI 刷新失败：HTTP 429 Too Many Requests',
    });
  });

  it('routes cloud completion mutations to dida and returns the new renderer state', async () => {
    serviceState.taskSource = 'ticktick-cli';
    const task = makeTask('cloud-1', 'ticktick');
    const updated = await setTaskCompleted(task, true);

    expect(serviceState.cliSetCompleted).toHaveBeenCalledWith(task, true);
    expect(updated).toMatchObject({
      id: 'cloud-1',
      status: 'completed',
      isCompleted: true,
      completedAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
  });

  it('clears completedAt when a cloud task is restored', async () => {
    const task = { ...makeTask('cloud-2', 'ticktick'), isCompleted: true, completedAt: 123 };
    const updated = await setTaskCompleted(task, false);

    expect(serviceState.cliSetCompleted).toHaveBeenCalledWith(task, false);
    expect(updated).toMatchObject({ isCompleted: false, completedAt: null });
  });
});

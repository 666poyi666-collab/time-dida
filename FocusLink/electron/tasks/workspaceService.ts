import type { Task, TaskWorkspaceRefreshOptions } from '@shared/types';
import type { IpcResult, TaskWorkspaceRefreshData } from '@shared/ipc/api';
import { ticktickAdapter } from '../integrations/ticktick/oauthAdapter.js';
import { detectCli, ticktickCliProvider } from './cliProvider.js';
import { LocalTaskProvider } from './localProvider.js';
import { publishDeviceTaskSnapshot, readDeviceTaskSnapshot } from '../sync/deviceSyncService.js';

export async function setTaskCompleted(task: Task, completed: boolean): Promise<Task> {
  if (task.source === 'local') return LocalTaskProvider.setCompleted(task.id, completed);

  // CLI/OAuth 是同一滴答任务源的连接方式，而不是 UI 中的任务来源。
  // 旧设置即使仍为 local，也按 CLI 优先、OAuth 后备解析，避免把云任务困在旧模式里。
  const detected = await detectCli();
  if (detected.found) {
    await ticktickCliProvider.setTaskCompleted(task, completed);
  } else if (ticktickAdapter.isAuthenticated) {
    await ticktickAdapter.setTaskCompleted(task, completed);
  } else {
    throw new Error(
      `没有可用的滴答清单连接，无法${completed ? '完成' : '恢复'}该任务。请先刷新或检查连接。`,
    );
  }
  const changedAt = Date.now();
  return {
    ...task,
    status: completed ? 'completed' : 'pending',
    isCompleted: completed,
    completedAt: completed
      ? task.isCompleted
        ? (task.completedAt ?? changedAt)
        : changedAt
      : null,
    updatedAt: changedAt,
  };
}

export async function refreshTaskWorkspace(
  options: TaskWorkspaceRefreshOptions = {},
): Promise<IpcResult<TaskWorkspaceRefreshData>> {
  const selectedProjectId = options.projectId?.trim() || undefined;
  const normalizedOptions = { ...options, projectId: selectedProjectId };
  let providerLabel = 'FocusLink 任务库';
  try {
    const cloud = await readDeviceTaskSnapshot();
    if (cloud?.snapshot) {
      LocalTaskProvider.mergeCloudSnapshot(cloud.snapshot.projects, cloud.snapshot.tasks);
    }
    const localTasks = LocalTaskProvider.list();
    if (localTasks.length > 0) {
      const projects = LocalTaskProvider.listProjects();
      const tasks = localTasks.filter(
        (task) => !selectedProjectId || task.projectId === selectedProjectId,
      );
      const refreshedAt = Date.now();
      const result = {
        ok: true,
        data: {
          provider: 'focuslink-local',
          projects,
          tasks,
          refreshedAt,
        },
      } satisfies IpcResult<TaskWorkspaceRefreshData>;
      void publishDeviceTaskSnapshot(projects, tasks, refreshedAt);
      return result;
    }

    const detected = await detectCli();
    if (detected.found) {
      providerLabel = '滴答 CLI';
      const projects = await ticktickCliProvider.listProjects();
      const tasks = await ticktickCliProvider.listWorkspaceTasks(
        selectedProjectId,
        normalizedOptions,
      );
      if (typeof LocalTaskProvider.importExternal !== 'function') {
        const refreshedAt = Date.now();
        void publishDeviceTaskSnapshot(projects, tasks, refreshedAt);
        return {
          ok: true,
          data: { provider: 'dida-cli', projects, tasks, refreshedAt },
        };
      }
      LocalTaskProvider.importExternal(projects, tasks);
      const localProjects = LocalTaskProvider.listProjects();
      const importedLocalTasks = LocalTaskProvider.list();
      if (localProjects.length === 0 && importedLocalTasks.length === 0) {
        const refreshedAt = Date.now();
        void publishDeviceTaskSnapshot(projects, tasks, refreshedAt);
        return { ok: true, data: { provider: 'dida-cli', projects, tasks, refreshedAt } };
      }
      const refreshedAt = Date.now();
      const result = {
        ok: true,
        data: {
          provider: 'focuslink-local',
          projects: localProjects,
          tasks: importedLocalTasks,
          refreshedAt,
        },
      } satisfies IpcResult<TaskWorkspaceRefreshData>;
      void publishDeviceTaskSnapshot(localProjects, importedLocalTasks, refreshedAt);
      return result;
    }

    if (!ticktickAdapter.isAuthenticated) {
      return {
        ok: false,
        error: '未找到 dida CLI，且 TickTick OAuth 尚未登录。请先配置一种滴答连接方式。',
      };
    }
    providerLabel = 'TickTick OAuth';
    const projects = await ticktickAdapter.listProjects();
    const tasks = await ticktickAdapter.listWorkspaceTasks(
      selectedProjectId,
      projects,
      normalizedOptions,
    );
    if (typeof LocalTaskProvider.importExternal !== 'function') {
      const refreshedAt = Date.now();
      void publishDeviceTaskSnapshot(projects, tasks, refreshedAt);
      return {
        ok: true,
        data: { provider: 'ticktick-oauth', projects, tasks, refreshedAt },
      };
    }
    LocalTaskProvider.importExternal(projects, tasks);
    const localProjects = LocalTaskProvider.listProjects();
    const importedLocalTasks = LocalTaskProvider.list();
    if (localProjects.length === 0 && importedLocalTasks.length === 0) {
      const refreshedAt = Date.now();
      void publishDeviceTaskSnapshot(projects, tasks, refreshedAt);
      return { ok: true, data: { provider: 'ticktick-oauth', projects, tasks, refreshedAt } };
    }
    const refreshedAt = Date.now();
    const result = {
      ok: true,
      data: {
        provider: 'focuslink-local',
        projects: localProjects,
        tasks: importedLocalTasks,
        refreshedAt,
      },
    } satisfies IpcResult<TaskWorkspaceRefreshData>;
    void publishDeviceTaskSnapshot(localProjects, importedLocalTasks, refreshedAt);
    return result;
  } catch (error) {
    return {
      ok: false,
      error: `${providerLabel} 刷新失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

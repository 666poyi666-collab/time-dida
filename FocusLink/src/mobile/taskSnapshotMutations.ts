import type { SyncedTaskProject, TaskSnapshotPayload } from '@shared/sync/taskSnapshotProtocol';
import { fingerprintDeviceSyncValue } from '@shared/sync/deviceProtocol';
import {
  defaultTaskProjectColor,
  FOCUSLINK_INBOX_PROJECT_ID,
  isFocusLinkInboxProject,
  normalizeTaskProjectColor,
} from '@shared/taskProjectPolicy';

/** Stable across a response-loss retry, but changes with task intent or observed revision. */
export function mobileTaskCompletionOperationId(input: {
  deviceId: string;
  taskId: string;
  completed: boolean;
  expectedRevision: number;
}): string {
  return `mobile-task:${fingerprintDeviceSyncValue(input)}`;
}

export function createEmptyTaskSnapshot(publishedAt: number): TaskSnapshotPayload {
  return {
    publishedAt,
    projects: [
      {
        id: FOCUSLINK_INBOX_PROJECT_ID,
        source: 'local',
        name: '收件箱',
        color: defaultTaskProjectColor(0),
      },
    ],
    tasks: [],
  };
}

export function updateTaskSnapshotProject(
  snapshot: TaskSnapshotPayload,
  project: SyncedTaskProject,
  input: { name?: string; color?: string | null },
  publishedAt: number,
): TaskSnapshotPayload {
  if (project.source !== 'local') throw new Error('只能编辑 FocusLink 清单');
  if (isFocusLinkInboxProject(project.id)) throw new Error('收件箱不能重命名');
  if (!snapshot.projects.some((candidate) => candidate.id === project.id)) {
    throw new Error('FocusLink 清单不存在');
  }
  const name = input.name === undefined ? project.name : input.name.trim();
  if (!name) throw new Error('清单名称不能为空');
  return {
    ...snapshot,
    publishedAt,
    projects: snapshot.projects.map((candidate) =>
      candidate.id === project.id
        ? {
            ...candidate,
            name,
            color:
              input.color === undefined ? candidate.color : normalizeTaskProjectColor(input.color),
          }
        : candidate,
    ),
  };
}

/** Delete a user list while preserving every task/subtask in the canonical inbox. */
export function deleteTaskSnapshotProject(
  snapshot: TaskSnapshotPayload,
  project: SyncedTaskProject,
  publishedAt: number,
): { snapshot: TaskSnapshotPayload; movedTaskCount: number } {
  if (project.source !== 'local') throw new Error('只能删除 FocusLink 清单');
  if (isFocusLinkInboxProject(project.id)) throw new Error('收件箱不可删除');
  if (!snapshot.projects.some((candidate) => candidate.id === project.id)) {
    throw new Error('FocusLink 清单不存在');
  }
  const movedTaskCount = snapshot.tasks.filter((task) => task.projectId === project.id).length;
  const projects = snapshot.projects.filter((candidate) => candidate.id !== project.id);
  if (!projects.some((candidate) => isFocusLinkInboxProject(candidate.id))) {
    projects.unshift({
      id: FOCUSLINK_INBOX_PROJECT_ID,
      source: 'local',
      name: '收件箱',
      color: normalizeTaskProjectColor(null),
    });
  }
  return {
    movedTaskCount,
    snapshot: {
      ...snapshot,
      publishedAt,
      projects,
      tasks: snapshot.tasks.map((task) =>
        task.projectId === project.id
          ? { ...task, projectId: FOCUSLINK_INBOX_PROJECT_ID, updatedAt: publishedAt }
          : task,
      ),
    },
  };
}

export function moveTaskSnapshotSubtree(
  snapshot: TaskSnapshotPayload,
  taskId: string,
  targetProjectId: string | null | undefined,
  publishedAt: number,
): TaskSnapshotPayload {
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error('FocusLink 任务不存在');
  if (task.source !== 'local') throw new Error('导入任务需先转为 FocusLink 任务');
  const projectId = targetProjectId || FOCUSLINK_INBOX_PROJECT_ID;
  if (
    !isFocusLinkInboxProject(projectId) &&
    !snapshot.projects.some((project) => project.id === projectId)
  ) {
    throw new Error('目标清单不存在');
  }
  const movingIds = new Set([task.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of snapshot.tasks) {
      if (candidate.parentId && movingIds.has(candidate.parentId) && !movingIds.has(candidate.id)) {
        movingIds.add(candidate.id);
        changed = true;
      }
    }
  }
  return {
    ...snapshot,
    publishedAt,
    tasks: snapshot.tasks.map((candidate) =>
      movingIds.has(candidate.id)
        ? {
            ...candidate,
            projectId,
            parentId: candidate.id === task.id && candidate.parentId ? null : candidate.parentId,
            updatedAt: publishedAt,
          }
        : candidate,
    ),
  };
}

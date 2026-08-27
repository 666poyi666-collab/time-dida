import type { Project, Task, TaskSource } from '../types';
import { fingerprintDeviceSyncValue } from './deviceProtocol';

export const TASK_SNAPSHOT_PROTOCOL_VERSION = 1 as const;
export const TASK_SNAPSHOT_PATH = '/sync/v2/tasks' as const;
export const TASK_SNAPSHOT_MAX_BODY_BYTES = 512 * 1024;
export const TASK_SNAPSHOT_MAX_TASKS = 5_000;
export const TASK_SNAPSHOT_MAX_PROJECTS = 500;
/** Keep list/color/move changes perceptibly cross-device without a dedicated task websocket. */
export const TASK_SNAPSHOT_REFRESH_INTERVAL_MS = 5_000;
/** Server accepts small client clock drift but never lets one future value freeze the register. */
export const TASK_SNAPSHOT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MAX_TEXT_LENGTH = 1_000;

export interface SyncedTaskProject {
  id: string;
  source: TaskSource;
  name: string;
  color: string | null;
}

export interface SyncedTask {
  id: string;
  source: TaskSource;
  projectId: string | null;
  title: string;
  status: string | null;
  priority: number | null;
  dueDate: number | null;
  tags: string[];
  parentId: string | null;
  isCompleted: boolean;
  updatedAt: number | null;
}

export interface TaskSnapshotPayload {
  publishedAt: number;
  projects: SyncedTaskProject[];
  tasks: SyncedTask[];
}

export interface TaskSnapshotPublishRequest {
  protocolVersion: typeof TASK_SNAPSHOT_PROTOCOL_VERSION;
  deviceId: string;
  snapshot: TaskSnapshotPayload;
}

export interface TaskSnapshotResponse {
  protocolVersion: typeof TASK_SNAPSHOT_PROTOCOL_VERSION;
  revision: number;
  sourceDeviceId: string | null;
  snapshot: TaskSnapshotPayload | null;
  serverTime: number;
}

export type TaskSnapshotFreshness = 'advance' | 'refresh' | 'stale' | 'inconsistent';

export interface TaskSnapshotReconciliation {
  freshness: TaskSnapshotFreshness;
  snapshot: TaskSnapshotResponse;
}

export function toTaskSnapshotPayload(
  projects: readonly Project[],
  tasks: readonly Task[],
  publishedAt: number,
): TaskSnapshotPayload {
  const flattened: SyncedTask[] = [];
  const visit = (task: Task, inheritedParentId: string | null) => {
    flattened.push({
      id: task.id,
      source: task.source,
      projectId: task.projectId,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      tags: [...task.tags],
      parentId: task.parentId ?? inheritedParentId,
      isCompleted: Boolean(task.isCompleted),
      updatedAt: task.updatedAt ?? null,
    });
    for (const child of task.children ?? []) visit(child, task.id);
  };
  for (const task of tasks) visit(task, null);
  return {
    publishedAt,
    projects: projects.map((project) => ({
      id: project.id,
      source: project.source,
      name: project.name,
      color: project.color,
    })),
    tasks: flattened,
  };
}

export function validateTaskSnapshotPayload(value: unknown): value is TaskSnapshotPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['publishedAt', 'projects', 'tasks'])) return false;
  if (!isTimestamp(value.publishedAt)) return false;
  if (!Array.isArray(value.projects) || value.projects.length > TASK_SNAPSHOT_MAX_PROJECTS) {
    return false;
  }
  if (!Array.isArray(value.tasks) || value.tasks.length > TASK_SNAPSHOT_MAX_TASKS) return false;
  const projectIds = new Set<string>();
  for (const project of value.projects) {
    if (
      !isRecord(project) ||
      !hasOnlyKeys(project, ['id', 'source', 'name', 'color']) ||
      !isId(project.id) ||
      !isSource(project.source) ||
      !isText(project.name) ||
      !(project.color === null || isText(project.color))
    ) {
      return false;
    }
    if (projectIds.has(project.id)) return false;
    projectIds.add(project.id);
  }
  const taskIds = new Set<string>();
  for (const task of value.tasks) {
    if (
      !isRecord(task) ||
      !hasOnlyKeys(task, [
        'id',
        'source',
        'projectId',
        'title',
        'status',
        'priority',
        'dueDate',
        'tags',
        'parentId',
        'isCompleted',
        'updatedAt',
      ]) ||
      !isId(task.id) ||
      !isSource(task.source) ||
      !isNullableId(task.projectId) ||
      !isText(task.title) ||
      !(task.status === null || isText(task.status)) ||
      !(task.priority === null || isFiniteNumber(task.priority)) ||
      !(task.dueDate === null || isTimestamp(task.dueDate)) ||
      !Array.isArray(task.tags) ||
      task.tags.length > 200 ||
      !task.tags.every(isText) ||
      !isNullableId(task.parentId) ||
      typeof task.isCompleted !== 'boolean' ||
      !(task.updatedAt === null || isTimestamp(task.updatedAt))
    ) {
      return false;
    }
    if (taskIds.has(task.id)) return false;
    taskIds.add(task.id);
  }
  return true;
}

export function validateTaskSnapshotPublishRequest(
  value: unknown,
): value is TaskSnapshotPublishRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['protocolVersion', 'deviceId', 'snapshot']) &&
    value.protocolVersion === TASK_SNAPSHOT_PROTOCOL_VERSION &&
    isId(value.deviceId) &&
    validateTaskSnapshotPayload(value.snapshot)
  );
}

/**
 * `publishedAt` is a client-provided ordering hint. Authorities must bound it against their own
 * clock before making it monotonic, otherwise a clock-skewed legacy client can freeze updates.
 */
export function isTaskSnapshotPublishedAtWithinFutureSkew(
  publishedAt: number,
  serverTime: number,
): boolean {
  return (
    isTimestamp(publishedAt) &&
    isTimestamp(serverTime) &&
    publishedAt <= serverTime + TASK_SNAPSHOT_MAX_FUTURE_SKEW_MS
  );
}

export function parseTaskSnapshotResponse(value: unknown): TaskSnapshotResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'protocolVersion',
      'revision',
      'sourceDeviceId',
      'snapshot',
      'serverTime',
    ]) ||
    value.protocolVersion !== TASK_SNAPSHOT_PROTOCOL_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !(value.sourceDeviceId === null || isId(value.sourceDeviceId)) ||
    !(value.snapshot === null || validateTaskSnapshotPayload(value.snapshot)) ||
    !isTimestamp(value.serverTime)
  ) {
    return null;
  }
  return value as unknown as TaskSnapshotResponse;
}

/**
 * Task snapshots are a server-owned monotonic register. A slow or cached response may refresh
 * timing metadata, but it must never replace a newer local revision. Equal revisions must carry
 * the same source and payload; otherwise the authority response is inconsistent and is ignored.
 */
export function reconcileTaskSnapshot(
  current: TaskSnapshotResponse | null,
  incoming: TaskSnapshotResponse,
): TaskSnapshotReconciliation {
  if (!current || incoming.revision > current.revision) {
    return { freshness: 'advance', snapshot: incoming };
  }
  if (incoming.revision < current.revision) {
    return { freshness: 'stale', snapshot: current };
  }
  const currentFingerprint = fingerprintDeviceSyncValue({
    sourceDeviceId: current.sourceDeviceId,
    snapshot: current.snapshot,
  });
  const incomingFingerprint = fingerprintDeviceSyncValue({
    sourceDeviceId: incoming.sourceDeviceId,
    snapshot: incoming.snapshot,
  });
  if (currentFingerprint !== incomingFingerprint) {
    return { freshness: 'inconsistent', snapshot: current };
  }
  return {
    freshness: 'refresh',
    snapshot: incoming.serverTime >= current.serverTime ? incoming : current,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function isNullableId(value: unknown): value is string | null {
  return value === null || isId(value);
}

function isSource(value: unknown): value is TaskSource {
  return value === 'local' || value === 'ticktick';
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
}

function isTimestamp(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

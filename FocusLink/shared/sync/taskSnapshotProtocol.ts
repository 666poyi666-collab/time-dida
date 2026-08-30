import type { Project, Task, TaskRecurrence, TaskRecurrenceDefinition, TaskSource } from '../types';
import { fingerprintDeviceSyncValue } from './deviceProtocol';
import { normalizeTaskProjectColor } from '../taskProjectPolicy';
import {
  completeTaskRecurrence,
  normalizeTaskRecurrence,
  normalizeTaskRecurrenceDefinition,
  restoreFinalTaskRecurrence,
} from '../taskRecurrence';

export const TASK_SNAPSHOT_PROTOCOL_VERSION = 1 as const;
export const TASK_SNAPSHOT_PATH = '/sync/v2/tasks' as const;
/**
 * A narrow mutation endpoint layered beside the legacy whole-snapshot register.
 * Old clients continue to GET/POST `/sync/v2/tasks`; clients that understand this
 * contract can perform an atomic CAS mutation without inventing another task store.
 */
export const TASK_SNAPSHOT_MUTATION_PATH = '/sync/v2/tasks/mutate' as const;
export const TASK_SNAPSHOT_CAPABILITY_HEADER = 'x-focuslink-task-capabilities' as const;
export const TASK_SNAPSHOT_SCHEDULING_CAPABILITY = 'task-scheduling-v1' as const;
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
  /** Missing only while parsing a legacy v1 snapshot; normalization emits explicit null. */
  startDate?: number | null;
  dueDate: number | null;
  /** Missing only while parsing a legacy v1 snapshot; normalization emits explicit null. */
  recurrence?: TaskRecurrence | null;
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

export type TaskSnapshotMutationKind =
  | 'create_project'
  | 'update_project'
  | 'delete_project'
  | 'create_task'
  | 'update_task'
  | 'set_task_completed'
  | 'delete_task'
  | 'move_task';

export interface CreateTaskProjectMutation {
  kind: 'create_project';
  projectId?: string;
  name: string;
  color?: string | null;
}

export interface UpdateTaskProjectMutation {
  kind: 'update_project';
  projectId: string;
  name?: string;
  color?: string | null;
}

export interface DeleteTaskProjectMutation {
  kind: 'delete_project';
  projectId: string;
}

export interface CreateTaskMutation {
  kind: 'create_task';
  taskId?: string;
  projectId?: string | null;
  parentId?: string | null;
  title: string;
  priority?: number | null;
  startDate?: number | null;
  dueDate?: number | null;
  recurrence?: TaskRecurrenceDefinition | null;
  tags?: string[];
}

export interface UpdateTaskMutation {
  kind: 'update_task';
  taskId: string;
  title?: string;
  projectId?: string | null;
  parentId?: string | null;
  priority?: number | null;
  startDate?: number | null;
  dueDate?: number | null;
  recurrence?: TaskRecurrenceDefinition | null;
  tags?: string[];
}

export interface SetTaskCompletedMutation {
  kind: 'set_task_completed';
  taskId: string;
  completed: boolean;
}

export interface DeleteTaskMutation {
  kind: 'delete_task';
  taskId: string;
}

export interface MoveTaskMutation {
  kind: 'move_task';
  taskId: string;
  projectId: string | null;
}

export type TaskSnapshotMutation =
  | CreateTaskProjectMutation
  | UpdateTaskProjectMutation
  | DeleteTaskProjectMutation
  | CreateTaskMutation
  | UpdateTaskMutation
  | SetTaskCompletedMutation
  | DeleteTaskMutation
  | MoveTaskMutation;

export interface TaskSnapshotMutationRequest {
  protocolVersion: typeof TASK_SNAPSHOT_PROTOCOL_VERSION;
  operationId: string;
  expectedRevision: number;
  /** Device id for normal clients, or a fixed redacted service label for MCP. */
  deviceId: string;
  mutation: TaskSnapshotMutation;
}

export interface TaskSnapshotMutationResult {
  kind: TaskSnapshotMutationKind;
  entityId: string;
  taskCount?: number;
  movedTaskCount?: number;
  deletedTaskCount?: number;
  projectId?: string | null;
  recurrenceRolled?: boolean;
  recurrenceExhausted?: boolean;
  nextDueDate?: number | null;
  completedCount?: number;
  /** Project removal always moves tasks to the inbox; task deletion is permanent. */
  safety: 'moved_to_inbox' | 'permanent_subtree_delete' | 'updated';
}

export interface TaskSnapshotMutationResponse extends TaskSnapshotResponse {
  operationId: string;
  status: 'applied' | 'duplicate';
  result: TaskSnapshotMutationResult;
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
      startDate: task.startDate ?? null,
      dueDate: task.dueDate,
      recurrence: task.recurrence ? normalizeTaskRecurrence(task.recurrence) : null,
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
    const recurrence =
      isRecord(task) && task.recurrence ? normalizeTaskRecurrence(task.recurrence) : null;
    if (
      !isRecord(task) ||
      !hasOnlyKeys(task, [
        'id',
        'source',
        'projectId',
        'title',
        'status',
        'priority',
        'startDate',
        'dueDate',
        'recurrence',
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
      !(task.priority === null || isPriority(task.priority)) ||
      !(task.startDate === undefined || task.startDate === null || isTimestamp(task.startDate)) ||
      !(task.dueDate === null || isTimestamp(task.dueDate)) ||
      !(task.recurrence === undefined || task.recurrence === null || recurrence !== null) ||
      (recurrence !== null && task.startDate == null && task.dueDate === null) ||
      (task.startDate != null && task.dueDate !== null && task.startDate > task.dueDate) ||
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

/**
 * Clone and validate scheduling values without adding keys to a legacy v1 wire shape. Hashing
 * uses `canonicalTaskSnapshotFingerprintPayload` so omission and explicit null remain equivalent
 * without exposing unknown keys to strict 0.12.104 readers.
 */
export function normalizeTaskSnapshotPayload(value: TaskSnapshotPayload): TaskSnapshotPayload {
  return {
    publishedAt: value.publishedAt,
    projects: value.projects.map((project) => ({ ...project })),
    tasks: value.tasks.map((task) => {
      const normalized: SyncedTask = { ...task, tags: [...task.tags] };
      if ('startDate' in task) normalized.startDate = task.startDate ?? null;
      if ('recurrence' in task) {
        normalized.recurrence = task.recurrence ? normalizeTaskRecurrence(task.recurrence) : null;
      }
      return normalized;
    }),
  };
}

/** Stable hash projection; unlike wire normalization it deliberately fills legacy omissions. */
export function canonicalTaskSnapshotFingerprintPayload(
  value: TaskSnapshotPayload,
): TaskSnapshotPayload {
  const normalized = normalizeTaskSnapshotPayload(value);
  return {
    ...normalized,
    tasks: normalized.tasks.map((task) => ({
      ...task,
      startDate: task.startDate ?? null,
      recurrence: task.recurrence ?? null,
    })),
  };
}

export function taskSnapshotSupportsScheduling(value: string | null | undefined): boolean {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .includes(TASK_SNAPSHOT_SCHEDULING_CAPABILITY);
}

/** Legacy 0.12.104 clients reject unknown task keys, even when their value is null. */
export function withoutTaskSchedulingFields(value: TaskSnapshotPayload): TaskSnapshotPayload {
  return {
    ...value,
    projects: value.projects.map((project) => ({ ...project })),
    tasks: value.tasks.map(({ startDate: _startDate, recurrence: _recurrence, ...task }) => ({
      ...task,
      tags: [...task.tags],
    })),
  };
}

/** Strip scheduling-only result keys for strict 0.12.104 mutation response readers. */
export function withoutTaskSchedulingMutationFields(
  value: TaskSnapshotMutationResponse,
): TaskSnapshotMutationResponse {
  const result = { ...value.result };
  delete result.recurrenceRolled;
  delete result.recurrenceExhausted;
  delete result.nextDueDate;
  delete result.completedCount;
  return {
    ...value,
    snapshot: value.snapshot === null ? null : withoutTaskSchedulingFields(value.snapshot),
    result,
  };
}

/** Preserve scheduling extensions when a legacy whole-snapshot writer cannot represent them. */
export function mergeLegacyTaskSchedulingFields(
  current: TaskSnapshotPayload | null,
  incoming: TaskSnapshotPayload,
): TaskSnapshotPayload {
  if (!current) return normalizeTaskSnapshotPayload(incoming);
  const currentTasks = new Map(current.tasks.map((task) => [task.id, task] as const));
  return {
    ...normalizeTaskSnapshotPayload(incoming),
    tasks: incoming.tasks.map((task) => {
      const previous = currentTasks.get(task.id);
      const merged: SyncedTask = {
        ...task,
        ...(!('startDate' in task) && previous && 'startDate' in previous
          ? { startDate: previous.startDate ?? null }
          : {}),
        ...(!('recurrence' in task) && previous && 'recurrence' in previous
          ? { recurrence: previous.recurrence ?? null }
          : {}),
        tags: [...task.tags],
      };
      if (!previous?.recurrence || 'recurrence' in task) return merged;
      if (merged.startDate == null && merged.dueDate === null) {
        merged.startDate = previous.startDate ?? null;
        merged.dueDate = previous.dueDate;
      }
      if (merged.isCompleted && !previous.isCompleted) {
        const completion = completeTaskRecurrence(
          {
            startDate: merged.startDate ?? null,
            dueDate: merged.dueDate,
            recurrence: previous.recurrence,
          },
          incoming.publishedAt,
        );
        merged.startDate = completion.startDate;
        merged.dueDate = completion.dueDate;
        merged.recurrence = completion.recurrence;
        merged.isCompleted = completion.exhausted;
        merged.status = completion.exhausted ? 'completed' : 'incomplete';
      } else if (!merged.isCompleted && previous.isCompleted) {
        merged.recurrence = restoreFinalTaskRecurrence(previous.recurrence);
      }
      return merged;
    }),
  };
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
  return {
    protocolVersion: TASK_SNAPSHOT_PROTOCOL_VERSION,
    revision: value.revision as number,
    sourceDeviceId: value.sourceDeviceId as string | null,
    snapshot:
      value.snapshot === null
        ? null
        : normalizeTaskSnapshotPayload(value.snapshot as TaskSnapshotPayload),
    serverTime: value.serverTime as number,
  };
}

export function validateTaskSnapshotMutationRequest(
  value: unknown,
): value is TaskSnapshotMutationRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'protocolVersion',
      'operationId',
      'expectedRevision',
      'deviceId',
      'mutation',
    ]) ||
    value.protocolVersion !== TASK_SNAPSHOT_PROTOCOL_VERSION ||
    !isOperationId(value.operationId) ||
    !isRevision(value.expectedRevision) ||
    !isId(value.deviceId) ||
    !validateTaskSnapshotMutation(value.mutation)
  ) {
    return false;
  }
  return true;
}

export function parseTaskSnapshotMutationResponse(
  value: unknown,
): TaskSnapshotMutationResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'protocolVersion',
      'revision',
      'sourceDeviceId',
      'snapshot',
      'serverTime',
      'operationId',
      'status',
      'result',
    ]) ||
    value.protocolVersion !== TASK_SNAPSHOT_PROTOCOL_VERSION ||
    !isRevision(value.revision) ||
    !(value.sourceDeviceId === null || isId(value.sourceDeviceId)) ||
    !(value.snapshot === null || validateTaskSnapshotPayload(value.snapshot)) ||
    !isTimestamp(value.serverTime) ||
    !isOperationId(value.operationId) ||
    (value.status !== 'applied' && value.status !== 'duplicate') ||
    !validateTaskSnapshotMutationResult(value.result)
  ) {
    return null;
  }
  return {
    protocolVersion: TASK_SNAPSHOT_PROTOCOL_VERSION,
    revision: value.revision as number,
    sourceDeviceId: value.sourceDeviceId as string | null,
    snapshot:
      value.snapshot === null
        ? null
        : normalizeTaskSnapshotPayload(value.snapshot as TaskSnapshotPayload),
    serverTime: value.serverTime as number,
    operationId: value.operationId as string,
    status: value.status as 'applied' | 'duplicate',
    result: value.result as unknown as TaskSnapshotMutationResult,
  };
}

/**
 * Apply one validated mutation to a task snapshot.  The function is deliberately pure so the
 * browser, Electron and Account DO all share the same parent/project/delete semantics.
 * `idFactory` is injectable for deterministic tests and server-side ID generation.
 */
export function applyTaskSnapshotMutation(
  source: TaskSnapshotPayload,
  mutation: TaskSnapshotMutation,
  publishedAt: number,
  idFactory: () => string = () => globalThis.crypto.randomUUID(),
): { snapshot: TaskSnapshotPayload; result: TaskSnapshotMutationResult } {
  if (!isTimestamp(publishedAt)) throw new Error('任务快照时间无效');
  const snapshot = normalizeTaskSnapshotPayload({ ...source, publishedAt });
  const findTask = (taskId: string) => snapshot.tasks.find((task) => task.id === taskId);
  const findProject = (projectId: string) =>
    snapshot.projects.find((project) => project.id === projectId);
  if (!findProject('local-inbox')) {
    // Older v1 snapshots may have represented inbox tasks with projectId=null and omitted the
    // synthetic project.  Materialize it before a mutation so new tasks and safe list deletion
    // always have a stable destination without rewriting any existing task identity.
    snapshot.projects.unshift({
      id: 'local-inbox',
      source: 'local',
      name: '收件箱',
      color: '#16899f',
    });
  }
  const ensureLocalProject = (projectId: string | null | undefined): string => {
    const resolved = projectId || 'local-inbox';
    const project = findProject(resolved);
    if (!project || project.source !== 'local') throw new Error('目标清单不存在');
    return resolved;
  };
  const ensureLocalTask = (taskId: string) => {
    const task = findTask(taskId);
    if (!task || task.source !== 'local') throw new Error('FocusLink 任务不存在');
    return task;
  };
  const validateParent = (taskId: string, parentId: string | null, projectId: string) => {
    if (parentId === null) return;
    if (parentId === taskId) throw new Error('任务不能成为自己的父任务');
    const parent = ensureLocalTask(parentId);
    if (parent.projectId !== projectId) throw new Error('父任务必须属于同一清单');
    const seen = new Set<string>([taskId]);
    let cursor: string | null = parent.id;
    while (cursor) {
      if (seen.has(cursor)) throw new Error('任务父子关系不能形成循环');
      seen.add(cursor);
      cursor = findTask(cursor)?.parentId ?? null;
    }
  };
  const markUpdated = (task: SyncedTask): SyncedTask => ({
    ...task,
    updatedAt: publishedAt,
  });
  const collectSubtree = (rootId: string): Set<string> => {
    const subtree = new Set([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of snapshot.tasks) {
        if (candidate.parentId && subtree.has(candidate.parentId) && !subtree.has(candidate.id)) {
          subtree.add(candidate.id);
          changed = true;
        }
      }
    }
    return subtree;
  };

  switch (mutation.kind) {
    case 'create_project': {
      const id = mutation.projectId ?? idFactory();
      if (!isId(id) || findProject(id)) throw new Error('清单标识已存在');
      const name = mutation.name.trim();
      if (!name) throw new Error('清单名称不能为空');
      snapshot.projects.push({
        id,
        source: 'local',
        name,
        color: normalizeTaskProjectColor(mutation.color),
      });
      return {
        snapshot,
        result: { kind: mutation.kind, entityId: id, safety: 'updated' },
      };
    }
    case 'update_project': {
      const project = findProject(mutation.projectId);
      if (!project || project.source !== 'local') throw new Error('FocusLink 清单不存在');
      if (mutation.projectId === 'local-inbox' && mutation.name !== undefined) {
        if (mutation.name.trim() !== project.name) throw new Error('收件箱不能重命名');
      }
      const name = mutation.name === undefined ? project.name : mutation.name.trim();
      if (!name) throw new Error('清单名称不能为空');
      project.name = name;
      if (mutation.color !== undefined) project.color = normalizeTaskProjectColor(mutation.color);
      return {
        snapshot,
        result: { kind: mutation.kind, entityId: project.id, safety: 'updated' },
      };
    }
    case 'delete_project': {
      if (mutation.projectId === 'local-inbox') throw new Error('收件箱不可删除');
      const project = findProject(mutation.projectId);
      if (!project || project.source !== 'local') throw new Error('FocusLink 清单不存在');
      const affected = snapshot.tasks.filter((task) => task.projectId === project.id);
      for (const task of affected) {
        task.projectId = 'local-inbox';
        task.updatedAt = publishedAt;
      }
      snapshot.projects = snapshot.projects.filter((candidate) => candidate.id !== project.id);
      return {
        snapshot,
        result: {
          kind: mutation.kind,
          entityId: project.id,
          movedTaskCount: affected.length,
          projectId: 'local-inbox',
          safety: 'moved_to_inbox',
        },
      };
    }
    case 'create_task': {
      const title = mutation.title.trim();
      if (!title) throw new Error('任务标题不能为空');
      const projectId = ensureLocalProject(mutation.projectId);
      const parentId = mutation.parentId ?? null;
      const startDate = mutation.startDate ?? null;
      const dueDate = mutation.dueDate ?? null;
      const recurrenceDefinition = mutation.recurrence
        ? normalizeTaskRecurrenceDefinition(mutation.recurrence)
        : null;
      const recurrence = recurrenceDefinition
        ? { ...recurrenceDefinition, completedCount: 0 }
        : null;
      validateTaskDates(startDate, dueDate, recurrence);
      const id = mutation.taskId ?? idFactory();
      if (!isId(id) || findTask(id)) throw new Error('任务标识已存在');
      validateParent(id, parentId, projectId);
      snapshot.tasks.push({
        id,
        source: 'local',
        projectId,
        title,
        status: 'incomplete',
        priority: mutation.priority ?? null,
        startDate,
        dueDate,
        recurrence,
        tags: [...(mutation.tags ?? [])],
        parentId,
        isCompleted: false,
        updatedAt: publishedAt,
      });
      return {
        snapshot,
        result: { kind: mutation.kind, entityId: id, projectId, safety: 'updated' },
      };
    }
    case 'update_task': {
      const task = ensureLocalTask(mutation.taskId);
      const previousProjectId = task.projectId;
      const projectId =
        mutation.projectId === undefined
          ? ensureLocalProject(task.projectId)
          : ensureLocalProject(mutation.projectId);
      const parentId =
        mutation.parentId === undefined ? (task.parentId ?? null) : mutation.parentId;
      validateParent(task.id, parentId, projectId);
      if (mutation.title !== undefined) {
        const title = mutation.title.trim();
        if (!title) throw new Error('任务标题不能为空');
        task.title = title;
      }
      if (mutation.priority !== undefined) task.priority = mutation.priority;
      if (mutation.startDate !== undefined) task.startDate = mutation.startDate;
      if (mutation.dueDate !== undefined) task.dueDate = mutation.dueDate;
      if (mutation.recurrence !== undefined) {
        const definition = mutation.recurrence
          ? normalizeTaskRecurrenceDefinition(mutation.recurrence)
          : null;
        task.recurrence = definition
          ? { ...definition, completedCount: task.recurrence?.completedCount ?? 0 }
          : null;
        if (
          task.recurrence &&
          task.recurrence.count !== null &&
          task.recurrence.completedCount > task.recurrence.count
        ) {
          throw new Error('循环总次数不能小于已完成次数');
        }
      }
      validateTaskDates(task.startDate ?? null, task.dueDate, task.recurrence ?? null);
      if (mutation.tags !== undefined) task.tags = [...mutation.tags];
      task.projectId = projectId;
      task.parentId = parentId;
      Object.assign(task, markUpdated(task));
      let taskCount: number | undefined;
      if (projectId !== previousProjectId) {
        // A project move must not leave descendants in a different list.
        const subtree = collectSubtree(task.id);
        for (const candidate of snapshot.tasks) {
          if (subtree.has(candidate.id))
            Object.assign(candidate, markUpdated({ ...candidate, projectId }));
        }
        taskCount = subtree.size;
      }
      return {
        snapshot,
        result: {
          kind: mutation.kind,
          entityId: task.id,
          projectId,
          ...(taskCount === undefined ? {} : { taskCount }),
          safety: 'updated',
        },
      };
    }
    case 'set_task_completed': {
      const task = ensureLocalTask(mutation.taskId);
      if (task.isCompleted === mutation.completed) {
        return {
          snapshot,
          result: {
            kind: mutation.kind,
            entityId: task.id,
            ...(task.recurrence
              ? {
                  recurrenceRolled: false,
                  recurrenceExhausted: task.isCompleted,
                  nextDueDate: null,
                  completedCount: task.recurrence.completedCount,
                }
              : {}),
            safety: 'updated',
          },
        };
      }
      if (task.recurrence && mutation.completed) {
        const completion = completeTaskRecurrence(
          {
            startDate: task.startDate ?? null,
            dueDate: task.dueDate,
            recurrence: task.recurrence,
          },
          publishedAt,
        );
        task.startDate = completion.startDate;
        task.dueDate = completion.dueDate;
        task.recurrence = completion.recurrence;
        task.isCompleted = completion.exhausted;
        task.status = completion.exhausted ? 'completed' : 'incomplete';
        Object.assign(task, markUpdated(task));
        return {
          snapshot,
          result: {
            kind: mutation.kind,
            entityId: task.id,
            recurrenceRolled: completion.rolled,
            recurrenceExhausted: completion.exhausted,
            nextDueDate: completion.rolled ? completion.dueDate : null,
            completedCount: completion.recurrence.completedCount,
            safety: 'updated',
          },
        };
      }
      if (task.recurrence && !mutation.completed && task.isCompleted) {
        task.recurrence = restoreFinalTaskRecurrence(task.recurrence);
      }
      task.isCompleted = mutation.completed;
      task.status = mutation.completed ? 'completed' : 'incomplete';
      Object.assign(task, markUpdated(task));
      return {
        snapshot,
        result: { kind: mutation.kind, entityId: task.id, safety: 'updated' },
      };
    }
    case 'delete_task': {
      ensureLocalTask(mutation.taskId);
      const deleting = collectSubtree(mutation.taskId);
      snapshot.tasks = snapshot.tasks.filter((task) => !deleting.has(task.id));
      return {
        snapshot,
        result: {
          kind: mutation.kind,
          entityId: mutation.taskId,
          deletedTaskCount: deleting.size,
          safety: 'permanent_subtree_delete',
        },
      };
    }
    case 'move_task': {
      const task = ensureLocalTask(mutation.taskId);
      const projectId = ensureLocalProject(mutation.projectId);
      const moving = collectSubtree(task.id);
      for (const candidate of snapshot.tasks) {
        if (moving.has(candidate.id)) {
          candidate.projectId = projectId;
          if (candidate.id === task.id) candidate.parentId = null;
          Object.assign(candidate, markUpdated(candidate));
        }
      }
      return {
        snapshot,
        result: {
          kind: mutation.kind,
          entityId: task.id,
          taskCount: moving.size,
          projectId,
          safety: 'updated',
        },
      };
    }
  }
}

function validateTaskSnapshotMutation(value: unknown): value is TaskSnapshotMutation {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'create_project':
      return (
        hasOnlyKeys(value, ['kind', 'projectId', 'name', 'color']) &&
        (value.projectId === undefined || isId(value.projectId)) &&
        isName(value.name) &&
        (value.color === undefined || value.color === null || isText(value.color))
      );
    case 'update_project':
      return (
        hasOnlyKeys(value, ['kind', 'projectId', 'name', 'color']) &&
        isId(value.projectId) &&
        (value.name === undefined || isName(value.name)) &&
        (value.color === undefined || value.color === null || isText(value.color)) &&
        (value.name !== undefined || value.color !== undefined)
      );
    case 'delete_project':
      return hasOnlyKeys(value, ['kind', 'projectId']) && isId(value.projectId);
    case 'create_task':
      return (
        hasOnlyKeys(value, [
          'kind',
          'taskId',
          'projectId',
          'parentId',
          'title',
          'priority',
          'startDate',
          'dueDate',
          'recurrence',
          'tags',
        ]) &&
        (value.taskId === undefined || isId(value.taskId)) &&
        isOptionalNullableId(value.projectId) &&
        isOptionalNullableId(value.parentId) &&
        isName(value.title) &&
        (value.priority === undefined || value.priority === null || isPriority(value.priority)) &&
        (value.startDate === undefined ||
          value.startDate === null ||
          isTimestamp(value.startDate)) &&
        (value.dueDate === undefined || value.dueDate === null || isTimestamp(value.dueDate)) &&
        (value.recurrence === undefined ||
          value.recurrence === null ||
          normalizeTaskRecurrenceDefinition(value.recurrence) !== null) &&
        (value.tags === undefined || isTags(value.tags))
      );
    case 'update_task':
      return (
        hasOnlyKeys(value, [
          'kind',
          'taskId',
          'title',
          'projectId',
          'parentId',
          'priority',
          'startDate',
          'dueDate',
          'recurrence',
          'tags',
        ]) &&
        isId(value.taskId) &&
        (value.title === undefined || isName(value.title)) &&
        isOptionalNullableId(value.projectId) &&
        isOptionalNullableId(value.parentId) &&
        (value.priority === undefined || value.priority === null || isPriority(value.priority)) &&
        (value.startDate === undefined ||
          value.startDate === null ||
          isTimestamp(value.startDate)) &&
        (value.dueDate === undefined || value.dueDate === null || isTimestamp(value.dueDate)) &&
        (value.recurrence === undefined ||
          value.recurrence === null ||
          normalizeTaskRecurrenceDefinition(value.recurrence) !== null) &&
        (value.tags === undefined || isTags(value.tags)) &&
        [
          'title',
          'projectId',
          'parentId',
          'priority',
          'startDate',
          'dueDate',
          'recurrence',
          'tags',
        ].some((key) => key in value)
      );
    case 'set_task_completed':
      return (
        hasOnlyKeys(value, ['kind', 'taskId', 'completed']) &&
        isId(value.taskId) &&
        typeof value.completed === 'boolean'
      );
    case 'delete_task':
      return hasOnlyKeys(value, ['kind', 'taskId']) && isId(value.taskId);
    case 'move_task':
      return (
        hasOnlyKeys(value, ['kind', 'taskId', 'projectId']) &&
        isId(value.taskId) &&
        isNullableId(value.projectId)
      );
    default:
      return false;
  }
}

function validateTaskDates(
  startDate: number | null,
  dueDate: number | null,
  recurrence: TaskRecurrence | null,
): void {
  if (startDate !== null && dueDate !== null && startDate > dueDate) {
    throw new Error('任务开始时间不能晚于截止时间');
  }
  if (recurrence && startDate === null && dueDate === null) {
    throw new Error('循环任务必须设置开始时间或截止时间');
  }
}

function validateTaskSnapshotMutationResult(value: unknown): value is TaskSnapshotMutationResult {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'kind',
      'entityId',
      'taskCount',
      'movedTaskCount',
      'deletedTaskCount',
      'projectId',
      'recurrenceRolled',
      'recurrenceExhausted',
      'nextDueDate',
      'completedCount',
      'safety',
    ]) &&
    typeof value.kind === 'string' &&
    isId(value.entityId) &&
    (value.taskCount === undefined || isRevision(value.taskCount)) &&
    (value.movedTaskCount === undefined || isRevision(value.movedTaskCount)) &&
    (value.deletedTaskCount === undefined || isRevision(value.deletedTaskCount)) &&
    (value.projectId === undefined || value.projectId === null || isId(value.projectId)) &&
    (value.recurrenceRolled === undefined || typeof value.recurrenceRolled === 'boolean') &&
    (value.recurrenceExhausted === undefined || typeof value.recurrenceExhausted === 'boolean') &&
    (value.nextDueDate === undefined ||
      value.nextDueDate === null ||
      isTimestamp(value.nextDueDate)) &&
    (value.completedCount === undefined || isRevision(value.completedCount)) &&
    (value.safety === 'moved_to_inbox' ||
      value.safety === 'permanent_subtree_delete' ||
      value.safety === 'updated')
  );
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
    snapshot:
      current.snapshot === null ? null : canonicalTaskSnapshotFingerprintPayload(current.snapshot),
  });
  const incomingFingerprint = fingerprintDeviceSyncValue({
    sourceDeviceId: incoming.sourceDeviceId,
    snapshot:
      incoming.snapshot === null
        ? null
        : canonicalTaskSnapshotFingerprintPayload(incoming.snapshot),
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

function isOptionalNullableId(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || isId(value);
}

function isOperationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function isPriority(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 5;
}

function isTags(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every((tag) => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 100)
  );
}

function isSource(value: unknown): value is TaskSource {
  return value === 'local' || value === 'ticktick';
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
}

function isTimestamp(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 8_640_000_000_000_000
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

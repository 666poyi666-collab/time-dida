import { describe, expect, it } from 'vitest';

import {
  applyTaskSnapshotMutation,
  parseTaskSnapshotMutationResponse,
  validateTaskSnapshotMutationRequest,
  validateTaskSnapshotPayload,
  canonicalTaskSnapshotFingerprintPayload,
  mergeLegacyTaskSchedulingFields,
  normalizeTaskSnapshotPayload,
  withoutTaskSchedulingFields,
  withoutTaskSchedulingMutationFields,
  type TaskSnapshotPayload,
} from '@shared/sync/taskSnapshotProtocol';
import {
  DEVICE_SYNC_MAX_TIMESTAMP_MS,
  fingerprintDeviceSyncValue,
} from '@shared/sync/deviceProtocol';
import type { TaskRecurrence } from '@shared/types';

const daily: TaskRecurrence = {
  timezone: 'Asia/Shanghai',
  frequency: 'daily',
  interval: 1,
  byWeekday: [],
  byMonthDay: [],
  endAt: null,
  count: 2,
  completedCount: 0,
  rollover: 'from_schedule',
};
const dailyDefinition = {
  timezone: daily.timezone,
  frequency: daily.frequency,
  interval: daily.interval,
  byWeekday: daily.byWeekday,
  byMonthDay: daily.byMonthDay,
  endAt: daily.endAt,
  count: daily.count,
  rollover: daily.rollover,
};

const base: TaskSnapshotPayload = {
  publishedAt: 1_720_000_000_000,
  projects: [
    { id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' },
    { id: 'study', source: 'local', name: '学习', color: '#2f6fed' },
    { id: 'life', source: 'local', name: '生活', color: '#c56a2d' },
  ],
  tasks: [
    task('parent', 'study'),
    { ...task('child', 'study'), parentId: 'parent' },
    { ...task('leaf', 'study'), parentId: 'child' },
  ],
};

function task(id: string, projectId: string) {
  return {
    id,
    source: 'local' as const,
    projectId,
    title: id,
    status: 'incomplete',
    priority: null,
    dueDate: null,
    tags: [],
    parentId: null,
    isCompleted: false,
    updatedAt: 1_720_000_000_000,
  };
}

describe('task snapshot CAS mutations', () => {
  it('reads legacy v1 tasks and canonicalizes optional fields before hashing', () => {
    expect(validateTaskSnapshotPayload(base)).toBe(true);
    const parsed = parseTaskSnapshotMutationResponse({
      protocolVersion: 1,
      revision: 4,
      sourceDeviceId: 'legacy-pc',
      snapshot: base,
      serverTime: 1_720_000_001_000,
      operationId: 'legacy-op-123',
      status: 'duplicate',
      result: { kind: 'update_task', entityId: 'parent', safety: 'updated' },
    });
    expect(parsed?.snapshot?.tasks[0]).not.toHaveProperty('startDate');
    expect(parsed?.snapshot?.tasks[0]).not.toHaveProperty('recurrence');
    expect(
      fingerprintDeviceSyncValue(canonicalTaskSnapshotFingerprintPayload(parsed!.snapshot!)),
    ).toBe(fingerprintDeviceSyncValue(canonicalTaskSnapshotFingerprintPayload(base)));
  });

  it('rejects out-of-range priorities and non-integral or out-of-range timestamps', () => {
    const invalidPriority = structuredClone(base);
    invalidPriority.tasks[0]!.priority = 6;
    expect(validateTaskSnapshotPayload(invalidPriority)).toBe(false);

    const invalidTimestamp = structuredClone(base);
    invalidTimestamp.publishedAt = 1.5;
    expect(validateTaskSnapshotPayload(invalidTimestamp)).toBe(false);

    const farFuture = structuredClone(base);
    farFuture.tasks[0]!.dueDate = 8_640_000_000_000_001;
    expect(validateTaskSnapshotPayload(farFuture)).toBe(false);
  });

  it('strips scheduling for strict legacy readers and preserves it on a legacy republish', () => {
    const scheduled = applyTaskSnapshotMutation(
      base,
      {
        kind: 'create_task',
        taskId: 'scheduled',
        title: '循环任务',
        dueDate: 100,
        recurrence: dailyDefinition,
      },
      10,
    ).snapshot;
    const legacyProjection = withoutTaskSchedulingFields(scheduled);
    expect(legacyProjection.tasks.at(-1)).not.toHaveProperty('startDate');
    expect(legacyProjection.tasks.at(-1)).not.toHaveProperty('recurrence');
    expect(validateTaskSnapshotPayload(legacyProjection)).toBe(true);

    const republished = mergeLegacyTaskSchedulingFields(scheduled, {
      ...legacyProjection,
      publishedAt: 11,
    });
    expect(republished.tasks.at(-1)).toMatchObject({
      startDate: null,
      recurrence: { frequency: 'daily', count: 2 },
    });
    expect(normalizeTaskSnapshotPayload(republished)).toEqual(republished);

    const legacyCompletion = mergeLegacyTaskSchedulingFields(scheduled, {
      ...legacyProjection,
      publishedAt: 101,
      tasks: legacyProjection.tasks.map((task) =>
        task.id === 'scheduled'
          ? { ...task, status: 'completed', isCompleted: true, updatedAt: 101 }
          : task,
      ),
    });
    expect(legacyCompletion.tasks.at(-1)).toMatchObject({
      status: 'incomplete',
      isCompleted: false,
      dueDate: 86_400_100,
      recurrence: { completedCount: 1 },
    });
  });

  it('strips scheduling result fields as well as task fields for strict legacy mutation readers', () => {
    const response = {
      protocolVersion: 1 as const,
      revision: 3,
      sourceDeviceId: 'device-new',
      snapshot: base,
      serverTime: 100,
      operationId: 'legacy-response-1',
      status: 'applied' as const,
      result: {
        kind: 'set_task_completed' as const,
        entityId: 'parent',
        recurrenceRolled: true,
        recurrenceExhausted: false,
        nextDueDate: 200,
        completedCount: 1,
        safety: 'updated' as const,
      },
    };
    const legacy = withoutTaskSchedulingMutationFields(response);
    expect(legacy.snapshot?.tasks[0]).not.toHaveProperty('startDate');
    expect(legacy.result).toEqual({
      kind: 'set_task_completed',
      entityId: 'parent',
      safety: 'updated',
    });
    expect(parseTaskSnapshotMutationResponse(legacy)).not.toBeNull();
  });

  it('moves a complete parent subtree and preserves parent links', () => {
    const result = applyTaskSnapshotMutation(
      base,
      { kind: 'move_task', taskId: 'parent', projectId: 'life' },
      1_720_000_001_000,
    );
    expect(result.result).toMatchObject({ kind: 'move_task', taskCount: 3, projectId: 'life' });
    expect(result.snapshot.tasks.map((candidate) => candidate.projectId)).toEqual([
      'life',
      'life',
      'life',
    ]);
    expect(result.snapshot.tasks.map((candidate) => candidate.parentId)).toEqual([
      null,
      'parent',
      'child',
    ]);
  });

  it('deletes a list safely by moving every task to the inbox', () => {
    const result = applyTaskSnapshotMutation(
      base,
      { kind: 'delete_project', projectId: 'study' },
      1_720_000_001_000,
    );
    expect(result.snapshot.projects.map((project) => project.id)).toEqual(['local-inbox', 'life']);
    expect(result.snapshot.tasks.every((candidate) => candidate.projectId === 'local-inbox')).toBe(
      true,
    );
    expect(result.result).toMatchObject({ movedTaskCount: 3, safety: 'moved_to_inbox' });
    expect(() =>
      applyTaskSnapshotMutation(
        base,
        { kind: 'delete_project', projectId: 'local-inbox' },
        1_720_000_001_000,
      ),
    ).toThrow('收件箱不可删除');
  });

  it('supports task fields and rejects self/cyclic parents', () => {
    const created = applyTaskSnapshotMutation(
      base,
      {
        kind: 'create_task',
        taskId: 'new-task',
        projectId: 'study',
        parentId: 'parent',
        title: '新的复习任务',
        priority: 5,
        dueDate: 1_720_000_100_000,
        tags: ['考试', '本周'],
      },
      1_720_000_001_000,
    );
    expect(created.snapshot.tasks.at(-1)).toMatchObject({
      id: 'new-task',
      parentId: 'parent',
      priority: 5,
      dueDate: 1_720_000_100_000,
      tags: ['考试', '本周'],
    });
    expect(() =>
      applyTaskSnapshotMutation(
        base,
        {
          kind: 'create_task',
          taskId: 'self',
          projectId: 'study',
          parentId: 'self',
          title: '循环',
        },
        1_720_000_001_000,
      ),
    ).toThrow('自己的父任务');
    expect(() =>
      applyTaskSnapshotMutation(
        base,
        { kind: 'update_task', taskId: 'parent', parentId: 'child' },
        1_720_000_001_000,
      ),
    ).toThrow('循环');
  });

  it('rolls recurring tasks until count is exhausted, then supports final restore', () => {
    const dueDate = Date.parse('2026-08-30T09:00:00+08:00');
    const created = applyTaskSnapshotMutation(
      base,
      {
        kind: 'create_task',
        taskId: 'daily-task',
        title: '每日复盘',
        dueDate,
        recurrence: dailyDefinition,
      },
      dueDate - 1,
    );
    const first = applyTaskSnapshotMutation(
      created.snapshot,
      { kind: 'set_task_completed', taskId: 'daily-task', completed: true },
      dueDate,
    );
    expect(first.result).toMatchObject({
      recurrenceRolled: true,
      recurrenceExhausted: false,
      completedCount: 1,
    });
    expect(first.snapshot.tasks.at(-1)).toMatchObject({
      isCompleted: false,
      dueDate: Date.parse('2026-08-31T09:00:00+08:00'),
      recurrence: { completedCount: 1 },
    });

    const second = applyTaskSnapshotMutation(
      first.snapshot,
      { kind: 'set_task_completed', taskId: 'daily-task', completed: true },
      Date.parse('2026-08-31T09:00:00+08:00'),
    );
    expect(second.result).toMatchObject({
      recurrenceRolled: false,
      recurrenceExhausted: true,
      completedCount: 2,
    });
    expect(second.snapshot.tasks.at(-1)?.isCompleted).toBe(true);

    const repeated = applyTaskSnapshotMutation(
      second.snapshot,
      { kind: 'set_task_completed', taskId: 'daily-task', completed: true },
      Date.parse('2026-08-31T09:00:01+08:00'),
    );
    expect(repeated.snapshot.tasks.at(-1)).toMatchObject({
      isCompleted: true,
      recurrence: { completedCount: 2, count: 2 },
    });
    expect(validateTaskSnapshotPayload(repeated.snapshot)).toBe(true);

    const restored = applyTaskSnapshotMutation(
      second.snapshot,
      { kind: 'set_task_completed', taskId: 'daily-task', completed: false },
      Date.parse('2026-08-31T09:00:01+08:00'),
    );
    expect(restored.snapshot.tasks.at(-1)).toMatchObject({
      isCompleted: false,
      recurrence: { completedCount: 1 },
    });
  });

  it('requires a recurrence anchor and coherent start/due dates for every mutation path', () => {
    expect(() =>
      applyTaskSnapshotMutation(
        base,
        { kind: 'create_task', title: '无锚点循环', recurrence: dailyDefinition },
        1_720_000_001_000,
      ),
    ).toThrow('必须设置开始时间或截止时间');
    expect(() =>
      applyTaskSnapshotMutation(
        base,
        {
          kind: 'create_task',
          title: '反向日期',
          startDate: 1_720_000_200_000,
          dueDate: 1_720_000_100_000,
        },
        1_720_000_001_000,
      ),
    ).toThrow('开始时间不能晚于截止时间');
    expect(() =>
      applyTaskSnapshotMutation(
        base,
        {
          kind: 'create_task',
          title: '结束早于任务',
          dueDate: 100,
          recurrence: { ...dailyDefinition, endAt: 99 },
        },
        1,
      ),
    ).toThrow('循环结束时间不能早于当前任务日期');

    const recurringBase = applyTaskSnapshotMutation(
      base,
      {
        kind: 'create_task',
        taskId: 'anchored',
        title: '锚点',
        dueDate: 10,
        recurrence: dailyDefinition,
      },
      1,
    );
    expect(() =>
      applyTaskSnapshotMutation(
        recurringBase.snapshot,
        { kind: 'update_task', taskId: 'anchored', dueDate: null },
        2,
      ),
    ).toThrow('必须设置开始时间或截止时间');
    expect(() =>
      applyTaskSnapshotMutation(
        recurringBase.snapshot,
        {
          kind: 'update_task',
          taskId: 'anchored',
          recurrence: { ...dailyDefinition, endAt: 9 },
        },
        2,
      ),
    ).toThrow('循环结束时间不能早于当前任务日期');
  });

  it('validates exact request/response envelopes and rejects extra/private fields', () => {
    const request = {
      protocolVersion: 1,
      operationId: 'mutation-123',
      expectedRevision: 4,
      deviceId: 'mcp-service',
      mutation: { kind: 'set_task_completed', taskId: 'task-1', completed: true },
    };
    expect(validateTaskSnapshotMutationRequest(request)).toBe(true);
    expect(validateTaskSnapshotMutationRequest({ ...request, privateTitle: 'nope' })).toBe(false);
    expect(validateTaskSnapshotMutationRequest({ ...request, expectedRevision: 4.5 })).toBe(false);
    expect(
      validateTaskSnapshotMutationRequest({
        ...request,
        mutation: {
          kind: 'create_task',
          title: '客户端伪造进度',
          dueDate: 100,
          recurrence: daily,
        },
      }),
    ).toBe(false);
    expect(
      validateTaskSnapshotMutationRequest({
        ...request,
        mutation: {
          kind: 'create_task',
          title: '合法循环定义',
          dueDate: 100,
          recurrence: dailyDefinition,
        },
      }),
    ).toBe(true);
    for (const endAt of [100.5, DEVICE_SYNC_MAX_TIMESTAMP_MS + 1]) {
      expect(
        validateTaskSnapshotMutationRequest({
          ...request,
          mutation: {
            kind: 'create_task',
            title: '非法循环时间',
            dueDate: 100,
            recurrence: { ...dailyDefinition, endAt },
          },
        }),
      ).toBe(false);
      expect(
        validateTaskSnapshotPayload({
          ...base,
          tasks: [
            {
              ...task('invalid-recurrence-time', 'study'),
              dueDate: 100,
              recurrence: { ...daily, endAt },
            },
          ],
        }),
      ).toBe(false);
    }
    expect(
      parseTaskSnapshotMutationResponse({
        protocolVersion: 1,
        revision: 5,
        sourceDeviceId: 'mcp-service',
        snapshot: base,
        serverTime: 1_720_000_001_000,
        operationId: 'mutation-123',
        status: 'applied',
        result: { kind: 'set_task_completed', entityId: 'task-1', safety: 'updated' },
        privateTitle: 'must not pass',
      }),
    ).toBeNull();
  });

  it('keeps server-owned recurrence progress when updating a rule', () => {
    const current = applyTaskSnapshotMutation(
      base,
      {
        kind: 'create_task',
        taskId: 'progress-task',
        title: '进度任务',
        dueDate: 100,
        recurrence: { ...dailyDefinition, count: 5 },
      },
      1,
    );
    const progressed = applyTaskSnapshotMutation(
      current.snapshot,
      { kind: 'set_task_completed', taskId: 'progress-task', completed: true },
      100,
    );
    const progressedTwice = applyTaskSnapshotMutation(
      progressed.snapshot,
      { kind: 'set_task_completed', taskId: 'progress-task', completed: true },
      86_400_100,
    );
    const updated = applyTaskSnapshotMutation(
      progressedTwice.snapshot,
      {
        kind: 'update_task',
        taskId: 'progress-task',
        recurrence: { ...dailyDefinition, interval: 2, count: 3 },
      },
      101,
    );
    expect(updated.snapshot.tasks.at(-1)?.recurrence).toMatchObject({
      interval: 2,
      count: 3,
      completedCount: 2,
    });
    expect(() =>
      applyTaskSnapshotMutation(
        progressedTwice.snapshot,
        {
          kind: 'update_task',
          taskId: 'progress-task',
          recurrence: { ...dailyDefinition, count: 1 },
        },
        102,
      ),
    ).toThrow('不能小于已完成次数');
  });
});

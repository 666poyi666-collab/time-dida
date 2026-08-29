import { describe, expect, it } from 'vitest';

import {
  applyTaskSnapshotMutation,
  parseTaskSnapshotMutationResponse,
  validateTaskSnapshotMutationRequest,
  type TaskSnapshotPayload,
} from '@shared/sync/taskSnapshotProtocol';

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
});

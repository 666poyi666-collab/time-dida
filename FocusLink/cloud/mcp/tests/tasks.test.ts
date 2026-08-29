import { describe, expect, it } from 'vitest';

import {
  fetchFocusLinkTaskSnapshot,
  getFocusLinkTask,
  listFocusLinkProjects,
  listFocusLinkTasks,
  makeTaskMutationRequest,
  mutateFocusLinkTasks,
  redactMutationConfirmation,
  type TaskMcpEnv,
} from '../src/tasks';
import type {
  TaskSnapshotMutationResponse,
  TaskSnapshotResponse,
} from '../../../shared/sync/taskSnapshotProtocol';

const TOKEN = 'mcp-service-secret-0123456789abcdefghijklmnopqrstuvwxyz';
const snapshot: TaskSnapshotResponse = {
  protocolVersion: 1,
  revision: 7,
  sourceDeviceId: 'device-pc',
  serverTime: 1_720_000_000_000,
  snapshot: {
    publishedAt: 1_720_000_000_000,
    projects: [
      { id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' },
      { id: 'study', source: 'local', name: '学习', color: '#2f6fed' },
      { id: 'ticktick-project', source: 'ticktick', name: '外部', color: null },
    ],
    tasks: [
      {
        id: 'parent',
        source: 'local',
        projectId: 'study',
        title: '复习化学',
        status: 'incomplete',
        priority: 3,
        dueDate: 1_720_000_100_000,
        tags: ['考试'],
        parentId: null,
        isCompleted: false,
        updatedAt: 1_720_000_000_000,
      },
      {
        id: 'child',
        source: 'local',
        projectId: 'study',
        title: '整理错题',
        status: 'incomplete',
        priority: null,
        dueDate: null,
        tags: [],
        parentId: 'parent',
        isCompleted: false,
        updatedAt: 1_720_000_000_000,
      },
      {
        id: 'done',
        source: 'local',
        projectId: 'local-inbox',
        title: '已完成',
        status: 'completed',
        priority: null,
        dueDate: null,
        tags: ['旧'],
        parentId: null,
        isCompleted: true,
        updatedAt: 1_720_000_000_000,
      },
    ],
  },
};

function env(
  handler: (request: Request) => Promise<Response> | Response = () => Response.json(snapshot),
): TaskMcpEnv & { calls: Request[] } {
  const calls: Request[] = [];
  return {
    calls,
    FOCUSLINK_MCP_SERVICE_TOKEN: TOKEN,
    FOCUSLINK_UPSTREAM: {
      fetch: async (request: Request) => {
        calls.push(request);
        return handler(request);
      },
    } as unknown as TaskMcpEnv['FOCUSLINK_UPSTREAM'],
  };
}

describe('FocusLink MCP task authority adapter', () => {
  it('reads only local projects and keeps the inbox visible on an empty register', async () => {
    const result = await listFocusLinkProjects(env());
    expect(result).toMatchObject({ authority: 'focuslink-account-do', revision: 7 });
    expect(result.projects.map((project) => project.id)).toEqual(['local-inbox', 'study']);

    const empty = env(() =>
      Response.json({ ...snapshot, revision: 0, sourceDeviceId: null, snapshot: null }),
    );
    await expect(listFocusLinkProjects(empty)).resolves.toMatchObject({
      revision: 0,
      projects: [{ id: 'local-inbox', name: '收件箱' }],
    });
  });

  it('filters task reads without exposing third-party tasks', async () => {
    const result = await listFocusLinkTasks(env(), {
      projectId: 'study',
      includeCompleted: false,
      query: '考试',
      limit: 10,
    });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      id: 'parent',
      parentId: null,
      dueDate: 1_720_000_100_000,
      priority: 3,
      tags: ['考试'],
    });
    await expect(
      listFocusLinkTasks(env(), {
        includeCompleted: false,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      tasks: [expect.objectContaining({ id: 'parent' }), expect.objectContaining({ id: 'child' })],
    });
    await expect(getFocusLinkTask(env(), 'done')).resolves.toMatchObject({
      task: expect.objectContaining({ id: 'done', isCompleted: true }),
    });
  });

  it('sends mutation requests through the private binding with an explicit CAS revision', async () => {
    const response: TaskSnapshotMutationResponse = {
      ...snapshot,
      operationId: 'mcp-op-create-1',
      status: 'applied',
      result: {
        kind: 'create_task',
        entityId: 'new-task',
        projectId: 'study',
        safety: 'updated',
      },
    };
    const fixture = env(async (request) => {
      expect(new URL(request.url).pathname).toBe('/internal/mcp/v1/tasks');
      expect(request.headers.get('x-focuslink-mcp-service')).toBe(TOKEN);
      expect(request.headers.get('authorization')).toBeNull();
      return Response.json(response);
    });
    const request = makeTaskMutationRequest('mcp-op-create-1', 7, {
      kind: 'create_task',
      title: '新任务',
      projectId: 'study',
      parentId: 'parent',
      priority: 5,
      dueDate: 1_720_000_200_000,
      tags: ['本周'],
    });
    await expect(mutateFocusLinkTasks(fixture, request)).resolves.toEqual(response);
    expect(fixture.calls).toHaveLength(1);
    const body = (await fixture.calls[0]!.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ expectedRevision: 7, operationId: 'mcp-op-create-1' });
    expect(body.deviceId).toBe('mcp-service');
    expect((body.mutation as Record<string, unknown>).title).toBe('新任务');
  });

  it('returns a redacted confirmation and stable errors for auth/conflict/redirect', async () => {
    const response: TaskSnapshotMutationResponse = {
      ...snapshot,
      operationId: 'mcp-op-delete-1',
      status: 'duplicate',
      result: {
        kind: 'delete_project',
        entityId: 'study',
        movedTaskCount: 2,
        projectId: 'local-inbox',
        safety: 'moved_to_inbox',
      },
    };
    expect(redactMutationConfirmation(response)).toEqual({
      authority: 'focuslink-account-do',
      operationId: 'mcp-op-delete-1',
      status: 'duplicate',
      revision: 7,
      result: response.result,
      confirmed: true,
    });
    for (const [status, code] of [
      [401, 'task_authority_service_rejected'],
      [409, 'task_revision_conflict'],
    ] as const) {
      await expect(
        fetchFocusLinkTaskSnapshot(
          env(() => Response.json({ error: 'private title must not escape' }, { status })),
        ),
      ).rejects.toMatchObject({ code, status });
    }
    await expect(
      fetchFocusLinkTaskSnapshot(
        env(() => new Response(null, { status: 302, headers: { location: 'https://evil.test' } })),
      ),
    ).rejects.toMatchObject({ code: 'focuslink_authority_redirect_rejected', status: 302 });
  });
});

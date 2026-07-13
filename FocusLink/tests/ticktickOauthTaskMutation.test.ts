import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskCache } from '../shared/types';

const oauthState = vi.hoisted(() => ({
  taskCache: [] as TaskCache[],
}));

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }));

vi.mock('../electron/credentials.js', () => ({
  credentials: {
    has: vi.fn(() => true),
    get: vi.fn(() => ({ accessToken: 'oauth-secret-token' })),
    set: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../electron/db/index.js', () => ({
  listTaskCache: vi.fn(() => oauthState.taskCache),
  upsertTaskCache: vi.fn((task: TaskCache) => {
    const index = oauthState.taskCache.findIndex((item) => item.id === task.id);
    if (index >= 0) oauthState.taskCache[index] = task;
    else oauthState.taskCache.push(task);
  }),
}));

vi.mock('../electron/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { TickTickAdapter } from '../electron/integrations/ticktick/oauthAdapter';

function task(completed: boolean): Task {
  return {
    id: 'ticktick:task-1',
    source: 'ticktick',
    externalId: 'task-1',
    projectId: 'project-1',
    title: '中文任务',
    status: completed ? 'completed' : 'incomplete',
    isCompleted: completed,
    priority: null,
    dueDate: null,
    tags: [],
    content: '正文',
  };
}

function seedCache(completed: boolean): void {
  const now = Date.now();
  oauthState.taskCache = [
    {
      id: 'ticktick:task-1',
      source: 'ticktick',
      externalId: 'task-1',
      projectId: 'project-1',
      title: '中文任务',
      status: completed ? 'completed' : 'incomplete',
      priority: null,
      dueDate: null,
      tags: '[]',
      content: '正文',
      rawJson: null,
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

beforeEach(() => {
  oauthState.taskCache = [];
  vi.unstubAllGlobals();
});

describe('TickTick OAuth task completion mutations', () => {
  it('aborts a permanently pending API request at the hard timeout', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });

    const adapter = new TickTickAdapter({ requestTimeoutMs: 10, fetchImpl: fetchMock });
    await expect(adapter.listProjects()).rejects.toThrow('TickTick API 请求超时（10ms）');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
  });

  it('does not fetch completed history by default', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ tasks: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new TickTickAdapter().listWorkspaceTasks('project-1', undefined, {
        includeCompleted: false,
      }),
    ).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.dida365.com/open/v1/project/project-1/data',
    );
  });

  it('merges active project data with the completed-task endpoint for the workspace', async () => {
    const completedTime = new Date(Date.now() - 60_000).toISOString();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            tasks: [
              {
                id: 'active',
                projectId: 'project-1',
                title: '待完成',
                status: 0,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              tasks: [
                {
                  id: 'done',
                  projectId: 'project-1',
                  title: '已完成',
                  status: 2,
                  completedTime,
                },
              ],
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const tasks = await new TickTickAdapter().listWorkspaceTasks(
      undefined,
      [
        {
          id: 'project-1',
          source: 'ticktick',
          externalId: 'project-1',
          name: '学习',
          color: null,
        },
      ],
      { includeCompleted: true, completedDays: 30 },
    );

    expect(tasks).toEqual([
      expect.objectContaining({ externalId: 'active', isCompleted: false }),
      expect.objectContaining({
        externalId: 'done',
        isCompleted: true,
        completedAt: Date.parse(completedTime),
      }),
    ]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.dida365.com/open/v1/project/project-1/data',
      'https://api.dida365.com/open/v1/project/all/completed',
    ]);
  });

  it('uses the official complete endpoint and verifies status 2', async () => {
    seedCache(false);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task-1',
            projectId: 'project-1',
            title: '中文任务',
            status: 2,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new TickTickAdapter().setTaskCompleted(task(false), true),
    ).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.dida365.com/open/v1/project/project-1/task/task-1/complete',
      'https://api.dida365.com/open/v1/project/project-1/task/task-1',
    ]);
    expect(oauthState.taskCache[0].status).toBe('completed');
  });

  it('posts status 0 to /task/{id}, clears completedTime, and verifies the restore', async () => {
    seedCache(true);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'task-1', status: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task-1',
            projectId: 'project-1',
            title: '中文任务',
            status: 0,
            completedTime: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new TickTickAdapter().setTaskCompleted(task(true), false),
    ).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.dida365.com/open/v1/task/task-1');
    const request = fetchMock.mock.calls[0][1];
    expect(request?.method).toBe('POST');
    expect(JSON.parse(String(request?.body))).toEqual({
      id: 'task-1',
      projectId: 'project-1',
      title: '中文任务',
      content: '正文',
      status: 0,
      completedTime: null,
    });
    expect(oauthState.taskCache[0].status).toBe('incomplete');
  });

  it('keeps the server response visible in a bounded completion error', async () => {
    seedCache(false);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('invalid task state', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new TickTickAdapter().setTaskCompleted(task(false), true)).rejects.toThrow(
      /完成任务失败（HTTP 400）：invalid task state/,
    );
  });
});

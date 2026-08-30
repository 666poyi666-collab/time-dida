import { afterEach, describe, expect, it } from 'vitest';

import { runFocusLinkCli } from '../scripts/cli/focuslink-cli.ts';
import {
  applyTaskSnapshotMutation,
  type TaskSnapshotMutationRequest,
  type TaskSnapshotResponse,
} from '@shared/sync/taskSnapshotProtocol';
import { createDeviceSyncCloudServer } from '../cloud';

const DEVICE_TOKEN = 'fl2_account1_device1_0123456789abcdefghijklmnopqrstuvwxyzABCDE';
const servers: Array<ReturnType<typeof createDeviceSyncCloudServer>> = [];
const initial: TaskSnapshotResponse = {
  protocolVersion: 1,
  revision: 4,
  sourceDeviceId: 'desktop',
  serverTime: Date.parse('2026-08-30T02:03:04Z'),
  snapshot: {
    publishedAt: Date.parse('2026-08-30T02:00:00Z'),
    projects: [{ id: 'local-inbox', source: 'local', name: '收件箱', color: '#16899f' }],
    tasks: [],
  },
};

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
    },
  };
}

describe('FocusLink first-party CLI', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('uses the shared CAS mutation contract for dates, tags, parent and recurrence', async () => {
    let posted: TaskSnapshotMutationRequest | null = null;
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.headers.get('authorization')).toBe(`Bearer ${DEVICE_TOKEN}`);
      if (request.method === 'GET') return Response.json(initial);
      posted = (await request.json()) as TaskSnapshotMutationRequest;
      const applied = applyTaskSnapshotMutation(
        initial.snapshot!,
        posted.mutation,
        initial.serverTime + 1,
        () => 'created-task',
      );
      return Response.json({
        ...initial,
        revision: initial.revision + 1,
        sourceDeviceId: posted.deviceId,
        snapshot: applied.snapshot,
        operationId: posted.operationId,
        status: 'applied',
        result: applied.result,
      });
    };
    const captured = output();
    const exitCode = await runFocusLinkCli(
      [
        'tasks',
        'create',
        '--title',
        '每周复盘',
        '--parent-id',
        'none',
        '--priority',
        '5',
        '--start',
        '2026-08-31T08:00:00+08:00',
        '--due',
        '2026-08-31T09:00:00+08:00',
        '--tag',
        '工作',
        '--tag',
        '复盘',
        '--frequency',
        'weekly',
        '--weekdays',
        '1,5',
        '--repeat-count',
        '4',
        '--rollover',
        'from_schedule',
        '--operation-id',
        'cli-test-create-1',
      ],
      {
        FOCUSLINK_ENDPOINT: 'https://focuslink.example.test',
        FOCUSLINK_DEVICE_TOKEN: DEVICE_TOKEN,
      },
      captured.io,
      fetchImpl as typeof fetch,
    );

    expect(exitCode).toBe(0);
    expect(posted).toMatchObject({
      protocolVersion: 1,
      operationId: 'cli-test-create-1',
      expectedRevision: 4,
      deviceId: 'device-device1',
      mutation: {
        kind: 'create_task',
        title: '每周复盘',
        parentId: null,
        priority: 5,
        tags: ['工作', '复盘'],
        recurrence: {
          timezone: 'Asia/Shanghai',
          frequency: 'weekly',
          byWeekday: [1, 5],
          count: 4,
        },
      },
    });
    const confirmation = JSON.parse(captured.stdout[0]!) as Record<string, unknown>;
    expect(confirmation).toMatchObject({
      confirmed: true,
      operationId: 'cli-test-create-1',
      revision: 5,
    });
    expect(captured.stdout[0]).not.toContain('每周复盘');
    expect(captured.stderr).toEqual([]);
  });

  it('returns authority time with timezone boundaries', async () => {
    const captured = output();
    const exitCode = await runFocusLinkCli(
      ['time', '--timezone', 'Asia/Shanghai'],
      {
        FOCUSLINK_ENDPOINT: 'https://focuslink.example.test',
        FOCUSLINK_DEVICE_TOKEN: DEVICE_TOKEN,
      },
      captured.io,
      (async () => Response.json(initial)) as typeof fetch,
    );
    expect(exitCode).toBe(0);
    expect(JSON.parse(captured.stdout[0]!)).toMatchObject({
      serverTime: initial.serverTime,
      timezone: 'Asia/Shanghai',
      localDate: '2026-08-30',
      localTime: '10:03:04',
      offsetMinutes: 480,
    });
  });

  it('lists and gets projects/tasks with every supported task filter', async () => {
    const startDate = 1_720_000_050_000;
    const dueDate = 1_720_000_150_000;
    const snapshot: TaskSnapshotResponse = {
      ...initial,
      snapshot: {
        publishedAt: initial.snapshot!.publishedAt,
        projects: [
          ...initial.snapshot!.projects,
          { id: 'study', source: 'local', name: '学习', color: '#2f6fed' },
          { id: 'ticktick-list', source: 'ticktick', name: '第三方', color: null },
        ],
        tasks: [
          {
            id: 'weekly-review',
            source: 'local',
            projectId: 'study',
            title: '每周复盘',
            status: 'completed',
            priority: 5,
            startDate,
            dueDate,
            recurrence: null,
            tags: ['工作', '复盘'],
            parentId: null,
            isCompleted: true,
            updatedAt: dueDate,
          },
          {
            id: 'review-child',
            source: 'local',
            projectId: 'study',
            title: '整理材料',
            status: 'incomplete',
            priority: 2,
            startDate: null,
            dueDate: null,
            recurrence: null,
            tags: ['工作'],
            parentId: 'weekly-review',
            isCompleted: false,
            updatedAt: dueDate,
          },
          {
            id: 'external-task',
            source: 'ticktick',
            projectId: 'ticktick-list',
            title: '外部任务',
            status: 'incomplete',
            priority: 5,
            startDate,
            dueDate,
            recurrence: null,
            tags: ['工作', '复盘'],
            parentId: null,
            isCompleted: false,
            updatedAt: dueDate,
          },
        ],
      },
    };
    const invoke = async (args: string[]) => {
      const captured = output();
      expect(
        await runFocusLinkCli(
          args,
          {
            FOCUSLINK_ENDPOINT: 'https://focuslink.example.test',
            FOCUSLINK_DEVICE_TOKEN: DEVICE_TOKEN,
          },
          captured.io,
          (async () => Response.json(snapshot)) as typeof fetch,
        ),
        captured.stderr.join('\n'),
      ).toBe(0);
      return JSON.parse(captured.stdout[0]!) as Record<string, unknown>;
    };

    await expect(invoke(['projects', 'list'])).resolves.toMatchObject({
      projects: [
        expect.objectContaining({ id: 'local-inbox' }),
        expect.objectContaining({ id: 'study' }),
      ],
    });
    const listedProjects = (await invoke(['projects', 'list'])).projects as Array<{
      id: string;
    }>;
    expect(listedProjects.map((project) => project.id)).not.toContain('ticktick-list');
    await expect(invoke(['projects', 'get', '--project-id', 'study'])).resolves.toMatchObject({
      project: { id: 'study' },
      taskCount: 2,
      openTaskCount: 1,
    });
    await expect(
      invoke([
        'tasks',
        'list',
        '--project-id',
        'study',
        '--include-completed',
        '--query',
        '每周',
        '--priority',
        '5',
        '--start-from',
        String(startDate),
        '--start-to',
        String(startDate + 1),
        '--due-from',
        String(dueDate),
        '--due-to',
        String(dueDate + 1),
        '--tag',
        '工作',
        '--tag',
        '复盘',
        '--limit',
        '1',
      ]),
    ).resolves.toMatchObject({ tasks: [{ id: 'weekly-review' }] });
    await expect(invoke(['tasks', 'get', '--task-id', 'weekly-review'])).resolves.toMatchObject({
      task: { id: 'weekly-review', parentId: null },
      subtasks: [{ id: 'review-child', parentId: 'weekly-review' }],
    });
  });

  it('updates every mutable task field and emits an explicit CAS request', async () => {
    let posted: TaskSnapshotMutationRequest | null = null;
    const snapshot: TaskSnapshotResponse = {
      ...initial,
      snapshot: {
        ...initial.snapshot!,
        tasks: [
          {
            id: 'task-update',
            source: 'local',
            projectId: 'local-inbox',
            title: '更新前',
            status: 'incomplete',
            priority: 3,
            startDate: 1_720_000_000_000,
            dueDate: 1_720_000_100_000,
            recurrence: {
              timezone: 'Asia/Shanghai',
              frequency: 'daily',
              interval: 1,
              byWeekday: [],
              byMonthDay: [],
              endAt: null,
              count: 3,
              completedCount: 0,
              rollover: 'from_schedule',
            },
            tags: ['旧标签'],
            parentId: null,
            isCompleted: false,
            updatedAt: initial.serverTime,
          },
        ],
      },
    };
    const captured = output();
    expect(
      await runFocusLinkCli(
        [
          'tasks',
          'update',
          '--task-id',
          'task-update',
          '--title',
          '更新后',
          '--project-id',
          'inbox',
          '--parent-id',
          'none',
          '--clear-priority',
          '--clear-start',
          '--clear-due',
          '--clear-tags',
          '--clear-recurrence',
          '--operation-id',
          'cli-task-update-fields',
          '--expected-revision',
          '4',
        ],
        {
          FOCUSLINK_ENDPOINT: 'https://focuslink.example.test',
          FOCUSLINK_DEVICE_TOKEN: DEVICE_TOKEN,
        },
        captured.io,
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          if (request.method === 'GET') return Response.json(snapshot);
          posted = (await request.json()) as TaskSnapshotMutationRequest;
          return Response.json({
            ...snapshot,
            revision: 5,
            operationId: posted.operationId,
            status: 'applied',
            result: {
              kind: 'update_task',
              entityId: 'task-update',
              safety: 'updated',
            },
          });
        }) as typeof fetch,
      ),
      captured.stderr.join('\n'),
    ).toBe(0);
    expect(posted).toMatchObject({
      operationId: 'cli-task-update-fields',
      expectedRevision: 4,
      mutation: {
        kind: 'update_task',
        taskId: 'task-update',
        title: '更新后',
        projectId: null,
        parentId: null,
        priority: null,
        startDate: null,
        dueDate: null,
        tags: [],
        recurrence: null,
      },
    });
  });

  it('documents every command, filter, clear option and CAS control in help', async () => {
    const captured = output();
    expect(await runFocusLinkCli(['--help'], {}, captured.io)).toBe(0);
    const help = captured.stdout[0]!;
    for (const expected of [
      'projects get --project-id',
      'projects update --project-id',
      'tasks list [--project-id',
      '--include-completed',
      '--start-from',
      '--due-to',
      'tasks get --task-id',
      'tasks update --task-id',
      '--clear-priority',
      '--clear-recurrence',
      '--operation-id',
      '--expected-revision',
    ]) {
      expect(help).toContain(expected);
    }
  });

  it('retries one transient mutation with the same operation id and request body', async () => {
    const posted: string[] = [];
    let postAttempt = 0;
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === 'GET') return Response.json(initial);
      posted.push(await request.text());
      postAttempt += 1;
      if (postAttempt === 1) throw new TypeError('synthetic response loss');
      const body = JSON.parse(posted[0]!) as TaskSnapshotMutationRequest;
      const applied = applyTaskSnapshotMutation(
        initial.snapshot!,
        body.mutation,
        initial.serverTime + 1,
        () => 'retry-task',
      );
      return Response.json({
        ...initial,
        revision: 5,
        sourceDeviceId: body.deviceId,
        snapshot: applied.snapshot,
        operationId: body.operationId,
        status: 'duplicate',
        result: applied.result,
      });
    };
    const captured = output();
    expect(
      await runFocusLinkCli(
        ['tasks', 'create', '--title', '响应丢失重试', '--operation-id', 'cli-retry-create-1'],
        {
          FOCUSLINK_ENDPOINT: 'https://focuslink.example.test',
          FOCUSLINK_DEVICE_TOKEN: DEVICE_TOKEN,
        },
        captured.io,
        fetchImpl as typeof fetch,
      ),
    ).toBe(0);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toBe(posted[0]);
    expect(JSON.parse(captured.stdout[0]!)).toMatchObject({
      operationId: 'cli-retry-create-1',
      status: 'duplicate',
      revision: 5,
    });
  });

  it('retries a 200 mutation whose response body stream is lost', async () => {
    const posted: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === 'GET') return Response.json(initial);
      posted.push(await request.text());
      if (posted.length === 1) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError('synthetic body stream loss'));
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      const body = JSON.parse(posted[0]!) as TaskSnapshotMutationRequest;
      const applied = applyTaskSnapshotMutation(
        initial.snapshot!,
        body.mutation,
        initial.serverTime + 1,
        () => 'stream-retry-task',
      );
      return Response.json({
        ...initial,
        revision: 5,
        sourceDeviceId: body.deviceId,
        snapshot: applied.snapshot,
        operationId: body.operationId,
        status: 'duplicate',
        result: applied.result,
      });
    };
    const captured = output();
    expect(
      await runFocusLinkCli(
        ['tasks', 'create', '--title', '响应体断流', '--operation-id', 'cli-stream-retry-1'],
        {
          FOCUSLINK_ENDPOINT: 'https://focuslink.example.test',
          FOCUSLINK_DEVICE_TOKEN: DEVICE_TOKEN,
        },
        captured.io,
        fetchImpl as typeof fetch,
      ),
    ).toBe(0);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toBe(posted[0]);
    expect(JSON.parse(captured.stdout[0]!)).toMatchObject({
      operationId: 'cli-stream-retry-1',
      status: 'duplicate',
      revision: 5,
    });
  });

  it('returns retry coordinates after bounded mutation failure and preserves nested error codes', async () => {
    let postAttempts = 0;
    const unavailable = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === 'GET') return Response.json(initial);
      postAttempts += 1;
      throw new TypeError('synthetic outage');
    };
    const failed = output();
    expect(
      await runFocusLinkCli(
        ['tasks', 'complete', '--task-id', 'task-1', '--operation-id', 'cli-failed-complete-1'],
        {
          FOCUSLINK_ENDPOINT: 'https://focuslink.example.test',
          FOCUSLINK_DEVICE_TOKEN: DEVICE_TOKEN,
        },
        failed.io,
        unavailable as typeof fetch,
      ),
    ).toBe(1);
    expect(postAttempts).toBe(2);
    expect(JSON.parse(failed.stderr[0]!)).toEqual({
      ok: false,
      error: 'task_authority_unavailable',
      operationId: 'cli-failed-complete-1',
      expectedRevision: 4,
    });

    let rejectedPosts = 0;
    const rejected = output();
    expect(
      await runFocusLinkCli(
        ['tasks', 'create', '--title', '非法循环', '--operation-id', 'cli-invalid-task-1'],
        {
          FOCUSLINK_ENDPOINT: 'https://focuslink.example.test',
          FOCUSLINK_DEVICE_TOKEN: DEVICE_TOKEN,
        },
        rejected.io,
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          if (request.method === 'GET') return Response.json(initial);
          rejectedPosts += 1;
          return Response.json({ error: { code: 'task_mutation_invalid' } }, { status: 422 });
        }) as typeof fetch,
      ),
    ).toBe(1);
    expect(rejectedPosts).toBe(1);
    expect(JSON.parse(rejected.stderr[0]!)).toMatchObject({
      error: 'task_mutation_invalid',
      operationId: 'cli-invalid-task-1',
      expectedRevision: 4,
    });
  });

  it('rejects invalid priority, timestamp and operation id before task mutation', async () => {
    for (const [args, error] of [
      [['tasks', 'create', '--title', '优先级', '--priority', '6'], 'invalid_priority'],
      [['tasks', 'create', '--title', '时间', '--due', '8640000000000001'], 'invalid_due'],
      [['tasks', 'create', '--title', '幂等', '--operation-id', 'short'], 'invalid_operation_id'],
    ] as const) {
      let postCount = 0;
      const captured = output();
      expect(
        await runFocusLinkCli(
          args,
          {
            FOCUSLINK_ENDPOINT: 'https://focuslink.example.test',
            FOCUSLINK_DEVICE_TOKEN: DEVICE_TOKEN,
          },
          captured.io,
          (async (input: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(input, init);
            if (request.method === 'GET') return Response.json(initial);
            postCount += 1;
            return Response.json({});
          }) as typeof fetch,
        ),
      ).toBe(1);
      expect(postCount).toBe(0);
      expect(JSON.parse(captured.stderr[0]!)).toMatchObject({ error });
    }
  });

  it('never accepts an OAuth access token as a CLI device credential', async () => {
    const captured = output();
    const exitCode = await runFocusLinkCli(
      ['tasks', 'list'],
      {
        FOCUSLINK_ENDPOINT: 'https://focuslink.example.test',
        FOCUSLINK_MCP_ACCESS_TOKEN: 'oauth-token',
      },
      captured.io,
      (async () => {
        throw new Error('must not call');
      }) as typeof fetch,
    );
    expect(exitCode).toBe(1);
    expect(captured.stderr[0]).toContain('device_credential_required_oauth_token_not_accepted');
  });

  it('rejects an invalid endpoint before issuing a request', async () => {
    const captured = output();
    let requestCount = 0;
    expect(
      await runFocusLinkCli(
        ['tasks', 'list'],
        {
          FOCUSLINK_ENDPOINT: 'ftp://focuslink.example.test',
          FOCUSLINK_DEVICE_TOKEN: DEVICE_TOKEN,
        },
        captured.io,
        (async () => {
          requestCount += 1;
          return Response.json(initial);
        }) as typeof fetch,
      ),
    ).toBe(1);
    expect(requestCount).toBe(0);
    expect(JSON.parse(captured.stderr[0]!)).toMatchObject({ error: 'focuslink_endpoint_invalid' });
  });

  it.each([
    [
      'redirect',
      () => new Response(null, { status: 302, headers: { location: 'https://other.test' } }),
      'task_authority_redirect_rejected',
    ],
    [
      'oversized response',
      () => new Response(new Uint8Array(1_100_001), { status: 200 }),
      'task_authority_response_too_large',
    ],
    ['invalid response DTO', () => Response.json({ ok: true }), 'task_authority_protocol_error'],
    ['malformed JSON', () => new Response('{', { status: 200 }), 'task_authority_protocol_error'],
  ])('rejects a %s', async (_label, response, error) => {
    const captured = output();
    expect(
      await runFocusLinkCli(
        ['tasks', 'list'],
        {
          FOCUSLINK_ENDPOINT: 'https://focuslink.example.test',
          FOCUSLINK_DEVICE_TOKEN: DEVICE_TOKEN,
        },
        captured.io,
        (async () => response()) as typeof fetch,
      ),
    ).toBe(1);
    expect(JSON.parse(captured.stderr[0]!)).toMatchObject({ error });
  });

  it('runs task CAS, duplicate replay, recurrence rollover and reads against a real loopback server', async () => {
    const server = createDeviceSyncCloudServer({
      tokenAccounts: new Map([[DEVICE_TOKEN, 'cli-account']]),
    });
    servers.push(server);
    const { url } = await server.listen();
    const environment = {
      FOCUSLINK_ENDPOINT: url,
      FOCUSLINK_DEVICE_TOKEN: DEVICE_TOKEN,
    };
    const invoke = async (args: string[]) => {
      const captured = output();
      const exitCode = await runFocusLinkCli(args, environment, captured.io);
      expect(exitCode, captured.stderr.join('\n')).toBe(0);
      return JSON.parse(captured.stdout[0]!) as Record<string, unknown>;
    };

    const dueDate = Date.now() + 60_000;
    const createArgs = [
      'tasks',
      'create',
      '--task-id',
      'loopback-recurring',
      '--title',
      '回环循环任务',
      '--due',
      String(dueDate),
      '--frequency',
      'daily',
      '--repeat-count',
      '2',
      '--operation-id',
      'cli-loopback-create',
      '--expected-revision',
      '0',
    ];
    expect(await invoke(createArgs)).toMatchObject({ status: 'applied', revision: 1 });
    expect(await invoke(createArgs)).toMatchObject({ status: 'duplicate', revision: 1 });

    const mismatched = output();
    expect(
      await runFocusLinkCli(
        ['tasks', 'list', '--project-id', 'inbox'],
        { ...environment, FOCUSLINK_CLI_DEVICE_ID: 'device-other' },
        mismatched.io,
      ),
    ).toBe(1);
    expect(mismatched.stderr[0]).toContain('focuslink_cli_device_identity_mismatch');

    expect(
      await invoke([
        'tasks',
        'complete',
        '--task-id',
        'loopback-recurring',
        '--operation-id',
        'cli-loopback-complete-1',
        '--expected-revision',
        '1',
      ]),
    ).toMatchObject({
      revision: 2,
      result: { recurrenceRolled: true, recurrenceExhausted: false, completedCount: 1 },
    });
    expect(
      await invoke([
        'tasks',
        'complete',
        '--task-id',
        'loopback-recurring',
        '--operation-id',
        'cli-loopback-complete-2',
        '--expected-revision',
        '2',
      ]),
    ).toMatchObject({
      revision: 3,
      result: { recurrenceRolled: false, recurrenceExhausted: true, completedCount: 2 },
    });
    expect(
      await invoke([
        'tasks',
        'complete',
        '--task-id',
        'loopback-recurring',
        '--operation-id',
        'cli-loopback-complete-3',
        '--expected-revision',
        '3',
      ]),
    ).toMatchObject({
      revision: 4,
      result: { recurrenceRolled: false, recurrenceExhausted: true, completedCount: 2 },
    });
    const listed = await invoke(['tasks', 'list', '--include-completed']);
    expect(listed).toMatchObject({
      revision: 4,
      tasks: [
        {
          id: 'loopback-recurring',
          isCompleted: true,
          recurrence: { count: 2, completedCount: 2 },
        },
      ],
    });

    expect(
      await invoke([
        'tasks',
        'restore',
        '--task-id',
        'loopback-recurring',
        '--operation-id',
        'cli-loopback-restore',
        '--expected-revision',
        '4',
      ]),
    ).toMatchObject({ revision: 5, status: 'applied' });
    const createdProject = await invoke([
      'projects',
      'create',
      '--name',
      'CLI 清单',
      '--color',
      '#2f6fed',
      '--operation-id',
      'cli-loopback-project-create',
      '--expected-revision',
      '5',
    ]);
    expect(createdProject).toMatchObject({ revision: 6, status: 'applied' });
    const projectId = String(
      (createdProject.result as { entityId?: string } | undefined)?.entityId ?? '',
    );
    expect(projectId).not.toBe('');
    expect(
      await invoke([
        'tasks',
        'move',
        '--task-id',
        'loopback-recurring',
        '--project-id',
        projectId,
        '--operation-id',
        'cli-loopback-move',
        '--expected-revision',
        '6',
      ]),
    ).toMatchObject({ revision: 7, result: { projectId } });
    expect(
      await invoke([
        'projects',
        'update',
        '--project-id',
        projectId,
        '--name',
        'CLI 清单已更新',
        '--operation-id',
        'cli-loopback-project-update',
        '--expected-revision',
        '7',
      ]),
    ).toMatchObject({ revision: 8, status: 'applied' });
    expect(
      await invoke([
        'projects',
        'delete',
        '--project-id',
        projectId,
        '--operation-id',
        'cli-loopback-project-delete',
        '--expected-revision',
        '8',
      ]),
    ).toMatchObject({
      revision: 9,
      result: { safety: 'moved_to_inbox', projectId: 'local-inbox' },
    });
    expect(
      await invoke([
        'tasks',
        'delete',
        '--task-id',
        'loopback-recurring',
        '--operation-id',
        'cli-loopback-task-delete',
        '--expected-revision',
        '9',
      ]),
    ).toMatchObject({ revision: 10, result: { safety: 'permanent_subtree_delete' } });
    await expect(invoke(['tasks', 'list', '--include-completed'])).resolves.toMatchObject({
      revision: 10,
      tasks: [],
    });
  });
});

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

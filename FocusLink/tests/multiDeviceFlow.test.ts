import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEVICE_SYNC_PROTOCOL_VERSION, type DeviceSyncResponse } from '@shared/sync/deviceProtocol';
import {
  LIVE_FOCUS_PROTOCOL_VERSION,
  type LiveFocusCommandResponse,
} from '@shared/sync/liveFocusProtocol';
import {
  TASK_SNAPSHOT_PROTOCOL_VERSION,
  toTaskSnapshotPayload,
  type TaskSnapshotResponse,
} from '@shared/sync/taskSnapshotProtocol';
import { createDeviceSyncCloudServer, type DeviceSyncCloudServer } from '../cloud';

const TOKEN = 'multi-device-flow-token';

describe('PC-off multi-device focus flow', () => {
  let server: DeviceSyncCloudServer;
  let url: string;

  beforeEach(async () => {
    server = createDeviceSyncCloudServer({
      tokenAccounts: new Map([[TOKEN, 'owner']]),
    });
    url = (await server.listen()).url;
  });

  afterEach(async () => server.close());

  async function request(path: string, method = 'GET', body?: unknown) {
    return fetch(`${url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it('uses the PC task snapshot, focuses without PC, resolves races, and returns one ledger', async () => {
    const taskSnapshot = toTaskSnapshotPayload(
      [
        {
          id: 'project-1',
          source: 'ticktick',
          externalId: 'project-1',
          name: '第一张清单',
          color: null,
        },
      ],
      [
        {
          id: 'task-chemistry',
          source: 'ticktick',
          externalId: 'task-chemistry',
          projectId: 'project-1',
          title: '复习化学',
          status: 'pending',
          priority: 3,
          dueDate: null,
          tags: ['学习'],
          content: null,
        },
      ],
      Date.now(),
    );
    expect(
      (
        await request('/v1/tasks', 'POST', {
          protocolVersion: TASK_SNAPSHOT_PROTOCOL_VERSION,
          deviceId: 'pc',
          snapshot: taskSnapshot,
        })
      ).status,
    ).toBe(200);
    const mobileTasks = (await (await request('/v1/tasks')).json()) as TaskSnapshotResponse;
    const selected = mobileTasks.snapshot?.tasks[0];
    expect(selected).toMatchObject({ id: 'task-chemistry', title: '复习化学' });

    const start = (await (
      await request('/v1/live/command', 'POST', {
        protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
        deviceId: 'phone',
        command: {
          commandId: 'start-phone',
          action: 'start',
          expectedRevision: 0,
          sessionId: 'session-phone',
          title: selected?.title ?? null,
          task: {
            taskId: selected?.id,
            taskSource: selected?.source,
            taskTitle: selected?.title,
          },
        },
      })
    ).json()) as LiveFocusCommandResponse;
    expect(start.ack.status).toBe('applied');

    const pauseBody = (deviceId: string, commandId: string) => ({
      protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
      deviceId,
      command: {
        commandId,
        action: 'pause',
        expectedRevision: 1,
        sessionId: 'session-phone',
      },
    });
    const firstPause = (await (
      await request('/v1/live/command', 'POST', pauseBody('tablet', 'pause-tablet'))
    ).json()) as LiveFocusCommandResponse;
    const racingPause = (await (
      await request('/v1/live/command', 'POST', pauseBody('web', 'pause-web'))
    ).json()) as LiveFocusCommandResponse;
    expect(firstPause.ack.status).toBe('applied');
    expect(racingPause.ack.status).toBe('conflict');
    expect(racingPause.snapshot.revision).toBe(2);

    const resume = (await (
      await request('/v1/live/command', 'POST', {
        protocolVersion: 1,
        deviceId: 'web',
        command: {
          commandId: 'resume-web',
          action: 'resume',
          expectedRevision: 2,
          sessionId: 'session-phone',
        },
      })
    ).json()) as LiveFocusCommandResponse;
    expect(resume.ack.status).toBe('applied');

    const finish = (await (
      await request('/v1/live/command', 'POST', {
        protocolVersion: 1,
        deviceId: 'tablet',
        command: {
          commandId: 'finish-tablet',
          action: 'finish',
          expectedRevision: 3,
          sessionId: 'session-phone',
        },
      })
    ).json()) as LiveFocusCommandResponse;
    expect(finish.ack).toMatchObject({ status: 'applied', completedEntityId: 'session-phone' });

    const ledger = (await (
      await request('/v1/sync', 'POST', {
        protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
        deviceId: 'pc-after-restart',
        cursor: null,
        mutations: [],
        pullLimit: 500,
      })
    ).json()) as DeviceSyncResponse;
    expect(ledger.changes).toHaveLength(1);
    expect(ledger.changes[0]?.payload?.session).toMatchObject({
      id: 'session-phone',
      defaultTaskId: 'task-chemistry',
      defaultTaskSource: 'ticktick',
    });
    expect(ledger.changes[0]?.payload?.segments.length).toBeGreaterThan(0);
    expect(
      ledger.changes[0]?.payload?.segments.every(
        (segment) => segment.taskId === 'task-chemistry' && segment.taskSource === 'ticktick',
      ),
    ).toBe(true);
  });
});

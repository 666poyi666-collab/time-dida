import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  TASK_SNAPSHOT_PATH,
  TASK_SNAPSHOT_PROTOCOL_VERSION,
  toTaskSnapshotPayload,
  validateTaskSnapshotPayload,
  type TaskSnapshotPublishRequest,
  type TaskSnapshotResponse,
} from '@shared/sync/taskSnapshotProtocol';
import { createDeviceSyncCloudServer, createDeviceSyncCloudStore } from '../cloud';

const TOKEN = 'task-snapshot-test-token';
const ACCOUNT = 'task-snapshot-account';
const ORIGIN = 'http://localhost:5175';

function request(): TaskSnapshotPublishRequest {
  return {
    protocolVersion: TASK_SNAPSHOT_PROTOCOL_VERSION,
    deviceId: 'desktop-a',
    snapshot: toTaskSnapshotPayload(
      [
        {
          id: 'project-a',
          source: 'ticktick',
          externalId: 'project-a',
          name: '第一张清单',
          color: null,
        },
      ],
      [
        {
          id: 'task-a',
          source: 'ticktick',
          externalId: 'task-a',
          projectId: 'project-a',
          title: '复习化学',
          status: 'pending',
          priority: 3,
          dueDate: null,
          tags: ['学习'],
          content: null,
          isCompleted: false,
          children: [
            {
              id: 'item-a',
              source: 'ticktick',
              externalId: 'item-a',
              projectId: 'project-a',
              title: '整理错题',
              status: 'pending',
              priority: null,
              dueDate: null,
              tags: [],
              content: null,
            },
          ],
        },
      ],
      1_720_000_000_000,
    ),
  };
}

describe('desktop-authoritative task snapshot', () => {
  const servers: Array<ReturnType<typeof createDeviceSyncCloudServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('flattens checklist children into a bounded portable snapshot', () => {
    const snapshot = request().snapshot;
    expect(validateTaskSnapshotPayload(snapshot)).toBe(true);
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({ id: 'task-a', parentId: null }),
      expect.objectContaining({ id: 'item-a', parentId: 'task-a' }),
    ]);
  });

  it('publishes idempotently, isolates accounts, and survives a store restart', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-task-snapshot-'));
    const persistencePath = path.join(directory, 'store.json');
    try {
      const store = createDeviceSyncCloudStore({ persistencePath, now: () => 1_720_000_001_000 });
      expect(store.publishTaskSnapshot(ACCOUNT, request()).revision).toBe(1);
      expect(store.publishTaskSnapshot(ACCOUNT, request()).revision).toBe(1);
      expect(store.getTaskSnapshot('other-account').snapshot).toBeNull();

      const reloaded = createDeviceSyncCloudStore({ persistencePath });
      expect(reloaded.getTaskSnapshot(ACCOUNT)).toMatchObject({
        revision: 1,
        sourceDeviceId: 'desktop-a',
        snapshot: { tasks: [{ id: 'task-a' }, { id: 'item-a' }] },
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('serves authenticated GET/POST with exact CORS preflight support', async () => {
    const server = createDeviceSyncCloudServer({
      tokenAccounts: new Map([[TOKEN, ACCOUNT]]),
      allowedOrigins: [ORIGIN],
    });
    servers.push(server);
    const { url } = await server.listen();

    const preflight = await fetch(`${url}${TASK_SNAPSHOT_PATH}`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    expect(preflight.status).toBe(204);

    const published = await fetch(`${url}${TASK_SNAPSHOT_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request()),
    });
    expect(published.status).toBe(200);

    const response = await fetch(`${url}${TASK_SNAPSHOT_PATH}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN },
    });
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as TaskSnapshotResponse;
    expect(snapshot).toMatchObject({
      revision: 1,
      snapshot: { tasks: [{ id: 'task-a' }, { id: 'item-a' }] },
    });
  });
});

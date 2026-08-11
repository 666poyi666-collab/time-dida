import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  TASK_SNAPSHOT_PATH,
  TASK_SNAPSHOT_MAX_FUTURE_SKEW_MS,
  TASK_SNAPSHOT_PROTOCOL_VERSION,
  toTaskSnapshotPayload,
  validateTaskSnapshotPayload,
  type TaskSnapshotPublishRequest,
  type TaskSnapshotResponse,
} from '@shared/sync/taskSnapshotProtocol';
import {
  createDeviceSyncCloudServer,
  createDeviceSyncCloudStore,
  DeviceSyncCloudStoreError,
} from '../cloud';

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

  it('rejects an older snapshot and equal-time divergent content', () => {
    const store = createDeviceSyncCloudStore();
    const current = request();
    expect(store.publishTaskSnapshot(ACCOUNT, current).revision).toBe(1);

    for (const candidate of [
      {
        ...request(),
        snapshot: { ...request().snapshot, publishedAt: current.snapshot.publishedAt - 1 },
      },
      {
        ...request(),
        snapshot: {
          ...request().snapshot,
          tasks: request().snapshot.tasks.map((task, index) =>
            index === 0 ? { ...task, title: '相同时间的冲突标题' } : task,
          ),
        },
      },
    ]) {
      expect(() => store.publishTaskSnapshot(ACCOUNT, candidate)).toThrow(
        DeviceSyncCloudStoreError,
      );
    }
    expect(store.getTaskSnapshot(ACCOUNT)).toMatchObject({
      revision: 1,
      snapshot: { tasks: [{ title: '复习化学' }, { title: '整理错题' }] },
    });
  });

  it('rejects future publishes and lets a normal snapshot replace legacy far-future state', () => {
    const baseNow = 1_720_000_000_000;
    let now = baseNow;
    const store = createDeviceSyncCloudStore({ now: () => now });
    const future = {
      ...request(),
      snapshot: {
        ...request().snapshot,
        publishedAt: baseNow + TASK_SNAPSHOT_MAX_FUTURE_SKEW_MS + 1,
      },
    };
    expect(() => store.publishTaskSnapshot(ACCOUNT, future)).toThrow(
      /publishedAt is too far in the future/,
    );

    now = baseNow + TASK_SNAPSHOT_MAX_FUTURE_SKEW_MS + 1;
    const legacy = {
      ...request(),
      snapshot: { ...request().snapshot, publishedAt: now },
    };
    expect(store.publishTaskSnapshot(ACCOUNT, legacy).revision).toBe(1);

    now = baseNow;
    const replacement = request();
    expect(store.publishTaskSnapshot(ACCOUNT, replacement).revision).toBe(2);
    expect(store.getTaskSnapshot(ACCOUNT).snapshot?.publishedAt).toBe(baseNow);
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

    const future = await fetch(`${url}${TASK_SNAPSHOT_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...request(),
        snapshot: {
          ...request().snapshot,
          publishedAt: Date.now() + TASK_SNAPSHOT_MAX_FUTURE_SKEW_MS + 60_000,
        },
      }),
    });
    expect(future.status).toBe(422);
    await expect(future.json()).resolves.toMatchObject({
      error: { code: 'task_snapshot_timestamp_too_far_ahead' },
    });

    const response = await fetch(`${url}${TASK_SNAPSHOT_PATH}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: ORIGIN },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const snapshot = (await response.json()) as TaskSnapshotResponse;
    expect(snapshot).toMatchObject({
      revision: 1,
      snapshot: { tasks: [{ id: 'task-a' }, { id: 'item-a' }] },
    });
  });
});

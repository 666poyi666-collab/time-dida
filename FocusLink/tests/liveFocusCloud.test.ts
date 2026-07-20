import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LIVE_FOCUS_COMMAND_PATH,
  LIVE_FOCUS_PROTOCOL_VERSION,
  LIVE_FOCUS_SNAPSHOT_PATH,
  LIVE_FOCUS_WAIT_PATH,
  type LiveFocusAction,
  type LiveFocusCommandRequest,
  type LiveFocusCommandResponse,
  type LiveFocusSnapshotResponse,
  type LiveFocusWaitResponse,
} from '@shared/sync/liveFocusProtocol';
import {
  LiveFocusWaitAbortedError,
  createDeviceSyncCloudServer,
  createDeviceSyncCloudStore,
  type DeviceSyncCloudServer,
} from '../cloud';

const TOKEN_A = 'live-test-token-account-a';
const TOKEN_B = 'live-test-token-account-b';
const ACCOUNT_A = 'live-account-a';
const ACCOUNT_B = 'live-account-b';
const ORIGIN = 'http://localhost:5175';

function commandRequest(input: {
  commandId: string;
  action: LiveFocusAction;
  expectedRevision: number;
  sessionId?: string;
  deviceId?: string;
  title?: string | null;
  task?: { taskId: string; taskSource: 'local' | 'ticktick'; taskTitle: string | null };
}): LiveFocusCommandRequest {
  const base = {
    commandId: input.commandId,
    action: input.action,
    expectedRevision: input.expectedRevision,
    sessionId: input.sessionId ?? 'live-session-1',
  };
  return {
    protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
    deviceId: input.deviceId ?? 'phone-a',
    command:
      input.action === 'start'
        ? {
            ...base,
            action: 'start',
            title: input.title ?? '复习化学',
            task: input.task,
          }
        : { ...base, action: input.action },
  };
}

describe('live focus cloud store', () => {
  it('runs a 60+5+60 session and atomically publishes one completed ledger bundle', () => {
    let now = 1_720_000_000_000;
    const store = createDeviceSyncCloudStore({ now: () => now });

    const start = store.commandLive(
      ACCOUNT_A,
      commandRequest({
        commandId: 'start-1',
        action: 'start',
        expectedRevision: 0,
        task: { taskId: 'chemistry-1', taskSource: 'ticktick', taskTitle: '复习化学' },
      }),
    );
    expect(start.ack.status).toBe('applied');
    expect(start.snapshot).toMatchObject({ revision: 1, state: 'running' });
    expect(start.snapshot.session).toMatchObject({
      task: { taskId: 'chemistry-1', taskSource: 'ticktick', taskTitle: '复习化学' },
      segments: [{ endedAt: null }],
      pauses: [],
    });

    now += 60_000;
    const running = store.getLiveSnapshot(ACCOUNT_A);
    expect(running.snapshot.session).toMatchObject({
      activeElapsedMs: 60_000,
      pauseElapsedMs: 0,
      wallElapsedMs: 60_000,
    });

    const pause = store.commandLive(
      ACCOUNT_A,
      commandRequest({ commandId: 'pause-1', action: 'pause', expectedRevision: 1 }),
    );
    expect(pause.snapshot.state).toBe('paused');

    now += 5_000;
    expect(store.getLiveSnapshot(ACCOUNT_A).snapshot.session).toMatchObject({
      activeElapsedMs: 60_000,
      pauseElapsedMs: 5_000,
      wallElapsedMs: 65_000,
    });

    const resume = store.commandLive(
      ACCOUNT_A,
      commandRequest({
        commandId: 'resume-1',
        action: 'resume',
        expectedRevision: 2,
        deviceId: 'tablet-b',
      }),
    );
    expect(resume.snapshot).toMatchObject({ revision: 3, state: 'running' });

    now += 60_000;
    const finishRequest = commandRequest({
      commandId: 'finish-1',
      action: 'finish',
      expectedRevision: 3,
      deviceId: 'tablet-b',
    });
    const finish = store.commandLive(ACCOUNT_A, finishRequest);
    expect(finish).toMatchObject({
      ack: {
        status: 'applied',
        revision: 4,
        completedEntityId: 'live-session-1',
      },
      snapshot: { revision: 4, state: 'idle', session: null },
    });

    const ledger = store.sync(ACCOUNT_A, {
      protocolVersion: 1,
      deviceId: 'phone-a',
      cursor: null,
      mutations: [],
      pullLimit: 10,
    });
    expect(ledger.changes).toHaveLength(1);
    const bundle = ledger.changes[0].payload;
    expect(bundle?.session).toMatchObject({
      id: 'live-session-1',
      status: 'finished',
      activeElapsedMs: 120_000,
      pauseElapsedMs: 5_000,
      wallElapsedMs: 125_000,
      defaultTaskId: 'chemistry-1',
      defaultTaskSource: 'ticktick',
      defaultTaskTitle: '复习化学',
    });
    expect(bundle?.segments).toHaveLength(2);
    expect(bundle?.segments.every((segment) => segment.taskId === 'chemistry-1')).toBe(true);
    expect(bundle?.pauses).toHaveLength(1);

    const duplicate = store.commandLive(ACCOUNT_A, finishRequest);
    expect(duplicate.ack).toMatchObject({ status: 'duplicate', revision: 4 });
    expect(store.inspectAccount(ACCOUNT_A)).toMatchObject({
      changeCount: 1,
      entityCount: 1,
      liveRevision: 4,
      liveState: 'idle',
    });
  });

  it('allows only one concurrent revision winner and rejects stale or mismatched sessions', () => {
    const store = createDeviceSyncCloudStore({ now: () => 1_720_000_000_000 });
    store.commandLive(
      ACCOUNT_A,
      commandRequest({ commandId: 'start-1', action: 'start', expectedRevision: 0 }),
    );

    const pause = store.commandLive(
      ACCOUNT_A,
      commandRequest({ commandId: 'pause-1', action: 'pause', expectedRevision: 1 }),
    );
    expect(pause.ack.status).toBe('applied');

    const stale = store.commandLive(
      ACCOUNT_A,
      commandRequest({ commandId: 'finish-stale', action: 'finish', expectedRevision: 1 }),
    );
    expect(stale.ack).toMatchObject({
      status: 'conflict',
      revision: 2,
      errorCode: 'revision_conflict',
    });
    expect(stale.snapshot.state).toBe('paused');

    const mismatch = store.commandLive(
      ACCOUNT_A,
      commandRequest({
        commandId: 'resume-wrong-session',
        action: 'resume',
        expectedRevision: 2,
        sessionId: 'another-session',
      }),
    );
    expect(mismatch.ack).toMatchObject({ status: 'rejected', errorCode: 'session_mismatch' });

    const reused = store.commandLive(
      ACCOUNT_A,
      commandRequest({ commandId: 'pause-1', action: 'resume', expectedRevision: 2 }),
    );
    expect(reused.ack).toMatchObject({
      status: 'rejected',
      errorCode: 'command_id_reused',
    });
    expect(store.getLiveSnapshot(ACCOUNT_B).snapshot).toEqual({
      revision: 0,
      state: 'idle',
      session: null,
    });
  });

  it('wakes bounded waits on revision changes and removes aborted waiters', async () => {
    const store = createDeviceSyncCloudStore({ now: () => 1_720_000_000_000 });
    const changedPromise = store.waitForLiveSnapshot(ACCOUNT_A, 0, 1_000);
    await Promise.resolve();
    expect(store.inspectAccount(ACCOUNT_A).liveWaiterCount).toBe(1);
    store.commandLive(
      ACCOUNT_A,
      commandRequest({ commandId: 'start-1', action: 'start', expectedRevision: 0 }),
    );
    await expect(changedPromise).resolves.toMatchObject({
      changed: true,
      snapshot: { revision: 1, state: 'running' },
    });
    expect(store.inspectAccount(ACCOUNT_A).liveWaiterCount).toBe(0);

    await expect(store.waitForLiveSnapshot(ACCOUNT_A, 1, 1)).resolves.toMatchObject({
      changed: false,
      snapshot: { revision: 1 },
    });

    const controller = new AbortController();
    const aborted = store.waitForLiveSnapshot(ACCOUNT_A, 1, 1_000, controller.signal);
    await Promise.resolve();
    expect(store.inspectAccount(ACCOUNT_A).liveWaiterCount).toBe(1);
    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(LiveFocusWaitAbortedError);
    expect(store.inspectAccount(ACCOUNT_A).liveWaiterCount).toBe(0);
  });

  it('persists active boundaries and command idempotency while loading pre-live v1 stores', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-live-cloud-'));
    const filePath = path.join(directory, 'store.json');
    let now = 1_720_000_000_000;
    try {
      const first = createDeviceSyncCloudStore({ persistencePath: filePath, now: () => now });
      const request = commandRequest({
        commandId: 'start-persisted',
        action: 'start',
        expectedRevision: 0,
      });
      first.commandLive(ACCOUNT_A, request);
      now += 30_000;

      const restored = createDeviceSyncCloudStore({ persistencePath: filePath, now: () => now });
      expect(restored.getLiveSnapshot(ACCOUNT_A).snapshot.session).toMatchObject({
        activeElapsedMs: 30_000,
        wallElapsedMs: 30_000,
      });
      expect(restored.commandLive(ACCOUNT_A, request).ack.status).toBe('duplicate');

      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
        accounts: Array<[string, Record<string, unknown>]>;
      };
      delete parsed.accounts[0][1].live;
      fs.writeFileSync(filePath, JSON.stringify(parsed), 'utf8');
      const migrated = createDeviceSyncCloudStore({ persistencePath: filePath, now: () => now });
      expect(migrated.getLiveSnapshot(ACCOUNT_A).snapshot).toEqual({
        revision: 0,
        state: 'idle',
        session: null,
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('live focus HTTP routes', () => {
  let server: DeviceSyncCloudServer | null = null;

  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  async function startServer(): Promise<string> {
    server = createDeviceSyncCloudServer({
      tokenAccounts: new Map([
        [TOKEN_A, ACCOUNT_A],
        [TOKEN_B, ACCOUNT_B],
      ]),
      allowedOrigins: [ORIGIN],
    });
    return (await server.listen()).url;
  }

  async function readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T;
  }

  it('authenticates snapshot/command/wait and permits exact CORS preflights', async () => {
    const baseUrl = await startServer();
    expect(await fetch(`${baseUrl}${LIVE_FOCUS_SNAPSHOT_PATH}`)).toMatchObject({ status: 401 });

    const preflight = await fetch(`${baseUrl}${LIVE_FOCUS_COMMAND_PATH}`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN);

    const getPreflight = await fetch(`${baseUrl}${LIVE_FOCUS_WAIT_PATH}`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    expect(getPreflight.status).toBe(204);

    const command = await fetch(`${baseUrl}${LIVE_FOCUS_COMMAND_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN_A}`,
        'Content-Type': 'application/json',
        Origin: ORIGIN,
      },
      body: JSON.stringify(
        commandRequest({ commandId: 'http-start', action: 'start', expectedRevision: 0 }),
      ),
    });
    expect(command.status).toBe(200);
    expect((await readJson<LiveFocusCommandResponse>(command)).ack.status).toBe('applied');

    const snapshot = await fetch(`${baseUrl}${LIVE_FOCUS_SNAPSHOT_PATH}`, {
      headers: { Authorization: `Bearer ${TOKEN_A}`, Origin: ORIGIN },
    });
    expect(snapshot.status).toBe(200);
    expect((await readJson<LiveFocusSnapshotResponse>(snapshot)).snapshot.state).toBe('running');

    const isolated = await fetch(`${baseUrl}${LIVE_FOCUS_SNAPSHOT_PATH}`, {
      headers: { Authorization: `Bearer ${TOKEN_B}` },
    });
    expect((await readJson<LiveFocusSnapshotResponse>(isolated)).snapshot.state).toBe('idle');

    const wait = await fetch(`${baseUrl}${LIVE_FOCUS_WAIT_PATH}?afterRevision=0&waitMs=0`, {
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    expect(wait.status).toBe(200);
    expect(await readJson<LiveFocusWaitResponse>(wait)).toMatchObject({
      changed: true,
      snapshot: { revision: 1 },
    });
  });

  it('rejects malformed queries, unsupported fields, and command bodies above 16 KiB', async () => {
    const baseUrl = await startServer();
    const authorization = { Authorization: `Bearer ${TOKEN_A}` };
    expect(
      await fetch(`${baseUrl}${LIVE_FOCUS_WAIT_PATH}?afterRevision=0`, {
        headers: authorization,
      }),
    ).toMatchObject({ status: 400 });
    expect(
      await fetch(`${baseUrl}${LIVE_FOCUS_WAIT_PATH}?afterRevision=0&waitMs=25001`, {
        headers: authorization,
      }),
    ).toMatchObject({ status: 400 });

    const forged = await fetch(`${baseUrl}${LIVE_FOCUS_COMMAND_PATH}`, {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...commandRequest({ commandId: 'forged', action: 'start', expectedRevision: 0 }),
        accountId: ACCOUNT_B,
      }),
    });
    expect(forged.status).toBe(400);

    const oversized = await fetch(`${baseUrl}${LIVE_FOCUS_COMMAND_PATH}`, {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(17 * 1024) }),
    });
    expect(oversized.status).toBe(413);
  });
});

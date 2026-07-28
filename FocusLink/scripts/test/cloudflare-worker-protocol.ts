import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  DEVICE_SYNC_ENTITY,
  DEVICE_SYNC_PROTOCOL_VERSION,
  makeDeviceSyncOperationId,
  type DeviceSyncMutation,
  type DeviceSyncResponse,
  type DeviceSyncSessionBundle,
} from '../../shared/sync/deviceProtocol';
import type {
  LiveFocusCommandRequest,
  LiveFocusCommandResponse,
  LiveFocusSnapshotResponse,
  LiveFocusWaitResponse,
} from '../../shared/sync/liveFocusProtocol';
import type { TaskSnapshotResponse } from '../../shared/sync/taskSnapshotProtocol';

const endpoint = (process.env.FOCUSLINK_TEST_ENDPOINT ?? '').replace(/\/$/, '');
const token = process.env.FOCUSLINK_TEST_TOKEN ?? '';
const mode = process.argv[2] ?? 'run';
const statePath = path.resolve(
  process.env.FOCUSLINK_TEST_STATE ?? '.tmp/cloudflare-worker-protocol-state.json',
);

assert(endpoint, 'FOCUSLINK_TEST_ENDPOINT is required');
assert(token, 'FOCUSLINK_TEST_TOKEN is required');

interface SavedState {
  runId: string;
  firstEntityId: string;
  secondEntityId: string;
  liveEntityId: string;
  cursor: string;
  taskRevision: number;
  liveRevision: number;
}

void main();

async function main(): Promise<void> {
  if (mode === 'verify') {
    await verifyPersistence(JSON.parse(fs.readFileSync(statePath, 'utf8')) as SavedState);
  } else {
    await runProtocol();
  }
}

async function runProtocol(): Promise<void> {
  const runId = `cf-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const health = await raw('/health');
  assert.equal(health.status, 200);
  assert.equal(((await health.json()) as { storage: string }).storage, 'sqlite-durable-object');

  const unauthenticated = await raw(`/sync/v2/live?probe=${Date.now()}`, {}, false);
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), {
    error: { code: 'unauthenticated', message: 'valid Bearer token required' },
  });
  const invalidCursor = await raw('/v1/sync', {
    method: 'POST',
    body: JSON.stringify({
      protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
      deviceId: 'cloudflare-regression',
      cursor: 'cursor-from-another-account',
      mutations: [],
      pullLimit: 1,
    }),
  });
  assert.equal(invalidCursor.status, 400);
  assert.deepEqual(await invalidCursor.json(), {
    error: { code: 'invalid_cursor', message: 'cursor is invalid for this account' },
  });

  const first = makeBundle(`${runId}-one`, `${runId}-one`);
  const firstMutation = putMutation(first, 0);
  const applied = await sync(null, [firstMutation]);
  assert.equal(applied.acks[0]?.status, 'applied');
  assert.equal(applied.changes.filter((change) => change.entityId === first.session.id).length, 1);

  const duplicate = await sync(applied.nextCursor, [firstMutation]);
  assert.equal(duplicate.acks[0]?.status, 'duplicate');

  const reused = await sync(applied.nextCursor, [
    { ...firstMutation, entityId: `${first.session.id}-reused` },
  ]);
  assert.equal(reused.acks[0]?.status, 'rejected');
  assert.equal(reused.acks[0]?.errorCode, 'op_id_reused');

  const changed = makeBundle(first.session.id, `${runId}-changed`);
  const stale = await sync(applied.nextCursor, [putMutation(changed, 0)]);
  assert.equal(stale.acks[0]?.status, 'conflict');
  assert.equal(stale.acks[0]?.revision, 1);

  const second = makeBundle(`${runId}-two`, `${runId}-two`);
  const secondApplied = await sync(applied.nextCursor, [putMutation(second, 0)]);
  assert.equal(secondApplied.acks[0]?.status, 'applied');
  assert.deepEqual(
    secondApplied.changes.map((change) => change.entityId),
    [second.session.id],
  );

  const tasks = await request<TaskSnapshotResponse>('/sync/v2/tasks', {
    method: 'POST',
    body: JSON.stringify({
      protocolVersion: 1,
      deviceId: `${runId}-desktop`,
      snapshot: {
        publishedAt: Date.now(),
        projects: [
          { id: `${runId}-project`, source: 'local', name: 'Cloudflare regression', color: null },
        ],
        tasks: [
          {
            id: `${runId}-task`,
            source: 'local',
            projectId: `${runId}-project`,
            title: 'Cloudflare regression task',
            status: 'pending',
            priority: null,
            dueDate: null,
            tags: [],
            parentId: null,
            isCompleted: false,
            updatedAt: null,
          },
        ],
      },
    }),
  });
  const taskRead = await request<TaskSnapshotResponse>('/sync/v2/tasks');
  assert.equal(taskRead.revision, tasks.revision);
  assert.equal(taskRead.snapshot?.tasks.length, 1);

  const initialLive = await request<LiveFocusSnapshotResponse>('/sync/v2/live');
  assert.equal(initialLive.snapshot.state, 'idle');
  const liveEntityId = `${runId}-live`;
  const start = liveRequest(
    `${runId}-start`,
    'start',
    initialLive.snapshot.revision,
    liveEntityId,
    runId,
  );
  const started = await liveCommand(start);
  assert.equal(started.ack.status, 'applied');
  const startDuplicate = await liveCommand(start);
  assert.equal(startDuplicate.ack.status, 'duplicate');

  const conflict = await liveCommand(
    liveRequest(`${runId}-stale`, 'pause', initialLive.snapshot.revision, liveEntityId),
  );
  assert.equal(conflict.ack.status, 'conflict');

  const paused = await liveCommand(
    liveRequest(`${runId}-pause`, 'pause', started.snapshot.revision, liveEntityId),
  );
  assert.equal(paused.snapshot.state, 'paused');
  await delay(20);
  const resumed = await liveCommand(
    liveRequest(`${runId}-resume`, 'resume', paused.snapshot.revision, liveEntityId),
  );
  assert.equal(resumed.snapshot.state, 'running');
  await delay(20);
  const finished = await liveCommand(
    liveRequest(`${runId}-finish`, 'finish', resumed.snapshot.revision, liveEntityId),
  );
  assert.equal(finished.snapshot.state, 'idle');
  assert.equal(finished.ack.completedEntityId, liveEntityId);

  const waited = await request<LiveFocusWaitResponse>(
    `/sync/v2/live/wait?afterRevision=${resumed.snapshot.revision}&waitMs=100`,
  );
  assert.equal(waited.changed, true);

  const ledger = await sync(secondApplied.nextCursor, []);
  assert.equal(
    ledger.changes.some((change) => change.entityId === liveEntityId),
    true,
  );
  const state: SavedState = {
    runId,
    firstEntityId: first.session.id,
    secondEntityId: second.session.id,
    liveEntityId,
    cursor: ledger.nextCursor,
    taskRevision: taskRead.revision,
    liveRevision: finished.snapshot.revision,
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, phase: 'run', ...state }));
}

async function verifyPersistence(state: SavedState): Promise<void> {
  const pulled = await sync(null, []);
  const ids = new Set(pulled.changes.map((change) => change.entityId));
  assert(ids.has(state.firstEntityId));
  assert(ids.has(state.secondEntityId));
  assert(ids.has(state.liveEntityId));
  const tasks = await request<TaskSnapshotResponse>('/sync/v2/tasks');
  assert(tasks.revision >= state.taskRevision);
  const live = await request<LiveFocusSnapshotResponse>('/sync/v2/live');
  assert(live.snapshot.revision >= state.liveRevision);
  assert.equal(live.snapshot.state, 'idle');
  console.log(JSON.stringify({ ok: true, phase: 'verify', ...state }));
}

function makeBundle(id: string, title: string): DeviceSyncSessionBundle {
  const startedAt = Date.now() - 2_000;
  const endedAt = startedAt + 1_000;
  return {
    session: {
      id,
      title,
      status: 'finished',
      startedAt,
      endedAt,
      activeElapsedMs: 1_000,
      pauseElapsedMs: 0,
      wallElapsedMs: 1_000,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      note: null,
      createdAt: startedAt,
      updatedAt: endedAt,
    },
    segments: [
      {
        id: `${id}-segment`,
        sessionId: id,
        taskId: null,
        taskSource: null,
        title,
        startedAt,
        endedAt,
        activeElapsedMs: 1_000,
        note: null,
        tomatodoSubject: null,
        createdAt: startedAt,
        updatedAt: endedAt,
      },
    ],
    pauses: [],
  };
}

function putMutation(bundle: DeviceSyncSessionBundle, baseRevision: number): DeviceSyncMutation {
  return {
    opId: makeDeviceSyncOperationId(bundle.session.id, 'put', baseRevision, bundle),
    entity: DEVICE_SYNC_ENTITY,
    entityId: bundle.session.id,
    kind: 'put',
    baseRevision,
    payload: bundle,
  };
}

async function sync(
  cursor: string | null,
  mutations: DeviceSyncMutation[],
): Promise<DeviceSyncResponse> {
  return request<DeviceSyncResponse>('/v1/sync', {
    method: 'POST',
    body: JSON.stringify({
      protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
      deviceId: 'cloudflare-regression',
      cursor,
      mutations,
      pullLimit: 500,
    }),
  });
}

function liveRequest(
  commandId: string,
  action: 'start' | 'pause' | 'resume' | 'finish',
  expectedRevision: number,
  sessionId: string,
  title?: string,
): LiveFocusCommandRequest {
  return {
    protocolVersion: 1,
    deviceId: 'cloudflare-regression',
    command:
      action === 'start'
        ? { commandId, action, expectedRevision, sessionId, title: title ?? null, task: null }
        : { commandId, action, expectedRevision, sessionId },
  };
}

async function liveCommand(body: LiveFocusCommandRequest): Promise<LiveFocusCommandResponse> {
  return request<LiveFocusCommandResponse>('/sync/v2/live/command', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await raw(pathname, init);
  const text = await response.text();
  assert.equal(response.ok, true, `${pathname} failed (${response.status}): ${text}`);
  return JSON.parse(text) as T;
}

function raw(pathname: string, init: RequestInit = {}, authenticated = true): Promise<Response> {
  const headers = new Headers(init.headers);
  if (authenticated) headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');
  return fetch(`${endpoint}${pathname}`, { ...init, headers });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

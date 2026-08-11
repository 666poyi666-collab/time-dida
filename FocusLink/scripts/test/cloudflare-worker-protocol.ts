import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
  validateFocusLinkDeviceRegistrationResponse,
} from '../../shared/sync/identityProtocol';
import type {
  LiveFocusCommandRequest,
  LiveFocusCommandResponse,
  LiveFocusSnapshotResponse,
  LiveFocusWaitResponse,
} from '../../shared/sync/liveFocusProtocol';
import {
  TASK_SNAPSHOT_MAX_FUTURE_SKEW_MS,
  type TaskSnapshotResponse,
} from '../../shared/sync/taskSnapshotProtocol';
import {
  SYNC_V2_PROTOCOL_VERSION,
  parseDeviceToken,
  type FocusMetadataV2,
  type SyncV2Mutation,
  type SyncV2Response,
} from '../../shared/sync/v2Protocol';

type GateMode = 'local' | 'run' | 'verify' | 'self-check';

interface EpochStatus {
  protocolVersion: typeof SYNC_V2_PROTOCOL_VERSION;
  syncEpoch: string;
  cursorEpoch: string;
  accountGeneration: number;
  changeSeq: number;
  serverTime: number;
}

interface DeviceCredential {
  deviceToken: string;
  deviceId: string;
  installationId: string;
}

interface ProtocolContext extends DeviceCredential {
  endpoint: string;
}

interface SavedState {
  runId: string;
  installationId: string;
  deviceId: string;
  firstMutation: SyncV2Mutation;
  syncEntityIds: string[];
  cursor: string;
  taskId: string;
  taskRevision: number;
  liveEntityId: string;
  liveRevision: number;
}

interface LocalAuthoritySecrets {
  syncToken: string;
  devicePepper: string;
  mcpServiceToken: string;
  pairAuthorityToken: string;
  identityAuthorityToken: string;
  authorityCapability: string;
  ownerSubject: string;
}

interface RunningWrangler {
  child: ChildProcess;
  endpoint: string;
  output: () => string;
}

interface ExternalStateFile {
  state: SavedState;
  identity: StateFileIdentity;
}

interface StateFileIdentity {
  dev: bigint;
  ino: bigint;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../..');
const defaultStatePath = path.resolve(
  process.env.FOCUSLINK_TEST_STATE ??
    process.argv[3] ??
    '.tmp/cloudflare-worker-protocol-state.json',
);
const EXTERNAL_LOOPBACK_WRITE_OPT_IN = 'FOCUSLINK_TEST_ALLOW_EXTERNAL_LOOPBACK_WRITE';
const SAFE_EXTERNAL_STATE_FILE_NAME =
  /^cloudflare-(?:worker-)?(?:protocol|v2)-state(?:-[A-Za-z0-9._-]+)?\.json$/;
const WRANGLER_RUNTIME_ENV_ALLOWLIST = new Set([
  'PATH',
  'Path',
  'path',
  'PATHEXT',
  'ComSpec',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
]);

void main().catch((error) => {
  console.error(redactError(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const mode = parseMode(process.argv[2] ?? 'local');
  if (mode === 'self-check') {
    runSelfCheck();
    return;
  }
  if (mode === 'local') {
    await runIsolatedLocalGate();
    return;
  }
  await runAgainstExistingWorker(mode, defaultStatePath);
}

function parseMode(value: string): GateMode {
  if (value === 'local' || value === 'run' || value === 'verify' || value === 'self-check') {
    return value;
  }
  throw new Error('mode must be local, run, verify, or self-check');
}

async function runAgainstExistingWorker(mode: 'run' | 'verify', statePath: string) {
  requireExternalLoopbackWriteOptIn();
  const safeStatePath = requireSafeExternalStatePath(statePath);
  if (process.env.FOCUSLINK_TEST_TOKEN) {
    throw new Error(
      'FOCUSLINK_TEST_TOKEN is retired: never pass FOCUSLINK_SYNC_TOKEN as a device credential; use FOCUSLINK_TEST_DEVICE_TOKEN',
    );
  }
  const endpoint = requireLoopbackEndpoint(process.env.FOCUSLINK_TEST_ENDPOINT ?? '');
  const saved = mode === 'verify' ? readExternalState(safeStatePath).state : null;
  const installationId = saved?.installationId ?? makeInstallationId();
  const credential = await resolveExternalCredential(endpoint, installationId);
  if (saved && credential.deviceId !== saved.deviceId) {
    throw new Error('verify credential belongs to a different device than the saved run');
  }
  const context: ProtocolContext = { endpoint, ...credential };
  if (mode === 'run') {
    const state = await runProtocol(context);
    writeExternalState(safeStatePath, state);
    printPhase('run', state);
    return;
  }
  await verifyPersistence(context, saved!);
  // The state path can be a user-supplied safe-name regular file.  We cannot prove that this
  // process created it, so external verification deliberately retains it for explicit cleanup.
  printPhase('verify', saved!, { externalStateRetained: true });
}

async function runIsolatedLocalGate(): Promise<void> {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-cloudflare-gate-'));
  const persistPath = path.join(temporaryRoot, 'persist');
  const statePath = path.join(temporaryRoot, 'protocol-state.json');
  const envPath = path.join(temporaryRoot, 'wrangler.env');
  const secrets = createLocalAuthoritySecrets();
  const installationId = makeInstallationId();
  let running: RunningWrangler | null = null;

  fs.mkdirSync(persistPath, { recursive: true });
  writeLocalEnv(envPath, secrets);
  try {
    running = await startWrangler(envPath, persistPath, secrets);
    const credential = await issueLocalDeviceCredential(
      running.endpoint,
      secrets.identityAuthorityToken,
      secrets.ownerSubject,
      installationId,
    );
    const context: ProtocolContext = { endpoint: running.endpoint, ...credential };
    const state = await runProtocol(context);
    writeState(statePath, state);
    printPhase('run', state);

    await stopWrangler(running);
    running = null;

    running = await startWrangler(envPath, persistPath, secrets);
    await verifyPersistence({ ...context, endpoint: running.endpoint }, readState(statePath));
    fs.rmSync(statePath, { force: true });
    printPhase('verify', state);
  } finally {
    if (running) await stopWrangler(running);
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
  }
  assert.equal(fs.existsSync(temporaryRoot), false, 'isolated Wrangler state was not cleaned');
  console.log(
    JSON.stringify({
      ok: true,
      phase: 'local-gate',
      loopbackOnly: true,
      ephemeralCredential: true,
      restarted: true,
      cleaned: true,
    }),
  );
}

async function resolveExternalCredential(
  endpoint: string,
  installationId: string,
): Promise<DeviceCredential> {
  const deviceToken = (process.env.FOCUSLINK_TEST_DEVICE_TOKEN ?? '').trim();
  if (deviceToken) {
    if (deviceToken === process.env.FOCUSLINK_SYNC_TOKEN) {
      throw new Error('FOCUSLINK_TEST_DEVICE_TOKEN must not be FOCUSLINK_SYNC_TOKEN');
    }
    const parsed = parseDeviceToken(deviceToken);
    if (!parsed) {
      throw new Error('FOCUSLINK_TEST_DEVICE_TOKEN must be a server-issued fl2 credential');
    }
    return {
      deviceToken,
      deviceId: 'device-' + parsed.devicePublicId,
      installationId,
    };
  }

  const identityAuthorityToken = (process.env.FOCUSLINK_TEST_IDENTITY_AUTHORITY_TOKEN ?? '').trim();
  const ownerSubject = (process.env.FOCUSLINK_TEST_OWNER_SUBJECT ?? '').trim();
  if (identityAuthorityToken || ownerSubject) {
    if (!identityAuthorityToken || !ownerSubject) {
      throw new Error(
        'FOCUSLINK_TEST_IDENTITY_AUTHORITY_TOKEN and FOCUSLINK_TEST_OWNER_SUBJECT must be set together',
      );
    }
    return issueLocalDeviceCredential(
      endpoint,
      identityAuthorityToken,
      ownerSubject,
      installationId,
    );
  }

  throw new Error(
    'FOCUSLINK_TEST_DEVICE_TOKEN is required unless test-only identity authority credentials are supplied',
  );
}

async function issueLocalDeviceCredential(
  endpoint: string,
  identityAuthorityToken: string,
  ownerSubject: string,
  installationId: string,
): Promise<DeviceCredential> {
  if (!/^fia_[A-Za-z0-9_-]{43,160}$/.test(identityAuthorityToken)) {
    throw new Error('test identity authority credential is invalid');
  }
  if (!/^[A-Za-z0-9._~-]{3,128}$/.test(ownerSubject)) {
    throw new Error('test owner subject is invalid');
  }
  const response = await fetch(endpoint + '/sync/v1/devices/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-focuslink-identity-authority': identityAuthorityToken,
      'x-focuslink-owner-subject': ownerSubject,
    },
    body: JSON.stringify({
      protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
      installationId,
      displayName: 'FocusLink local protocol gate',
      platform: 'windows',
      deviceKind: 'desktop',
      appVersion: '0.0.0-test',
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      '/sync/v1/devices/register failed (' +
        response.status +
        '): ' +
        redactText(text, [identityAuthorityToken]),
    );
  }
  const value: unknown = parseJson(text, '/sync/v1/devices/register');
  if (!validateFocusLinkDeviceRegistrationResponse(value)) {
    throw new Error('/sync/v1/devices/register returned an invalid credential envelope');
  }
  const parsed = parseDeviceToken(value.accessToken);
  assert(parsed, 'issued credential is not a canonical fl2 token');
  assert.equal(value.deviceId, 'device-' + parsed.devicePublicId);
  return {
    deviceToken: value.accessToken,
    deviceId: value.deviceId,
    installationId,
  };
}

async function runProtocol(context: ProtocolContext): Promise<SavedState> {
  await assertHealth(context.endpoint);
  const runId = 'cf-' + Date.now() + '-' + randomToken(8);

  const unauthenticated = await fetch(context.endpoint + '/sync/v2/status', {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal(await responseErrorCode(unauthenticated), 'unauthenticated');

  const oauthLike = await fetch(context.endpoint + '/sync/v2/status', {
    method: 'GET',
    headers: { authorization: 'Bearer oauth-looking-token' },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(oauthLike.status, 401);
  assert.equal(await responseErrorCode(oauthLike), 'unauthenticated');

  const status = await request<EpochStatus>(context, '/sync/v2/status', { method: 'GET' });
  assertEpoch(status);

  const invalidCursor = await raw(context, '/sync/v2/exchange', {
    method: 'POST',
    body: JSON.stringify({
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      deviceId: context.deviceId,
      cursor: 'cursor-from-another-account',
      mutations: [],
      pullLimit: 1,
      syncEpoch: status.syncEpoch,
      cursorEpoch: status.cursorEpoch,
      accountGeneration: status.accountGeneration,
    }),
  });
  assert.equal(invalidCursor.status, 409);
  assert.equal(await responseErrorCode(invalidCursor), 'invalid_cursor');

  const firstMutation = makeMetadataMutation(
    runId + '-one',
    runId + '-op-one',
    'Sync v2 first fixture',
    context.deviceId,
    status.accountGeneration,
  );
  const first = await sync(context, status, null, [firstMutation], 500);
  assert.equal(first.acks[0]?.status, 'applied');
  assert.equal(
    first.changes.some((change) => change.entityId === firstMutation.entityId),
    true,
  );
  assert.match(first.nextCursor, /^c[0-9a-z]+$/);

  const duplicate = await sync(context, first, first.nextCursor, [firstMutation], 500);
  assert.equal(duplicate.acks[0]?.status, 'duplicate');
  assert.equal(duplicate.nextCursor, first.nextCursor);

  const staleMutation: SyncV2Mutation = {
    ...firstMutation,
    opId: runId + '-op-stale',
    payload: {
      ...(firstMutation.payload as FocusMetadataV2),
      title: 'stale update must conflict',
      updatedAt: Date.now(),
    },
  };
  const stale = await sync(context, duplicate, duplicate.nextCursor, [staleMutation], 500);
  assert.equal(stale.acks[0]?.status, 'conflict');
  assert.equal(stale.acks[0]?.errorCode, 'revision_conflict');

  const secondMutation = makeMetadataMutation(
    runId + '-two',
    runId + '-op-two',
    'Sync v2 second fixture',
    context.deviceId,
    status.accountGeneration,
  );
  const thirdMutation = makeMetadataMutation(
    runId + '-three',
    runId + '-op-three',
    'Sync v2 third fixture',
    context.deviceId,
    status.accountGeneration,
  );
  const pageOne = await sync(context, stale, stale.nextCursor, [secondMutation, thirdMutation], 1);
  assert.deepEqual(
    pageOne.acks.map((ack) => ack.status),
    ['applied', 'applied'],
  );
  assert.equal(pageOne.changes.length, 1);
  assert.equal(pageOne.hasMore, true);

  const pageTwo = await sync(context, pageOne, pageOne.nextCursor, [], 1);
  assert.equal(pageTwo.changes.length, 1);
  assert.equal(pageTwo.hasMore, false);
  assert.deepEqual(
    [...pageOne.changes, ...pageTwo.changes].map((change) => change.entityId),
    [secondMutation.entityId, thirdMutation.entityId],
  );
  assert.notEqual(pageOne.nextCursor, pageTwo.nextCursor);

  const taskId = runId + '-task';
  const publishedTasks = await request<TaskSnapshotResponse>(context, '/sync/v2/tasks', {
    method: 'POST',
    body: JSON.stringify({
      protocolVersion: 1,
      deviceId: context.deviceId,
      snapshot: {
        publishedAt: Date.now(),
        projects: [
          {
            id: runId + '-project',
            source: 'local',
            name: 'Cloudflare canonical protocol',
            color: null,
          },
        ],
        tasks: [
          {
            id: taskId,
            source: 'local',
            projectId: runId + '-project',
            title: 'Cloudflare canonical task snapshot',
            status: 'pending',
            priority: null,
            dueDate: null,
            tags: ['cloudflare-gate'],
            parentId: null,
            isCompleted: false,
            updatedAt: null,
          },
        ],
      },
    }),
  });
  assert(publishedTasks.snapshot, 'task publish did not return a snapshot');
  const futureTaskPublish = await raw(context, '/sync/v2/tasks', {
    method: 'POST',
    body: JSON.stringify({
      protocolVersion: 1,
      deviceId: context.deviceId,
      snapshot: {
        ...publishedTasks.snapshot,
        publishedAt: Date.now() + TASK_SNAPSHOT_MAX_FUTURE_SKEW_MS + 60_000,
      },
    }),
  });
  assert.equal(futureTaskPublish.status, 422);
  assert.equal(await responseErrorCode(futureTaskPublish), 'task_snapshot_timestamp_too_far_ahead');
  const staleTaskPublish = await raw(context, '/sync/v2/tasks', {
    method: 'POST',
    body: JSON.stringify({
      protocolVersion: 1,
      deviceId: context.deviceId,
      snapshot: {
        ...publishedTasks.snapshot,
        publishedAt: publishedTasks.snapshot.publishedAt - 1,
      },
    }),
  });
  assert.equal(staleTaskPublish.status, 409);
  assert.equal(await responseErrorCode(staleTaskPublish), 'stale_task_snapshot');
  const equalTimeTaskConflict = await raw(context, '/sync/v2/tasks', {
    method: 'POST',
    body: JSON.stringify({
      protocolVersion: 1,
      deviceId: context.deviceId,
      snapshot: {
        ...publishedTasks.snapshot,
        tasks: publishedTasks.snapshot.tasks.map((task, index) =>
          index === 0 ? { ...task, title: task.title + ' conflict' } : task,
        ),
      },
    }),
  });
  assert.equal(equalTimeTaskConflict.status, 409);
  assert.equal(await responseErrorCode(equalTimeTaskConflict), 'task_snapshot_conflict');
  const taskRead = await request<TaskSnapshotResponse>(context, '/sync/v2/tasks', {
    method: 'GET',
  });
  assert.equal(taskRead.revision, publishedTasks.revision);
  assert.equal(taskRead.sourceDeviceId, context.deviceId);
  assert.equal(taskRead.snapshot?.tasks[0]?.id, taskId);

  const initialLive = await request<LiveFocusSnapshotResponse>(context, '/sync/v2/live', {
    method: 'GET',
  });
  assert.equal(initialLive.snapshot.state, 'idle');
  const liveEntityId = runId + '-live';
  const start = liveRequest(
    context.deviceId,
    runId + '-start',
    'start',
    initialLive.snapshot.revision,
    liveEntityId,
    runId,
  );
  const started = await liveCommand(context, start);
  assert.equal(started.ack.status, 'applied');
  assert.equal(started.snapshot.state, 'running');
  const startDuplicate = await liveCommand(context, start);
  assert.equal(startDuplicate.ack.status, 'duplicate');

  const conflict = await liveCommand(
    context,
    liveRequest(
      context.deviceId,
      runId + '-stale-live',
      'pause',
      initialLive.snapshot.revision,
      liveEntityId,
    ),
  );
  assert.equal(conflict.ack.status, 'conflict');

  const paused = await liveCommand(
    context,
    liveRequest(
      context.deviceId,
      runId + '-pause',
      'pause',
      started.snapshot.revision,
      liveEntityId,
    ),
  );
  assert.equal(paused.snapshot.state, 'paused');
  await delay(20);
  const resumed = await liveCommand(
    context,
    liveRequest(
      context.deviceId,
      runId + '-resume',
      'resume',
      paused.snapshot.revision,
      liveEntityId,
    ),
  );
  assert.equal(resumed.snapshot.state, 'running');
  await delay(20);
  const finished = await liveCommand(
    context,
    liveRequest(
      context.deviceId,
      runId + '-finish',
      'finish',
      resumed.snapshot.revision,
      liveEntityId,
    ),
  );
  assert.equal(finished.snapshot.state, 'idle');
  assert.equal(finished.ack.completedEntityId, liveEntityId);

  const waited = await request<LiveFocusWaitResponse>(
    context,
    '/sync/v2/live/wait?afterRevision=' + resumed.snapshot.revision + '&waitMs=100',
    { method: 'GET' },
  );
  assert.equal(waited.changed, true);

  const liveChanges = await sync(context, pageTwo, pageTwo.nextCursor, [], 500);
  assert.equal(
    liveChanges.changes.some(
      (change) => change.entityId === liveEntityId && change.entityType === 'focus_ledger_v2',
    ),
    true,
  );
  const drained = await sync(context, liveChanges, liveChanges.nextCursor, [], 500);
  assert.equal(drained.changes.length, 0);
  assert.equal(drained.nextCursor, liveChanges.nextCursor);

  return {
    runId,
    installationId: context.installationId,
    deviceId: context.deviceId,
    firstMutation,
    syncEntityIds: [
      firstMutation.entityId,
      secondMutation.entityId,
      thirdMutation.entityId,
      liveEntityId,
    ],
    cursor: drained.nextCursor,
    taskId,
    taskRevision: taskRead.revision,
    liveEntityId,
    liveRevision: finished.snapshot.revision,
  };
}

async function verifyPersistence(context: ProtocolContext, state: SavedState): Promise<void> {
  await assertHealth(context.endpoint);
  assert.equal(context.deviceId, state.deviceId);
  const status = await request<EpochStatus>(context, '/sync/v2/status', { method: 'GET' });
  assertEpoch(status);

  const pulled = await sync(context, status, null, [state.firstMutation], 500);
  assert.equal(pulled.acks[0]?.status, 'duplicate');
  const ids = new Set(pulled.changes.map((change) => change.entityId));
  for (const entityId of state.syncEntityIds) assert(ids.has(entityId));
  assert.equal(pulled.hasMore, false);

  const cursor = await sync(context, pulled, state.cursor, [], 500);
  assert.equal(cursor.changes.length, 0);
  assert.equal(cursor.nextCursor, state.cursor);

  const tasks = await request<TaskSnapshotResponse>(context, '/sync/v2/tasks', { method: 'GET' });
  assert(tasks.revision >= state.taskRevision);
  assert.equal(
    tasks.snapshot?.tasks.some((task) => task.id === state.taskId),
    true,
  );

  const live = await request<LiveFocusSnapshotResponse>(context, '/sync/v2/live', {
    method: 'GET',
  });
  assert(live.snapshot.revision >= state.liveRevision);
  assert.equal(live.snapshot.state, 'idle');
}

function makeMetadataMutation(
  entityId: string,
  opId: string,
  title: string,
  deviceId: string,
  accountGeneration: number,
): SyncV2Mutation {
  const payload: FocusMetadataV2 = {
    sessionId: entityId,
    title,
    note: null,
    subject: 'protocol-gate',
    tags: [{ tagId: 'cloudflare-gate', name: 'cloudflare-gate' }],
    taskAssociation: null,
    updatedAt: Date.now(),
    updatedByDeviceId: deviceId,
  };
  return {
    opId,
    entityType: 'focus_metadata_v2',
    entityId,
    kind: 'put',
    baseRevision: 0,
    baseFingerprint: null,
    payload,
    deviceId,
    accountGeneration,
  };
}

function liveRequest(
  deviceId: string,
  commandId: string,
  action: 'start' | 'pause' | 'resume' | 'finish',
  expectedRevision: number,
  sessionId: string,
  title?: string,
): LiveFocusCommandRequest {
  return {
    protocolVersion: 1,
    deviceId,
    command:
      action === 'start'
        ? { commandId, action, expectedRevision, sessionId, title: title ?? null, task: null }
        : { commandId, action, expectedRevision, sessionId },
  };
}

async function liveCommand(
  context: ProtocolContext,
  body: LiveFocusCommandRequest,
): Promise<LiveFocusCommandResponse> {
  return request(context, '/sync/v2/live/command', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function sync(
  context: ProtocolContext,
  epoch: Pick<EpochStatus, 'syncEpoch' | 'cursorEpoch' | 'accountGeneration'>,
  cursor: string | null,
  mutations: SyncV2Mutation[],
  pullLimit: number,
): Promise<SyncV2Response> {
  return request(context, '/sync/v2/exchange', {
    method: 'POST',
    body: JSON.stringify({
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      deviceId: context.deviceId,
      cursor,
      mutations,
      pullLimit,
      syncEpoch: epoch.syncEpoch,
      cursorEpoch: epoch.cursorEpoch,
      accountGeneration: epoch.accountGeneration,
    }),
  });
}

async function request<T>(
  context: ProtocolContext,
  pathname: string,
  init: RequestInit,
): Promise<T> {
  const response = await raw(context, pathname, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      pathname + ' failed (' + response.status + '): ' + redactText(text, [context.deviceToken]),
    );
  }
  return parseJson(text, pathname) as T;
}

function raw(
  context: ProtocolContext,
  pathname: string,
  init: RequestInit = {},
): Promise<Response> {
  const target = new URL(pathname, context.endpoint + '/');
  assert.equal(target.origin, context.endpoint, 'request escaped the loopback test origin');
  const headers = new Headers(init.headers);
  headers.set('authorization', 'Bearer ' + context.deviceToken);
  if (init.body) headers.set('content-type', 'application/json');
  return fetch(target, {
    ...init,
    headers,
    redirect: 'error',
    signal: init.signal ?? AbortSignal.timeout(5_000),
  });
}

async function assertHealth(endpoint: string): Promise<void> {
  const response = await fetch(endpoint + '/healthz', {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200);
  const value = parseJson(await response.text(), '/healthz') as Record<string, unknown>;
  assert.equal(value.storage, 'sqlite-durable-object');
  assert.equal(value.syncV2ProtocolVersion, SYNC_V2_PROTOCOL_VERSION);
  assert.equal(value.publicIngress, false);
}

function assertEpoch(value: EpochStatus): void {
  assert.equal(value.protocolVersion, SYNC_V2_PROTOCOL_VERSION);
  assert.equal(typeof value.syncEpoch, 'string');
  assert(value.syncEpoch.length > 0);
  assert.equal(typeof value.cursorEpoch, 'string');
  assert(value.cursorEpoch.length > 0);
  assert(Number.isSafeInteger(value.accountGeneration));
  assert(value.accountGeneration >= 1);
  assert(Number.isSafeInteger(value.changeSeq));
}

async function responseErrorCode(response: Response): Promise<string | null> {
  const value = parseJson(await response.text(), 'error response') as {
    error?: { code?: unknown };
  };
  return typeof value.error?.code === 'string' ? value.error.code : null;
}

function requireLoopbackEndpoint(value: string): string {
  if (!value) throw new Error('FOCUSLINK_TEST_ENDPOINT is required');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('FOCUSLINK_TEST_ENDPOINT must be an absolute loopback URL');
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('FOCUSLINK_TEST_ENDPOINT must be http://127.0.0.1:<port>');
  }
  return url.origin;
}

function requireExternalLoopbackWriteOptIn(env: NodeJS.ProcessEnv = process.env): void {
  if (env[EXTERNAL_LOOPBACK_WRITE_OPT_IN] !== '1') {
    throw new Error(
      'external run/verify requires ' +
        EXTERNAL_LOOPBACK_WRITE_OPT_IN +
        '=1 and a disposable loopback Worker',
    );
  }
}

function requireSafeExternalStatePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const allowedRoots = [path.resolve(projectRoot, '.tmp'), path.resolve(os.tmpdir())];
  const parent = path.dirname(resolved);
  const allowedParent = allowedRoots.find((root) => parent === root);
  if (!allowedParent || !SAFE_EXTERNAL_STATE_FILE_NAME.test(path.basename(resolved))) {
    throw new Error(
      'FOCUSLINK_TEST_STATE must be a cloudflare gate state file directly under project .tmp or the system temp directory; unsafe paths are never written or removed',
    );
  }
  assertSafeExternalStateDirectory(allowedParent);
  return resolved;
}

function assertSafeExternalStateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const details = fs.lstatSync(directory);
  const resolvedDirectory = fs.realpathSync.native(directory);
  if (
    !details.isDirectory() ||
    details.isSymbolicLink() ||
    !sameResolvedPath(resolvedDirectory, directory)
  ) {
    throw new Error(
      'FOCUSLINK_TEST_STATE parent must be a real directory, not a junction or symlink',
    );
  }
}

function sameResolvedPath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value).replace(/^\\\\\?\\/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function externalStateNoFollowFlag(): number {
  // Windows has no portable O_NOFOLLOW equivalent; O_EXCL still prevents following an existing
  // file or reparse point on creation, while read/remove revalidate lstat + file identity.
  return process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW;
}

function stateFileIdentity(details: { dev: bigint; ino: bigint }): StateFileIdentity {
  return { dev: details.dev, ino: details.ino };
}

function sameStateFileIdentity(left: StateFileIdentity, right: StateFileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function inspectExternalState(filePath: string): StateFileIdentity {
  requireSafeExternalStatePath(filePath);
  const details = fs.lstatSync(filePath, { bigint: true });
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error('FOCUSLINK_TEST_STATE must be an existing regular file, never a symlink');
  }
  return stateFileIdentity(details);
}

function assertExternalStateAbsent(filePath: string): void {
  requireSafeExternalStatePath(filePath);
  try {
    const details = fs.lstatSync(filePath);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error('FOCUSLINK_TEST_STATE must not be a symlink or non-regular file');
    }
    throw new Error('FOCUSLINK_TEST_STATE already exists; verify or remove the prior safe state');
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
}

function writeExternalState(filePath: string, state: SavedState): void {
  assertExternalStateAbsent(filePath);
  const serialized = serializeState(state);
  const descriptor = fs.openSync(filePath, 'wx', 0o600);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile()) {
      throw new Error('FOCUSLINK_TEST_STATE creation did not produce a regular file');
    }
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readExternalState(filePath: string): ExternalStateFile {
  const expected = inspectExternalState(filePath);
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | externalStateNoFollowFlag());
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameStateFileIdentity(expected, stateFileIdentity(opened))) {
      throw new Error('FOCUSLINK_TEST_STATE changed before it could be read safely');
    }
    const state = JSON.parse(fs.readFileSync(descriptor, 'utf8')) as SavedState;
    return { state, identity: stateFileIdentity(opened) };
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Self-check only: external run/verify never delete user-provided state paths. */
function removeExternalState(filePath: string, expected: StateFileIdentity): void {
  const current = inspectExternalState(filePath);
  if (!sameStateFileIdentity(current, expected)) {
    throw new Error('FOCUSLINK_TEST_STATE changed before safe cleanup');
  }
  fs.unlinkSync(filePath);
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT',
  );
}

function createIsolatedWranglerEnvironment(
  parentEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (!value || /^(?:FOCUSLINK|CLOUDFLARE|CF)_/i.test(key)) continue;
    if (WRANGLER_RUNTIME_ENV_ALLOWLIST.has(key)) environment[key] = value;
  }
  return {
    ...environment,
    CI: '1',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false',
    WRANGLER_SEND_METRICS: 'false',
  };
}

function runSelfCheck(): void {
  const safeProjectState = path.join(
    projectRoot,
    '.tmp',
    'cloudflare-worker-protocol-state-self-check.json',
  );
  const safeSystemState = path.join(os.tmpdir(), 'cloudflare-v2-state-self-check.json');
  assert.equal(requireSafeExternalStatePath(safeProjectState), path.resolve(safeProjectState));
  assert.equal(requireSafeExternalStatePath(safeSystemState), path.resolve(safeSystemState));
  assert.throws(
    () =>
      requireSafeExternalStatePath(path.join(projectRoot, 'cloudflare-worker-protocol-state.json')),
    /project .tmp or the system temp directory/,
  );
  assert.throws(
    () => requireSafeExternalStatePath(path.join(projectRoot, '.tmp', 'unrelated-state.json')),
    /project .tmp or the system temp directory/,
  );
  const nonRegularState = path.join(
    os.tmpdir(),
    `cloudflare-v2-state-nonregular-${randomToken(8)}.json`,
  );
  fs.mkdirSync(nonRegularState);
  try {
    assert.throws(() => readExternalState(nonRegularState), /regular file/);
  } finally {
    fs.rmdirSync(nonRegularState);
  }
  const ownedExternalState = path.join(
    os.tmpdir(),
    `cloudflare-v2-state-self-check-${randomToken(8)}.json`,
  );
  const replacedExternalState = path.join(
    os.tmpdir(),
    `cloudflare-v2-state-self-check-replaced-${randomToken(8)}.json`,
  );
  const selfCheckState: SavedState = {
    runId: 'self-check',
    installationId: 'self-check-installation',
    deviceId: 'self-check-device',
    firstMutation: {
      opId: 'self-check-operation',
      entityType: 'focus_metadata_v2',
      entityId: 'self-check-entity',
      kind: 'delete',
      baseRevision: 0,
      baseFingerprint: null,
      payload: null,
      deviceId: 'self-check-device',
      accountGeneration: 0,
    },
    syncEntityIds: [],
    cursor: 'self-check-cursor',
    taskId: 'self-check-task',
    taskRevision: 0,
    liveEntityId: 'self-check-live',
    liveRevision: 0,
  };
  try {
    writeExternalState(ownedExternalState, selfCheckState);
    assert.throws(
      () => fs.openSync(ownedExternalState, 'wx', 0o600),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST',
      'exclusive external state creation must reject duplicates',
    );
    const original = readExternalState(ownedExternalState);
    assert.equal(typeof original.identity.dev, 'bigint');
    assert.equal(typeof original.identity.ino, 'bigint');
    fs.renameSync(ownedExternalState, replacedExternalState);
    writeExternalState(ownedExternalState, selfCheckState);
    assert.throws(
      () => removeExternalState(ownedExternalState, original.identity),
      /changed before safe cleanup/,
    );
    assert.equal(
      fs.existsSync(ownedExternalState),
      true,
      'identity mismatch must not delete state',
    );
  } finally {
    fs.rmSync(ownedExternalState, { force: true });
    fs.rmSync(replacedExternalState, { force: true });
  }
  assert.throws(() => requireExternalLoopbackWriteOptIn({}), /requires/);
  requireExternalLoopbackWriteOptIn({ [EXTERNAL_LOOPBACK_WRITE_OPT_IN]: '1' });

  const isolatedEnvironment = createIsolatedWranglerEnvironment({
    PATH: 'safe-path',
    HOME: 'safe-home',
    FOCUSLINK_TEST_DEVICE_TOKEN: 'must-not-pass',
    CLOUDFLARE_API_TOKEN: 'must-not-pass',
    CF_ACCOUNT_ID: 'must-not-pass',
    UNRELATED_PARENT_VALUE: 'must-not-pass',
  });
  assert.equal(isolatedEnvironment.PATH, 'safe-path');
  assert.equal(isolatedEnvironment.HOME, 'safe-home');
  assert.equal(isolatedEnvironment.FOCUSLINK_TEST_DEVICE_TOKEN, undefined);
  assert.equal(isolatedEnvironment.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(isolatedEnvironment.CF_ACCOUNT_ID, undefined);
  assert.equal(isolatedEnvironment.UNRELATED_PARENT_VALUE, undefined);
  assert.equal(isolatedEnvironment.CLOUDFLARE_INCLUDE_PROCESS_ENV, 'false');
  assert.equal(isolatedEnvironment.WRANGLER_SEND_ERROR_REPORTS, 'false');
  assert.equal(isolatedEnvironment.WRANGLER_SEND_METRICS, 'false');
  console.log(
    JSON.stringify({
      ok: true,
      phase: 'self-check',
      externalWritesFailClosed: true,
      stateCleanupRestricted: true,
      wranglerEnvironmentIsolated: true,
    }),
  );
}

function writeState(filePath: string, state: SavedState): void {
  const serialized = serializeState(state);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serialized, { encoding: 'utf8', mode: 0o600 });
}

function serializeState(state: SavedState): string {
  const serialized = JSON.stringify(state, null, 2) + '\n';
  assert.equal(/fl2_|Bearer|authorization/i.test(serialized), false, 'state contains a credential');
  return serialized;
}

function readState(filePath: string): SavedState {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SavedState;
}

function printPhase(
  phase: 'run' | 'verify',
  state: SavedState,
  options: { externalStateRetained?: boolean } = {},
): void {
  console.log(
    JSON.stringify({
      ok: true,
      phase,
      runId: state.runId,
      deviceId: state.deviceId,
      canonicalSyncV2: true,
      taskSnapshot: true,
      liveLifecycle: true,
      cursor: true,
      persistence: phase === 'verify',
      ...(options.externalStateRetained ? { externalStateRetained: true } : {}),
    }),
  );
}

function createLocalAuthoritySecrets(): LocalAuthoritySecrets {
  return {
    syncToken: 'internal-' + randomToken(48),
    devicePepper: 'pepper-' + randomToken(48),
    mcpServiceToken: 'mcp-' + randomToken(48),
    pairAuthorityToken: 'fla_' + randomToken(48),
    identityAuthorityToken: 'fia_' + randomToken(48),
    authorityCapability: 'cap-' + randomToken(48),
    ownerSubject: 'focuslink-local-gate',
  };
}

function writeLocalEnv(filePath: string, secrets: LocalAuthoritySecrets): void {
  const values = [
    'FOCUSLINK_SYNC_TOKEN=' + secrets.syncToken,
    'FOCUSLINK_DEVICE_PEPPER=' + secrets.devicePepper,
    'FOCUSLINK_MCP_SERVICE_TOKEN=' + secrets.mcpServiceToken,
    'FOCUSLINK_PAIR_AUTHORITY_TOKEN=' + secrets.pairAuthorityToken,
    'FOCUSLINK_IDENTITY_AUTHORITY_TOKEN=' + secrets.identityAuthorityToken,
    'FOCUSLINK_AUTHORITY_CAPABILITY=' + secrets.authorityCapability,
    'FOCUSLINK_AUTHORITY_AUDIENCE=https://focuslink.local.invalid/authority/identity-focus',
    'FOCUSLINK_OWNER_SUBJECT=' + secrets.ownerSubject,
  ];
  assert.equal(
    new Set(values.map((line) => line.slice(line.indexOf('=') + 1))).size,
    values.length,
  );
  fs.writeFileSync(filePath, values.join('\n') + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

async function startWrangler(
  envPath: string,
  persistPath: string,
  secrets: LocalAuthoritySecrets,
): Promise<RunningWrangler> {
  const [port, inspectorPort] = await loopbackPorts(2);
  const endpoint = 'http://127.0.0.1:' + port;
  const wranglerBin = path.join(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  assert(fs.existsSync(wranglerBin), 'local Wrangler runtime is missing');
  const child = spawn(
    process.execPath,
    [
      wranglerBin,
      'dev',
      '--config',
      path.join(projectRoot, 'wrangler.jsonc'),
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-ip',
      '127.0.0.1',
      '--inspector-port',
      String(inspectorPort),
      '--persist-to',
      persistPath,
      '--env-file',
      envPath,
      '--show-interactive-dev-session=false',
      '--log-level',
      'warn',
    ],
    {
      cwd: projectRoot,
      env: createIsolatedWranglerEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let output = '';
  let spawnError: Error | null = null;
  const append = (chunk: Buffer | string) => {
    output = (output + chunk.toString()).slice(-64 * 1024);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.once('error', (error) => {
    spawnError = error;
  });
  const running = { child, endpoint, output: () => output };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        'Wrangler exited before healthz: ' + redactText(output, Object.values(secrets)),
      );
    }
    try {
      await assertHealth(endpoint);
      return running;
    } catch {
      await delay(100);
    }
  }
  await stopWrangler(running);
  throw new Error('Wrangler did not become healthy: ' + redactText(output, Object.values(secrets)));
}

async function stopWrangler(running: RunningWrangler): Promise<void> {
  const { child, endpoint } = running;
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      child.kill('SIGTERM');
    }
    const exited = await waitForExit(child, 5_000);
    if (!exited) {
      child.kill('SIGKILL');
      if (!(await waitForExit(child, 5_000))) {
        throw new Error('Wrangler process did not exit');
      }
    }
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await fetch(endpoint + '/healthz', { signal: AbortSignal.timeout(200) });
    } catch {
      return;
    }
    await delay(50);
  }
  throw new Error('Wrangler loopback listener was not released');
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

async function loopbackPorts(count: number): Promise<number[]> {
  const ports = new Set<number>();
  while (ports.size < count) ports.add(await loopbackPort());
  return [...ports];
}

function loopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to reserve a loopback port'));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(label + ' returned invalid JSON');
  }
}

function makeInstallationId(): string {
  return 'cloudflare-gate-' + randomToken(24);
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function redactError(error: unknown): string {
  const value = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return redactText(value, [
    process.env.FOCUSLINK_TEST_DEVICE_TOKEN ?? '',
    process.env.FOCUSLINK_TEST_IDENTITY_AUTHORITY_TOKEN ?? '',
    process.env.FOCUSLINK_SYNC_TOKEN ?? '',
  ]);
}

function redactText(value: string, secrets: string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('[credential-redacted]');
  }
  return redacted
    .replace(/\bfl2_[A-Za-z0-9_-]+/g, '[device-credential-redacted]')
    .replace(/\bfia_[A-Za-z0-9_-]+/g, '[identity-authority-redacted]')
    .replace(/\bfla_[A-Za-z0-9_-]+/g, '[pair-authority-redacted]');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

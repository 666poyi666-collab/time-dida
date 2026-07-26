import fs from 'node:fs';
import path from 'node:path';

import { fingerprintDeviceSyncValue } from '../../shared/sync/deviceProtocol';
import {
  SYNC_V2_PROTOCOL_VERSION,
  type FocusMetadataV2,
  type SyncV2Mutation,
  type SyncV2BootstrapEntitiesResponse,
  type SyncV2BootstrapInventoryResponse,
  type SyncV2Response,
} from '../../shared/sync/v2Protocol';

const endpoint = (
  process.env.FOCUSLINK_TEST_ENDPOINT ?? 'https://focuslink-sync.pyzzgk.dpdns.org'
).replace(/\/$/, '');
const ownerToken = process.env.FOCUSLINK_TEST_TOKEN ?? '';
const statePath = process.argv[3] ?? '.tmp/cloudflare-v2-state.json';
const mode = process.argv[2] ?? 'initial';
if (!ownerToken) throw new Error('FOCUSLINK_TEST_TOKEN is required');

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const state =
    mode === 'verify'
      ? (JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
          entityId: string;
          opId: string;
          mutation: SyncV2Mutation;
        })
      : null;

  const health = await request<Record<string, unknown>>('/health', undefined, ownerToken, 'GET');
  assert(
    health.syncV2ProtocolVersion === SYNC_V2_PROTOCOL_VERSION,
    'health does not advertise Sync v2',
  );

  if (state) {
    const response = await sync(
      ownerToken,
      { syncEpoch: 'sync-1', cursorEpoch: 'cursor-1', accountGeneration: 1 },
      null,
      [state.mutation],
      state.mutation.deviceId,
    );
    assert(response.acks[0]?.status === 'duplicate', 'operation did not survive Worker redeploy');
    assert(
      response.changes.some((change) => change.entityId === state.entityId),
      'entity did not survive Worker redeploy',
    );
    console.log(
      JSON.stringify({
        ok: true,
        mode,
        persisted: true,
        duplicate: true,
        changeCount: response.changes.length,
      }),
    );
    process.exit(0);
  }

  const suffix = `${Date.now()}`;
  const entityId = `v2-public-${suffix}`;
  const bootstrapId = `bootstrap-${suffix}`;
  const deviceId = `public-test-${suffix}`;
  const payload: FocusMetadataV2 = {
    sessionId: entityId,
    title: '公网 Sync v2',
    note: null,
    subject: '数学',
    tags: [{ tagId: 'tag-public', name: '公网' }],
    taskAssociation: null,
    updatedAt: Date.now(),
    updatedByDeviceId: deviceId,
  };
  const inventory = await request<SyncV2BootstrapInventoryResponse>(
    '/v2/bootstrap/inventory',
    {
      protocolVersion: 2,
      deviceId,
      bootstrapId,
      inventory: [
        {
          entityId,
          entityType: 'focus_metadata_v2',
          fingerprint: fingerprintDeviceSyncValue({ deleted: false, payload }),
          localUpdatedAt: Date.now(),
          deleted: false,
        },
      ],
    },
    ownerToken,
  );
  assert(
    inventory.manifest[0].disposition === 'need-upload',
    'bootstrap manifest did not request missing entity',
  );
  const mutation: SyncV2Mutation = {
    opId: `op-${suffix}`,
    entityType: 'focus_metadata_v2',
    entityId,
    kind: 'put',
    baseRevision: 0,
    baseFingerprint: null,
    payload,
    deviceId,
    accountGeneration: inventory.accountGeneration,
  };
  const established = await request<SyncV2BootstrapEntitiesResponse>(
    '/v2/bootstrap/entities',
    { protocolVersion: 2, deviceId, bootstrapId, entities: [mutation] },
    ownerToken,
  );
  assert(established.acks[0].status === 'applied', 'bootstrap entity was not applied');
  const duplicate = await sync(ownerToken, established, null, [mutation], deviceId);
  assert(duplicate.acks[0].status === 'duplicate', 'opId duplicate was not detected');
  assert(
    duplicate.changes.some((change) => change.entityId === entityId),
    'cursor pull omitted entity',
  );
  const conflictMutation = {
    ...mutation,
    opId: `conflict-${suffix}`,
    deviceId: `other-${suffix}`,
    payload: { ...payload, title: '冲突版本' },
  };
  const conflict = await sync(
    ownerToken,
    established,
    duplicate.nextCursor,
    [conflictMutation],
    conflictMutation.deviceId,
  );
  assert(conflict.acks[0].status === 'conflict', 'stale revision did not conflict');

  const offer = await request<{ nonce: string }>(
    '/v2/pair/offers',
    { displayName: 'Public test device', scopes: ['sync:read', 'sync:write'] },
    ownerToken,
  );
  const exchanged = await request<{ accessToken: string; deviceId: string }>(
    '/v2/pair/exchange',
    { nonce: offer.nonce },
    '',
    'POST',
  );
  assert(
    typeof exchanged.accessToken === 'string' && exchanged.accessToken.startsWith('fl2_'),
    'device token missing',
  );
  let replayStatus = 0;
  try {
    await request('/v2/pair/exchange', { nonce: offer.nonce }, '', 'POST');
  } catch (error) {
    replayStatus = Number((error as Error & { status?: number }).status ?? 0);
  }
  assert(replayStatus === 410, 'pair nonce replay was not rejected');
  const devicePull = await sync(
    exchanged.accessToken,
    established,
    duplicate.nextCursor,
    [],
    exchanged.deviceId,
  );
  assert(devicePull.protocolVersion === 2, 'device credential could not sync');
  const push = await request<{ state: string }>(
    '/v2/push/register',
    { provider: 'fcm', token: 'fixture-registration' },
    exchanged.accessToken,
  );
  assert(
    push.state === 'credential-missing',
    'push status overstated missing provider credentials',
  );
  const devices = await request<{ devices: Array<{ deviceId: string }> }>(
    '/v2/devices',
    undefined,
    ownerToken,
    'GET',
  );
  assert(
    devices.devices.some((device) => device.deviceId === exchanged.deviceId),
    'paired device missing',
  );
  const conflicts = await request<{ conflicts: Array<{ entity_id: string }> }>(
    '/v2/conflicts',
    undefined,
    ownerToken,
    'GET',
  );
  assert(
    conflicts.conflicts.some((item) => item.entity_id === entityId),
    'conflict center missing stale revision',
  );
  const backups = await request<{ storageConfigured: boolean }>(
    '/v2/backups',
    undefined,
    ownerToken,
    'GET',
  );
  assert(
    backups.storageConfigured === false,
    'R2 should remain explicitly unconfigured until account activation',
  );

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ entityId, opId: mutation.opId, mutation }, null, 2));
  console.log(
    JSON.stringify({
      ok: true,
      mode,
      entityId,
      bootstrap: true,
      applied: true,
      duplicate: true,
      conflict: true,
      cursor: true,
      pairing: true,
      replayRejected: true,
      deviceScope: true,
      pushState: push.state,
      r2Configured: backups.storageConfigured,
    }),
  );
}

async function sync(
  token: string,
  epoch: { syncEpoch: string; cursorEpoch: string; accountGeneration: number },
  cursor: string | null,
  mutations: SyncV2Mutation[],
  currentDeviceId: string,
): Promise<SyncV2Response> {
  return request(
    '/v2/sync',
    {
      protocolVersion: 2,
      deviceId: currentDeviceId,
      cursor,
      mutations,
      pullLimit: 500,
      syncEpoch: epoch.syncEpoch,
      cursorEpoch: epoch.cursorEpoch,
      accountGeneration: epoch.accountGeneration,
    },
    token,
  );
}
async function request<T = unknown>(
  path: string,
  body: unknown,
  token: string,
  method = 'POST',
): Promise<T> {
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = Object.assign(new Error(`${path}: ${response.status} ${await response.text()}`), {
      status: response.status,
    });
    throw error;
  }
  return response.json() as Promise<T>;
}
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

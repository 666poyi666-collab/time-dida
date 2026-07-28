import fs from 'node:fs';
import path from 'node:path';

import {
  SYNC_V2_PROTOCOL_VERSION,
  parseDeviceToken,
  type FocusMetadataV2,
  type SyncV2Mutation,
  type SyncV2Response,
} from '../../shared/sync/v2Protocol';

const endpoint = (process.env.FOCUSLINK_TEST_ENDPOINT ?? '').replace(/\/$/, '');
const deviceToken = process.env.FOCUSLINK_TEST_DEVICE_TOKEN ?? '';
const explicitDeviceId = process.env.FOCUSLINK_TEST_DEVICE_ID ?? '';
const statePath = process.argv[3] ?? '.tmp/cloudflare-v2-state.json';
const mode = process.argv[2] ?? 'initial';

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  if (!endpoint) throw new Error('FOCUSLINK_TEST_ENDPOINT is required');
  if (!deviceToken) throw new Error('FOCUSLINK_TEST_DEVICE_TOKEN is required');
  const parsedToken = parseDeviceToken(deviceToken);
  if (!parsedToken && !explicitDeviceId) {
    throw new Error('FOCUSLINK_TEST_DEVICE_ID is required for a non-fl2 test token');
  }
  const deviceId = explicitDeviceId || `device-${parsedToken!.devicePublicId}`;
  const state =
    mode === 'verify'
      ? (JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
          entityId: string;
          mutation: SyncV2Mutation;
        })
      : null;

  const health = await request<Record<string, unknown>>('/healthz', undefined, '', 'GET');
  assert(
    health.syncV2ProtocolVersion === SYNC_V2_PROTOCOL_VERSION,
    'healthz does not advertise Sync v2',
  );

  const oauthLike = await raw('/sync/v2/status', 'Bearer oauth-looking-token', 'GET');
  assert(oauthLike.status === 401, 'OAuth-shaped bearer must not access device sync');
  const offers = await raw('/sync/v1/pair/offers', `Bearer ${deviceToken}`, 'POST');
  assert(offers.status === 403, 'public device token must not create pairing offers');

  const status = await request<EpochStatus>('/sync/v2/status', undefined, deviceToken, 'GET');
  assertEpoch(status);
  if (state) {
    const response = await sync(status, null, [state.mutation], deviceId);
    assert(response.acks[0]?.status === 'duplicate', 'operation did not survive Worker redeploy');
    assert(
      response.changes.some((change) => change.entityId === state.entityId),
      'entity did not survive Worker redeploy',
    );
    console.log(JSON.stringify({ ok: true, mode, persisted: true, duplicate: true }));
    return;
  }

  const suffix = `${Date.now()}`;
  const entityId = `v2-public-${suffix}`;
  const payload: FocusMetadataV2 = {
    sessionId: entityId,
    title: 'Sync v2 device fixture',
    note: null,
    subject: 'math',
    tags: [{ tagId: 'tag-public', name: 'public' }],
    taskAssociation: null,
    updatedAt: Date.now(),
    updatedByDeviceId: deviceId,
  };
  const mutation: SyncV2Mutation = {
    opId: `op-${suffix}`,
    entityType: 'focus_metadata_v2',
    entityId,
    kind: 'put',
    baseRevision: 0,
    baseFingerprint: null,
    payload,
    deviceId,
    accountGeneration: status.accountGeneration,
  };
  const created = await sync(status, null, [mutation], deviceId);
  assert(created.acks[0]?.status === 'applied', 'canonical exchange did not apply mutation');
  const duplicate = await sync(created, created.nextCursor, [mutation], deviceId);
  assert(duplicate.acks[0]?.status === 'duplicate', 'opId duplicate was not detected');
  const stale = await sync(
    duplicate,
    duplicate.nextCursor,
    [{ ...mutation, opId: `stale-${suffix}`, payload: { ...payload, title: 'stale' } }],
    deviceId,
  );
  assert(stale.acks[0]?.status === 'conflict', 'stale base revision did not conflict');

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ entityId, mutation }, null, 2));
  console.log(
    JSON.stringify({
      ok: true,
      mode,
      entityId,
      canonicalRoutes: true,
      applied: true,
      duplicate: true,
      conflict: true,
      oauthRejected: true,
      publicOffersRejected: true,
    }),
  );
}

interface EpochStatus {
  protocolVersion: typeof SYNC_V2_PROTOCOL_VERSION;
  syncEpoch: string;
  cursorEpoch: string;
  accountGeneration: number;
  changeSeq: number;
  serverTime: number;
}

function assertEpoch(value: EpochStatus): void {
  assert(value.protocolVersion === SYNC_V2_PROTOCOL_VERSION, 'status protocol version is invalid');
  assert(
    typeof value.syncEpoch === 'string' && value.syncEpoch.length > 0,
    'sync epoch is invalid',
  );
  assert(
    typeof value.cursorEpoch === 'string' && value.cursorEpoch.length > 0,
    'cursor epoch is invalid',
  );
  assert(Number.isSafeInteger(value.accountGeneration), 'account generation is invalid');
}

async function sync(
  epoch: Pick<EpochStatus, 'syncEpoch' | 'cursorEpoch' | 'accountGeneration'>,
  cursor: string | null,
  mutations: SyncV2Mutation[],
  deviceId: string,
): Promise<SyncV2Response> {
  return request(
    '/sync/v2/exchange',
    {
      protocolVersion: 2,
      deviceId,
      cursor,
      mutations,
      pullLimit: 500,
      syncEpoch: epoch.syncEpoch,
      cursorEpoch: epoch.cursorEpoch,
      accountGeneration: epoch.accountGeneration,
    },
    deviceToken,
  );
}

async function raw(
  pathname: string,
  authorization: string,
  method: 'GET' | 'POST',
): Promise<Response> {
  return fetch(`${endpoint}${pathname}`, {
    method,
    headers: authorization ? { authorization } : undefined,
  });
}

async function request<T = unknown>(
  pathname: string,
  body: unknown,
  token: string,
  method = 'POST',
): Promise<T> {
  const response = await fetch(`${endpoint}${pathname}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = Object.assign(
      new Error(`${pathname}: ${response.status} ${await response.text()}`),
      {
        status: response.status,
      },
    );
    throw error;
  }
  return response.json() as Promise<T>;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

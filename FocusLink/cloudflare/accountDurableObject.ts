import { DurableObject } from 'cloudflare:workers';
import {
  DEVICE_SYNC_ENTITY,
  DEVICE_SYNC_MAX_BODY_BYTES,
  DEVICE_SYNC_MAX_PULL,
  DEVICE_SYNC_MAX_PUSH,
  DEVICE_SYNC_PROTOCOL_VERSION,
  deviceSyncJsonByteLength,
  fingerprintDeviceSyncValue,
  validateDeviceSyncBundle,
  type DeviceSyncAck,
  type DeviceSyncChange,
  type DeviceSyncMutation,
  type DeviceSyncRequest,
  type DeviceSyncResponse,
  type DeviceSyncSessionBundle,
} from '../shared/sync/deviceProtocol';
import {
  FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
  FOCUSLINK_ENROLLED_DEVICE_SCOPES,
  parseFocusLinkDeviceRegistrationRequest,
  type FocusLinkDeviceRegistrationResponse,
} from '../shared/sync/identityProtocol';
import {
  FOCUSLINK_PAIRING_CODE_PATTERN,
  FOCUSLINK_PAIRING_CODE_TTL_MS,
} from '../shared/sync/pairingProtocol';
import {
  LIVE_FOCUS_MAX_TRANSITIONS,
  LIVE_FOCUS_MAX_WAIT_MS,
  LIVE_FOCUS_PROTOCOL_VERSION,
  validateLiveFocusCommandRequest,
  type LiveFocusCommand,
  type LiveFocusCommandAck,
  type LiveFocusCommandRequest,
  type LiveFocusCommandResponse,
  type LiveFocusSessionSnapshot,
  type LiveFocusSnapshot,
  type LiveFocusSnapshotResponse,
  type LiveFocusTaskContext,
  type LiveFocusTimelinePause,
  type LiveFocusTimelineSegment,
  type LiveFocusWaitResponse,
} from '../shared/sync/liveFocusProtocol';
import {
  TASK_SNAPSHOT_PROTOCOL_VERSION,
  isTaskSnapshotPublishedAtWithinFutureSkew,
  validateTaskSnapshotPublishRequest,
  type TaskSnapshotPayload,
  type TaskSnapshotPublishRequest,
  type TaskSnapshotResponse,
} from '../shared/sync/taskSnapshotProtocol';
import {
  SYNC_V2_MAX_PULL,
  SYNC_V2_MAX_PUSH,
  SYNC_V2_MAX_ENTITY_BYTES,
  SYNC_V2_PROTOCOL_VERSION,
  isEncryptedFocusGuardEnvelopeV1,
  paginateSyncV2Response,
  splitBundleForSyncV2,
  type SyncV2Ack,
  type SyncV2BootstrapEntitiesRequest,
  type SyncV2BootstrapEntitiesResponse,
  type SyncV2BootstrapInventoryRequest,
  type SyncV2BootstrapInventoryResponse,
  type FocusLedgerCorrectionV2,
  type FocusLedgerV2,
  type FocusMetadataV2,
  type EncryptedFocusGuardEnvelopeV1,
  type SyncV2Change,
  type SyncV2EntityType,
  type SyncV2Epoch,
  type SyncV2ManifestItem,
  type SyncV2Mutation,
  type SyncV2Payload,
  type SyncV2Request,
  type SyncV2Response,
} from '../shared/sync/v2Protocol';
import {
  buildFocusMcpRecordsProjection,
  buildFocusMcpProjection,
  type FocusProjectionCorrection,
  type FocusProjectionLedger,
  type FocusProjectionMetadata,
} from '../shared/sync/focusMcpProjection';
import {
  FOCUSLINK_AUTHORITY_OBSERVATION_MEDIA_TYPE,
  FOCUSLINK_AUTHORITY_OBSERVATION_PATH,
  buildFocusLinkAuthorityObservation,
  exactFocusLinkAuthorityAudience,
  reusableFocusLinkAuthorityObservation,
  type FocusLinkAuthorityObservation,
} from './authorityObservation';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WorkerEnv {
  FOCUSLINK_ACCOUNT: DurableObjectNamespace<FocusLinkAccount>;
  FOCUSLINK_ACCOUNT_ID: string;
  FOCUSLINK_SYNC_TOKEN: string;
  FOCUSLINK_ALLOWED_ORIGINS?: string;
  FOCUSLINK_DEVICE_PEPPER?: string;
  FOCUSLINK_DEVICE_PEPPER_PREVIOUS?: string;
  FOCUSLINK_BACKUP_KEY?: string;
  FOCUSLINK_BACKUPS?: R2Bucket;
  FOCUSLINK_PUSH_QUEUE?: Queue;
  /** Dedicated credential used only by the cloud MCP service binding. */
  FOCUSLINK_MCP_SERVICE_TOKEN?: string;
  /** Dedicated credential used only to mint one-time pair offers through a service binding. */
  FOCUSLINK_PAIR_AUTHORITY_TOKEN?: string;
  /** Dedicated credential used only after the identity gateway authenticates the owner. */
  FOCUSLINK_IDENTITY_AUTHORITY_TOKEN?: string;
  /** Exact owner subject accepted from the identity gateway (currently poyi-owner). */
  FOCUSLINK_OWNER_SUBJECT?: string;
  /** Dedicated capability used only by the named observation service binding. */
  FOCUSLINK_AUTHORITY_CAPABILITY?: string;
  /** Exact central-authority audience ending in /authority/identity-focus. */
  FOCUSLINK_AUTHORITY_AUDIENCE?: string;
}

interface EntityRow extends Record<string, SqlStorageValue> {
  entity_id: string;
  revision: number;
  deleted: number;
  payload_json: string | null;
}

interface OperationRow extends Record<string, SqlStorageValue> {
  fingerprint: string;
  ack_json: string;
}

interface ChangeRow extends Record<string, SqlStorageValue> {
  change_seq: number;
  device_id: string;
  entity_id: string;
  revision: number;
  deleted: number;
  payload_json: string | null;
}

interface MetaRow extends Record<string, SqlStorageValue> {
  value: string;
}

interface V2EntityRow extends Record<string, SqlStorageValue> {
  entity_type: SyncV2EntityType;
  entity_id: string;
  revision: number;
  fingerprint: string;
  deleted: number;
  payload_json: string | null;
  delete_change_seq: number | null;
}

interface V2OperationRow extends Record<string, SqlStorageValue> {
  fingerprint: string;
  ack_json: string;
}

interface V2ChangeRow extends Record<string, SqlStorageValue> {
  change_seq: number;
  source_device_id: string;
  entity_type: SyncV2EntityType;
  entity_id: string;
  revision: number;
  fingerprint: string;
  deleted: number;
  payload_json: string | null;
}

interface LegacyCompletedBundleRow extends Record<string, SqlStorageValue> {
  entity_id: string;
  payload_json: string;
  device_id: string | null;
  has_ledger: number;
  has_metadata: number;
}

interface FocusProjectionEntityRow extends Record<string, SqlStorageValue> {
  entity_type: 'focus_ledger_v2' | 'focus_metadata_v2' | 'focus_ledger_correction_v2';
  revision: number;
  payload_json: string;
}

interface TaskRow extends Record<string, SqlStorageValue> {
  revision: number;
  source_device_id: string | null;
  fingerprint: string | null;
  snapshot_json: string | null;
}

interface LiveRow extends Record<string, SqlStorageValue> {
  revision: number;
  session_json: string | null;
}

interface AuthorityObservationRow extends Record<string, SqlStorageValue> {
  revision: number;
  state_hash: string;
  observation_json: string;
  expires_at: number;
}

interface StoredLiveOperationRow extends Record<string, SqlStorageValue> {
  fingerprint: string;
  ack_json: string;
}

interface StoredLiveSession {
  id: string;
  title: string | null;
  task: LiveFocusTaskContext | null;
  state: 'running' | 'paused';
  startedAt: number;
  updatedAt: number;
  lastCommandDeviceId: string;
  segments: LiveFocusTimelineSegment[];
  pauses: LiveFocusTimelinePause[];
}

export interface V2Identity {
  deviceId: string;
  scopes: string[];
  owner: boolean;
}

export class ProtocolError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ParsedV2DeviceCredential {
  accountPublicId: string;
  devicePublicId: string;
  secret: string;
}

export interface V2DeviceCredentialRecord extends Record<string, SqlStorageValue> {
  device_id: string;
  account_public_id: string;
  secret_hmac: string;
  scopes_json: string;
  expires_at: number | null;
  revoked_at: number | null;
}

export function parseV2DeviceCredential(header: string): ParsedV2DeviceCredential | null {
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const match = /^fl2_([A-Za-z0-9-]{6,80})_([A-Za-z0-9-]{6,80})_([A-Za-z0-9_-]{32,160})$/.exec(
    token,
  );
  return match ? { accountPublicId: match[1], devicePublicId: match[2], secret: match[3] } : null;
}

export function authorizeV2CredentialRecord(
  credential: ParsedV2DeviceCredential,
  row: V2DeviceCredentialRecord | undefined,
  secretDigest: string | null,
  scope: string,
  now: number,
): V2Identity {
  if (
    !row ||
    row.account_public_id !== credential.accountPublicId ||
    row.revoked_at !== null ||
    (row.expires_at !== null && row.expires_at <= now)
  ) {
    throw new ProtocolError(401, 'device_revoked_or_expired', 'device credential is inactive');
  }
  if (!secretDigest || !constantTimeEqual(secretDigest, row.secret_hmac)) {
    throw new ProtocolError(401, 'unauthenticated', 'device credential is invalid');
  }
  let scopes: string[];
  try {
    const value: unknown = JSON.parse(row.scopes_json);
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      throw new Error('invalid scopes');
    }
    scopes = value;
  } catch {
    throw new ProtocolError(500, 'store_corrupt', 'device scope record is invalid');
  }
  if (!scopes.includes(scope)) {
    throw new ProtocolError(403, 'scope_denied', `scope ${scope} required`);
  }
  return { deviceId: row.device_id, scopes, owner: false };
}

/**
 * Binds a V2 request to its authenticated device identity.
 *
 * The device token proves *which* device is calling; the request body must not
 * be able to claim a different device. Without this, a holder of device A's
 * token could write change-feed rows and advance watermarks as device B, which
 * corrupts sourceDeviceId provenance and the watermark set that gates physical
 * purge. The internal owner-migration credential is exempt because it legitimately
 * replays historical device ids during account backfill.
 */
export function assertV2DeviceBinding(
  identity: V2Identity,
  requestDeviceId: string,
  mutations: ReadonlyArray<{ deviceId: string }> = [],
): void {
  if (identity.owner) return;
  if (requestDeviceId !== identity.deviceId) {
    throw new ProtocolError(
      403,
      'device_identity_mismatch',
      'request deviceId does not match the authenticated device',
    );
  }
  for (const mutation of mutations) {
    if (mutation.deviceId !== identity.deviceId) {
      throw new ProtocolError(
        403,
        'device_identity_mismatch',
        'mutation deviceId does not match the authenticated device',
      );
    }
  }
}

export class FocusLinkAccount extends DurableObject<WorkerEnv> {
  private readonly sql: SqlStorage;
  private registrationSchemaReady = false;

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initializeSchema();
    this.ensurePairOfferSchema();
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const accountId = request.headers.get('x-focuslink-account') ?? '';
      if (!isId(accountId)) throw new ProtocolError(400, 'invalid_account', 'invalid account id');

      if (url.pathname === '/internal/readyz') {
        if (request.method !== 'GET') {
          throw new ProtocolError(405, 'method_not_allowed', 'GET required');
        }
        if (request.headers.get('x-focuslink-internal') !== this.env.FOCUSLINK_SYNC_TOKEN) {
          throw new ProtocolError(
            401,
            'internal_service_unauthenticated',
            'service credential required',
          );
        }
        const probe = this.sql
          .exec<Record<string, SqlStorageValue>>('SELECT 1 AS storage_ready')
          .one();
        return json({
          ok: Number(probe.storage_ready) === 1,
          storageReady: Number(probe.storage_ready) === 1,
          authority: 'focuslink-account-do',
        });
      }
      if (url.pathname === FOCUSLINK_AUTHORITY_OBSERVATION_PATH) {
        if (request.method !== 'GET') {
          throw new ProtocolError(405, 'method_not_allowed', 'GET required');
        }
        rejectUnexpectedQuery(url);
        if (request.headers.get('x-focuslink-internal') !== this.env.FOCUSLINK_SYNC_TOKEN) {
          throw new ProtocolError(
            401,
            'internal_service_unauthenticated',
            'service credential required',
          );
        }
        const observation = this.ensureAuthorityObservation(Date.now());
        if (!observation) {
          throw new ProtocolError(
            503,
            'authority_observation_unavailable',
            'authority observation is unavailable',
          );
        }
        return authorityObservationJson(observation);
      }
      if (
        url.pathname === '/internal/v2/backup' &&
        request.method === 'POST' &&
        request.headers.get('x-focuslink-internal') === this.env.FOCUSLINK_SYNC_TOKEN
      ) {
        return json(await this.createV2Backup('daily'));
      }
      if (
        url.pathname === '/internal/mcp/v1/focus/summary' ||
        url.pathname === '/internal/mcp/v1/focus/records'
      ) {
        if (request.method !== 'GET') {
          throw new ProtocolError(405, 'method_not_allowed', 'GET required');
        }
        if (
          !this.env.FOCUSLINK_MCP_SERVICE_TOKEN ||
          request.headers.get('x-focuslink-mcp-service') !== this.env.FOCUSLINK_MCP_SERVICE_TOKEN
        ) {
          throw new ProtocolError(
            401,
            'internal_service_unauthenticated',
            'cloud MCP service credential required',
          );
        }
        return json(
          url.pathname.endsWith('/records')
            ? this.focusMcpRecordsProjection(url)
            : this.focusMcpProjection(url),
        );
      }

      if (url.pathname === '/v1/sync' && request.method === 'POST') {
        const body = parseSyncRequest(await readJson(request, DEVICE_SYNC_MAX_BODY_BYTES));
        return json(this.sync(accountId, body));
      }
      if (url.pathname === '/v2/bootstrap/inventory' && request.method === 'POST') {
        const identity = await this.authorizeV2(request, 'sync:write');
        const body = (await readJson(
          request,
          DEVICE_SYNC_MAX_BODY_BYTES,
        )) as SyncV2BootstrapInventoryRequest;
        validateV2Inventory(body);
        assertV2DeviceBinding(identity, body.deviceId);
        return json(this.bootstrapV2Inventory(accountId, body));
      }
      if (url.pathname === '/v2/bootstrap/entities' && request.method === 'POST') {
        const identity = await this.authorizeV2(request, 'sync:write');
        const body = (await readJson(
          request,
          DEVICE_SYNC_MAX_BODY_BYTES,
        )) as SyncV2BootstrapEntitiesRequest;
        validateV2BootstrapEntities(body);
        assertV2DeviceBinding(identity, body.deviceId, body.entities);
        return json(this.bootstrapV2Entities(accountId, body));
      }
      if (url.pathname === '/v2/sync/epoch' && request.method === 'GET') {
        await this.authorizeV2(request, 'sync:read');
        rejectUnexpectedQuery(url);
        return json({
          protocolVersion: SYNC_V2_PROTOCOL_VERSION,
          ...this.v2Epoch(),
          changeSeq: this.v2ChangeSeq(),
          serverTime: Date.now(),
        });
      }
      if (url.pathname === '/v2/sync' && request.method === 'POST') {
        const body = (await readJson(request, DEVICE_SYNC_MAX_BODY_BYTES)) as SyncV2Request;
        validateV2SyncRequest(body);
        const identity = await this.authorizeV2(
          request,
          body.mutations.length > 0 ? 'sync:write' : 'sync:read',
        );
        assertV2DeviceBinding(identity, body.deviceId, body.mutations);
        return json(this.syncV2(accountId, body));
      }
      if (url.pathname === '/v2/pair/offers' && request.method === 'POST') {
        // A trusted device may add another device with its normal write
        // capability. The offer itself never grants device-management scope;
        // the dedicated service-authority path remains available to the owner
        // admin flow and inventory tooling.
        const identity = await this.authorizeV2(request, 'sync:write');
        return json(
          await this.createPairOffer(
            await readJson(request, 16 * 1024),
            identity,
            publicId(accountId),
          ),
        );
      }
      if (url.pathname === '/v2/pair/exchange' && request.method === 'POST') {
        return json(await this.exchangePairOffer(accountId, await readJson(request, 16 * 1024)));
      }
      if (url.pathname === '/v2/devices/register' && request.method === 'POST') {
        rejectUnexpectedQuery(url);
        if (
          !isIdentityAuthorityToken(this.env.FOCUSLINK_IDENTITY_AUTHORITY_TOKEN) ||
          !constantTimeEqual(
            request.headers.get('x-focuslink-enrollment-authority') ?? '',
            this.env.FOCUSLINK_IDENTITY_AUTHORITY_TOKEN,
          ) ||
          !isOwnerSubject(this.env.FOCUSLINK_OWNER_SUBJECT) ||
          !constantTimeEqual(
            request.headers.get('x-focuslink-owner-subject') ?? '',
            this.env.FOCUSLINK_OWNER_SUBJECT,
          )
        ) {
          throw new ProtocolError(
            401,
            'identity_authority_required',
            'authenticated owner identity required',
          );
        }
        return json(await this.registerOwnerDevice(accountId, await readJson(request, 16 * 1024)));
      }
      if (url.pathname === '/v2/devices' && request.method === 'GET') {
        await this.authorizeV2(request, 'devices:manage');
        rejectUnexpectedQuery(url);
        return json(this.listV2Devices());
      }
      if (url.pathname === '/v2/devices' && request.method === 'PATCH') {
        await this.authorizeV2(request, 'devices:manage');
        return json(this.patchV2Device(await readJson(request, 16 * 1024)));
      }
      const deviceRoute = /^\/v2\/devices\/([^/]+)\/(revoke|rotate)$/.exec(url.pathname);
      if (deviceRoute && request.method === 'POST') {
        await this.authorizeV2(request, 'devices:manage');
        return json(
          deviceRoute[2] === 'revoke'
            ? this.revokeV2Device(deviceRoute[1])
            : await this.rotateV2Device(accountId, deviceRoute[1]),
        );
      }
      if (url.pathname === '/v2/conflicts' && request.method === 'GET') {
        await this.authorizeV2(request, 'sync:read');
        return json(this.listV2Conflicts());
      }
      const conflictRoute = /^\/v2\/conflicts\/([^/]+)(?:\/(resolve))?$/.exec(url.pathname);
      if (conflictRoute) {
        await this.authorizeV2(request, request.method === 'GET' ? 'sync:read' : 'sync:write');
        if (request.method === 'GET' && !conflictRoute[2])
          return json(this.getV2Conflict(conflictRoute[1]));
        if (request.method === 'POST' && conflictRoute[2] === 'resolve')
          return json(
            this.resolveV2Conflict(
              conflictRoute[1],
              await readJson(request, DEVICE_SYNC_MAX_BODY_BYTES),
            ),
          );
      }
      if (url.pathname === '/v2/trash' && request.method === 'GET') {
        await this.authorizeV2(request, 'sync:read');
        return json(this.listV2Trash());
      }
      const trashRoute = /^\/v2\/trash\/([^/]+)(?:\/(restore))?$/.exec(url.pathname);
      if (trashRoute) {
        await this.authorizeV2(request, request.method === 'GET' ? 'sync:read' : 'sync:write');
        if (request.method === 'GET' && !trashRoute[2])
          return json(this.getV2TrashItem(trashRoute[1]));
        if (request.method === 'POST' && trashRoute[2] === 'restore')
          return json(
            this.applyV2AdministrativeMutation(
              await readJson(request, DEVICE_SYNC_MAX_BODY_BYTES),
              'restore',
            ),
          );
        if (request.method === 'DELETE' && !trashRoute[2])
          return json(
            this.applyV2AdministrativeMutation(
              await readJson(request, DEVICE_SYNC_MAX_BODY_BYTES),
              'purge',
            ),
          );
      }
      if (url.pathname === '/v2/push/register' && request.method === 'POST') {
        const identity = await this.authorizeV2(request, 'sync:read');
        return json(this.registerV2Push(identity.deviceId, await readJson(request, 16 * 1024)));
      }
      if (url.pathname === '/v2/backups' && request.method === 'GET') {
        await this.authorizeV2(request, 'backups:manage');
        return json(this.listV2Backups());
      }
      if (url.pathname === '/v2/backups/preview' && request.method === 'POST') {
        await this.authorizeV2(request, 'backups:manage');
        return json(await this.previewV2Backup(await readJson(request, 16 * 1024)));
      }
      if (url.pathname === '/v2/backups/restore' && request.method === 'POST') {
        await this.authorizeV2(request, 'backups:manage');
        return json(await this.restoreV2Backup(await readJson(request, 16 * 1024)));
      }
      if (url.pathname === '/v1/tasks' && request.method === 'GET') {
        await this.authorizeV2(request, 'sync:read');
        rejectUnexpectedQuery(url);
        return json(this.getTaskSnapshot());
      }
      if (url.pathname === '/v1/tasks' && request.method === 'POST') {
        rejectUnexpectedQuery(url);
        const body = await readJson(request, 512 * 1024);
        if (!validateTaskSnapshotPublishRequest(body)) {
          throw new ProtocolError(400, 'invalid_request', 'invalid task snapshot');
        }
        const identity = await this.authorizeV2(request, 'sync:write');
        assertV2DeviceBinding(identity, body.deviceId);
        return json(this.publishTaskSnapshot(body));
      }
      if (url.pathname === '/v1/live' && request.method === 'GET') {
        await this.authorizeV2(request, 'live:read');
        rejectUnexpectedQuery(url);
        return json(this.getLiveSnapshot());
      }
      if (url.pathname === '/v1/live/wait' && request.method === 'GET') {
        await this.authorizeV2(request, 'live:read');
        return json(await this.waitForLive(url));
      }
      if (url.pathname === '/v1/live/command' && request.method === 'POST') {
        rejectUnexpectedQuery(url);
        const body = await readJson(request, 16 * 1024);
        const validation = validateLiveFocusCommandRequest(body);
        if (!validation.ok || !validation.request) {
          throw new ProtocolError(
            400,
            'invalid_request',
            validation.error ?? 'invalid live command',
          );
        }
        const identity = await this.authorizeV2(request, 'live:write');
        assertV2DeviceBinding(identity, validation.request.deviceId);
        return json(this.commandLive(validation.request));
      }
      throw new ProtocolError(404, 'not_found', 'route not found');
    } catch (error) {
      if (error instanceof ProtocolError) return errorJson(error.status, error.code, error.message);
      console.error('FocusLinkAccount request failed', error);
      return errorJson(500, 'store_corrupt', 'account store operation failed');
    }
  }

  private initializeSchema(): void {
    let metaAvailable = true;
    let current: MetaRow | undefined;
    try {
      current = this.sql
        .exec<MetaRow>("SELECT value FROM meta WHERE key = 'account_schema_version'")
        .toArray()[0];
    } catch {
      metaAvailable = false;
    }
    if (current?.value === '1') return;
    if (current && current.value !== '1') {
      throw new Error('account schema version is invalid');
    }
    if (metaAvailable) {
      // Accounts created before account_schema_version already completed the
      // authority-observation v2 migration. Mark them ready without replaying
      // CREATE INDEX statements over a large Durable Object on every wake.
      const legacyReady = this.sql
        .exec<MetaRow>("SELECT value FROM meta WHERE key = 'authority_observation_schema_version'")
        .toArray()[0];
      if (legacyReady?.value === '2') {
        this.sql.exec("INSERT INTO meta(key, value) VALUES ('account_schema_version', '1')");
        return;
      }
    }

    // A brand-new Durable Object has no meta table yet. Create the complete
    // schema below; established accounts take the constant-row fast path.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entities (
        entity_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
        payload_json TEXT
      );
      CREATE TABLE IF NOT EXISTS operations (
        op_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        ack_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS changes (
        change_seq INTEGER PRIMARY KEY,
        device_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
        payload_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_changes_entity_seq ON changes(entity_id, change_seq);
      CREATE TABLE IF NOT EXISTS task_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        revision INTEGER NOT NULL,
        source_device_id TEXT,
        fingerprint TEXT,
        snapshot_json TEXT
      );
      CREATE TABLE IF NOT EXISTS live_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        revision INTEGER NOT NULL,
        session_json TEXT
      );
      CREATE TABLE IF NOT EXISTS live_operations (
        command_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        ack_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS v2_entities (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
        payload_json TEXT,
        delete_change_seq INTEGER,
        deleted_at INTEGER,
        purge_after INTEGER,
        PRIMARY KEY(entity_type, entity_id)
      );
      CREATE TABLE IF NOT EXISTS v2_operations (
        op_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        ack_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS v2_changes (
        change_seq INTEGER PRIMARY KEY,
        source_device_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
        payload_json TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_v2_changes_entity ON v2_changes(entity_type, entity_id, change_seq);
      CREATE TABLE IF NOT EXISTS v2_bootstraps (
        bootstrap_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        state TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS v2_devices (
        device_id TEXT PRIMARY KEY,
        device_public_id TEXT,
        account_public_id TEXT,
        display_name TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        secret_hmac TEXT,
        pepper_version INTEGER NOT NULL DEFAULT 1,
        expires_at INTEGER,
        last_seen_at INTEGER NOT NULL,
        watermark INTEGER NOT NULL DEFAULT 0,
        stale INTEGER NOT NULL DEFAULT 0,
        revoked_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_devices_public ON v2_devices(device_public_id);
      CREATE TABLE IF NOT EXISTS v2_pair_offers (
        nonce TEXT PRIMARY KEY,
        account_public_id TEXT,
        device_public_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        code_hmac TEXT,
        installation_id TEXT,
        platform TEXT,
        device_kind TEXT,
        app_version TEXT
      );
      CREATE TABLE IF NOT EXISTS v2_conflicts (
        conflict_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        base_json TEXT,
        local_json TEXT,
        remote_json TEXT,
        fields_json TEXT NOT NULL,
        source_devices_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        resolution_op_id TEXT
      );
      CREATE TABLE IF NOT EXISTS v2_push_registrations (
        device_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        registration_json TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS v2_backup_catalog (
        backup_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        object_key TEXT NOT NULL,
        key_version INTEGER NOT NULL,
        nonce TEXT NOT NULL,
        plaintext_sha256 TEXT NOT NULL,
        ciphertext_sha256 TEXT NOT NULL,
        account_generation INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS v2_graveyard (
        entity_hash TEXT PRIMARY KEY,
        deleted_generation INTEGER NOT NULL,
        purged_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authority_observation_snapshots (
        revision INTEGER PRIMARY KEY,
        state_hash TEXT NOT NULL,
        observation_json TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO meta(key, value) VALUES ('change_seq', '0');
      INSERT OR IGNORE INTO meta(key, value) VALUES ('v2_change_seq', '0');
      INSERT OR IGNORE INTO meta(key, value) VALUES ('v2_sync_epoch', 'sync-1');
      INSERT OR IGNORE INTO meta(key, value) VALUES ('v2_cursor_epoch', 'cursor-1');
      INSERT OR IGNORE INTO meta(key, value) VALUES ('v2_account_generation', '1');
      INSERT OR IGNORE INTO meta(key, value) VALUES ('v2_maintenance', '0');
      INSERT OR IGNORE INTO meta(key, value) VALUES ('authority_observation_revision', '0');
      INSERT OR IGNORE INTO task_state(singleton, revision) VALUES (1, 0);
      INSERT OR IGNORE INTO live_state(singleton, revision) VALUES (1, 0);
    `);
    this.migrateAuthorityObservationSchema();
    this.sql.exec(`
      INSERT INTO meta(key, value)
      VALUES ('account_schema_version', '1')
      ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    `);
  }

  private migrateAuthorityObservationSchema(): void {
    const current = this.sql
      .exec<MetaRow>("SELECT value FROM meta WHERE key = 'authority_observation_schema_version'")
      .toArray()[0];
    if (current?.value === '2') return;
    if (current && current.value !== '1') {
      throw new Error('authority observation schema version is invalid');
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`
        DROP TABLE IF EXISTS authority_observation_snapshots_v2;
        CREATE TABLE authority_observation_snapshots_v2 (
          revision INTEGER PRIMARY KEY,
          state_hash TEXT NOT NULL,
          observation_json TEXT NOT NULL,
          observed_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        INSERT INTO authority_observation_snapshots_v2(
          revision, state_hash, observation_json, observed_at, expires_at
        )
        SELECT revision, state_hash, observation_json, observed_at, expires_at
        FROM authority_observation_snapshots;
        DROP TABLE authority_observation_snapshots;
        ALTER TABLE authority_observation_snapshots_v2
          RENAME TO authority_observation_snapshots;
        CREATE INDEX idx_authority_observation_state_revision
          ON authority_observation_snapshots(state_hash, revision DESC);
        INSERT INTO meta(key, value)
          VALUES ('authority_observation_schema_version', '2')
          ON CONFLICT(key) DO UPDATE SET value=excluded.value;
      `);
    });
  }

  /** Add pairing metadata to accounts created before numeric pairing shipped. */
  private ensurePairOfferSchema(): void {
    const existingColumns = new Set(
      this.sql
        .exec<{ name: string }>('PRAGMA table_info(v2_pair_offers)')
        .toArray()
        .map((row) => row.name),
    );
    const columns: Array<[string, string]> = [
      ['account_public_id', 'TEXT'],
      ['code_hmac', 'TEXT'],
      ['installation_id', 'TEXT'],
      ['platform', 'TEXT'],
      ['device_kind', 'TEXT'],
      ['app_version', 'TEXT'],
    ];
    for (const [name, type] of columns) {
      if (existingColumns.has(name)) continue;
      try {
        this.sql.exec(`ALTER TABLE v2_pair_offers ADD COLUMN ${name} ${type}`);
        existingColumns.add(name);
      } catch (error) {
        if (!isDuplicateColumnError(error)) throw error;
      }
    }
    try {
      this.sql.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_pair_offers_code_hmac ON v2_pair_offers(code_hmac)',
      );
    } catch (error) {
      throw error;
    }
  }

  private focusMcpProjection(url: URL) {
    rejectUnexpectedQuery(url, new Set(['from', 'to', 'limit']));
    const generatedAt = Date.now();
    const from = parseBoundedTimestamp(url.searchParams.get('from'), generatedAt - 30 * DAY_MS);
    const to = parseBoundedTimestamp(url.searchParams.get('to'), generatedAt);
    const limit = parseBoundedInteger(url.searchParams.get('limit'), 20, 1, 100);
    if (to <= from || to - from > 10 * 366 * DAY_MS) {
      throw new ProtocolError(
        400,
        'invalid_range',
        'focus range must be positive and at most 10 years',
      );
    }

    const rows = this.sql
      .exec<FocusProjectionEntityRow>(
        `SELECT entity_type, revision, payload_json
           FROM v2_entities
          WHERE deleted = 0
            AND payload_json IS NOT NULL
            AND entity_type IN (
              'focus_ledger_v2', 'focus_metadata_v2', 'focus_ledger_correction_v2'
            )`,
      )
      .toArray();
    const ledgers: FocusProjectionLedger[] = [];
    const metadata: FocusProjectionMetadata[] = [];
    const corrections: FocusProjectionCorrection[] = [];
    for (const row of rows) {
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        continue;
      }
      if (row.entity_type === 'focus_ledger_v2') {
        ledgers.push({
          revision: row.revision,
          payload: payload as FocusProjectionLedger['payload'],
        });
      } else {
        if (row.entity_type === 'focus_metadata_v2') {
          metadata.push({
            revision: row.revision,
            payload: payload as FocusProjectionMetadata['payload'],
          });
        } else {
          corrections.push({
            revision: row.revision,
            payload: payload as FocusProjectionCorrection['payload'],
          });
        }
      }
    }
    const latestDevice = this.sql
      .exec<{ last_seen_at: number | null }>(
        'SELECT MAX(last_seen_at) AS last_seen_at FROM v2_devices WHERE revoked_at IS NULL',
      )
      .one().last_seen_at;
    const latestLedgerChange = this.sql
      .exec<{ created_at: number | null }>(
        `SELECT MAX(created_at) AS created_at
           FROM v2_changes
          WHERE entity_type IN (
            'focus_ledger_v2', 'focus_metadata_v2', 'focus_ledger_correction_v2'
          )`,
      )
      .one().created_at;
    const verifiedCandidates = [latestDevice, latestLedgerChange].filter(
      (value): value is number => typeof value === 'number' && Number.isSafeInteger(value),
    );
    return buildFocusMcpProjection({
      ledgers,
      metadata,
      corrections,
      generatedAt,
      lastVerifiedAt: verifiedCandidates.length > 0 ? Math.max(...verifiedCandidates) : null,
      changeSeq: this.v2ChangeSeq(),
      from,
      to,
      limit,
    });
  }

  private focusMcpRecordsProjection(url: URL) {
    rejectUnexpectedQuery(url, new Set(['from', 'to', 'limit']));
    const generatedAt = Date.now();
    const from = parseBoundedTimestamp(url.searchParams.get('from'), generatedAt - 30 * DAY_MS);
    const to = parseBoundedTimestamp(url.searchParams.get('to'), generatedAt);
    const limit = parseBoundedInteger(url.searchParams.get('limit'), 50, 1, 100);
    if (to <= from || to - from > 10 * 366 * DAY_MS) {
      throw new ProtocolError(
        400,
        'invalid_range',
        'focus range must be positive and at most 10 years',
      );
    }
    const rows = this.sql
      .exec<FocusProjectionEntityRow>(
        `SELECT entity_type, revision, payload_json
           FROM v2_entities
          WHERE deleted = 0
            AND payload_json IS NOT NULL
            AND entity_type IN (
              'focus_ledger_v2', 'focus_metadata_v2', 'focus_ledger_correction_v2'
            )`,
      )
      .toArray();
    const ledgers: FocusProjectionLedger[] = [];
    const metadata: FocusProjectionMetadata[] = [];
    const corrections: FocusProjectionCorrection[] = [];
    for (const row of rows) {
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        continue;
      }
      if (row.entity_type === 'focus_ledger_v2') {
        ledgers.push({ revision: row.revision, payload: payload as FocusLedgerV2 });
      } else if (row.entity_type === 'focus_metadata_v2') {
        metadata.push({ revision: row.revision, payload: payload as FocusMetadataV2 });
      } else {
        corrections.push({
          revision: row.revision,
          payload: payload as FocusProjectionCorrection['payload'],
        });
      }
    }
    const latestDevice = this.sql
      .exec<{ last_seen_at: number | null }>(
        'SELECT MAX(last_seen_at) AS last_seen_at FROM v2_devices WHERE revoked_at IS NULL',
      )
      .one().last_seen_at;
    const latestLedgerChange = this.sql
      .exec<{ created_at: number | null }>(
        `SELECT MAX(created_at) AS created_at
           FROM v2_changes
          WHERE entity_type IN (
            'focus_ledger_v2', 'focus_metadata_v2', 'focus_ledger_correction_v2'
          )`,
      )
      .one().created_at;
    const verifiedCandidates = [latestDevice, latestLedgerChange].filter(
      (value): value is number => typeof value === 'number' && Number.isSafeInteger(value),
    );
    const live = this.getLiveSnapshot();
    return buildFocusMcpRecordsProjection({
      ledgers,
      metadata,
      corrections,
      live: live.snapshot,
      serverTime: live.serverTime,
      generatedAt,
      lastVerifiedAt: verifiedCandidates.length > 0 ? Math.max(...verifiedCandidates) : null,
      from,
      to,
      limit,
    });
  }

  private sync(accountId: string, request: DeviceSyncRequest): DeviceSyncResponse {
    const cursorSeq = decodeCursor(accountId, request.cursor, this.changeSeq());
    const acks = this.ctx.storage.transactionSync(() =>
      request.mutations.map((mutation) => this.applyMutation(request.deviceId, mutation)),
    );
    const available = this.selectLatestChangesAfter(cursorSeq);
    const serverTime = Date.now();
    const changes: DeviceSyncChange[] = [];
    for (const change of available) {
      if (changes.length >= request.pullLimit) break;
      const candidate = toChange(change);
      const trial: DeviceSyncResponse = {
        protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
        acks,
        changes: [...changes, candidate],
        nextCursor: encodeCursor(accountId, candidate.changeSeq),
        hasMore: true,
        serverTime,
      };
      if (deviceSyncJsonByteLength(trial) > DEVICE_SYNC_MAX_BODY_BYTES) break;
      changes.push(candidate);
    }
    if (changes.length === 0 && available.length > 0) {
      throw new ProtocolError(500, 'store_corrupt', 'one change exceeds response budget');
    }
    const nextSeq = changes.at(-1)?.changeSeq ?? cursorSeq;
    return {
      protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
      acks,
      changes,
      nextCursor: encodeCursor(accountId, nextSeq),
      hasMore: available.length > changes.length,
      serverTime,
    };
  }

  private applyMutation(deviceId: string, mutation: DeviceSyncMutation): DeviceSyncAck {
    const fingerprint = fingerprintDeviceSyncValue(mutation);
    const previous = this.sql
      .exec<OperationRow>(
        'SELECT fingerprint, ack_json FROM operations WHERE op_id = ?',
        mutation.opId,
      )
      .toArray()[0];
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        return rejectedMutationAck(
          mutation,
          this.entityRevision(mutation.entityId),
          'op_id_reused',
        );
      }
      const ack = JSON.parse(previous.ack_json) as DeviceSyncAck;
      return ack.status === 'applied' ? { ...ack, status: 'duplicate', errorCode: null } : ack;
    }

    const rejection = validateMutation(mutation);
    if (rejection) return this.persistMutationAck(fingerprint, mutation, rejection);
    const live = this.readLive();
    if (live.session?.id === mutation.entityId) {
      return this.persistMutationAck(fingerprint, mutation, 'live_session_reserved');
    }

    const row = this.entity(mutation.entityId);
    const currentRevision = row?.revision ?? 0;
    if (mutation.baseRevision !== currentRevision) {
      const ack: DeviceSyncAck = {
        opId: mutation.opId,
        entityId: mutation.entityId,
        status: 'conflict',
        revision: row?.revision ?? null,
        errorCode: 'revision_conflict',
      };
      this.insertOperation(mutation.opId, fingerprint, ack);
      return ack;
    }

    const revision = currentRevision + 1;
    const deleted = mutation.kind === 'delete';
    const payload = deleted ? null : (mutation.payload as DeviceSyncSessionBundle);
    const sequence = this.incrementChangeSeq();
    this.sql.exec(
      `INSERT INTO entities(entity_id, revision, deleted, payload_json) VALUES (?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET revision=excluded.revision, deleted=excluded.deleted, payload_json=excluded.payload_json`,
      mutation.entityId,
      revision,
      deleted ? 1 : 0,
      payload === null ? null : JSON.stringify(payload),
    );
    this.sql.exec(
      'INSERT INTO changes(change_seq, device_id, entity_id, revision, deleted, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      sequence,
      deviceId,
      mutation.entityId,
      revision,
      deleted ? 1 : 0,
      payload === null ? null : JSON.stringify(payload),
      Date.now(),
    );
    const ack: DeviceSyncAck = {
      opId: mutation.opId,
      entityId: mutation.entityId,
      status: 'applied',
      revision,
      errorCode: null,
    };
    this.insertOperation(mutation.opId, fingerprint, ack);
    return ack;
  }

  private persistMutationAck(
    fingerprint: string,
    mutation: DeviceSyncMutation,
    errorCode: string,
  ): DeviceSyncAck {
    const ack = rejectedMutationAck(mutation, this.entityRevision(mutation.entityId), errorCode);
    this.insertOperation(mutation.opId, fingerprint, ack);
    return ack;
  }

  private insertOperation(opId: string, fingerprint: string, ack: DeviceSyncAck): void {
    this.sql.exec(
      'INSERT INTO operations(op_id, fingerprint, ack_json, created_at) VALUES (?, ?, ?, ?)',
      opId,
      fingerprint,
      JSON.stringify(ack),
      Date.now(),
    );
  }

  private v2Epoch(): SyncV2Epoch {
    const rows = this.sql
      .exec<MetaRow>(
        "SELECT key, value FROM meta WHERE key IN ('v2_sync_epoch', 'v2_cursor_epoch', 'v2_account_generation')",
      )
      .toArray() as Array<MetaRow & { key: string }>;
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return {
      syncEpoch: values.get('v2_sync_epoch') ?? 'sync-1',
      cursorEpoch: values.get('v2_cursor_epoch') ?? 'cursor-1',
      accountGeneration: Number(values.get('v2_account_generation') ?? '1'),
    };
  }

  private bootstrapV2Inventory(
    accountId: string,
    request: SyncV2BootstrapInventoryRequest,
  ): SyncV2BootstrapInventoryResponse {
    const epoch = this.v2Epoch();
    const manifest: SyncV2ManifestItem[] = request.inventory.map((item) => {
      const remote = this.v2Entity(item.entityType, item.entityId);
      let disposition: SyncV2ManifestItem['disposition'];
      if (!remote) disposition = 'need-upload';
      else if (remote.fingerprint === item.fingerprint && Boolean(remote.deleted) === item.deleted)
        disposition = 'already-known';
      else if (item.deleted === Boolean(remote.deleted)) disposition = 'fingerprint-conflict';
      else disposition = remote.deleted ? 'need-download' : 'fingerprint-conflict';
      return {
        ...item,
        disposition,
        confirmedRevision: remote?.revision ?? null,
        confirmedFingerprint: remote?.fingerprint ?? null,
      };
    });
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.touchV2Device(request.deviceId, now);
      this.sql.exec(
        `INSERT INTO v2_bootstraps(bootstrap_id, device_id, state, manifest_json, created_at, updated_at)
         VALUES (?, ?, 'manifest-received', ?, ?, ?)
         ON CONFLICT(bootstrap_id) DO UPDATE SET manifest_json=excluded.manifest_json, updated_at=excluded.updated_at`,
        request.bootstrapId,
        request.deviceId,
        JSON.stringify(manifest),
        now,
        now,
      );
    });
    return {
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      bootstrapId: request.bootstrapId,
      state: 'manifest-received',
      manifest,
      ...epoch,
      cursor: encodeV2Cursor(accountId, epoch, this.v2ChangeSeq()),
    };
  }

  private bootstrapV2Entities(
    accountId: string,
    request: SyncV2BootstrapEntitiesRequest,
  ): SyncV2BootstrapEntitiesResponse {
    const bootstrap = this.sql
      .exec<{ device_id: string; state: string }>(
        'SELECT device_id, state FROM v2_bootstraps WHERE bootstrap_id = ?',
        request.bootstrapId,
      )
      .toArray()[0];
    if (!bootstrap || bootstrap.device_id !== request.deviceId) {
      throw new ProtocolError(409, 'bootstrap_state_invalid', 'bootstrap manifest is missing');
    }
    const epoch = this.v2Epoch();
    const acks = this.ctx.storage.transactionSync(() => {
      const result = request.entities.map((mutation) => this.applyV2Mutation(mutation));
      const verifiedAt = Date.now();
      this.sql.exec(
        "UPDATE v2_bootstraps SET state = 'base-established', updated_at = ? WHERE bootstrap_id = ?",
        verifiedAt,
        request.bootstrapId,
      );
      this.sql.exec(
        'UPDATE v2_devices SET watermark = ?, last_seen_at = ? WHERE device_id = ?',
        this.v2ChangeSeq(),
        verifiedAt,
        request.deviceId,
      );
      this.recordAuthorityObservationCheckpoint(verifiedAt);
      return result;
    });
    if (this.env.FOCUSLINK_PUSH_QUEUE && acks.some((ack) => ack.status === 'applied')) {
      const hintSeq = this.v2ChangeSeq();
      this.ctx.waitUntil(
        this.env.FOCUSLINK_PUSH_QUEUE.send({
          hintSeq,
          needSync: true,
          sourceDeviceId: request.deviceId,
        }),
      );
    }
    return {
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      bootstrapId: request.bootstrapId,
      state: 'base-established',
      acks,
      ...epoch,
      cursor: encodeV2Cursor(accountId, epoch, this.v2ChangeSeq()),
    };
  }

  private syncV2(accountId: string, request: SyncV2Request): SyncV2Response {
    if (
      this.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = 'v2_maintenance'").one().value ===
        '1' &&
      request.mutations.length > 0
    )
      throw new ProtocolError(503, 'maintenance_mode', 'account restore is in progress');
    this.backfillLegacyCompletedBundles();
    const epoch = this.v2Epoch();
    assertV2Epoch(request, epoch);
    const cursorSeq = decodeV2Cursor(accountId, request.cursor, epoch, this.v2ChangeSeq());
    const acks = this.ctx.storage.transactionSync(() => {
      this.touchV2Device(request.deviceId, Date.now());
      return request.mutations.map((mutation) => this.applyV2Mutation(mutation));
    });
    const available = this.sql
      .exec<V2ChangeRow>(
        `SELECT change_seq, source_device_id, entity_type, entity_id, revision, fingerprint,
         deleted, payload_json FROM v2_changes WHERE change_seq > ? ORDER BY change_seq ASC LIMIT ?`,
        cursorSeq,
        request.pullLimit + 1,
      )
      .toArray();
    const candidateChanges: SyncV2Change[] = available.map((row) => ({
      changeSeq: row.change_seq,
      entityType: row.entity_type,
      entityId: row.entity_id,
      revision: row.revision,
      fingerprint: row.fingerprint,
      deleted: Boolean(row.deleted),
      payload: row.payload_json ? (JSON.parse(row.payload_json) as SyncV2Payload) : null,
      sourceDeviceId: row.source_device_id,
    }));
    const serverTime = Date.now();
    const initialCursor = encodeV2Cursor(accountId, epoch, cursorSeq);
    const page = paginateSyncV2Response(
      {
        protocolVersion: SYNC_V2_PROTOCOL_VERSION,
        ...epoch,
        acks,
        serverTime,
      },
      candidateChanges,
      request.pullLimit,
      initialCursor,
      (change) => encodeV2Cursor(accountId, epoch, change.changeSeq),
    );
    const nextSeq = page.changes.at(-1)?.changeSeq ?? cursorSeq;
    this.ctx.storage.transactionSync(() => {
      const verifiedAt = Date.now();
      this.sql.exec(
        'UPDATE v2_devices SET watermark = ?, last_seen_at = ? WHERE device_id = ?',
        nextSeq,
        verifiedAt,
        request.deviceId,
      );
      this.recordAuthorityObservationCheckpoint(verifiedAt);
    });
    return {
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      ...epoch,
      acks,
      ...page,
      serverTime,
    };
  }

  private applyV2Mutation(mutation: SyncV2Mutation): SyncV2Ack {
    const operationFingerprint = fingerprintDeviceSyncValue(mutation);
    const previous = this.sql
      .exec<V2OperationRow>(
        'SELECT fingerprint, ack_json FROM v2_operations WHERE op_id = ?',
        mutation.opId,
      )
      .toArray()[0];
    if (previous) {
      if (previous.fingerprint !== operationFingerprint) {
        return v2Ack(
          mutation,
          'rejected',
          this.v2Entity(mutation.entityType, mutation.entityId)?.revision ?? null,
          null,
          'op_id_reused',
        );
      }
      const stored = JSON.parse(previous.ack_json) as SyncV2Ack;
      return stored.status === 'applied' ? { ...stored, status: 'duplicate' } : stored;
    }
    const epoch = this.v2Epoch();
    if (mutation.accountGeneration !== epoch.accountGeneration) {
      return this.storeV2Ack(
        operationFingerprint,
        mutation,
        'rejected',
        null,
        null,
        'account_generation_changed',
      );
    }
    const validation = validateV2Mutation(mutation);
    if (validation)
      return this.storeV2Ack(operationFingerprint, mutation, 'rejected', null, null, validation);
    const row = this.v2Entity(mutation.entityType, mutation.entityId);
    if (mutation.baseRevision !== (row?.revision ?? 0)) {
      if (row && isSyntheticCorrectionDuplicate(mutation, row)) {
        const result = this.storeV2Ack(
          operationFingerprint,
          mutation,
          'duplicate',
          row.revision,
          row.fingerprint,
          null,
        );
        this.resolveSyntheticCorrectionConflicts(mutation, row.payload_json);
        return result;
      }
      const result = this.storeV2Ack(
        operationFingerprint,
        mutation,
        'conflict',
        row?.revision ?? null,
        row?.fingerprint ?? null,
        'revision_conflict',
      );
      this.sql.exec(
        `INSERT OR IGNORE INTO v2_conflicts(conflict_id, entity_type, entity_id, base_json,
         local_json, remote_json, fields_json, source_devices_json, status, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, '["revision"]', ?, 'open', ?)`,
        `conflict-${fingerprintDeviceSyncValue({ opId: mutation.opId, revision: row?.revision ?? 0 })}`,
        mutation.entityType,
        mutation.entityId,
        mutation.payload === null ? null : JSON.stringify(mutation.payload),
        row?.payload_json ?? null,
        JSON.stringify([mutation.deviceId]),
        Date.now(),
      );
      return result;
    }
    if (
      row &&
      !row.deleted &&
      mutation.entityType === 'focus_ledger_v2' &&
      (mutation.kind === 'put' || mutation.kind === 'restore')
    ) {
      return this.storeV2Ack(
        operationFingerprint,
        mutation,
        'rejected',
        row.revision,
        row.fingerprint,
        'immutable_ledger_requires_correction',
      );
    }
    const deleted = mutation.kind === 'delete' || mutation.kind === 'purge';
    const revision = (row?.revision ?? 0) + 1;
    const payload = deleted ? null : mutation.payload;
    const fingerprint = fingerprintDeviceSyncValue({ deleted, payload });
    const sequence = this.incrementV2ChangeSeq();
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO v2_entities(entity_type, entity_id, revision, fingerprint, deleted, payload_json,
       delete_change_seq, deleted_at, purge_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET revision=excluded.revision,
       fingerprint=excluded.fingerprint, deleted=excluded.deleted, payload_json=excluded.payload_json,
       delete_change_seq=excluded.delete_change_seq, deleted_at=excluded.deleted_at, purge_after=excluded.purge_after`,
      mutation.entityType,
      mutation.entityId,
      revision,
      fingerprint,
      deleted ? 1 : 0,
      payload === null ? null : JSON.stringify(payload),
      deleted ? sequence : null,
      deleted ? now : null,
      deleted ? now + 180 * 24 * 60 * 60 * 1000 : null,
    );
    this.sql.exec(
      `INSERT INTO v2_changes(change_seq, source_device_id, entity_type, entity_id, revision,
       fingerprint, deleted, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sequence,
      mutation.deviceId,
      mutation.entityType,
      mutation.entityId,
      revision,
      fingerprint,
      deleted ? 1 : 0,
      payload === null ? null : JSON.stringify(payload),
      now,
    );
    if (mutation.kind === 'purge') {
      this.sql.exec(
        `INSERT OR REPLACE INTO v2_graveyard(entity_hash, deleted_generation, purged_at)
         VALUES (?, ?, ?)`,
        fingerprintDeviceSyncValue({
          entityType: mutation.entityType,
          entityId: mutation.entityId,
        }),
        this.v2Epoch().accountGeneration,
        now,
      );
    }
    return this.storeV2Ack(operationFingerprint, mutation, 'applied', revision, fingerprint, null);
  }

  private storeV2Ack(
    operationFingerprint: string,
    mutation: SyncV2Mutation,
    status: SyncV2Ack['status'],
    revision: number | null,
    fingerprint: string | null,
    errorCode: string | null,
  ): SyncV2Ack {
    const ack = v2Ack(mutation, status, revision, fingerprint, errorCode);
    this.sql.exec(
      'INSERT INTO v2_operations(op_id, fingerprint, ack_json, created_at) VALUES (?, ?, ?, ?)',
      mutation.opId,
      operationFingerprint,
      JSON.stringify(ack),
      Date.now(),
    );
    return ack;
  }

  private resolveSyntheticCorrectionConflicts(
    mutation: SyncV2Mutation,
    canonicalPayloadJson: string | null,
  ): void {
    if (canonicalPayloadJson === null) return;
    const rows = this.sql
      .exec<{
        conflict_id: string;
        base_json: string | null;
        local_json: string | null;
        remote_json: string | null;
        fields_json: string;
      }>(
        `SELECT conflict_id, base_json, local_json, remote_json, fields_json FROM v2_conflicts
         WHERE entity_type = 'focus_ledger_correction_v2'
           AND entity_id = ? AND status = 'open'`,
        mutation.entityId,
      )
      .toArray();
    for (const conflict of rows) {
      if (!historicalCorrectionConflictMatches(conflict, mutation.payload, canonicalPayloadJson)) {
        continue;
      }
      this.sql.exec(
        `UPDATE v2_conflicts
         SET status = 'resolved', resolved_at = ?, resolution_op_id = ?
         WHERE conflict_id = ? AND status = 'open'`,
        Date.now(),
        mutation.opId,
        conflict.conflict_id,
      );
    }
  }

  private v2Entity(entityType: SyncV2EntityType, entityId: string): V2EntityRow | undefined {
    return this.sql
      .exec<V2EntityRow>(
        `SELECT entity_type, entity_id, revision, fingerprint, deleted, payload_json, delete_change_seq
         FROM v2_entities WHERE entity_type = ? AND entity_id = ?`,
        entityType,
        entityId,
      )
      .toArray()[0];
  }

  private v2ChangeSeq(): number {
    return Number(
      this.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = 'v2_change_seq'").one().value,
    );
  }

  private incrementV2ChangeSeq(): number {
    const next = this.v2ChangeSeq() + 1;
    this.sql.exec("UPDATE meta SET value = ? WHERE key = 'v2_change_seq'", String(next));
    return next;
  }

  private touchV2Device(deviceId: string, now: number): void {
    this.sql.exec(
      `INSERT INTO v2_devices(device_id, display_name, scopes_json, last_seen_at)
       VALUES (?, ?, '["sync:read","sync:write","live:read","live:write"]', ?)
       ON CONFLICT(device_id) DO UPDATE SET last_seen_at=excluded.last_seen_at, stale=0`,
      deviceId,
      deviceId,
      now,
    );
    this.sql.exec(
      'UPDATE v2_devices SET stale = 1 WHERE last_seen_at < ?',
      now - 90 * 24 * 60 * 60 * 1000,
    );
  }

  private authorityObservationRevision(): number {
    return Number(
      this.sql
        .exec<MetaRow>("SELECT value FROM meta WHERE key = 'authority_observation_revision'")
        .one().value,
    );
  }

  private assertAuthorityObservationDependencies(): void {
    const probe = this.sql
      .exec<{ table_count: number; meta_count: number; live_count: number }>(
        `
        SELECT
          (SELECT COUNT(*) FROM sqlite_schema
           WHERE type = 'table' AND name IN (
             'meta', 'v2_entities', 'v2_devices', 'v2_conflicts',
             'live_state', 'authority_observation_snapshots'
           )) AS table_count,
          (SELECT COUNT(*) FROM meta WHERE key IN (
             'v2_change_seq', 'v2_sync_epoch', 'v2_cursor_epoch',
             'v2_account_generation', 'v2_maintenance',
             'authority_observation_revision', 'authority_observation_schema_version'
           )) AS meta_count,
          (SELECT COUNT(*) FROM live_state WHERE singleton = 1) AS live_count
      `,
      )
      .one();
    if (
      Number(probe.table_count) !== 6 ||
      Number(probe.meta_count) !== 7 ||
      Number(probe.live_count) !== 1
    ) {
      throw new Error('authority observation dependency probe failed');
    }
  }

  private recordAuthorityObservationCheckpoint(verifiedAt: number): void {
    const audience = exactFocusLinkAuthorityAudience(this.env.FOCUSLINK_AUTHORITY_AUDIENCE);
    if (!audience) return;
    const authorityChangeSeq = this.v2ChangeSeq();
    const epoch = this.v2Epoch();
    const maintenance =
      this.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = 'v2_maintenance'").one().value ===
      '1';
    const devices = this.sql
      .exec<{ device_id: string; watermark: number; stale: number }>(
        `SELECT device_id, watermark, stale FROM v2_devices
         WHERE revoked_at IS NULL ORDER BY device_id`,
      )
      .toArray();
    const openConflictCount = Number(
      this.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM v2_conflicts WHERE status = 'open'")
        .one().count,
    );
    let pendingCount = 0;
    for (const device of devices) {
      if (
        !Number.isSafeInteger(device.watermark) ||
        device.watermark < 0 ||
        device.watermark > authorityChangeSeq
      ) {
        throw new Error('authority device checkpoint is invalid');
      }
      pendingCount += authorityChangeSeq - device.watermark;
      if (!Number.isSafeInteger(pendingCount)) {
        throw new Error('authority pending count is invalid');
      }
    }
    const liveRevision = this.readLive().revision;
    const state = {
      accountGeneration: epoch.accountGeneration,
      authorityChangeSeq,
      liveRevision,
      maintenance,
      openConflictCount,
      devices: devices.map((device) => ({
        deviceId: device.device_id,
        watermark: device.watermark,
        stale: Boolean(device.stale),
      })),
    };
    const stateHash = fingerprintDeviceSyncValue(state);
    const previous = this.sql
      .exec<AuthorityObservationRow>(
        `SELECT revision, state_hash, observation_json, expires_at
         FROM authority_observation_snapshots ORDER BY revision DESC LIMIT 1`,
      )
      .toArray()[0];
    if (
      previous &&
      reusableFocusLinkAuthorityObservation(
        {
          revision: Number(previous.revision),
          stateHash: previous.state_hash,
          observationJson: previous.observation_json,
          expiresAtMs: Number(previous.expires_at),
        },
        stateHash,
        verifiedAt,
      )
    ) {
      return;
    }

    let blockerReason: string | null = null;
    if (maintenance) blockerReason = 'maintenance_mode';
    else if (openConflictCount > 0) blockerReason = 'open_conflict';
    else if (devices.length === 0) blockerReason = 'no_active_device';
    else if (authorityChangeSeq < 1 && liveRevision < 1)
      blockerReason = 'authority_revision_unavailable';
    else if (pendingCount > 0) blockerReason = 'device_catchup_pending';
    const revision = this.authorityObservationRevision() + 1;
    if (!Number.isSafeInteger(revision)) throw new Error('authority revision exhausted');
    const readAvailable = devices.length > 0 && (authorityChangeSeq > 0 || liveRevision > 0);
    const writeAvailable = readAvailable;
    const observation = buildFocusLinkAuthorityObservation({
      revision,
      audience,
      observedAtMs: verifiedAt,
      lastVerifiedAtMs: verifiedAt,
      pendingCount,
      blockerReason,
      readAvailable,
      writeAvailable,
      continuedSync: readAvailable && writeAvailable && blockerReason === null,
    });
    this.sql.exec(
      `INSERT INTO authority_observation_snapshots(
         revision, state_hash, observation_json, observed_at, expires_at
       ) VALUES (?, ?, ?, ?, ?)`,
      revision,
      stateHash,
      JSON.stringify(observation),
      verifiedAt,
      Date.parse(observation.expiresAt),
    );
    this.sql.exec(
      "UPDATE meta SET value = ? WHERE key = 'authority_observation_revision'",
      String(revision),
    );
  }

  private ensureAuthorityObservation(now: number): FocusLinkAuthorityObservation | null {
    return this.ctx.storage.transactionSync(() => {
      this.assertAuthorityObservationDependencies();
      const current = this.readAuthorityObservation(now);
      if (current) return current;
      this.recordAuthorityObservationCheckpoint(now);
      return this.readAuthorityObservation(now);
    });
  }

  private readAuthorityObservation(now: number): FocusLinkAuthorityObservation | null {
    const row = this.sql
      .exec<AuthorityObservationRow>(
        `SELECT revision, state_hash, observation_json, expires_at
         FROM authority_observation_snapshots ORDER BY revision DESC LIMIT 1`,
      )
      .toArray()[0];
    if (!row) return null;
    return reusableFocusLinkAuthorityObservation(
      {
        revision: Number(row.revision),
        stateHash: row.state_hash,
        observationJson: row.observation_json,
        expiresAtMs: Number(row.expires_at),
      },
      row.state_hash,
      now,
    );
  }

  private async authorizeV2(request: Request, scope: string): Promise<V2Identity> {
    const header = request.headers.get('x-focuslink-authorization') ?? '';
    if (header === `Bearer ${this.env.FOCUSLINK_SYNC_TOKEN}`) {
      return { deviceId: 'owner-migration', scopes: ['*'], owner: true };
    }
    const credential = parseV2DeviceCredential(header);
    if (!credential) {
      throw new ProtocolError(401, 'unauthenticated', 'valid device credential required');
    }
    const row = this.sql
      .exec<V2DeviceCredentialRecord & { pepper_version: number }>(
        `SELECT device_id, account_public_id, secret_hmac, pepper_version, scopes_json, expires_at, revoked_at
       FROM v2_devices WHERE device_public_id = ?`,
        credential.devicePublicId,
      )
      .toArray()[0];
    if (!row) {
      return authorizeV2CredentialRecord(credential, undefined, null, scope, Date.now());
    }
    const pepper =
      row.pepper_version === 2
        ? this.env.FOCUSLINK_DEVICE_PEPPER
        : (this.env.FOCUSLINK_DEVICE_PEPPER_PREVIOUS ?? this.env.FOCUSLINK_DEVICE_PEPPER);
    if (!pepper)
      throw new ProtocolError(503, 'credential_missing', 'device pepper is not configured');
    const digest = await hmacHex(pepper, credential.secret);
    const identity = authorizeV2CredentialRecord(credential, row, digest, scope, Date.now());
    this.sql.exec(
      'UPDATE v2_devices SET last_seen_at = ?, stale = 0 WHERE device_id = ?',
      Date.now(),
      identity.deviceId,
    );
    return identity;
  }

  private async createPairOffer(
    value: unknown,
    identity: V2Identity,
    accountPublicId: string,
  ): Promise<
    | { code: string; expiresAt: number }
    | { nonce: string; expiresAt: number; devicePublicId: string }
  > {
    if (!isRecord(value) || !hasOnlyKeys(value, PAIR_OFFER_KEYS)) {
      throw new ProtocolError(400, 'invalid_pair_offer', 'invalid pair offer');
    }
    const displayName = normalizePairDisplayName(value.displayName);
    const scopes = parsePairScopes(value.scopes);
    const hasTargetMetadata = ['installationId', 'platform', 'deviceKind', 'appVersion'].some(
      (key) => key in value,
    );
    const metadata = parsePairDeviceMetadata(
      hasTargetMetadata
        ? {
            installationId: value.installationId,
            displayName,
            platform: value.platform,
            deviceKind: value.deviceKind,
            appVersion: value.appVersion,
          }
        : {},
      false,
    );
    if (!displayName || !scopes || metadata === 'invalid') {
      throw new ProtocolError(400, 'invalid_pair_offer', 'invalid pair offer');
    }
    const pepper = this.env.FOCUSLINK_DEVICE_PEPPER;
    if (!pepper) {
      throw new ProtocolError(503, 'credential_missing', 'device pepper is not configured');
    }

    const expiresAt = Date.now() + FOCUSLINK_PAIRING_CODE_TTL_MS;
    // Owner/service authority keeps the legacy high-entropy nonce contract.
    // A normal trusted device receives the human-facing numeric code. The
    // numeric value is never inserted into storage or passed to a logger.
    let nonce = '';
    let devicePublicId = '';
    let numericCode = '';
    let inserted = false;
    for (let attempt = 0; attempt < 4 && !inserted; attempt += 1) {
      nonce = randomToken(32);
      devicePublicId = randomDevicePublicId();
      numericCode = randomPairingCode();
      const codeHmac = await hmacHex(pepper, pairingCodeHmacInput(numericCode));
      try {
        this.sql.exec(
          `INSERT INTO v2_pair_offers(
             nonce, account_public_id, device_public_id, display_name, scopes_json, expires_at, code_hmac,
             installation_id, platform, device_kind, app_version
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          nonce,
          accountPublicId,
          devicePublicId,
          displayName,
          JSON.stringify(scopes),
          expiresAt,
          codeHmac,
          metadata === null ? null : metadata.installationId,
          metadata === null ? null : metadata.platform,
          metadata === null ? null : metadata.deviceKind,
          metadata === null ? null : metadata.appVersion,
        );
        inserted = true;
      } catch (error) {
        if (!shouldRetryPairCodeCollision(error, attempt)) {
          throw new ProtocolError(500, 'store_corrupt', 'pair offer could not be stored');
        }
      }
    }
    if (!inserted) throw new ProtocolError(503, 'pairing_unavailable', 'pairing is unavailable');
    if (identity.owner) return { nonce, expiresAt, devicePublicId };
    return { code: numericCode, expiresAt };
  }

  private async exchangePairOffer(
    accountId: string,
    value: unknown,
  ): Promise<{
    deviceId: string;
    accessToken: string;
    scopes: string[];
    expiresAt: number;
  }> {
    if (!isRecord(value) || !hasOnlyKeys(value, PAIR_EXCHANGE_KEYS)) {
      throw new ProtocolError(400, 'invalid_pairing_request', 'invalid pairing request');
    }
    const code = typeof value.code === 'string' ? value.code : null;
    const nonce = typeof value.nonce === 'string' ? value.nonce : null;
    if ((code === null) === (nonce === null)) {
      throw new ProtocolError(400, 'invalid_pairing_code', 'invalid pairing code');
    }
    const metadata = parsePairDeviceMetadata(value.device, code !== null);
    if (metadata === 'invalid' || metadata === null) {
      throw new ProtocolError(400, 'invalid_pairing_device', 'invalid pairing device');
    }
    const pepper = this.env.FOCUSLINK_DEVICE_PEPPER;
    if (!pepper)
      throw new ProtocolError(503, 'credential_missing', 'device pepper is not configured');
    const lookup =
      code !== null
        ? FOCUSLINK_PAIRING_CODE_PATTERN.test(code)
          ? { field: 'code_hmac', value: await hmacHex(pepper, pairingCodeHmacInput(code)) }
          : null
        : /^[A-Za-z0-9_-]{8,160}$/.test(nonce!)
          ? { field: 'nonce', value: nonce! }
          : null;
    if (!lookup) {
      throw new ProtocolError(400, 'invalid_pairing_code', 'invalid pairing code');
    }

    this.ensureRegistrationSchema();
    const accountPublicId = publicId(accountId);
    const installationHmac =
      code !== null
        ? await registeredDeviceInstallationHmac(pepper, accountId, metadata.installationId)
        : null;
    const derivedDevicePublicId = installationHmac?.slice(0, 24) ?? null;
    let devicePublicId = derivedDevicePublicId ?? '';
    let deviceId = '';
    const secret = randomToken(48);
    const secretHmac = await hmacHex(pepper, secret);
    const expiresAt = Date.now() + 365 * DAY_MS;
    let scopes: string[] = [...FOCUSLINK_ENROLLED_DEVICE_SCOPES];
    const now = Date.now();
    let offer: PairOfferRow | undefined;
    this.ctx.storage.transactionSync(() => {
      offer = this.sql
        .exec<PairOfferRow>(
          `SELECT nonce, device_public_id, display_name, scopes_json, expires_at, used_at,
             code_hmac, account_public_id, installation_id, platform, device_kind, app_version
           FROM v2_pair_offers WHERE ${lookup.field} = ?`,
          lookup.value,
        )
        .toArray()[0];
      assertPairOfferClaimAvailable(offer, now, accountPublicId);
      // Legacy offers predate numeric installation binding and already carry
      // their public device id. Do not rotate it during a compatibility claim.
      devicePublicId = derivedDevicePublicId ?? offer.device_public_id;
      deviceId = `device-${devicePublicId}`;
      if (code === null) {
        try {
          const legacyScopes = parsePairScopes(JSON.parse(offer.scopes_json) as unknown);
          if (legacyScopes) scopes = legacyScopes;
        } catch {
          // A malformed historical scope row is fail-closed to enrolled scopes.
        }
      }
      if (code !== null) {
        const matches = pairMetadataMatches(offer, metadata);
        if (!matches) {
          throw new ProtocolError(
            409,
            'pairing_binding_mismatch',
            'pairing device metadata does not match the offer',
          );
        }
        // A desktop-generated offer does not know the target installation in
        // advance. Bind it exactly once at the first valid code redemption.
        if (offer.installation_id === null) {
          this.sql.exec(
            `UPDATE v2_pair_offers
             SET display_name = ?, installation_id = ?, platform = ?, device_kind = ?, app_version = ?
             WHERE nonce = ? AND used_at IS NULL`,
            metadata.displayName,
            metadata.installationId,
            metadata.platform,
            metadata.deviceKind,
            metadata.appVersion,
            offer.nonce,
          );
        }
      }
      this.sql.exec(
        `UPDATE v2_pair_offers SET used_at = ? WHERE nonce = ? AND used_at IS NULL`,
        now,
        offer.nonce,
      );
      const scopesJson = JSON.stringify(scopes);
      this.sql.exec(
        `INSERT INTO v2_devices(device_id, device_public_id, account_public_id, display_name,
         scopes_json, secret_hmac, pepper_version, expires_at, last_seen_at, stale, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, 2, ?, ?, 0, NULL)
         ON CONFLICT(device_id) DO UPDATE SET
           device_public_id=excluded.device_public_id,
           account_public_id=excluded.account_public_id,
           display_name=excluded.display_name,
           scopes_json=excluded.scopes_json,
           secret_hmac=excluded.secret_hmac,
           pepper_version=2,
           expires_at=excluded.expires_at,
           last_seen_at=excluded.last_seen_at,
           stale=0,
           revoked_at=NULL`,
        deviceId,
        devicePublicId,
        accountPublicId,
        code !== null ? metadata.displayName : offer.display_name,
        scopesJson,
        secretHmac,
        expiresAt,
        now,
      );
      if (installationHmac !== null) {
        this.sql.exec(
          `INSERT INTO v2_device_registrations(device_id, installation_hmac, platform, device_kind,
           app_version, registered_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(device_id) DO UPDATE SET
             installation_hmac=excluded.installation_hmac,
             platform=excluded.platform,
             device_kind=excluded.device_kind,
             app_version=excluded.app_version,
             updated_at=excluded.updated_at`,
          deviceId,
          installationHmac,
          metadata.platform,
          metadata.deviceKind,
          metadata.appVersion,
          now,
          now,
        );
      }
    });
    return {
      deviceId,
      accessToken: `fl2_${accountPublicId}_${devicePublicId}_${secret}`,
      scopes,
      expiresAt,
    };
  }

  private async registerOwnerDevice(
    accountId: string,
    value: unknown,
  ): Promise<FocusLinkDeviceRegistrationResponse> {
    const request = parseFocusLinkDeviceRegistrationRequest(value);
    if (!request) {
      throw new ProtocolError(400, 'invalid_device_registration', 'invalid device registration');
    }
    const pepper = this.env.FOCUSLINK_DEVICE_PEPPER;
    if (!pepper) {
      throw new ProtocolError(503, 'credential_missing', 'device pepper is not configured');
    }
    this.ensureRegistrationSchema();
    const accountPublicId = publicId(accountId);
    const installationHmac = await registeredDeviceInstallationHmac(
      pepper,
      accountId,
      request.installationId,
    );
    const devicePublicId = installationHmac.slice(0, 24);
    const deviceId = `device-${devicePublicId}`;
    const secret = randomToken(48);
    const secretHmac = await hmacHex(pepper, secret);
    const now = Date.now();
    const expiresAt = now + 365 * DAY_MS;
    const scopes = [...FOCUSLINK_ENROLLED_DEVICE_SCOPES];
    const existing = this.sql
      .exec<{ device_id: string }>(
        'SELECT device_id FROM v2_device_registrations WHERE installation_hmac = ?',
        installationHmac,
      )
      .toArray()[0];
    if (existing && existing.device_id !== deviceId) {
      throw new ProtocolError(409, 'installation_conflict', 'installation identity conflict');
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO v2_devices(device_id, device_public_id, account_public_id, display_name,
         scopes_json, secret_hmac, pepper_version, expires_at, last_seen_at, stale, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, 2, ?, ?, 0, NULL)
         ON CONFLICT(device_id) DO UPDATE SET
           device_public_id=excluded.device_public_id,
           account_public_id=excluded.account_public_id,
           display_name=excluded.display_name,
           scopes_json=excluded.scopes_json,
           secret_hmac=excluded.secret_hmac,
           pepper_version=2,
           expires_at=excluded.expires_at,
           last_seen_at=excluded.last_seen_at,
           stale=0,
           revoked_at=NULL`,
        deviceId,
        devicePublicId,
        accountPublicId,
        request.displayName,
        JSON.stringify(scopes),
        secretHmac,
        expiresAt,
        now,
      );
      this.sql.exec(
        `INSERT INTO v2_device_registrations(device_id, installation_hmac, platform, device_kind,
         app_version, registered_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           installation_hmac=excluded.installation_hmac,
           platform=excluded.platform,
           device_kind=excluded.device_kind,
           app_version=excluded.app_version,
           updated_at=excluded.updated_at`,
        deviceId,
        installationHmac,
        request.platform,
        request.deviceKind,
        request.appVersion ?? null,
        now,
        now,
      );
    });
    console.info(
      JSON.stringify({
        event: 'focuslink.device.registered',
        accountPublicId,
        deviceId,
        platform: request.platform,
        deviceKind: request.deviceKind,
        credentialRotated: Boolean(existing),
      }),
    );
    return {
      protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
      accountPublicId,
      deviceId,
      accessToken: `fl2_${accountPublicId}_${devicePublicId}_${secret}`,
      tokenType: 'Bearer',
      scopes,
      expiresAt,
      serverTime: now,
    };
  }

  private ensureRegistrationSchema(): void {
    if (this.registrationSchemaReady) return;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS v2_device_registrations (
        device_id TEXT PRIMARY KEY,
        installation_hmac TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL,
        device_kind TEXT NOT NULL,
        app_version TEXT,
        registered_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.registrationSchemaReady = true;
  }

  private listV2Devices(): { devices: unknown[]; serverTime: number } {
    this.ensureRegistrationSchema();
    const devices = this.sql
      .exec<Record<string, SqlStorageValue>>(
        `SELECT d.device_id, d.device_public_id, d.display_name, d.scopes_json, d.expires_at,
       d.revoked_at, d.last_seen_at, d.watermark, d.stale, r.platform, r.device_kind,
       r.app_version, r.registered_at
       FROM v2_devices d LEFT JOIN v2_device_registrations r ON r.device_id = d.device_id
       ORDER BY d.last_seen_at DESC`,
      )
      .toArray()
      .map((row) => ({
        deviceId: row.device_id,
        devicePublicId: row.device_public_id,
        displayName: row.display_name,
        scopes: JSON.parse(String(row.scopes_json)),
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        lastSeenAt: row.last_seen_at,
        watermark: row.watermark,
        stale: Boolean(row.stale),
        platform: row.platform ?? null,
        deviceKind: row.device_kind ?? null,
        appVersion: row.app_version ?? null,
        registeredAt: row.registered_at ?? null,
      }));
    return { devices, serverTime: Date.now() };
  }

  private patchV2Device(value: unknown): unknown {
    if (
      !isRecord(value) ||
      !isId(value.deviceId) ||
      typeof value.displayName !== 'string' ||
      value.displayName.trim().length === 0 ||
      value.displayName.length > 100
    )
      throw new ProtocolError(400, 'invalid_request', 'invalid device patch');
    this.sql.exec(
      'UPDATE v2_devices SET display_name = ? WHERE device_id = ?',
      value.displayName.trim(),
      value.deviceId,
    );
    return this.listV2Devices();
  }

  private revokeV2Device(deviceId: string): { deviceId: string; revokedAt: number } {
    const revokedAt = Date.now();
    this.ctx.storage.transactionSync(() => {
      const result = this.sql.exec(
        'UPDATE v2_devices SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL',
        revokedAt,
        deviceId,
      );
      if (result.rowsWritten === 0)
        throw new ProtocolError(404, 'device_not_found', 'active device not found');
      this.recordAuthorityObservationCheckpoint(revokedAt);
    });
    return { deviceId, revokedAt };
  }

  private async rotateV2Device(
    accountId: string,
    deviceId: string,
  ): Promise<{ accessToken: string; expiresAt: number }> {
    const row = this.sql
      .exec<{ device_public_id: string; revoked_at: number | null }>(
        'SELECT device_public_id, revoked_at FROM v2_devices WHERE device_id = ?',
        deviceId,
      )
      .toArray()[0];
    if (!row || row.revoked_at !== null)
      throw new ProtocolError(404, 'device_not_found', 'active device not found');
    const pepper = this.env.FOCUSLINK_DEVICE_PEPPER;
    if (!pepper)
      throw new ProtocolError(503, 'credential_missing', 'device pepper is not configured');
    const secret = randomToken(48);
    const expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
    this.sql.exec(
      'UPDATE v2_devices SET secret_hmac = ?, pepper_version = 2, expires_at = ? WHERE device_id = ?',
      await hmacHex(pepper, secret),
      expiresAt,
      deviceId,
    );
    return {
      accessToken: `fl2_${publicId(accountId)}_${row.device_public_id}_${secret}`,
      expiresAt,
    };
  }

  private listV2Conflicts(): { conflicts: unknown[] } {
    return {
      conflicts: this.sql
        .exec<Record<string, SqlStorageValue>>(
          `SELECT conflict_id, entity_type, entity_id, base_json, local_json, remote_json,
       fields_json, source_devices_json, status, created_at, resolved_at, resolution_op_id
       FROM v2_conflicts ORDER BY created_at DESC`,
        )
        .toArray()
        .map((row) => ({
          ...row,
          fields: JSON.parse(String(row.fields_json)),
          sourceDeviceIds: JSON.parse(String(row.source_devices_json)),
        })),
    };
  }

  private getV2Conflict(conflictId: string): unknown {
    const row = this.sql
      .exec<Record<string, SqlStorageValue>>(
        'SELECT * FROM v2_conflicts WHERE conflict_id = ?',
        conflictId,
      )
      .toArray()[0];
    if (!row) throw new ProtocolError(404, 'conflict_not_found', 'conflict not found');
    return row;
  }

  private resolveV2Conflict(conflictId: string, value: unknown): { ack: SyncV2Ack } {
    const existing = this.getV2Conflict(conflictId) as Record<string, SqlStorageValue>;
    if (!isRecord(value) || !isRecord(value.mutation))
      throw new ProtocolError(400, 'invalid_request', 'standard v2 mutation required');
    const mutation = value.mutation as unknown as SyncV2Mutation;
    const error = validateV2Mutation(mutation);
    if (error) throw new ProtocolError(400, error, 'invalid conflict resolution mutation');
    if (mutation.entityType !== existing.entity_type || mutation.entityId !== existing.entity_id)
      throw new ProtocolError(409, 'conflict_entity_mismatch', 'resolution targets another entity');
    const ack = this.ctx.storage.transactionSync(() => {
      const result = this.applyV2Mutation(mutation);
      if (result.status === 'applied' || result.status === 'duplicate') {
        this.sql.exec(
          `UPDATE v2_conflicts SET status = 'resolved', resolved_at = ?, resolution_op_id = ?
         WHERE conflict_id = ?`,
          Date.now(),
          mutation.opId,
          conflictId,
        );
        this.recordAuthorityObservationCheckpoint(Date.now());
      }
      return result;
    });
    return { ack };
  }

  private listV2Trash(): { items: unknown[]; retentionDays: number } {
    return {
      items: this.sql
        .exec<Record<string, SqlStorageValue>>(
          `SELECT entity_type, entity_id, revision, fingerprint, delete_change_seq, deleted_at, purge_after
       FROM v2_entities WHERE deleted = 1 ORDER BY deleted_at DESC`,
        )
        .toArray(),
      retentionDays: 30,
    };
  }

  private getV2TrashItem(entityId: string): unknown {
    const rows = this.sql
      .exec<Record<string, SqlStorageValue>>(
        `SELECT entity_type, entity_id, revision, fingerprint, delete_change_seq, deleted_at, purge_after
       FROM v2_entities WHERE entity_id = ? AND deleted = 1`,
        entityId,
      )
      .toArray();
    if (rows.length === 0) throw new ProtocolError(404, 'trash_not_found', 'trash item not found');
    return { items: rows };
  }

  private applyV2AdministrativeMutation(
    value: unknown,
    expectedKind: 'restore' | 'purge',
  ): { ack: SyncV2Ack } {
    if (!isRecord(value) || !isRecord(value.mutation))
      throw new ProtocolError(400, 'invalid_request', 'standard v2 mutation required');
    const mutation = value.mutation as unknown as SyncV2Mutation;
    if (mutation.kind !== expectedKind)
      throw new ProtocolError(400, 'mutation_kind_mismatch', `${expectedKind} mutation required`);
    const error = validateV2Mutation(mutation);
    if (error) throw new ProtocolError(400, error, 'invalid administrative mutation');
    return {
      ack: this.ctx.storage.transactionSync(() => {
        const ack = this.applyV2Mutation(mutation);
        if (ack.status === 'applied' || ack.status === 'duplicate') {
          this.recordAuthorityObservationCheckpoint(Date.now());
        }
        return ack;
      }),
    };
  }

  private registerV2Push(deviceId: string, value: unknown): { deviceId: string; state: string } {
    if (!isRecord(value) || !['fcm', 'huawei', 'xiaomi'].includes(String(value.provider)))
      throw new ProtocolError(400, 'invalid_request', 'invalid push provider');
    const provider = String(value.provider);
    const configured = false;
    const state = configured ? 'registered' : 'credential-missing';
    this.sql.exec(
      `INSERT INTO v2_push_registrations(device_id, provider, registration_json, state, updated_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET provider=excluded.provider,
       registration_json=excluded.registration_json, state=excluded.state, updated_at=excluded.updated_at`,
      deviceId,
      provider,
      JSON.stringify(value),
      state,
      Date.now(),
    );
    return { deviceId, state };
  }

  private listV2Backups(): { backups: unknown[]; storageConfigured: boolean } {
    return {
      backups: this.sql
        .exec<Record<string, SqlStorageValue>>(
          'SELECT * FROM v2_backup_catalog ORDER BY created_at DESC',
        )
        .toArray(),
      storageConfigured: Boolean(this.env.FOCUSLINK_BACKUPS && this.env.FOCUSLINK_BACKUP_KEY),
    };
  }

  private async createV2Backup(
    kind: 'daily' | 'weekly' | 'pre-restore' | 'post-restore',
  ): Promise<unknown> {
    if (!this.env.FOCUSLINK_BACKUPS || !this.env.FOCUSLINK_BACKUP_KEY)
      throw new ProtocolError(503, 'credential_missing', 'R2 backup binding or key is missing');
    const epoch = this.v2Epoch();
    const entities = this.sql
      .exec<Record<string, SqlStorageValue>>(
        `SELECT entity_type, entity_id, revision, fingerprint, deleted, payload_json,
       delete_change_seq, deleted_at, purge_after FROM v2_entities ORDER BY entity_type, entity_id`,
      )
      .toArray()
      .map((row) => [
        row.entity_type,
        row.entity_id,
        row.revision,
        row.fingerprint,
        row.deleted,
        row.payload_json,
        row.delete_change_seq,
        row.deleted_at,
        row.purge_after,
      ]);
    const changes = this.sql
      .exec<Record<string, SqlStorageValue>>(
        `SELECT change_seq, source_device_id, entity_type, entity_id, revision, fingerprint,
       deleted, payload_json, created_at FROM v2_changes ORDER BY change_seq`,
      )
      .toArray()
      .map((row) => [
        row.change_seq,
        row.source_device_id,
        row.entity_type,
        row.entity_id,
        row.revision,
        row.fingerprint,
        row.deleted,
        row.payload_json,
        row.created_at,
      ]);
    const operations = this.sql
      .exec<Record<string, SqlStorageValue>>(
        'SELECT op_id, fingerprint, ack_json, created_at FROM v2_operations ORDER BY created_at',
      )
      .toArray()
      .map((row) => [row.op_id, row.fingerprint, row.ack_json, row.created_at]);
    const graveyard = this.sql
      .exec<Record<string, SqlStorageValue>>(
        'SELECT entity_hash, deleted_generation, purged_at FROM v2_graveyard ORDER BY entity_hash',
      )
      .toArray()
      .map((row) => [row.entity_hash, row.deleted_generation, row.purged_at]);
    const plaintext = new TextEncoder().encode(
      JSON.stringify({
        accountGeneration: epoch.accountGeneration,
        changeSeq: this.v2ChangeSeq(),
        entities,
        changes,
        operations,
        graveyard,
      }),
    );
    const encrypted = await aesEncrypt(plaintext, this.env.FOCUSLINK_BACKUP_KEY);
    const createdAt = Date.now();
    const backupId = `backup-${createdAt}-${randomToken(8)}`;
    const objectKey = `${kind}/${new Date(createdAt).toISOString().slice(0, 10)}/${backupId}.bin`;
    const plaintextSha = await sha256Hex(plaintext);
    const ciphertextSha = await sha256Hex(encrypted.ciphertext);
    await this.env.FOCUSLINK_BACKUPS.put(objectKey, encrypted.ciphertext, {
      customMetadata: { backupId, kind, keyVersion: '1', plaintextSha, ciphertextSha },
    });
    this.sql.exec(
      `INSERT INTO v2_backup_catalog(backup_id, kind, object_key, key_version, nonce,
       plaintext_sha256, ciphertext_sha256, account_generation, created_at, status)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'verified')`,
      backupId,
      kind,
      objectKey,
      encrypted.nonce,
      plaintextSha,
      ciphertextSha,
      epoch.accountGeneration,
      createdAt,
    );
    await this.pruneV2Backups();
    return {
      backupId,
      kind,
      createdAt,
      plaintextSha256: plaintextSha,
      ciphertextSha256: ciphertextSha,
    };
  }

  private async pruneV2Backups(): Promise<void> {
    if (!this.env.FOCUSLINK_BACKUPS) return;
    for (const [kind, keep] of [
      ['daily', 30],
      ['weekly', 12],
    ] as const) {
      const expired = this.sql
        .exec<{ backup_id: string; object_key: string }>(
          'SELECT backup_id, object_key FROM v2_backup_catalog WHERE kind = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?',
          kind,
          keep,
        )
        .toArray();
      for (const row of expired) {
        await this.env.FOCUSLINK_BACKUPS.delete(row.object_key);
        this.sql.exec('DELETE FROM v2_backup_catalog WHERE backup_id = ?', row.backup_id);
      }
    }
  }

  private async previewV2Backup(value: unknown): Promise<unknown> {
    if (!isRecord(value) || !isId(value.backupId))
      throw new ProtocolError(400, 'invalid_request', 'backup id required');
    const decoded = await this.readV2Backup(value.backupId);
    return {
      backupId: value.backupId,
      accountGeneration: decoded.accountGeneration,
      entityCount: decoded.entities.length,
      changeCount: decoded.changes.length,
      operationCount: decoded.operations.length,
      graveyardCount: decoded.graveyard.length,
    };
  }

  private async restoreV2Backup(value: unknown): Promise<unknown> {
    if (!isRecord(value) || !isId(value.backupId))
      throw new ProtocolError(400, 'invalid_request', 'backup id required');
    const backup = await this.readV2Backup(value.backupId);
    const before = await this.createV2Backup('pre-restore');
    this.sql.exec("UPDATE meta SET value = '1' WHERE key = 'v2_maintenance'");
    try {
      const nextGeneration = this.v2Epoch().accountGeneration + 1;
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM v2_entities');
        this.sql.exec('DELETE FROM v2_changes');
        this.sql.exec('DELETE FROM v2_operations');
        for (const row of backup.entities)
          this.sql.exec(
            `INSERT INTO v2_entities(entity_type, entity_id, revision, fingerprint, deleted, payload_json,
           delete_change_seq, deleted_at, purge_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ...row,
          );
        for (const row of backup.changes)
          this.sql.exec(
            `INSERT INTO v2_changes(change_seq, source_device_id, entity_type, entity_id, revision,
           fingerprint, deleted, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ...row,
          );
        for (const row of backup.operations)
          this.sql.exec(
            'INSERT INTO v2_operations(op_id, fingerprint, ack_json, created_at) VALUES (?, ?, ?, ?)',
            ...row,
          );
        for (const row of backup.graveyard)
          this.sql.exec(
            `INSERT INTO v2_graveyard(entity_hash, deleted_generation, purged_at)
             VALUES (?, ?, ?) ON CONFLICT(entity_hash) DO UPDATE SET
             deleted_generation = MAX(v2_graveyard.deleted_generation, excluded.deleted_generation),
             purged_at = MAX(v2_graveyard.purged_at, excluded.purged_at)`,
            ...row,
          );
        this.sql.exec(
          "UPDATE meta SET value = ? WHERE key = 'v2_account_generation'",
          String(nextGeneration),
        );
        this.sql.exec(
          "UPDATE meta SET value = ? WHERE key = 'v2_sync_epoch'",
          `sync-${randomToken(12)}`,
        );
        this.sql.exec(
          "UPDATE meta SET value = ? WHERE key = 'v2_cursor_epoch'",
          `cursor-${randomToken(12)}`,
        );
        this.sql.exec(
          "UPDATE meta SET value = ? WHERE key = 'v2_change_seq'",
          String(backup.changeSeq),
        );
        // A generation change invalidates every prior cursor. Reset only the
        // existing Account DO watermarks so each device must bootstrap the
        // restored generation before it can gate tombstone/graveyard cleanup.
        this.sql.exec('UPDATE v2_devices SET watermark = 0');
      });
      const after = await this.createV2Backup('post-restore');
      return { restored: true, before, after, ...this.v2Epoch() };
    } finally {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("UPDATE meta SET value = '0' WHERE key = 'v2_maintenance'");
        this.recordAuthorityObservationCheckpoint(Date.now());
      });
    }
  }

  private async readV2Backup(backupId: string): Promise<{
    accountGeneration: number;
    changeSeq: number;
    entities: unknown[][];
    changes: unknown[][];
    operations: unknown[][];
    graveyard: unknown[][];
  }> {
    const catalog = this.sql
      .exec<{ object_key: string; nonce: string; plaintext_sha256: string }>(
        'SELECT object_key, nonce, plaintext_sha256 FROM v2_backup_catalog WHERE backup_id = ?',
        backupId,
      )
      .toArray()[0];
    if (!catalog) throw new ProtocolError(404, 'backup_not_found', 'backup not found');
    if (!this.env.FOCUSLINK_BACKUPS || !this.env.FOCUSLINK_BACKUP_KEY)
      throw new ProtocolError(503, 'credential_missing', 'R2 backup binding or key is missing');
    const object = await this.env.FOCUSLINK_BACKUPS.get(catalog.object_key);
    if (!object) throw new ProtocolError(500, 'backup_missing', 'backup object missing');
    const plaintext = await aesDecrypt(
      await object.arrayBuffer(),
      catalog.nonce,
      this.env.FOCUSLINK_BACKUP_KEY,
    );
    if ((await sha256Hex(plaintext)) !== catalog.plaintext_sha256)
      throw new ProtocolError(409, 'backup_tampered', 'backup digest mismatch');
    const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as {
      accountGeneration: number;
      changeSeq: number;
      entities: unknown[][];
      changes: unknown[][];
      operations: unknown[][];
      graveyard?: unknown[][];
    };
    if (
      !Number.isSafeInteger(decoded.accountGeneration) ||
      decoded.accountGeneration < 1 ||
      !Number.isSafeInteger(decoded.changeSeq) ||
      decoded.changeSeq < 0 ||
      !Array.isArray(decoded.entities) ||
      !Array.isArray(decoded.changes) ||
      !Array.isArray(decoded.operations) ||
      (decoded.graveyard !== undefined && !Array.isArray(decoded.graveyard))
    ) {
      throw new ProtocolError(409, 'backup_invalid', 'backup payload is invalid');
    }
    return { ...decoded, graveyard: decoded.graveyard ?? [] };
  }

  private getTaskSnapshot(): TaskSnapshotResponse {
    const row = this.sql
      .exec<TaskRow>(
        'SELECT revision, source_device_id, fingerprint, snapshot_json FROM task_state WHERE singleton = 1',
      )
      .one();
    return {
      protocolVersion: TASK_SNAPSHOT_PROTOCOL_VERSION,
      revision: row.revision,
      sourceDeviceId: row.source_device_id,
      snapshot: row.snapshot_json ? (JSON.parse(row.snapshot_json) as TaskSnapshotPayload) : null,
      serverTime: Date.now(),
    };
  }

  private publishTaskSnapshot(request: TaskSnapshotPublishRequest): TaskSnapshotResponse {
    const serverTime = Date.now();
    if (!isTaskSnapshotPublishedAtWithinFutureSkew(request.snapshot.publishedAt, serverTime)) {
      throw new ProtocolError(
        422,
        'task_snapshot_timestamp_too_far_ahead',
        'task snapshot publishedAt is too far in the future',
      );
    }
    const fingerprint = fingerprintDeviceSyncValue(request.snapshot);
    this.ctx.storage.transactionSync(() => {
      const row = this.sql
        .exec<TaskRow>(
          'SELECT revision, source_device_id, fingerprint, snapshot_json FROM task_state WHERE singleton = 1',
        )
        .one();
      if (row.fingerprint === fingerprint && row.source_device_id === request.deviceId) return;
      const currentSnapshot = row.snapshot_json
        ? (JSON.parse(row.snapshot_json) as TaskSnapshotPayload)
        : null;
      const currentSnapshotIsLegacyFuture =
        currentSnapshot !== null &&
        !isTaskSnapshotPublishedAtWithinFutureSkew(currentSnapshot.publishedAt, serverTime);
      if (
        currentSnapshot &&
        !currentSnapshotIsLegacyFuture &&
        request.snapshot.publishedAt < currentSnapshot.publishedAt
      ) {
        throw new ProtocolError(
          409,
          'stale_task_snapshot',
          'task snapshot is older than the current cloud snapshot',
        );
      }
      if (
        currentSnapshot &&
        !currentSnapshotIsLegacyFuture &&
        request.snapshot.publishedAt === currentSnapshot.publishedAt
      ) {
        throw new ProtocolError(
          409,
          'task_snapshot_conflict',
          'task snapshot timestamp is already bound to different content',
        );
      }
      this.sql.exec(
        'UPDATE task_state SET revision = ?, source_device_id = ?, fingerprint = ?, snapshot_json = ? WHERE singleton = 1',
        row.revision + 1,
        request.deviceId,
        fingerprint,
        JSON.stringify(request.snapshot),
      );
    });
    return this.getTaskSnapshot();
  }

  private getLiveSnapshot(): LiveFocusSnapshotResponse {
    const live = this.readLive();
    const serverTime = Math.max(Date.now(), live.session?.updatedAt ?? 0);
    return {
      protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
      snapshot: materializeLive(live.revision, live.session, serverTime),
      serverTime,
    };
  }

  private async waitForLive(url: URL): Promise<LiveFocusWaitResponse> {
    const keys = [...url.searchParams.keys()];
    if (
      keys.length !== 2 ||
      url.searchParams.getAll('afterRevision').length !== 1 ||
      url.searchParams.getAll('waitMs').length !== 1
    ) {
      throw new ProtocolError(400, 'invalid_query', 'afterRevision and waitMs are required');
    }
    const afterRevision = parseUnsigned(url.searchParams.get('afterRevision'), 'afterRevision');
    const waitMs = parseUnsigned(url.searchParams.get('waitMs'), 'waitMs');
    if (waitMs > LIVE_FOCUS_MAX_WAIT_MS) {
      throw new ProtocolError(400, 'invalid_query', 'waitMs exceeds protocol limit');
    }
    const initial = this.readLive().revision;
    if (afterRevision > initial) {
      throw new ProtocolError(
        409,
        'invalid_live_revision',
        'afterRevision is ahead of current revision',
      );
    }
    if (initial === afterRevision && waitMs > 0) {
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline && this.readLive().revision === afterRevision) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
      }
    }
    const response = this.getLiveSnapshot();
    return { ...response, changed: response.snapshot.revision > afterRevision };
  }

  private commandLive(request: LiveFocusCommandRequest): LiveFocusCommandResponse {
    return this.ctx.storage.transactionSync(() => {
      const live = this.readLive();
      const serverTime = Math.max(Date.now(), live.session?.updatedAt ?? 0);
      const fingerprint = fingerprintDeviceSyncValue({
        deviceId: request.deviceId,
        command: request.command,
      });
      const previous = this.sql
        .exec<StoredLiveOperationRow>(
          'SELECT fingerprint, ack_json FROM live_operations WHERE command_id = ?',
          request.command.commandId,
        )
        .toArray()[0];
      if (previous) {
        let ack = JSON.parse(previous.ack_json) as LiveFocusCommandAck;
        if (previous.fingerprint !== fingerprint) {
          ack = liveRejectedAck(request.command.commandId, live.revision, 'command_id_reused');
        } else if (ack.status === 'applied') {
          ack = { ...ack, status: 'duplicate', errorCode: null };
        }
        return this.liveCommandResponse(ack, serverTime);
      }

      if (request.command.expectedRevision !== live.revision) {
        const ack: LiveFocusCommandAck = {
          commandId: request.command.commandId,
          status: 'conflict',
          revision: live.revision,
          errorCode: 'revision_conflict',
          completedEntityId: null,
        };
        this.insertLiveOperation(request.command.commandId, fingerprint, ack);
        return this.liveCommandResponse(ack, serverTime);
      }
      const rejection = validateLiveTransition(
        live.session,
        request.command,
        Boolean(
          this.entity(request.command.sessionId) ??
          this.v2Entity('focus_ledger_v2', request.command.sessionId) ??
          this.v2Entity('focus_metadata_v2', request.command.sessionId),
        ),
      );
      if (rejection) {
        const ack = liveRejectedAck(request.command.commandId, live.revision, rejection);
        this.insertLiveOperation(request.command.commandId, fingerprint, ack);
        return this.liveCommandResponse(ack, serverTime);
      }

      let session = live.session;
      let completedEntityId: string | null = null;
      switch (request.command.action) {
        case 'start':
          session = {
            id: request.command.sessionId,
            title: request.command.title,
            task: request.command.task ?? null,
            state: 'running',
            startedAt: serverTime,
            updatedAt: serverTime,
            lastCommandDeviceId: request.deviceId,
            segments: [makeLiveSegment(request.command.sessionId, 0, serverTime)],
            pauses: [],
          };
          break;
        case 'pause': {
          const active = requireLiveSession(session);
          const segment = active.segments.at(-1);
          if (!segment || segment.endedAt !== null) throw new Error('running phase missing');
          segment.endedAt = serverTime;
          active.pauses.push(
            makeLivePause(active.id, active.pauses.length, segment.id, serverTime),
          );
          active.state = 'paused';
          active.updatedAt = serverTime;
          active.lastCommandDeviceId = request.deviceId;
          break;
        }
        case 'resume': {
          const active = requireLiveSession(session);
          const pause = active.pauses.at(-1);
          if (!pause || pause.endedAt !== null) throw new Error('paused phase missing');
          pause.endedAt = serverTime;
          active.segments.push(makeLiveSegment(active.id, active.segments.length, serverTime));
          active.state = 'running';
          active.updatedAt = serverTime;
          active.lastCommandDeviceId = request.deviceId;
          break;
        }
        case 'finish':
        case 'abort': {
          const active = requireLiveSession(session);
          closeLivePhase(active, serverTime);
          active.updatedAt = serverTime;
          active.lastCommandDeviceId = request.deviceId;
          const bundle = buildCompletedLiveBundle(
            active,
            request.command.action === 'finish' ? 'finished' : 'aborted',
            serverTime,
          );
          this.publishLiveBundle(request.deviceId, bundle);
          completedEntityId = active.id;
          session = null;
          break;
        }
      }

      const revision = live.revision + 1;
      this.sql.exec(
        'UPDATE live_state SET revision = ?, session_json = ? WHERE singleton = 1',
        revision,
        session ? JSON.stringify(session) : null,
      );
      const ack: LiveFocusCommandAck = {
        commandId: request.command.commandId,
        status: 'applied',
        revision,
        errorCode: null,
        completedEntityId,
      };
      this.insertLiveOperation(request.command.commandId, fingerprint, ack);
      this.recordAuthorityObservationCheckpoint(serverTime);
      return {
        protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
        ack,
        snapshot: materializeLive(revision, session, serverTime),
        serverTime,
      };
    });
  }

  private liveCommandResponse(
    ack: LiveFocusCommandAck,
    serverTime: number,
  ): LiveFocusCommandResponse {
    const live = this.readLive();
    return {
      protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
      ack,
      snapshot: materializeLive(live.revision, live.session, serverTime),
      serverTime,
    };
  }

  private insertLiveOperation(
    commandId: string,
    fingerprint: string,
    ack: LiveFocusCommandAck,
  ): void {
    this.sql.exec(
      'INSERT INTO live_operations(command_id, fingerprint, ack_json, created_at) VALUES (?, ?, ?, ?)',
      commandId,
      fingerprint,
      JSON.stringify(ack),
      Date.now(),
    );
  }

  private publishLiveBundle(deviceId: string, bundle: DeviceSyncSessionBundle): void {
    const split = splitBundleForSyncV2(bundle, deviceId);
    this.insertCompletedV2Entity(
      deviceId,
      'focus_ledger_v2',
      bundle.session.id,
      split.ledger,
      false,
    );
    this.insertCompletedV2Entity(
      deviceId,
      'focus_metadata_v2',
      bundle.session.id,
      split.metadata,
      false,
    );
    const payloadJson = JSON.stringify(bundle);
    const sequence = this.incrementChangeSeq();
    this.sql.exec(
      'INSERT INTO entities(entity_id, revision, deleted, payload_json) VALUES (?, 1, 0, ?)',
      bundle.session.id,
      payloadJson,
    );
    this.sql.exec(
      'INSERT INTO changes(change_seq, device_id, entity_id, revision, deleted, payload_json, created_at) VALUES (?, ?, ?, 1, 0, ?, ?)',
      sequence,
      deviceId,
      bundle.session.id,
      payloadJson,
      Date.now(),
    );
  }

  private backfillLegacyCompletedBundles(): void {
    const marker = this.sql
      .exec<MetaRow>(
        "SELECT value FROM meta WHERE key = 'legacy_v1_completed_bundle_backfill_version'",
      )
      .toArray()[0];
    if (marker?.value === '1') return;

    const limit = 25;
    this.ctx.storage.transactionSync(() => {
      const rows = this.sql
        .exec<LegacyCompletedBundleRow>(
          `SELECT e.entity_id, e.payload_json,
             (SELECT c.device_id FROM changes c
               WHERE c.entity_id = e.entity_id
               ORDER BY c.change_seq ASC LIMIT 1) AS device_id,
             CASE WHEN EXISTS(
               SELECT 1 FROM v2_entities v
                WHERE v.entity_type = 'focus_ledger_v2' AND v.entity_id = e.entity_id
             ) THEN 1 ELSE 0 END AS has_ledger,
             CASE WHEN EXISTS(
               SELECT 1 FROM v2_entities v
                WHERE v.entity_type = 'focus_metadata_v2' AND v.entity_id = e.entity_id
             ) THEN 1 ELSE 0 END AS has_metadata
           FROM entities e
          WHERE e.deleted = 0
            AND e.payload_json IS NOT NULL
            AND (
              NOT EXISTS(
                SELECT 1 FROM v2_entities v
                 WHERE v.entity_type = 'focus_ledger_v2' AND v.entity_id = e.entity_id
              ) OR NOT EXISTS(
                SELECT 1 FROM v2_entities v
                 WHERE v.entity_type = 'focus_metadata_v2' AND v.entity_id = e.entity_id
              )
            )
          ORDER BY e.entity_id ASC
          LIMIT ?`,
          limit,
        )
        .toArray();
      for (const row of rows) {
        let bundle: DeviceSyncSessionBundle;
        try {
          bundle = JSON.parse(row.payload_json) as DeviceSyncSessionBundle;
        } catch {
          continue;
        }
        if (!validateDeviceSyncBundle(bundle).ok) continue;
        const sourceDeviceId = row.device_id ?? 'legacy-v1-migration';
        const split = splitBundleForSyncV2(bundle, sourceDeviceId);
        if (!row.has_ledger) {
          this.insertCompletedV2Entity(
            sourceDeviceId,
            'focus_ledger_v2',
            row.entity_id,
            split.ledger,
            true,
          );
        }
        if (!row.has_metadata) {
          this.insertCompletedV2Entity(
            sourceDeviceId,
            'focus_metadata_v2',
            row.entity_id,
            split.metadata,
            true,
          );
        }
      }
      if (rows.length < limit) {
        this.sql.exec(`
          INSERT INTO meta(key, value)
          VALUES ('legacy_v1_completed_bundle_backfill_version', '1')
          ON CONFLICT(key) DO UPDATE SET value=excluded.value;
        `);
      }
    });
  }

  private insertCompletedV2Entity(
    sourceDeviceId: string,
    entityType: 'focus_ledger_v2' | 'focus_metadata_v2',
    entityId: string,
    payload: FocusLedgerV2 | FocusMetadataV2,
    allowExisting: boolean,
  ): void {
    if (this.v2Entity(entityType, entityId)) {
      if (allowExisting) return;
      throw new ProtocolError(409, 'session_id_exists', 'completed session already exists');
    }
    const payloadJson = JSON.stringify(payload);
    const fingerprint = fingerprintDeviceSyncValue({ deleted: false, payload });
    const sequence = this.incrementV2ChangeSeq();
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO v2_entities(entity_type, entity_id, revision, fingerprint, deleted, payload_json,
       delete_change_seq, deleted_at, purge_after) VALUES (?, ?, 1, ?, 0, ?, NULL, NULL, NULL)`,
      entityType,
      entityId,
      fingerprint,
      payloadJson,
    );
    this.sql.exec(
      `INSERT INTO v2_changes(change_seq, source_device_id, entity_type, entity_id, revision,
       fingerprint, deleted, payload_json, created_at) VALUES (?, ?, ?, ?, 1, ?, 0, ?, ?)`,
      sequence,
      sourceDeviceId,
      entityType,
      entityId,
      fingerprint,
      payloadJson,
      now,
    );
  }

  private readLive(): { revision: number; session: StoredLiveSession | null } {
    const row = this.sql
      .exec<LiveRow>('SELECT revision, session_json FROM live_state WHERE singleton = 1')
      .one();
    return {
      revision: row.revision,
      session: row.session_json ? (JSON.parse(row.session_json) as StoredLiveSession) : null,
    };
  }

  private entity(entityId: string): EntityRow | undefined {
    return this.sql
      .exec<EntityRow>(
        'SELECT entity_id, revision, deleted, payload_json FROM entities WHERE entity_id = ?',
        entityId,
      )
      .toArray()[0];
  }

  private entityRevision(entityId: string): number | null {
    return this.entity(entityId)?.revision ?? null;
  }

  private changeSeq(): number {
    return Number(
      this.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = 'change_seq'").one().value,
    );
  }

  private incrementChangeSeq(): number {
    const next = this.changeSeq() + 1;
    if (!Number.isSafeInteger(next)) throw new Error('change sequence exhausted');
    this.sql.exec("UPDATE meta SET value = ? WHERE key = 'change_seq'", String(next));
    return next;
  }

  private selectLatestChangesAfter(sequence: number): ChangeRow[] {
    return this.sql
      .exec<ChangeRow>(
        `SELECT c.change_seq, c.device_id, c.entity_id, c.revision, c.deleted, c.payload_json
           FROM changes c
           JOIN (
             SELECT entity_id, MAX(change_seq) AS latest_seq
               FROM changes
              WHERE change_seq > ?
              GROUP BY entity_id
           ) latest ON latest.latest_seq = c.change_seq
          ORDER BY c.change_seq ASC`,
        sequence,
      )
      .toArray();
  }
}

function parseSyncRequest(value: unknown): DeviceSyncRequest {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['protocolVersion', 'deviceId', 'cursor', 'mutations', 'pullLimit'])
  ) {
    throw new ProtocolError(400, 'invalid_request', 'invalid sync request fields');
  }
  if (value.protocolVersion !== DEVICE_SYNC_PROTOCOL_VERSION || !isId(value.deviceId)) {
    throw new ProtocolError(400, 'invalid_request', 'unsupported protocol or invalid device');
  }
  if (value.cursor !== null && (typeof value.cursor !== 'string' || value.cursor.length > 512)) {
    throw new ProtocolError(400, 'invalid_request', 'invalid cursor');
  }
  if (!Array.isArray(value.mutations) || value.mutations.length > DEVICE_SYNC_MAX_PUSH) {
    throw new ProtocolError(400, 'invalid_request', 'invalid mutation count');
  }
  if (
    !Number.isInteger(value.pullLimit) ||
    Number(value.pullLimit) < 1 ||
    Number(value.pullLimit) > DEVICE_SYNC_MAX_PULL
  ) {
    throw new ProtocolError(400, 'invalid_request', 'invalid pull limit');
  }
  for (const mutation of value.mutations) {
    if (
      !isRecord(mutation) ||
      !hasOnlyKeys(mutation, ['opId', 'entity', 'entityId', 'kind', 'baseRevision', 'payload'])
    ) {
      throw new ProtocolError(400, 'invalid_request', 'invalid mutation fields');
    }
    if (
      !isId(mutation.opId) ||
      !isId(mutation.entityId) ||
      !Number.isSafeInteger(mutation.baseRevision) ||
      Number(mutation.baseRevision) < 0
    ) {
      throw new ProtocolError(400, 'invalid_request', 'invalid mutation identity');
    }
  }
  return value as unknown as DeviceSyncRequest;
}

function validateMutation(mutation: DeviceSyncMutation): string | null {
  if (mutation.entity !== DEVICE_SYNC_ENTITY) return 'unsupported_entity';
  if (mutation.kind === 'delete')
    return mutation.payload === null ? null : 'invalid_delete_payload';
  if (mutation.kind !== 'put' || mutation.payload === null) return 'invalid_put_payload';
  const validation = validateDeviceSyncBundle(mutation.payload);
  if (!validation.ok) return 'invalid_bundle';
  return mutation.payload.session.id === mutation.entityId ? null : 'entity_id_mismatch';
}

function validateV2Inventory(value: SyncV2BootstrapInventoryRequest): void {
  if (
    value?.protocolVersion !== SYNC_V2_PROTOCOL_VERSION ||
    !isId(value.deviceId) ||
    !isId(value.bootstrapId) ||
    !Array.isArray(value.inventory) ||
    value.inventory.length > 10_000
  ) {
    throw new ProtocolError(400, 'invalid_request', 'invalid v2 inventory');
  }
  for (const item of value.inventory) {
    if (
      !isV2EntityType(item.entityType) ||
      !isId(item.entityId) ||
      !isFingerprint(item.fingerprint) ||
      !Number.isSafeInteger(item.localUpdatedAt) ||
      typeof item.deleted !== 'boolean'
    ) {
      throw new ProtocolError(400, 'invalid_request', 'invalid v2 inventory item');
    }
  }
}

function validateV2BootstrapEntities(value: SyncV2BootstrapEntitiesRequest): void {
  if (
    value?.protocolVersion !== SYNC_V2_PROTOCOL_VERSION ||
    !isId(value.deviceId) ||
    !isId(value.bootstrapId) ||
    !Array.isArray(value.entities) ||
    value.entities.length > SYNC_V2_MAX_PUSH
  ) {
    throw new ProtocolError(400, 'invalid_request', 'invalid v2 bootstrap entities');
  }
  for (const mutation of value.entities) {
    const validationError = validateV2Mutation(mutation);
    if (validationError === 'payload_too_large') {
      throw new ProtocolError(413, validationError, 'v2 entity exceeds protocol limit');
    }
    if (mutation.deviceId !== value.deviceId || validationError) {
      throw new ProtocolError(400, 'invalid_request', 'invalid v2 bootstrap mutation');
    }
  }
}

function validateV2SyncRequest(value: SyncV2Request): void {
  if (
    value?.protocolVersion !== SYNC_V2_PROTOCOL_VERSION ||
    !isId(value.deviceId) ||
    !Array.isArray(value.mutations) ||
    value.mutations.length > SYNC_V2_MAX_PUSH ||
    !Number.isSafeInteger(value.pullLimit) ||
    value.pullLimit < 1 ||
    value.pullLimit > SYNC_V2_MAX_PULL ||
    (value.cursor !== null && typeof value.cursor !== 'string')
  ) {
    throw new ProtocolError(400, 'invalid_request', 'invalid v2 sync request');
  }
  for (const mutation of value.mutations) {
    const validationError = validateV2Mutation(mutation);
    if (validationError === 'payload_too_large') {
      throw new ProtocolError(413, validationError, 'v2 entity exceeds protocol limit');
    }
    if (mutation.deviceId !== value.deviceId || validationError) {
      throw new ProtocolError(400, 'invalid_request', 'invalid v2 mutation');
    }
  }
}

export function validateV2Mutation(mutation: SyncV2Mutation): string | null {
  if (
    !mutation ||
    !isId(mutation.opId) ||
    !isV2EntityType(mutation.entityType) ||
    !isId(mutation.entityId) ||
    !isId(mutation.deviceId)
  )
    return 'invalid_mutation';
  if (
    !['put', 'delete', 'restore', 'purge'].includes(mutation.kind) ||
    !Number.isSafeInteger(mutation.baseRevision) ||
    mutation.baseRevision < 0 ||
    !Number.isSafeInteger(mutation.accountGeneration) ||
    mutation.accountGeneration < 1
  )
    return 'invalid_mutation';
  if (mutation.baseFingerprint !== null && !isFingerprint(mutation.baseFingerprint))
    return 'invalid_fingerprint';
  if ((mutation.kind === 'put' || mutation.kind === 'restore') && !isRecord(mutation.payload))
    return 'payload_required';
  if (
    mutation.payload !== null &&
    deviceSyncJsonByteLength(mutation.payload) > SYNC_V2_MAX_ENTITY_BYTES
  ) {
    return 'payload_too_large';
  }
  if ((mutation.kind === 'delete' || mutation.kind === 'purge') && mutation.payload !== null)
    return 'delete_payload_forbidden';
  if (
    mutation.entityType.startsWith('focus_guard_') &&
    mutation.kind !== 'delete' &&
    mutation.kind !== 'purge' &&
    (!isEncryptedFocusGuardEnvelopeV1(mutation.payload, mutation.entityType) ||
      (mutation.payload as EncryptedFocusGuardEnvelopeV1).operation !== mutation.kind ||
      (mutation.payload as EncryptedFocusGuardEnvelopeV1).aadBaseRevision !== mutation.baseRevision)
  ) {
    return 'invalid_encrypted_focus_guard_envelope';
  }
  if (mutation.entityType === 'focus_ledger_correction_v2' && mutation.kind !== 'delete') {
    const payload = mutation.payload as Partial<{ reason: string }> | null;
    if (!payload || typeof payload.reason !== 'string' || payload.reason.trim().length === 0)
      return 'correction_reason_required';
  }
  return null;
}

function assertV2Epoch(request: SyncV2Epoch, current: SyncV2Epoch): void {
  if (request.accountGeneration !== current.accountGeneration) {
    throw new ProtocolError(409, 'account_generation_changed', 'account generation changed');
  }
  if (request.syncEpoch !== current.syncEpoch) {
    throw new ProtocolError(409, 'sync_epoch_changed', 'sync epoch changed');
  }
  if (request.cursorEpoch !== current.cursorEpoch) {
    throw new ProtocolError(409, 'cursor_epoch_changed', 'cursor epoch changed');
  }
}

function v2Ack(
  mutation: SyncV2Mutation,
  status: SyncV2Ack['status'],
  revision: number | null,
  fingerprint: string | null,
  errorCode: string | null,
): SyncV2Ack {
  return {
    opId: mutation.opId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    status,
    revision,
    fingerprint,
    errorCode,
  };
}

function encodeV2Cursor(accountId: string, epoch: SyncV2Epoch, sequence: number): string {
  // The Account DO and authenticated epoch already bind the cursor to one account.
  // Keep the wire token deliberately strict and monotonic instead of embedding
  // account/epoch JSON that clients could accidentally accept across generations.
  void accountId;
  void epoch;
  return `c${sequence.toString(36)}`;
}

function decodeV2Cursor(
  accountId: string,
  cursor: string | null,
  epoch: SyncV2Epoch,
  maximum: number,
): number {
  if (cursor === null) return 0;
  try {
    void accountId;
    void epoch;
    if (!/^c[0-9a-z]+$/.test(cursor)) throw new Error('format');
    const sequence = Number.parseInt(cursor.slice(1), 36);
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > maximum)
      throw new Error('sequence');
    return sequence;
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(409, 'invalid_cursor', 'v2 cursor is invalid');
  }
}

function isV2EntityType(value: unknown): value is SyncV2EntityType {
  return (
    value === 'focus_ledger_v2' ||
    value === 'focus_metadata_v2' ||
    value === 'focus_ledger_correction_v2' ||
    value === 'focus_guard_rule_v1' ||
    value === 'focus_guard_state_v1' ||
    value === 'focus_guard_completion_v1' ||
    value === 'focus_guard_config_v1'
  );
}

function isSyntheticCorrectionDuplicate(mutation: SyncV2Mutation, row: V2EntityRow): boolean {
  return (
    mutation.entityType === 'focus_ledger_correction_v2' &&
    mutation.kind === 'put' &&
    mutation.baseRevision === 0 &&
    mutation.baseFingerprint === null &&
    !row.deleted &&
    correctionJsonMatches(row.payload_json, mutation.payload)
  );
}

function correctionJsonMatches(serialized: string | null, candidate: unknown): boolean {
  if (serialized === null) return false;
  try {
    return correctionPayloadsEquivalent(
      JSON.parse(serialized),
      typeof candidate === 'string' ? JSON.parse(candidate) : candidate,
    );
  } catch {
    return false;
  }
}

export function correctionPayloadsEquivalent(left: unknown, right: unknown): boolean {
  if (!isCorrectionRecord(left) || !isCorrectionRecord(right)) return false;
  const normalize = (value: FocusLedgerCorrectionV2) => ({
    correctionId: value.correctionId,
    sessionId: value.sessionId,
    baseLedgerRevision: value.baseLedgerRevision,
    before: value.before,
    after: value.after,
    reason: value.reason,
    createdByDeviceId: value.createdByDeviceId,
  });
  return (
    fingerprintDeviceSyncValue(normalize(left)) === fingerprintDeviceSyncValue(normalize(right))
  );
}

export function historicalCorrectionConflictMatches(
  conflict: {
    base_json: string | null;
    local_json: string | null;
    remote_json: string | null;
    fields_json: string;
  },
  incoming: unknown,
  canonicalPayloadJson: string | null,
): boolean {
  if (
    conflict.base_json !== null ||
    canonicalPayloadJson === null ||
    !correctionJsonMatches(conflict.local_json, incoming) ||
    !correctionJsonMatches(conflict.remote_json, canonicalPayloadJson)
  ) {
    return false;
  }
  try {
    const fields = JSON.parse(conflict.fields_json) as unknown;
    return Array.isArray(fields) && fields.length === 1 && fields[0] === 'revision';
  } catch {
    return false;
  }
}

function isCorrectionRecord(value: unknown): value is FocusLedgerCorrectionV2 {
  if (!isRecord(value)) return false;
  return (
    typeof value.correctionId === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.baseLedgerRevision === 'number' &&
    Number.isSafeInteger(value.baseLedgerRevision) &&
    value.baseLedgerRevision >= 1 &&
    isRecord(value.before) &&
    isRecord(value.after) &&
    typeof value.reason === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.createdByDeviceId === 'string'
  );
}

function isFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32,128}$/i.test(value);
}

const PAIR_OFFER_KEYS = [
  'displayName',
  'scopes',
  'installationId',
  'platform',
  'deviceKind',
  'appVersion',
] as const;
const PAIR_EXCHANGE_KEYS = ['code', 'nonce', 'device'] as const;

export interface PairDeviceMetadata {
  installationId: string;
  displayName: string;
  platform: 'windows' | 'android' | 'web' | 'macos' | 'linux' | 'ios';
  deviceKind: 'desktop' | 'phone' | 'tablet' | 'watch';
  appVersion: string;
}

interface PairOfferRow extends Record<string, SqlStorageValue> {
  nonce: string;
  account_public_id: string | null;
  device_public_id: string;
  display_name: string;
  scopes_json: string;
  expires_at: number;
  used_at: number | null;
  code_hmac: string | null;
  installation_id: string | null;
  platform: string | null;
  device_kind: string | null;
  app_version: string | null;
}

function normalizePairDisplayName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= 100 && !/[\u0000-\u001f\u007f-\u009f]/.test(normalized)
    ? normalized
    : '';
}

function parsePairScopes(value: unknown): string[] | null {
  if (value === undefined) return [...FOCUSLINK_ENROLLED_DEVICE_SCOPES];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > FOCUSLINK_ENROLLED_DEVICE_SCOPES.length ||
    !value.every((item): item is string => typeof item === 'string' && isDeviceScope(item)) ||
    new Set(value).size !== value.length ||
    !value.includes('sync:read') ||
    value.some((scope) => scope === 'devices:manage' || scope === 'backups:manage')
  ) {
    return null;
  }
  return [...value];
}

function parsePairDeviceMetadata(
  value: unknown,
  required: boolean,
): PairDeviceMetadata | null | 'invalid' {
  if (!isRecord(value)) return 'invalid';
  const keys = Object.keys(value);
  const metadataKeys = new Set<string>(
    PAIR_OFFER_KEYS.filter((key) => key !== 'scopes' && key !== 'displayName'),
  );
  const hasMetadata = keys.some((key) => metadataKeys.has(key));
  if (!required && !hasMetadata) return null;
  const allowed = new Set([
    'installationId',
    'displayName',
    'platform',
    'deviceKind',
    'appVersion',
  ]);
  if (keys.some((key) => !allowed.has(key))) return 'invalid';
  // The old nonce contract only carried platform/appVersion/displayName. Keep
  // that path parseable while all numeric-code claims require the complete
  // installation binding below.
  if (
    !required &&
    typeof value.installationId !== 'string' &&
    typeof value.deviceKind !== 'string'
  ) {
    if (
      !['windows', 'macos', 'linux', 'android', 'ios', 'web'].includes(String(value.platform)) ||
      typeof value.appVersion !== 'string' ||
      !/^[0-9A-Za-z.+-]{1,32}$/.test(value.appVersion)
    ) {
      return 'invalid';
    }
    return {
      installationId: `legacy-${randomToken(16)}`,
      displayName:
        typeof value.displayName === 'string' && normalizePairDisplayName(value.displayName)
          ? normalizePairDisplayName(value.displayName)
          : 'FocusLink device',
      platform: value.platform as PairDeviceMetadata['platform'],
      deviceKind: value.platform === 'windows' ? 'desktop' : 'phone',
      appVersion: value.appVersion,
    };
  }
  if (
    typeof value.installationId !== 'string' ||
    !/^[A-Za-z0-9._~-]{20,160}$/.test(value.installationId) ||
    typeof value.displayName !== 'string' ||
    !normalizePairDisplayName(value.displayName) ||
    !['windows', 'android', 'web'].includes(String(value.platform)) ||
    !['desktop', 'phone', 'tablet', 'watch'].includes(String(value.deviceKind)) ||
    typeof value.appVersion !== 'string' ||
    !/^[0-9A-Za-z.+-]{1,32}$/.test(value.appVersion)
  ) {
    return 'invalid';
  }
  return {
    installationId: value.installationId,
    displayName: normalizePairDisplayName(value.displayName),
    platform: value.platform as PairDeviceMetadata['platform'],
    deviceKind: value.deviceKind as PairDeviceMetadata['deviceKind'],
    appVersion: value.appVersion,
  };
}

export function pairMetadataMatches(offer: PairOfferRow, metadata: PairDeviceMetadata): boolean {
  if (offer.installation_id === null) return true;
  return (
    offer.installation_id === metadata.installationId &&
    offer.platform === metadata.platform &&
    offer.device_kind === metadata.deviceKind &&
    offer.app_version === metadata.appVersion &&
    offer.display_name === metadata.displayName
  );
}

function pairingCodeHmacInput(code: string): string {
  return `focuslink-pair-code-v1:${code}`;
}

function randomPairingCode(): string {
  // Reject the short tail of Uint32 so every 8-digit code has equal weight.
  const limit = Math.floor(0x1_0000_0000 / 100_000_000) * 100_000_000;
  while (true) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    if (bytes[0] < limit) return String(bytes[0] % 100_000_000).padStart(8, '0');
  }
}

function isPairCodeCollisionError(error: unknown): boolean {
  return error instanceof Error && /v2_pair_offers(?:\.code_hmac|_code_hmac)/i.test(error.message);
}

export function shouldRetryPairCodeCollision(error: unknown, attempt: number): boolean {
  return (
    Number.isInteger(attempt) && attempt >= 0 && attempt < 3 && isPairCodeCollisionError(error)
  );
}

export function assertPairOfferClaimAvailable(
  offer:
    | {
        used_at: number | null;
        expires_at: number;
        account_public_id: string | null;
      }
    | undefined,
  now: number,
  accountPublicId: string,
): asserts offer is {
  used_at: number | null;
  expires_at: number;
  account_public_id: string | null;
} {
  if (
    !offer ||
    offer.used_at !== null ||
    offer.expires_at <= now ||
    (offer.account_public_id !== null && offer.account_public_id !== accountPublicId)
  ) {
    throw new ProtocolError(410, 'pairing_expired', 'pair offer expired or already used');
  }
}

function isDuplicateColumnError(error: unknown): boolean {
  return error instanceof Error && /duplicate column name/i.test(error.message);
}

function isDeviceScope(value: string): boolean {
  return [
    'sync:read',
    'sync:write',
    'live:read',
    'live:write',
    'devices:manage',
    'backups:manage',
  ].includes(value);
}

function isIdentityAuthorityToken(value: string | undefined): value is string {
  return typeof value === 'string' && /^fia_[A-Za-z0-9_-]{43,160}$/.test(value);
}

function isOwnerSubject(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{3,128}$/.test(value);
}

function randomToken(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

function randomDevicePublicId(): string {
  const value = new Uint8Array(12);
  crypto.getRandomValues(value);
  return encodeDevicePublicId(value);
}

export function encodeDevicePublicId(value: Uint8Array): string {
  if (value.byteLength !== 12) throw new Error('device public id requires 12 random bytes');
  return hex(value);
}

function publicId(accountId: string): string {
  return accountId
    .replace(/[^A-Za-z0-9-]/g, '-')
    .slice(0, 80)
    .padEnd(6, '0');
}

async function hmacHex(pepper: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(secret)));
}

export async function deriveRegisteredDevicePublicId(
  pepper: string,
  accountId: string,
  installationId: string,
): Promise<string> {
  return (await registeredDeviceInstallationHmac(pepper, accountId, installationId)).slice(0, 24);
}

async function registeredDeviceInstallationHmac(
  pepper: string,
  accountId: string,
  installationId: string,
): Promise<string> {
  return hmacHex(pepper, `focuslink-device-installation-v1:${accountId}:${installationId}`);
}

async function sha256Hex(value: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return hex(await crypto.subtle.digest('SHA-256', exactBuffer(bytes)));
}

async function aesDecrypt(
  ciphertext: ArrayBuffer,
  nonce: string,
  encodedKey: string,
): Promise<Uint8Array> {
  const keyBytes = decodeBase64Url(encodedKey);
  if (keyBytes.byteLength !== 32)
    throw new ProtocolError(503, 'invalid_backup_key', 'backup key must be 256 bits');
  const key = await crypto.subtle.importKey('raw', exactBuffer(keyBytes), 'AES-GCM', false, [
    'decrypt',
  ]);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: exactBuffer(decodeBase64Url(nonce)) },
        key,
        ciphertext,
      ),
    );
  } catch {
    throw new ProtocolError(409, 'backup_tampered', 'backup authentication failed');
  }
}

async function aesEncrypt(
  plaintext: Uint8Array,
  encodedKey: string,
): Promise<{ ciphertext: ArrayBuffer; nonce: string }> {
  const keyBytes = decodeBase64Url(encodedKey);
  if (keyBytes.byteLength !== 32)
    throw new ProtocolError(503, 'invalid_backup_key', 'backup key must be 256 bits');
  const key = await crypto.subtle.importKey('raw', exactBuffer(keyBytes), 'AES-GCM', false, [
    'encrypt',
  ]);
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: exactBuffer(nonce) },
    key,
    exactBuffer(plaintext),
  );
  return { ciphertext, nonce: base64Url(nonce) };
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1)
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function hex(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function exactBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

function rejectedMutationAck(
  mutation: Pick<DeviceSyncMutation, 'opId' | 'entityId'>,
  revision: number | null,
  errorCode: string,
): DeviceSyncAck {
  return {
    opId: mutation.opId,
    entityId: mutation.entityId,
    status: 'rejected',
    revision,
    errorCode,
  };
}

function toChange(row: ChangeRow): DeviceSyncChange {
  return {
    changeSeq: row.change_seq,
    deviceId: row.device_id,
    entity: DEVICE_SYNC_ENTITY,
    entityId: row.entity_id,
    revision: row.revision,
    deleted: row.deleted === 1,
    payload: row.payload_json ? (JSON.parse(row.payload_json) as DeviceSyncSessionBundle) : null,
  };
}

function validateLiveTransition(
  session: StoredLiveSession | null,
  command: LiveFocusCommand,
  existingEntity: boolean,
): string | null {
  if (command.action === 'start') {
    if (session) return 'active_session_exists';
    return existingEntity ? 'session_id_exists' : null;
  }
  if (!session) return 'no_active_session';
  if (session.id !== command.sessionId) return 'session_mismatch';
  if (command.action === 'pause') {
    if (session.state !== 'running') return 'not_running';
    return session.pauses.length >= LIVE_FOCUS_MAX_TRANSITIONS ? 'transition_limit' : null;
  }
  if (command.action === 'resume') {
    if (session.state !== 'paused') return 'not_paused';
    return session.segments.length >= LIVE_FOCUS_MAX_TRANSITIONS ? 'transition_limit' : null;
  }
  return existingEntity ? 'session_id_exists' : null;
}

function materializeLive(
  revision: number,
  session: StoredLiveSession | null,
  serverTime: number,
): LiveFocusSnapshot {
  if (!session) return { revision, state: 'idle', session: null };
  const activeElapsedMs = session.segments.reduce(
    (total, segment) => total + ((segment.endedAt ?? serverTime) - segment.startedAt),
    0,
  );
  const pauseElapsedMs = session.pauses.reduce(
    (total, pause) => total + ((pause.endedAt ?? serverTime) - pause.startedAt),
    0,
  );
  const currentPause = session.state === 'paused' ? session.pauses.at(-1) : null;
  const snapshot: LiveFocusSessionSnapshot = {
    id: session.id,
    title: session.title,
    state: session.state,
    startedAt: session.startedAt,
    activeElapsedMs,
    pauseElapsedMs,
    wallElapsedMs: serverTime - session.startedAt,
    currentPauseStartedAt: currentPause?.startedAt ?? null,
    segments: structuredClone(session.segments),
    pauses: structuredClone(session.pauses),
    task: session.task,
    updatedAt: session.updatedAt,
    lastCommandDeviceId: session.lastCommandDeviceId,
  };
  return { revision, state: session.state, session: snapshot };
}

function makeLiveSegment(
  sessionId: string,
  index: number,
  startedAt: number,
): LiveFocusTimelineSegment {
  return {
    id: `live-segment-${fingerprintDeviceSyncValue({ sessionId, index, startedAt }).slice(0, 32)}`,
    startedAt,
    endedAt: null,
  };
}

function makeLivePause(
  sessionId: string,
  index: number,
  segmentId: string,
  startedAt: number,
): LiveFocusTimelinePause {
  return {
    id: `live-pause-${fingerprintDeviceSyncValue({ sessionId, index, startedAt }).slice(0, 32)}`,
    segmentId,
    startedAt,
    endedAt: null,
  };
}

function requireLiveSession(session: StoredLiveSession | null): StoredLiveSession {
  if (!session) throw new Error('live session missing');
  return session;
}

function closeLivePhase(session: StoredLiveSession, endedAt: number): void {
  if (session.state === 'running') {
    const segment = session.segments.at(-1);
    if (!segment || segment.endedAt !== null) throw new Error('running phase missing');
    segment.endedAt = endedAt;
  } else {
    const pause = session.pauses.at(-1);
    if (!pause || pause.endedAt !== null) throw new Error('paused phase missing');
    pause.endedAt = endedAt;
  }
}

function buildCompletedLiveBundle(
  session: StoredLiveSession,
  status: 'finished' | 'aborted',
  endedAt: number,
): DeviceSyncSessionBundle {
  const segments = session.segments.map((segment) => {
    if (segment.endedAt === null) throw new Error('open segment in completed session');
    return {
      id: segment.id,
      sessionId: session.id,
      taskId: session.task?.taskId ?? null,
      taskSource: session.task?.taskSource ?? null,
      title: session.task?.taskTitle ?? session.title,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      activeElapsedMs: segment.endedAt - segment.startedAt,
      note: null,
      tomatodoSubject: null,
      createdAt: segment.startedAt,
      updatedAt: segment.endedAt,
    };
  });
  const pauses = session.pauses.map((pause) => {
    if (pause.endedAt === null) throw new Error('open pause in completed session');
    return {
      id: pause.id,
      sessionId: session.id,
      segmentId: pause.segmentId,
      pauseStartedAt: pause.startedAt,
      pauseEndedAt: pause.endedAt,
      durationMs: pause.endedAt - pause.startedAt,
      reason: null,
      createdAt: pause.startedAt,
      updatedAt: pause.endedAt,
    };
  });
  const activeElapsedMs = segments.reduce((sum, segment) => sum + segment.activeElapsedMs, 0);
  const pauseElapsedMs = pauses.reduce((sum, pause) => sum + pause.durationMs, 0);
  const bundle: DeviceSyncSessionBundle = {
    session: {
      id: session.id,
      title: session.title,
      status,
      startedAt: session.startedAt,
      endedAt,
      activeElapsedMs,
      pauseElapsedMs,
      wallElapsedMs: endedAt - session.startedAt,
      defaultTaskId: session.task?.taskId ?? null,
      defaultTaskSource: session.task?.taskSource ?? null,
      defaultTaskTitle: session.task?.taskTitle ?? null,
      note: null,
      createdAt: session.startedAt,
      updatedAt: endedAt,
    },
    segments,
    pauses,
  };
  const validation = validateDeviceSyncBundle(bundle);
  if (!validation.ok) throw new Error(`invalid completed bundle: ${validation.error ?? 'unknown'}`);
  return bundle;
}

function liveRejectedAck(
  commandId: string,
  revision: number,
  errorCode: string,
): LiveFocusCommandAck {
  return { commandId, status: 'rejected', revision, errorCode, completedEntityId: null };
}

function encodeCursor(accountId: string, sequence: number): string {
  const raw = `v1:${fingerprintDeviceSyncValue(accountId).slice(0, 16)}:${sequence}`;
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(accountId: string, cursor: string | null, maximum: number): number {
  if (cursor === null) return 0;
  try {
    const padded = cursor
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(cursor.length / 4) * 4, '=');
    const decoded = atob(padded);
    const match = /^v1:([a-f0-9]{16}):(0|[1-9]\d*)$/.exec(decoded);
    const sequence = match ? Number(match[2]) : Number.NaN;
    if (
      match?.[1] !== fingerprintDeviceSyncValue(accountId).slice(0, 16) ||
      !Number.isSafeInteger(sequence) ||
      sequence > maximum
    ) {
      throw new Error('invalid');
    }
    return sequence;
  } catch {
    throw new ProtocolError(400, 'invalid_cursor', 'cursor is invalid for this account');
  }
}

export async function readJson(request: Request, limit: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new ProtocolError(415, 'unsupported_media_type', 'application/json required');
  }
  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength !== null &&
    /^(0|[1-9]\d*)$/.test(declaredLength) &&
    Number(declaredLength) > limit
  ) {
    throw new ProtocolError(413, 'payload_too_large', 'request body exceeds protocol limit');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body?.getReader();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new ProtocolError(413, 'payload_too_large', 'request body exceeds protocol limit');
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ProtocolError(400, 'invalid_json', 'request body is not valid UTF-8 JSON');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ProtocolError(400, 'invalid_json', 'request body is not valid JSON');
  }
}

export function rejectUnexpectedQuery(url: URL, allowed: ReadonlySet<string> = new Set()): void {
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
    throw new ProtocolError(400, 'invalid_query', 'route does not accept query fields');
  }
}

function parseBoundedTimestamp(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new ProtocolError(400, 'invalid_query', 'timestamp must be a non-negative integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ProtocolError(400, 'invalid_query', 'timestamp is too large');
  }
  return parsed;
}

function parseBoundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === null) return fallback;
  const parsed = parseUnsigned(value, 'limit');
  if (parsed < minimum || parsed > maximum) {
    throw new ProtocolError(400, 'invalid_query', `limit must be ${minimum}..${maximum}`);
  }
  return parsed;
}

function parseUnsigned(value: string | null, name: string): number {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new ProtocolError(400, 'invalid_query', `${name} must be a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new ProtocolError(400, 'invalid_query', `${name} is too large`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function authorityObservationJson(value: FocusLinkAuthorityObservation): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'cache-control': 'no-store',
      'content-type': FOCUSLINK_AUTHORITY_OBSERVATION_MEDIA_TYPE,
      'x-content-type-options': 'nosniff',
    },
  });
}

function errorJson(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

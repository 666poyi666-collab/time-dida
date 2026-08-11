import type { EncryptedFocusGuardEnvelopeV1, SyncV2Mutation } from './v2Protocol';
import {
  encryptFocusGuardPayload,
  focusGuardAad,
  type FocusGuardCryptoContext,
} from './focusGuardCrypto';

export const FOCUS_GUARD_STATE_ENTITY_ID = 'guard-state-focuslink-live';
export const FOCUS_GUARD_STATE_TTL_MS = 90_000;
export const FOCUS_GUARD_STATE_MAX_TTL_MS = 300_000;

export interface FocusGuardStatePlaintext {
  state: 'idle' | 'running' | 'paused';
  sessionId: string | null;
  revision: number;
  observedAt: number;
  expiresAt: number;
}

export interface FocusGuardLiveSnapshot {
  state: FocusGuardStatePlaintext['state'];
  sessionId: string | null;
  revision: number;
}

export function projectFocusGuardState(
  snapshot: FocusGuardLiveSnapshot,
  observedAt: number,
  ttlMs = FOCUS_GUARD_STATE_TTL_MS,
): FocusGuardStatePlaintext {
  if (!isTimestamp(observedAt)) throw new Error('guard observedAt is invalid');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 0 || ttlMs > FOCUS_GUARD_STATE_MAX_TTL_MS) {
    throw new Error('guard TTL is invalid');
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
    throw new Error('guard revision is invalid');
  }
  if (snapshot.state === 'running' && !isSafeId(snapshot.sessionId)) {
    throw new Error('running guard state requires a sessionId');
  }
  if (snapshot.sessionId !== null && !isSafeId(snapshot.sessionId)) {
    throw new Error('guard sessionId is invalid');
  }
  return {
    state: snapshot.state,
    sessionId: snapshot.state === 'idle' ? null : snapshot.sessionId,
    revision: snapshot.revision,
    observedAt,
    expiresAt: observedAt + ttlMs,
  };
}

export async function encryptFocusGuardStateEnvelope(input: {
  context: FocusGuardCryptoContext;
  plaintext: FocusGuardStatePlaintext;
  baseRevision: number;
  operation?: 'put' | 'restore';
  entityId?: string;
  nonce?: Uint8Array;
  createdAt?: number;
}): Promise<EncryptedFocusGuardEnvelopeV1> {
  const entityId = input.entityId ?? FOCUS_GUARD_STATE_ENTITY_ID;
  const operation = input.operation ?? 'put';
  const createdAt = input.createdAt ?? Date.now();
  validateEnvelopeInput(input.plaintext, entityId, input.baseRevision, createdAt);
  return encryptFocusGuardPayload({
    context: input.context,
    entityType: 'focus_guard_state_v1',
    entityId,
    baseRevision: input.baseRevision,
    operation,
    plaintext: input.plaintext,
    nonce: input.nonce,
    createdAt,
  });
}

/**
 * Builds a canonical mutation only when an already-provisioned account root
 * key is supplied. This module deliberately does not generate or persist a
 * root: provisioning must come from the paired account recovery flow.
 */
export async function buildEncryptedFocusGuardStateMutation(input: {
  context: FocusGuardCryptoContext;
  snapshot: FocusGuardLiveSnapshot;
  observedAt: number;
  baseRevision: number;
  baseFingerprint: string | null;
  deviceId: string;
  accountGeneration: number;
  nonce?: Uint8Array;
  createdAt?: number;
}): Promise<SyncV2Mutation> {
  if (!isSafeId(input.deviceId)) throw new Error('guard producer deviceId is invalid');
  if (!Number.isSafeInteger(input.accountGeneration) || input.accountGeneration < 1) {
    throw new Error('guard producer accountGeneration is invalid');
  }
  const plaintext = projectFocusGuardState(input.snapshot, input.observedAt);
  const payload = await encryptFocusGuardStateEnvelope({
    context: input.context,
    plaintext,
    baseRevision: input.baseRevision,
    entityId: FOCUS_GUARD_STATE_ENTITY_ID,
    nonce: input.nonce,
    createdAt: input.createdAt,
  });
  const opMaterial = new TextEncoder().encode(
    `${input.deviceId}|${plaintext.revision}|${plaintext.observedAt}|${payload.ciphertext}`,
  );
  const opHash = hex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', exactBuffer(opMaterial))),
  );
  return {
    opId: `guard-state-${opHash}`,
    entityType: 'focus_guard_state_v1',
    entityId: FOCUS_GUARD_STATE_ENTITY_ID,
    kind: 'put',
    baseRevision: input.baseRevision,
    baseFingerprint: input.baseFingerprint,
    payload,
    deviceId: input.deviceId,
    accountGeneration: input.accountGeneration,
  };
}

export function focusGuardStateAad(
  entityId: string,
  baseRevision: number,
  operation: 'put' | 'restore',
): string {
  return focusGuardAad('focus_guard_state_v1', entityId, baseRevision, operation);
}

function validateEnvelopeInput(
  plaintext: FocusGuardStatePlaintext,
  entityId: string,
  baseRevision: number,
  createdAt: number,
): void {
  if (!isSafeId(entityId)) throw new Error('guard entityId is invalid');
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new Error('guard baseRevision is invalid');
  }
  if (!isTimestamp(createdAt)) throw new Error('guard createdAt is invalid');
  if (!isTimestamp(plaintext.observedAt) || !isTimestamp(plaintext.expiresAt)) {
    throw new Error('guard timestamps are invalid');
  }
  const ttl = plaintext.expiresAt - plaintext.observedAt;
  if (ttl < 0 || ttl > FOCUS_GUARD_STATE_MAX_TTL_MS) {
    throw new Error('guard TTL is invalid');
  }
  if (!Number.isSafeInteger(plaintext.revision) || plaintext.revision < 0) {
    throw new Error('guard revision is invalid');
  }
  if (plaintext.state === 'running' && !isSafeId(plaintext.sessionId)) {
    throw new Error('running guard state requires a sessionId');
  }
  if (plaintext.sessionId !== null && !isSafeId(plaintext.sessionId)) {
    throw new Error('guard sessionId is invalid');
  }
}

function isTimestamp(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isSafeId(value: string | null): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 160 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

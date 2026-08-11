import {
  FOCUS_GUARD_ENTITY_TYPES,
  type EncryptedFocusGuardEnvelopeV1,
  type FocusGuardEntityType,
  isEncryptedFocusGuardEnvelopeV1,
} from './v2Protocol';
import {
  FOCUS_GUARD_ROOT_BYTES,
  type FocusGuardRootMaterial,
  focusGuardRootKeyId,
} from './focusGuardRootProtocol';

/** The V1 envelope is intentionally unchanged; root metadata stays outside it. */
export const FOCUS_GUARD_PAYLOAD_MAX_BYTES = 512 * 1024;
export const FOCUS_GUARD_NONCE_BYTES = 12;
export const FOCUS_GUARD_TAG_BYTES = 16;

export interface FocusGuardCryptoContext {
  accountPublicId: string;
  generation: number;
  root: FocusGuardRootMaterial;
}

export interface EncryptFocusGuardPayloadInput<T = unknown> {
  context: FocusGuardCryptoContext;
  entityType: FocusGuardEntityType;
  entityId: string;
  baseRevision: number;
  operation?: 'put' | 'restore';
  plaintext: T;
  nonce?: Uint8Array;
  createdAt?: number;
}

export interface DecryptFocusGuardPayloadInput {
  context: FocusGuardCryptoContext;
  entityType: FocusGuardEntityType;
  entityId: string;
  baseRevision: number;
  operation: 'put' | 'restore';
  envelope: unknown;
}

export async function encryptFocusGuardPayload<T>(
  input: EncryptFocusGuardPayloadInput<T>,
): Promise<EncryptedFocusGuardEnvelopeV1> {
  const context = await validateContext(input.context);
  const entityType = validateEntityType(input.entityType);
  const entityId = validateEntityId(input.entityId);
  const baseRevision = validateRevision(input.baseRevision);
  const operation = input.operation ?? 'put';
  const createdAt = validateTimestamp(input.createdAt ?? Date.now());
  const nonce = copyExact(
    input.nonce ?? randomBytes(FOCUS_GUARD_NONCE_BYTES),
    FOCUS_GUARD_NONCE_BYTES,
  );
  const plaintext = canonicalJsonBytes(input.plaintext);
  if (plaintext.byteLength > FOCUS_GUARD_PAYLOAD_MAX_BYTES) {
    throw verificationError();
  }
  const aad = new TextEncoder().encode(
    focusGuardAad(entityType, entityId, baseRevision, operation),
  );
  try {
    const key = await derivePayloadKey(context, 'encrypt');
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: exactBuffer(nonce), additionalData: exactBuffer(aad), tagLength: 128 },
      key,
      exactBuffer(plaintext),
    );
    return {
      version: 1,
      algorithm: 'A256GCM',
      product: 'focus-guard',
      entityKind: entityKindFor(entityType),
      nonce: encodeBase64Url(nonce),
      ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
      aadHash: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', exactBuffer(aad)))),
      aadBaseRevision: baseRevision,
      operation,
      createdAt,
    };
  } catch {
    throw verificationError();
  }
}

export async function decryptFocusGuardPayload<T = unknown>(
  input: DecryptFocusGuardPayloadInput,
): Promise<T> {
  const context = await validateContext(input.context);
  const entityType = validateEntityType(input.entityType);
  const entityId = validateEntityId(input.entityId);
  const baseRevision = validateRevision(input.baseRevision);
  const envelope = validateEnvelope(input.envelope, entityType);
  if (envelope.aadBaseRevision !== baseRevision || envelope.operation !== input.operation) {
    throw verificationError();
  }
  const aad = new TextEncoder().encode(
    focusGuardAad(entityType, entityId, baseRevision, input.operation),
  );
  try {
    const expectedAadHash = hex(
      new Uint8Array(await crypto.subtle.digest('SHA-256', exactBuffer(aad))),
    );
    if (!constantTimeTextEqual(expectedAadHash, envelope.aadHash)) throw verificationError();
    const nonce = decodeBase64Url(envelope.nonce, FOCUS_GUARD_NONCE_BYTES, FOCUS_GUARD_NONCE_BYTES);
    const ciphertext = decodeBase64Url(
      envelope.ciphertext,
      FOCUS_GUARD_TAG_BYTES + 1,
      FOCUS_GUARD_PAYLOAD_MAX_BYTES + FOCUS_GUARD_TAG_BYTES,
    );
    const key = await derivePayloadKey(context, 'decrypt');
    const plaintextBytes = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: exactBuffer(nonce),
          additionalData: exactBuffer(aad),
          tagLength: 128,
        },
        key,
        exactBuffer(ciphertext),
      ),
    );
    if (plaintextBytes.byteLength > FOCUS_GUARD_PAYLOAD_MAX_BYTES) throw verificationError();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(exactBuffer(plaintextBytes));
    const value = JSON.parse(text) as T;
    const canonical = canonicalJsonBytes(value);
    if (!bytesEqual(canonical, plaintextBytes)) throw verificationError();
    return value;
  } catch {
    throw verificationError();
  }
}

/** Compatibility aliases keep call sites explicit while preserving one implementation. */
export const encryptFocusGuardEnvelope = encryptFocusGuardPayload;
export const decryptFocusGuardEnvelope = decryptFocusGuardPayload;

export function focusGuardAad(
  entityType: FocusGuardEntityType,
  entityId: string,
  baseRevision: number,
  operation: 'put' | 'restore',
): string {
  return `focus-guard|${validateEntityType(entityType)}|${validateEntityId(entityId)}|${validateRevision(baseRevision)}|${operation}`;
}

async function validateContext(context: FocusGuardCryptoContext): Promise<FocusGuardCryptoContext> {
  if (
    !context ||
    typeof context.accountPublicId !== 'string' ||
    !/^[A-Za-z0-9-]{6,80}$/.test(context.accountPublicId) ||
    !Number.isSafeInteger(context.generation) ||
    context.generation < 1 ||
    !context.root ||
    context.root.accountPublicId !== context.accountPublicId ||
    context.root.generation !== context.generation
  ) {
    throw verificationError();
  }
  try {
    const key = copyExact(context.root.rootKey, FOCUS_GUARD_ROOT_BYTES);
    const keyId = await focusGuardRootKeyId(key);
    if (!constantTimeTextEqual(keyId, context.root.keyId)) throw verificationError();
    return { ...context, root: { ...context.root, rootKey: key } };
  } catch {
    throw verificationError();
  }
}

function validateEntityType(value: unknown): FocusGuardEntityType {
  if (
    typeof value !== 'string' ||
    !(FOCUS_GUARD_ENTITY_TYPES as readonly string[]).includes(value)
  ) {
    throw verificationError();
  }
  return value as FocusGuardEntityType;
}

function validateEntityId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 160 ||
    value.includes('|') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw verificationError();
  }
  return value;
}

function validateRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw verificationError();
  return Number(value);
}

function validateTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw verificationError();
  return Number(value);
}

function entityKindFor(
  entityType: FocusGuardEntityType,
): 'rule' | 'state' | 'completion' | 'config' {
  return entityType.slice('focus_guard_'.length, -'_v1'.length) as
    'rule' | 'state' | 'completion' | 'config';
}

function validateEnvelope(
  value: unknown,
  entityType: FocusGuardEntityType,
): EncryptedFocusGuardEnvelopeV1 {
  if (!isEncryptedFocusGuardEnvelopeV1(value, entityType)) throw verificationError();
  return value;
}

async function derivePayloadKey(
  context: FocusGuardCryptoContext,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const saltMaterial = encoder.encode(`focus-guard-payload-salt-v1|${context.accountPublicId}`);
  const salt = await crypto.subtle.digest('SHA-256', exactBuffer(saltMaterial));
  const info = encoder.encode(
    `focus-guard-payload-key-v1|${context.accountPublicId}|${context.generation}`,
  );
  const root = await crypto.subtle.importKey(
    'raw',
    exactBuffer(context.root.rootKey),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: exactBuffer(info),
    },
    root,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

function canonicalJsonBytes(value: unknown): Uint8Array {
  const text = canonicalJson(value, 0);
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > FOCUS_GUARD_PAYLOAD_MAX_BYTES) throw verificationError();
  return bytes;
}

function canonicalJson(value: unknown, depth: number): string {
  if (depth > 32) throw verificationError();
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw verificationError();
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw verificationError();
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`;
  }
  if (typeof value !== 'object' || value === undefined) throw verificationError();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], depth + 1)}`).join(',')}}`;
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function copyExact(value: Uint8Array, length: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) throw verificationError();
  return new Uint8Array(value);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string, minimumBytes: number, maximumBytes: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw verificationError();
  try {
    const padded =
      value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    if (
      bytes.byteLength < minimumBytes ||
      bytes.byteLength > maximumBytes ||
      encodeBase64Url(bytes) !== value
    ) {
      throw verificationError();
    }
    return bytes;
  } catch {
    throw verificationError();
  }
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function constantTimeTextEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function verificationError(): Error {
  return new Error('Focus Guard payload verification failed');
}

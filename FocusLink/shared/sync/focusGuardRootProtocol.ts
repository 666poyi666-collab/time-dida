export const FOCUS_GUARD_ROOT_BYTES = 32;
export const FOCUS_GUARD_RECOVERY_SECRET_BYTES = 32;

export type FocusGuardRootPurpose = 'recovery' | 'rotation';

export interface FocusGuardRootEnvelopeV1 {
  version: 1;
  algorithm: 'A256GCM';
  kdf: 'HKDF-SHA256' | 'direct-root';
  product: 'focus-guard-root';
  purpose: FocusGuardRootPurpose;
  accountPublicId: string;
  fromGeneration: number | null;
  generation: number;
  nonce: string;
  ciphertext: string;
  aadHash: string;
  createdAt: number;
}

export interface FocusGuardRootMaterial {
  accountPublicId: string;
  generation: number;
  keyId: string;
  createdAt: number;
  rootKey: Uint8Array;
}

export interface FocusGuardProvisioningResult {
  material: FocusGuardRootMaterial;
  recoverySecret: Uint8Array;
  recoveryEnvelope: FocusGuardRootEnvelopeV1;
}

export interface FocusGuardRotationResult {
  material: FocusGuardRootMaterial;
  recoveryEnvelope: FocusGuardRootEnvelopeV1;
  rotationEnvelope: FocusGuardRootEnvelopeV1;
}

const ENVELOPE_KEYS = [
  'aadHash',
  'accountPublicId',
  'algorithm',
  'ciphertext',
  'createdAt',
  'fromGeneration',
  'generation',
  'kdf',
  'nonce',
  'product',
  'purpose',
  'version',
];

export async function provisionFocusGuardRoot(input: {
  accountPublicId: string;
  generation?: number;
  rootKey?: Uint8Array;
  recoverySecret?: Uint8Array;
  nonce?: Uint8Array;
  createdAt?: number;
}): Promise<FocusGuardProvisioningResult> {
  const accountPublicId = validateAccountPublicId(input.accountPublicId);
  const generation = validateGeneration(input.generation ?? 1);
  const createdAt = validateTimestamp(input.createdAt ?? Date.now());
  const rootKey = copyExact(
    input.rootKey ?? randomBytes(FOCUS_GUARD_ROOT_BYTES),
    FOCUS_GUARD_ROOT_BYTES,
    'account root',
  );
  const recoverySecret = copyExact(
    input.recoverySecret ?? randomBytes(FOCUS_GUARD_RECOVERY_SECRET_BYTES),
    FOCUS_GUARD_RECOVERY_SECRET_BYTES,
    'recovery secret',
  );
  const material = await makeRootMaterial(accountPublicId, generation, createdAt, rootKey);
  const recoveryEnvelope = await wrapFocusGuardRootForRecovery({
    material,
    recoverySecret,
    nonce: input.nonce,
  });
  return { material, recoverySecret, recoveryEnvelope };
}

export async function rotateFocusGuardRoot(input: {
  current: FocusGuardRootMaterial;
  recoverySecret: Uint8Array;
  nextRootKey?: Uint8Array;
  rotationNonce?: Uint8Array;
  recoveryNonce?: Uint8Array;
  createdAt?: number;
}): Promise<FocusGuardRotationResult> {
  const current = await validateRootMaterial(input.current);
  const recoverySecret = copyExact(
    input.recoverySecret,
    FOCUS_GUARD_RECOVERY_SECRET_BYTES,
    'recovery secret',
  );
  const createdAt = validateTimestamp(input.createdAt ?? Date.now());
  const nextRootKey = copyExact(
    input.nextRootKey ?? randomBytes(FOCUS_GUARD_ROOT_BYTES),
    FOCUS_GUARD_ROOT_BYTES,
    'next account root',
  );
  if (constantTimeBytesEqual(current.rootKey, nextRootKey)) throw verificationError();
  const material = await makeRootMaterial(
    current.accountPublicId,
    validateGeneration(current.generation + 1),
    createdAt,
    nextRootKey,
  );
  const rotationEnvelope = await wrapRoot({
    purpose: 'rotation',
    wrappingKey: current.rootKey,
    material,
    fromGeneration: current.generation,
    nonce: input.rotationNonce,
  });
  const recoveryEnvelope = await wrapFocusGuardRootForRecovery({
    material,
    recoverySecret,
    nonce: input.recoveryNonce,
  });
  return { material, recoveryEnvelope, rotationEnvelope };
}

export async function wrapFocusGuardRootForRecovery(input: {
  material: FocusGuardRootMaterial;
  recoverySecret: Uint8Array;
  nonce?: Uint8Array;
}): Promise<FocusGuardRootEnvelopeV1> {
  const material = await validateRootMaterial(input.material);
  const recoverySecret = copyExact(
    input.recoverySecret,
    FOCUS_GUARD_RECOVERY_SECRET_BYTES,
    'recovery secret',
  );
  const wrappingKey = await deriveRecoveryKey(
    recoverySecret,
    material.accountPublicId,
    material.generation,
  );
  return wrapRoot({
    purpose: 'recovery',
    wrappingKey,
    material,
    fromGeneration: null,
    nonce: input.nonce,
  });
}

export async function recoverFocusGuardRoot(input: {
  envelope: unknown;
  recoverySecret: Uint8Array;
  expectedAccountPublicId: string;
  minimumGeneration?: number;
}): Promise<FocusGuardRootMaterial> {
  const envelope = validateFocusGuardRootEnvelopeV1(input.envelope, 'recovery');
  const expectedAccountPublicId = validateAccountPublicId(input.expectedAccountPublicId);
  if (envelope.accountPublicId !== expectedAccountPublicId) throw verificationError();
  const minimumGeneration = validateGeneration(input.minimumGeneration ?? 1);
  if (envelope.generation < minimumGeneration) throw verificationError();
  const recoverySecret = copyExact(
    input.recoverySecret,
    FOCUS_GUARD_RECOVERY_SECRET_BYTES,
    'recovery secret',
  );
  const wrappingKey = await deriveRecoveryKey(
    recoverySecret,
    envelope.accountPublicId,
    envelope.generation,
  );
  return unwrapRoot(envelope, wrappingKey);
}

export async function applyFocusGuardRootRotation(input: {
  envelope: unknown;
  current: FocusGuardRootMaterial;
}): Promise<FocusGuardRootMaterial> {
  const envelope = validateFocusGuardRootEnvelopeV1(input.envelope, 'rotation');
  const current = await validateRootMaterial(input.current);
  if (
    envelope.accountPublicId !== current.accountPublicId ||
    envelope.fromGeneration !== current.generation ||
    envelope.generation !== current.generation + 1
  ) {
    throw verificationError();
  }
  const material = await unwrapRoot(envelope, current.rootKey);
  if (constantTimeBytesEqual(material.rootKey, current.rootKey)) throw verificationError();
  return material;
}

export function validateFocusGuardRootEnvelopeV1(
  value: unknown,
  expectedPurpose?: FocusGuardRootPurpose,
): FocusGuardRootEnvelopeV1 {
  if (!isRecord(value)) throw verificationError();
  const keys = Object.keys(value).sort();
  if (
    keys.length !== ENVELOPE_KEYS.length ||
    keys.some((key, index) => key !== ENVELOPE_KEYS[index])
  ) {
    throw verificationError();
  }
  const purpose = value.purpose;
  if (purpose !== 'recovery' && purpose !== 'rotation') throw verificationError();
  if (expectedPurpose && purpose !== expectedPurpose) throw verificationError();
  const kdf = value.kdf;
  const fromGeneration = value.fromGeneration;
  if (
    value.version !== 1 ||
    value.algorithm !== 'A256GCM' ||
    value.product !== 'focus-guard-root' ||
    (kdf !== 'HKDF-SHA256' && kdf !== 'direct-root') ||
    (purpose === 'recovery' && (kdf !== 'HKDF-SHA256' || fromGeneration !== null)) ||
    (purpose === 'rotation' &&
      (kdf !== 'direct-root' ||
        !Number.isSafeInteger(fromGeneration) ||
        Number(fromGeneration) < 1))
  ) {
    throw verificationError();
  }
  const accountPublicId = validateAccountPublicId(value.accountPublicId);
  const generation = validateGeneration(value.generation);
  if (purpose === 'rotation' && Number(fromGeneration) + 1 !== generation)
    throw verificationError();
  const nonce = decodeBase64Url(value.nonce, 12, 12, 'nonce');
  if (nonce.byteLength !== 12) throw verificationError();
  decodeBase64Url(value.ciphertext, 48, 48, 'ciphertext');
  if (typeof value.aadHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.aadHash)) {
    throw verificationError();
  }
  const createdAt = validateTimestamp(value.createdAt);
  return {
    version: 1,
    algorithm: 'A256GCM',
    kdf,
    product: 'focus-guard-root',
    purpose,
    accountPublicId,
    fromGeneration: fromGeneration === null ? null : Number(fromGeneration),
    generation,
    nonce: encodeBase64Url(nonce),
    ciphertext: String(value.ciphertext),
    aadHash: value.aadHash,
    createdAt,
  };
}

export async function focusGuardRootKeyId(rootKey: Uint8Array): Promise<string> {
  const root = copyExact(rootKey, FOCUS_GUARD_ROOT_BYTES, 'account root');
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', exactBuffer(root))));
}

async function wrapRoot(input: {
  purpose: FocusGuardRootPurpose;
  wrappingKey: Uint8Array;
  material: FocusGuardRootMaterial;
  fromGeneration: number | null;
  nonce?: Uint8Array;
}): Promise<FocusGuardRootEnvelopeV1> {
  const material = await validateRootMaterial(input.material);
  const wrappingKey = copyExact(input.wrappingKey, 32, 'wrapping key');
  const nonce = copyExact(input.nonce ?? randomBytes(12), 12, 'nonce');
  const kdf = input.purpose === 'recovery' ? 'HKDF-SHA256' : 'direct-root';
  const aad = rootAad({
    purpose: input.purpose,
    accountPublicId: material.accountPublicId,
    fromGeneration: input.fromGeneration,
    generation: material.generation,
    createdAt: material.createdAt,
  });
  const aadBytes = new TextEncoder().encode(aad);
  const key = await crypto.subtle.importKey('raw', exactBuffer(wrappingKey), 'AES-GCM', false, [
    'encrypt',
  ]);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: exactBuffer(nonce),
      additionalData: exactBuffer(aadBytes),
      tagLength: 128,
    },
    key,
    exactBuffer(material.rootKey),
  );
  return {
    version: 1,
    algorithm: 'A256GCM',
    kdf,
    product: 'focus-guard-root',
    purpose: input.purpose,
    accountPublicId: material.accountPublicId,
    fromGeneration: input.fromGeneration,
    generation: material.generation,
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
    aadHash: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', exactBuffer(aadBytes)))),
    createdAt: material.createdAt,
  };
}

async function unwrapRoot(
  envelope: FocusGuardRootEnvelopeV1,
  wrappingKey: Uint8Array,
): Promise<FocusGuardRootMaterial> {
  try {
    const aad = rootAad(envelope);
    const aadBytes = new TextEncoder().encode(aad);
    const expectedHash = hex(
      new Uint8Array(await crypto.subtle.digest('SHA-256', exactBuffer(aadBytes))),
    );
    if (!constantTimeTextEqual(expectedHash, envelope.aadHash)) throw verificationError();
    const key = await crypto.subtle.importKey(
      'raw',
      exactBuffer(copyExact(wrappingKey, 32, 'wrapping key')),
      'AES-GCM',
      false,
      ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: exactBuffer(decodeBase64Url(envelope.nonce, 12, 12, 'nonce')),
        additionalData: exactBuffer(aadBytes),
        tagLength: 128,
      },
      key,
      exactBuffer(decodeBase64Url(envelope.ciphertext, 48, 48, 'ciphertext')),
    );
    return makeRootMaterial(
      envelope.accountPublicId,
      envelope.generation,
      envelope.createdAt,
      new Uint8Array(plaintext),
    );
  } catch {
    throw verificationError();
  }
}

async function deriveRecoveryKey(
  recoverySecret: Uint8Array,
  accountPublicId: string,
  generation: number,
): Promise<Uint8Array> {
  const saltMaterial = new TextEncoder().encode(
    `focus-guard-root-recovery-salt-v1|${accountPublicId}`,
  );
  const salt = await crypto.subtle.digest('SHA-256', exactBuffer(saltMaterial));
  const info = new TextEncoder().encode(
    `focus-guard-root|recovery|${accountPublicId}|${generation}`,
  );
  const key = await crypto.subtle.importKey('raw', exactBuffer(recoverySecret), 'HKDF', false, [
    'deriveBits',
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: exactBuffer(info) },
      key,
      256,
    ),
  );
}

async function makeRootMaterial(
  accountPublicId: string,
  generation: number,
  createdAt: number,
  rootKey: Uint8Array,
): Promise<FocusGuardRootMaterial> {
  const root = copyExact(rootKey, FOCUS_GUARD_ROOT_BYTES, 'account root');
  return {
    accountPublicId: validateAccountPublicId(accountPublicId),
    generation: validateGeneration(generation),
    keyId: await focusGuardRootKeyId(root),
    createdAt: validateTimestamp(createdAt),
    rootKey: root,
  };
}

async function validateRootMaterial(
  value: FocusGuardRootMaterial,
): Promise<FocusGuardRootMaterial> {
  const material = await makeRootMaterial(
    value.accountPublicId,
    value.generation,
    value.createdAt,
    value.rootKey,
  );
  if (!constantTimeTextEqual(material.keyId, value.keyId)) throw verificationError();
  return material;
}

function rootAad(input: {
  purpose: FocusGuardRootPurpose;
  accountPublicId: string;
  fromGeneration: number | null;
  generation: number;
  createdAt: number;
}): string {
  return [
    'focus-guard-root',
    input.purpose,
    input.accountPublicId,
    input.fromGeneration === null ? 'none' : input.fromGeneration,
    input.generation,
    input.createdAt,
  ].join('|');
}

function validateAccountPublicId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{6,80}$/.test(value)) {
    throw verificationError();
  }
  return value;
}

function validateGeneration(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw verificationError();
  return Number(value);
}

function validateTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw verificationError();
  return Number(value);
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function copyExact(value: Uint8Array, length: number, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
    throw new Error(`Focus Guard ${label} must be ${length} bytes`);
  }
  return new Uint8Array(value);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(
  value: unknown,
  minimumBytes: number,
  maximumBytes: number,
  _label: string,
): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw verificationError();
  try {
    const padded =
      value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength < minimumBytes || bytes.byteLength > maximumBytes)
      throw verificationError();
    if (encodeBase64Url(bytes) !== value) throw verificationError();
    return bytes;
  } catch {
    throw verificationError();
  }
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeTextEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function verificationError(): Error {
  return new Error('Focus Guard root envelope verification failed');
}

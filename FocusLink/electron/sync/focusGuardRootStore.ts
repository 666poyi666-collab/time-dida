import { app, safeStorage } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  provisionFocusGuardRoot,
  recoverFocusGuardRoot,
  rotateFocusGuardRoot,
  type FocusGuardRootEnvelopeV1,
  type FocusGuardRootMaterial,
} from '../../shared/sync/focusGuardRootProtocol.js';

export type FocusGuardRootStatus =
  | 'absent'
  | 'ready'
  | 'recovery-required'
  | 'lost'
  | 'revoked'
  | 'corrupt'
  | 'secure-storage-unavailable';

export interface FocusGuardRootStatusSnapshot {
  status: FocusGuardRootStatus;
  accountPublicId: string | null;
  generation: number | null;
  keyId: string | null;
  updatedAt: number | null;
}

export interface FocusGuardRootSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface FocusGuardRootStoreOptions {
  filePath?: string;
  safeStorage?: FocusGuardRootSafeStorage;
  now?: () => number;
}

interface StoredFocusGuardRootRecord {
  version: 1;
  state: 'ready' | 'recovery-required' | 'lost' | 'revoked';
  accountPublicId: string;
  generation: number;
  keyId: string | null;
  encryptedMaterial: string | null;
  updatedAt: number;
}

const RECORD_KEYS = [
  'accountPublicId',
  'encryptedMaterial',
  'generation',
  'keyId',
  'state',
  'updatedAt',
  'version',
];
const ROOT_RECORD_NAME = 'focus-guard-root-v1.json';

class FocusGuardRootFileMutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release = (): void => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

const ROOT_FILE_MUTEXES = new Map<string, FocusGuardRootFileMutex>();

function mutexForRootFile(filePath: string): FocusGuardRootFileMutex {
  const resolved = path.resolve(filePath);
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  let mutex = ROOT_FILE_MUTEXES.get(key);
  if (!mutex) {
    mutex = new FocusGuardRootFileMutex();
    ROOT_FILE_MUTEXES.set(key, mutex);
  }
  return mutex;
}

export class FocusGuardRootStore {
  private readonly filePath: string;
  private readonly protectedStorage: FocusGuardRootSafeStorage;
  private readonly now: () => number;
  private readonly mutationMutex: FocusGuardRootFileMutex;

  constructor(options: FocusGuardRootStoreOptions = {}) {
    this.filePath = options.filePath ?? path.join(app.getPath('userData'), ROOT_RECORD_NAME);
    this.protectedStorage = options.safeStorage ?? safeStorage;
    this.now = options.now ?? (() => Date.now());
    this.mutationMutex = mutexForRootFile(this.filePath);
  }

  status(accountPublicId?: string): FocusGuardRootStatusSnapshot {
    const absent: FocusGuardRootStatusSnapshot = {
      status: 'absent',
      accountPublicId: null,
      generation: null,
      keyId: null,
      updatedAt: null,
    };
    this.restoreReplaceBackupIfNeeded();
    if (!fs.existsSync(this.filePath)) return absent;
    let record: StoredFocusGuardRootRecord;
    try {
      record = this.readRecord();
    } catch {
      return { ...absent, status: 'corrupt' };
    }
    if (accountPublicId && record.accountPublicId !== accountPublicId) return absent;
    if (record.state !== 'ready') {
      return {
        status: record.state,
        accountPublicId: record.accountPublicId,
        generation: record.generation,
        keyId: record.keyId,
        updatedAt: record.updatedAt,
      };
    }
    if (!this.protectedStorage.isEncryptionAvailable()) {
      return {
        status: 'secure-storage-unavailable',
        accountPublicId: record.accountPublicId,
        generation: record.generation,
        keyId: record.keyId,
        updatedAt: record.updatedAt,
      };
    }
    try {
      const material = this.decryptMaterial(record);
      if (accountPublicId && material.accountPublicId !== accountPublicId) return absent;
      return {
        status: 'ready',
        accountPublicId: material.accountPublicId,
        generation: material.generation,
        keyId: material.keyId,
        updatedAt: record.updatedAt,
      };
    } catch {
      return {
        status: 'corrupt',
        accountPublicId: record.accountPublicId,
        generation: record.generation,
        keyId: record.keyId,
        updatedAt: record.updatedAt,
      };
    }
  }

  load(accountPublicId: string): FocusGuardRootMaterial | null {
    const record = this.readRecordOrNull();
    if (!record || record.accountPublicId !== accountPublicId) return null;
    if (record.state !== 'ready') return null;
    if (!this.protectedStorage.isEncryptionAvailable()) throw secureStorageError();
    try {
      const material = this.decryptMaterial(record);
      if (material.accountPublicId !== accountPublicId) throw verificationError();
      return material;
    } catch {
      throw verificationError();
    }
  }

  async create(input: {
    accountPublicId: string;
    generation?: number;
    rootKey?: Uint8Array;
    recoverySecret?: Uint8Array;
    nonce?: Uint8Array;
    createdAt?: number;
  }): Promise<Awaited<ReturnType<typeof provisionFocusGuardRoot>>> {
    const expectedVersion = this.captureRecordVersion();
    return this.mutationMutex.runExclusive(async () => {
      this.assertRecordVersion(expectedVersion);
      if (!this.protectedStorage.isEncryptionAvailable()) throw secureStorageError();
      const current = this.readRecordOrNull();
      if (current) throw new Error('Focus Guard root already exists');
      const result = await provisionFocusGuardRoot(input);
      this.persistMaterial(result.material, expectedVersion);
      return result;
    });
  }

  async recover(input: {
    envelope: unknown;
    recoverySecret: Uint8Array;
    expectedAccountPublicId: string;
    minimumGeneration?: number;
  }): Promise<FocusGuardRootMaterial> {
    const expectedVersion = this.captureRecordVersion();
    return this.mutationMutex.runExclusive(async () => {
      this.assertRecordVersion(expectedVersion);
      if (!this.protectedStorage.isEncryptionAvailable()) throw secureStorageError();
      let current: StoredFocusGuardRootRecord | null = null;
      let corrupt = false;
      try {
        current = this.readRecordOrNull();
      } catch {
        this.preserveUnreadableRecord();
        corrupt = true;
      }
      if (corrupt && input.minimumGeneration === undefined) {
        throw new Error(
          'Focus Guard corrupt record requires an explicit generation high-water mark',
        );
      }
      if (current?.state === 'revoked') throw new Error('Focus Guard root is revoked');
      if (current && current.accountPublicId !== input.expectedAccountPublicId) {
        throw new Error('Focus Guard root belongs to another account');
      }
      const minimumGeneration = Math.max(
        input.minimumGeneration ?? 1,
        current?.state === 'ready' ? current.generation + 1 : (current?.generation ?? 1),
      );
      const material = await recoverFocusGuardRoot({ ...input, minimumGeneration });
      this.persistMaterial(material, expectedVersion);
      return material;
    });
  }

  async rotate(
    accountPublicId: string,
    input: {
      recoverySecret: Uint8Array;
      nextRootKey?: Uint8Array;
      rotationNonce?: Uint8Array;
      recoveryNonce?: Uint8Array;
      createdAt?: number;
    },
  ): Promise<Awaited<ReturnType<typeof rotateFocusGuardRoot>>> {
    const expectedVersion = this.captureRecordVersion();
    return this.mutationMutex.runExclusive(async () => {
      this.assertRecordVersion(expectedVersion);
      const current = this.load(accountPublicId);
      if (!current) throw new Error('Focus Guard root is unavailable');
      const result = await rotateFocusGuardRoot({ current, ...input });
      this.persistMaterial(result.material, expectedVersion);
      return result;
    });
  }

  markRecoveryRequired(accountPublicId: string, generation: number): void {
    this.persistTerminalState({
      version: 1,
      state: 'recovery-required',
      accountPublicId,
      generation: validateGeneration(generation),
      keyId: null,
      encryptedMaterial: null,
      updatedAt: this.now(),
    });
  }

  markLost(accountPublicId: string, generation: number): void {
    this.persistTerminalState({
      version: 1,
      state: 'lost',
      accountPublicId,
      generation: validateGeneration(generation),
      keyId: null,
      encryptedMaterial: null,
      updatedAt: this.now(),
    });
  }

  revoke(accountPublicId: string, generation: number): void {
    this.persistTerminalState({
      version: 1,
      state: 'revoked',
      accountPublicId,
      generation: validateGeneration(generation),
      keyId: null,
      encryptedMaterial: null,
      updatedAt: this.now(),
    });
  }

  private persistMaterial(material: FocusGuardRootMaterial, expectedVersion: string): void {
    if (!this.protectedStorage.isEncryptionAvailable()) throw secureStorageError();
    const encryptedMaterial = this.protectedStorage
      .encryptString(JSON.stringify(serializeMaterial(material)))
      .toString('base64');
    this.assertRecordVersion(expectedVersion);
    this.persistState({
      version: 1,
      state: 'ready',
      accountPublicId: material.accountPublicId,
      generation: material.generation,
      keyId: material.keyId,
      encryptedMaterial,
      updatedAt: this.now(),
    });
    const readback = this.load(material.accountPublicId);
    if (
      !readback ||
      readback.keyId !== material.keyId ||
      readback.generation !== material.generation
    ) {
      throw new Error('Focus Guard root write readback failed');
    }
  }

  private persistTerminalState(record: StoredFocusGuardRootRecord): void {
    const current = this.readRecordOrNull();
    if (current) {
      if (current.accountPublicId !== record.accountPublicId) {
        throw new Error('Focus Guard root belongs to another account');
      }
      if (record.generation < current.generation) {
        throw new Error('Focus Guard root generation rollback rejected');
      }
      if (current.state === 'revoked' && record.state !== 'revoked') {
        throw new Error('Focus Guard root is revoked');
      }
    }
    this.persistState(record);
  }

  private captureRecordVersion(): string {
    this.restoreReplaceBackupIfNeeded();
    if (!fs.existsSync(this.filePath)) return 'absent';
    try {
      return `sha256:${createHash('sha256').update(fs.readFileSync(this.filePath)).digest('hex')}`;
    } catch (error) {
      if (isFileNotFoundError(error)) return 'absent';
      throw new Error('Focus Guard root record version unavailable');
    }
  }

  private assertRecordVersion(expectedVersion: string): void {
    if (this.captureRecordVersion() !== expectedVersion) {
      throw new Error('Focus Guard root changed during operation');
    }
  }

  private persistState(record: StoredFocusGuardRootRecord): void {
    const keys = Object.keys(record).sort();
    if (
      keys.length !== RECORD_KEYS.length ||
      keys.some((key, index) => key !== RECORD_KEYS[index])
    ) {
      throw verificationError();
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${this.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
      const descriptor = fs.openSync(temporary, 'r+');
      try {
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      replaceFile(temporary, this.filePath);
      const readback = this.readRecord();
      if (JSON.stringify(readback) !== JSON.stringify(record))
        throw new Error('root record readback failed');
    } finally {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        // Keep the committed record; cleanup is best effort.
      }
    }
  }

  private readRecordOrNull(): StoredFocusGuardRootRecord | null {
    this.restoreReplaceBackupIfNeeded();
    if (!fs.existsSync(this.filePath)) return null;
    return this.readRecord();
  }

  private restoreReplaceBackupIfNeeded(): void {
    if (fs.existsSync(this.filePath)) return;
    const directory = path.dirname(this.filePath);
    const prefix = `${path.basename(this.filePath)}.`;
    let candidates: string[] = [];
    try {
      candidates = fs
        .readdirSync(directory)
        .filter((name) => name.startsWith(prefix) && name.endsWith('.replace-bak'))
        .map((name) => path.join(directory, name));
    } catch {
      return;
    }
    const candidate = candidates.sort((left, right) => {
      return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
    })[0];
    if (!candidate) return;
    try {
      fs.renameSync(candidate, this.filePath);
    } catch {
      // Keep the explicit unavailable state; do not create a new root.
    }
  }

  private preserveUnreadableRecord(): void {
    if (!fs.existsSync(this.filePath)) return;
    const backup = `${this.filePath}.unreadable.${this.now()}.${Math.random().toString(16).slice(2)}.bak`;
    try {
      fs.copyFileSync(this.filePath, backup);
    } catch {
      throw new Error('Focus Guard corrupt record cannot be preserved');
    }
  }

  private readRecord(): StoredFocusGuardRootRecord {
    const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown;
    if (!isRecord(value)) throw verificationError();
    const keys = Object.keys(value).sort();
    if (
      keys.length !== RECORD_KEYS.length ||
      keys.some((key, index) => key !== RECORD_KEYS[index])
    ) {
      throw verificationError();
    }
    if (
      value.version !== 1 ||
      !isAccountId(value.accountPublicId) ||
      !['ready', 'recovery-required', 'lost', 'revoked'].includes(String(value.state)) ||
      !Number.isSafeInteger(value.generation) ||
      Number(value.generation) < 1 ||
      (value.keyId !== null && !/^[a-f0-9]{64}$/.test(String(value.keyId))) ||
      (value.encryptedMaterial !== null && typeof value.encryptedMaterial !== 'string') ||
      !Number.isSafeInteger(value.updatedAt) ||
      Number(value.updatedAt) <= 0
    ) {
      throw verificationError();
    }
    if (value.state === 'ready' && (value.keyId === null || value.encryptedMaterial === null)) {
      throw verificationError();
    }
    if (value.state !== 'ready' && (value.keyId !== null || value.encryptedMaterial !== null)) {
      throw verificationError();
    }
    return value as unknown as StoredFocusGuardRootRecord;
  }

  private decryptMaterial(record: StoredFocusGuardRootRecord): FocusGuardRootMaterial {
    if (!record.encryptedMaterial || !record.keyId) throw verificationError();
    const plaintext = this.protectedStorage.decryptString(
      Buffer.from(record.encryptedMaterial, 'base64'),
    );
    const material = deserializeMaterial(JSON.parse(plaintext) as unknown);
    if (
      material.accountPublicId !== record.accountPublicId ||
      material.generation !== record.generation ||
      material.keyId !== record.keyId
    ) {
      throw verificationError();
    }
    return material;
  }
}

function serializeMaterial(material: FocusGuardRootMaterial): Record<string, unknown> {
  return {
    accountPublicId: material.accountPublicId,
    createdAt: material.createdAt,
    generation: material.generation,
    keyId: material.keyId,
    rootKey: encodeBase64Url(material.rootKey),
  };
}

function deserializeMaterial(value: unknown): FocusGuardRootMaterial {
  if (!isRecord(value)) throw verificationError();
  const keys = Object.keys(value).sort();
  if (keys.join('|') !== 'accountPublicId|createdAt|generation|keyId|rootKey') {
    throw verificationError();
  }
  const rootKey = decodeBase64Url(value.rootKey);
  if (
    !isAccountId(value.accountPublicId) ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 1
  ) {
    throw verificationError();
  }
  if (createHash('sha256').update(rootKey).digest('hex') !== value.keyId) {
    throw verificationError();
  }
  if (
    typeof value.keyId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.keyId) ||
    !Number.isSafeInteger(value.createdAt) ||
    Number(value.createdAt) <= 0
  ) {
    throw verificationError();
  }
  return {
    accountPublicId: value.accountPublicId,
    generation: Number(value.generation),
    keyId: value.keyId,
    createdAt: Number(value.createdAt),
    rootKey,
  };
}

function decodeBase64Url(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw verificationError();
  try {
    const padded =
      value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    if (bytes.byteLength !== 32 || encodeBase64Url(bytes) !== value) throw verificationError();
    return bytes;
  } catch {
    throw verificationError();
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function validateGeneration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw verificationError();
  return value;
}

function isAccountId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{6,80}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function secureStorageError(): Error {
  return new Error('Focus Guard secure storage unavailable');
}

function replaceFile(temporary: string, target: string): void {
  try {
    fs.renameSync(temporary, target);
    return;
  } catch (error) {
    if (!fs.existsSync(target)) throw error;
  }
  const backup = `${target}.${process.pid}.${Date.now()}.replace-bak`;
  fs.renameSync(target, backup);
  try {
    fs.renameSync(temporary, target);
    fs.rmSync(backup, { force: true });
  } catch (error) {
    try {
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
      fs.renameSync(backup, target);
    } catch {
      // Preserve whichever durable record is still available for recovery.
    }
    throw error;
  }
}

function verificationError(): Error {
  return new Error('Focus Guard root record verification failed');
}

export type { FocusGuardRootEnvelopeV1 };

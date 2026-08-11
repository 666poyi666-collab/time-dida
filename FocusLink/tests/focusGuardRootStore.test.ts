import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import {
  FocusGuardRootStore,
  type FocusGuardRootSafeStorage,
} from '../electron/sync/focusGuardRootStore';

const ROOT = Uint8Array.from({ length: 32 }, (_, index) => index);
const NEXT_ROOT = Uint8Array.from({ length: 32 }, (_, index) => 0x40 + index);
const OTHER_NEXT_ROOT = Uint8Array.from({ length: 32 }, (_, index) => 0x80 + index);
const RECOVERY = Uint8Array.from({ length: 32 }, (_, index) => 0x20 + index);
const NONCE = Uint8Array.from({ length: 12 }, (_, index) => 0x60 + index);
const CREATED_AT = 1_700_000_000_000;

class FakeSafeStorage implements FocusGuardRootSafeStorage {
  available = true;

  isEncryptionAvailable(): boolean {
    return this.available;
  }

  encryptString(value: string): Buffer {
    return Buffer.from([...Buffer.from(value, 'utf8')].map((byte) => byte ^ 0xa5));
  }

  decryptString(value: Buffer): string {
    return Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString('utf8');
  }
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-guard-root-'));
  const safeStorage = new FakeSafeStorage();
  const filePath = path.join(directory, 'root.json');
  const store = new FocusGuardRootStore({
    filePath,
    safeStorage,
    now: () => CREATED_AT,
  });
  return { directory, filePath, safeStorage, store };
}

function secondStore(value: ReturnType<typeof fixture>): FocusGuardRootStore {
  return new FocusGuardRootStore({
    filePath: value.filePath,
    safeStorage: value.safeStorage,
    now: () => CREATED_AT,
  });
}

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length > 0) fs.rmSync(cleanups.pop()!, { recursive: true, force: true });
});

describe('Windows Focus Guard safeStorage root store', () => {
  it('stores encrypted root material with readback and explicit ready status', async () => {
    const value = fixture();
    cleanups.push(value.directory);
    const provisioned = await value.store.create({
      accountPublicId: 'account-stage-b',
      generation: 1,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      nonce: NONCE,
      createdAt: CREATED_AT,
    });
    const raw = fs.readFileSync(path.join(value.directory, 'root.json'), 'utf8');
    expect(raw).not.toContain(Buffer.from(ROOT).toString('base64'));
    expect(value.store.status('account-stage-b')).toMatchObject({
      status: 'ready',
      accountPublicId: 'account-stage-b',
      generation: 1,
      keyId: provisioned.material.keyId,
    });
    expect(value.store.load('account-stage-b')).toEqual(provisioned.material);
  });

  it('does not create or load plaintext when safeStorage is unavailable', async () => {
    const value = fixture();
    cleanups.push(value.directory);
    value.safeStorage.available = false;
    await expect(value.store.create({ accountPublicId: 'account-stage-b' })).rejects.toThrow(
      'secure storage unavailable',
    );
    expect(value.store.status('account-stage-b').status).toBe('absent');
  });

  it('allows only one concurrent create across store instances', async () => {
    const value = fixture();
    cleanups.push(value.directory);
    const peer = secondStore(value);
    const results = await Promise.allSettled([
      value.store.create({
        accountPublicId: 'account-stage-b',
        rootKey: ROOT,
        recoverySecret: RECOVERY,
        nonce: NONCE,
        createdAt: CREATED_AT,
      }),
      peer.create({
        accountPublicId: 'account-stage-b',
        rootKey: NEXT_ROOT,
        recoverySecret: RECOVERY,
        nonce: NONCE,
        createdAt: CREATED_AT,
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = fulfilled[0];
    if (!winner || winner.status !== 'fulfilled') throw new Error('missing create winner');
    expect(value.store.load('account-stage-b')?.keyId).toBe(winner.value.material.keyId);
  });

  it('keeps generation high-water mark across rotation and rejects recovery rollback', async () => {
    const value = fixture();
    cleanups.push(value.directory);
    const first = await value.store.create({
      accountPublicId: 'account-stage-b',
      generation: 1,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      nonce: NONCE,
      createdAt: CREATED_AT,
    });
    await value.store.rotate('account-stage-b', {
      recoverySecret: RECOVERY,
      nextRootKey: NEXT_ROOT,
      rotationNonce: NONCE,
      recoveryNonce: NONCE,
      createdAt: CREATED_AT + 1,
    });
    expect(value.store.status('account-stage-b').generation).toBe(2);
    await expect(
      value.store.recover({
        envelope: first.recoveryEnvelope,
        recoverySecret: RECOVERY,
        expectedAccountPublicId: 'account-stage-b',
      }),
    ).rejects.toThrow('verification failed');
  });

  it('allows only one concurrent rotation and never overwrites its winning root', async () => {
    const value = fixture();
    cleanups.push(value.directory);
    const peer = secondStore(value);
    await value.store.create({
      accountPublicId: 'account-stage-b',
      generation: 1,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      nonce: NONCE,
      createdAt: CREATED_AT,
    });
    const results = await Promise.allSettled([
      value.store.rotate('account-stage-b', {
        recoverySecret: RECOVERY,
        nextRootKey: NEXT_ROOT,
        rotationNonce: NONCE,
        recoveryNonce: NONCE,
        createdAt: CREATED_AT + 1,
      }),
      peer.rotate('account-stage-b', {
        recoverySecret: RECOVERY,
        nextRootKey: OTHER_NEXT_ROOT,
        rotationNonce: NONCE,
        recoveryNonce: NONCE,
        createdAt: CREATED_AT + 1,
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = fulfilled[0];
    if (!winner || winner.status !== 'fulfilled') throw new Error('missing rotation winner');
    expect(value.store.load('account-stage-b')).toMatchObject({
      generation: 2,
      keyId: winner.value.material.keyId,
    });
  });

  it('allows only one concurrent recovery from the same lost record', async () => {
    const value = fixture();
    cleanups.push(value.directory);
    const peer = secondStore(value);
    const provisioned = await value.store.create({
      accountPublicId: 'account-stage-b',
      generation: 1,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      nonce: NONCE,
      createdAt: CREATED_AT,
    });
    value.store.markLost('account-stage-b', 1);
    const recoverInput = {
      envelope: provisioned.recoveryEnvelope,
      recoverySecret: RECOVERY,
      expectedAccountPublicId: 'account-stage-b',
    };
    const results = await Promise.allSettled([
      value.store.recover(recoverInput),
      peer.recover(recoverInput),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(value.store.status('account-stage-b')).toMatchObject({
      status: 'ready',
      generation: 1,
    });
  });

  it('rejects terminal-state generation downgrade and ambiguous corrupt recovery', async () => {
    const value = fixture();
    cleanups.push(value.directory);
    await value.store.create({
      accountPublicId: 'account-stage-b',
      generation: 2,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      nonce: NONCE,
      createdAt: CREATED_AT,
    });
    expect(() => value.store.markLost('account-stage-b', 1)).toThrow('rollback rejected');
    const filePath = path.join(value.directory, 'root.json');
    fs.writeFileSync(filePath, '{not-json', 'utf8');
    await expect(
      value.store.recover({
        envelope: {
          version: 1,
          algorithm: 'A256GCM',
          kdf: 'HKDF-SHA256',
          product: 'focus-guard-root',
          purpose: 'recovery',
          accountPublicId: 'account-stage-b',
          fromGeneration: null,
          generation: 1,
          nonce: 'QEFCQ0RFRkdISUpL',
          ciphertext: 'A'.repeat(64),
          aadHash: 'a'.repeat(64),
          createdAt: CREATED_AT,
        },
        recoverySecret: RECOVERY,
        expectedAccountPublicId: 'account-stage-b',
      }),
    ).rejects.toThrow('explicit generation high-water mark');
  });

  it('exposes lost/revoked/corrupt states and preserves unreadable bytes for recovery', async () => {
    const value = fixture();
    cleanups.push(value.directory);
    const provisioned = await value.store.create({
      accountPublicId: 'account-stage-b',
      generation: 1,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      nonce: NONCE,
      createdAt: CREATED_AT,
    });
    value.store.markLost('account-stage-b', 1);
    expect(value.store.status('account-stage-b').status).toBe('lost');
    value.store.markRecoveryRequired('account-stage-b', 2);
    expect(value.store.status('account-stage-b').status).toBe('recovery-required');
    value.store.revoke('account-stage-b', 2);
    expect(value.store.status('account-stage-b').status).toBe('revoked');
    await expect(
      value.store.recover({
        envelope: provisioned.recoveryEnvelope,
        recoverySecret: RECOVERY,
        expectedAccountPublicId: 'account-stage-b',
      }),
    ).rejects.toThrow('revoked');

    const corrupt = fixture();
    cleanups.push(corrupt.directory);
    const corruptProvisioned = await corrupt.store.create({
      accountPublicId: 'account-stage-b',
      generation: 1,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      nonce: NONCE,
      createdAt: CREATED_AT,
    });
    const filePath = path.join(corrupt.directory, 'root.json');
    fs.writeFileSync(filePath, '{not-json', 'utf8');
    expect(corrupt.store.status('account-stage-b').status).toBe('corrupt');
    await expect(
      corrupt.store.recover({
        envelope: corruptProvisioned.recoveryEnvelope,
        recoverySecret: RECOVERY,
        expectedAccountPublicId: 'account-stage-b',
        minimumGeneration: 1,
      }),
    ).resolves.toMatchObject({ generation: 1 });
    expect(fs.readdirSync(corrupt.directory).some((name) => name.includes('.unreadable.'))).toBe(
      true,
    );
  });

  it('keeps revoked irreversible when markLost or an in-flight recovery races it', async () => {
    const value = fixture();
    cleanups.push(value.directory);
    const peer = secondStore(value);
    const provisioned = await value.store.create({
      accountPublicId: 'account-stage-b',
      generation: 1,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      nonce: NONCE,
      createdAt: CREATED_AT,
    });
    value.store.markLost('account-stage-b', 1);
    const recovery = value.store.recover({
      envelope: provisioned.recoveryEnvelope,
      recoverySecret: RECOVERY,
      expectedAccountPublicId: 'account-stage-b',
    });
    peer.revoke('account-stage-b', 1);

    await expect(recovery).rejects.toThrow();
    expect(value.store.status('account-stage-b').status).toBe('revoked');
    expect(() => value.store.markLost('account-stage-b', 1)).toThrow('revoked');
    expect(() => value.store.markRecoveryRequired('account-stage-b', 1)).toThrow('revoked');
    expect(value.store.status('account-stage-b').status).toBe('revoked');
  });
});

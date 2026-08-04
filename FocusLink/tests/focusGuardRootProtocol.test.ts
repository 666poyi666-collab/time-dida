import { describe, expect, it } from 'vitest';
import {
  applyFocusGuardRootRotation,
  focusGuardRootKeyId,
  provisionFocusGuardRoot,
  recoverFocusGuardRoot,
  rotateFocusGuardRoot,
  validateFocusGuardRootEnvelopeV1,
} from '../shared/sync/focusGuardRootProtocol';

const ACCOUNT = 'account-stage-b';
const OTHER_ACCOUNT = 'account-stage-c';
const ROOT = Uint8Array.from({ length: 32 }, (_, index) => index);
const NEXT_ROOT = Uint8Array.from({ length: 32 }, (_, index) => 0x40 + index);
const RECOVERY = Uint8Array.from({ length: 32 }, (_, index) => 0x20 + index);
const RECOVERY_NONCE = Uint8Array.from({ length: 12 }, (_, index) => 0x40 + index);
const ROTATION_NONCE = Uint8Array.from({ length: 12 }, (_, index) => 0x50 + index);
const CREATED_AT = 1_700_000_000_000;

describe('Focus Guard root protocol', () => {
  it('provisions and recovers a deterministic 32-byte root with exact envelope fields', async () => {
    const provisioned = await provisionFocusGuardRoot({
      accountPublicId: ACCOUNT,
      generation: 7,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      nonce: RECOVERY_NONCE,
      createdAt: CREATED_AT,
    });
    expect(provisioned.material.rootKey).toEqual(ROOT);
    expect(provisioned.material.generation).toBe(7);
    expect(provisioned.recoveryEnvelope).toEqual({
      version: 1,
      algorithm: 'A256GCM',
      kdf: 'HKDF-SHA256',
      product: 'focus-guard-root',
      purpose: 'recovery',
      accountPublicId: ACCOUNT,
      fromGeneration: null,
      generation: 7,
      nonce: 'QEFCQ0RFRkdISUpL',
      ciphertext: expect.any(String),
      aadHash: expect.any(String),
      createdAt: CREATED_AT,
    });
    expect(Object.keys(provisioned.recoveryEnvelope).sort()).toEqual([
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
    ]);
    const recovered = await recoverFocusGuardRoot({
      envelope: provisioned.recoveryEnvelope,
      recoverySecret: RECOVERY,
      expectedAccountPublicId: ACCOUNT,
      minimumGeneration: 7,
    });
    expect(recovered).toEqual(provisioned.material);
    expect(await focusGuardRootKeyId(ROOT)).toBe(provisioned.material.keyId);
  });

  it('rotates 1→2 with predecessor binding and rejects replay/rollback', async () => {
    const first = await provisionFocusGuardRoot({
      accountPublicId: ACCOUNT,
      generation: 1,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      nonce: RECOVERY_NONCE,
      createdAt: CREATED_AT,
    });
    const rotation = await rotateFocusGuardRoot({
      current: first.material,
      recoverySecret: RECOVERY,
      nextRootKey: NEXT_ROOT,
      recoveryNonce: RECOVERY_NONCE,
      rotationNonce: ROTATION_NONCE,
      createdAt: CREATED_AT + 1,
    });
    expect(rotation.material.generation).toBe(2);
    expect(rotation.rotationEnvelope.purpose).toBe('rotation');
    expect(rotation.rotationEnvelope.fromGeneration).toBe(1);
    const applied = await applyFocusGuardRootRotation({
      current: first.material,
      envelope: rotation.rotationEnvelope,
    });
    expect(applied).toEqual(rotation.material);
    await expect(
      applyFocusGuardRootRotation({ current: applied, envelope: rotation.rotationEnvelope }),
    ).rejects.toThrow('verification failed');
    await expect(
      recoverFocusGuardRoot({
        envelope: first.recoveryEnvelope,
        recoverySecret: RECOVERY,
        expectedAccountPublicId: ACCOUNT,
        minimumGeneration: 2,
      }),
    ).rejects.toThrow('verification failed');
  });

  it('rejects a rotation that reuses the current root', async () => {
    const first = await provisionFocusGuardRoot({
      accountPublicId: ACCOUNT,
      generation: 1,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      nonce: RECOVERY_NONCE,
      createdAt: CREATED_AT,
    });
    await expect(
      rotateFocusGuardRoot({
        current: first.material,
        recoverySecret: RECOVERY,
        nextRootKey: ROOT,
        recoveryNonce: RECOVERY_NONCE,
        rotationNonce: ROTATION_NONCE,
        createdAt: CREATED_AT + 1,
      }),
    ).rejects.toThrow('verification failed');
  });

  it('fails closed for wrong secrets/accounts, truncation, tamper and schema additions', async () => {
    const provisioned = await provisionFocusGuardRoot({
      accountPublicId: ACCOUNT,
      generation: 7,
      rootKey: ROOT,
      recoverySecret: RECOVERY,
      nonce: RECOVERY_NONCE,
      createdAt: CREATED_AT,
    });
    await expect(
      recoverFocusGuardRoot({
        envelope: provisioned.recoveryEnvelope,
        recoverySecret: Uint8Array.from(RECOVERY, (byte) => byte ^ 1),
        expectedAccountPublicId: ACCOUNT,
      }),
    ).rejects.toThrow('verification failed');
    await expect(
      recoverFocusGuardRoot({
        envelope: provisioned.recoveryEnvelope,
        recoverySecret: RECOVERY,
        expectedAccountPublicId: OTHER_ACCOUNT,
      }),
    ).rejects.toThrow('verification failed');
    const tampered = {
      ...provisioned.recoveryEnvelope,
      ciphertext: provisioned.recoveryEnvelope.ciphertext.slice(0, -1),
    };
    await expect(
      recoverFocusGuardRoot({
        envelope: tampered,
        recoverySecret: RECOVERY,
        expectedAccountPublicId: ACCOUNT,
      }),
    ).rejects.toThrow('verification failed');
    expect(() =>
      validateFocusGuardRootEnvelopeV1({ ...provisioned.recoveryEnvelope, extra: true }),
    ).toThrow('verification failed');
    await expect(
      provisionFocusGuardRoot({ accountPublicId: ACCOUNT, rootKey: new Uint8Array(31) }),
    ).rejects.toThrow('32 bytes');
  });
});

import { describe, expect, it } from 'vitest';
import {
  FOCUS_GUARD_STATE_ENTITY_ID,
  buildEncryptedFocusGuardStateMutation,
  encryptFocusGuardStateEnvelope,
  focusGuardStateAad,
  projectFocusGuardState,
} from '../shared/sync/focusGuardStateProducer';
import { decryptFocusGuardPayload } from '../shared/sync/focusGuardCrypto';
import { provisionFocusGuardRoot } from '../shared/sync/focusGuardRootProtocol';

const ROOT = Uint8Array.from({ length: 32 }, (_, index) => index);
const RECOVERY = Uint8Array.from({ length: 32 }, (_, index) => 0x20 + index);
const NONCE = Uint8Array.from({ length: 12 }, (_, index) => 0xa0 + index);
const OBSERVED_AT = 1_700_000_000_000;

async function context() {
  const provisioned = await provisionFocusGuardRoot({
    accountPublicId: 'account-state-producer',
    generation: 2,
    rootKey: ROOT,
    recoverySecret: RECOVERY,
    createdAt: OBSERVED_AT,
  });
  return {
    accountPublicId: provisioned.material.accountPublicId,
    generation: provisioned.material.generation,
    root: provisioned.material,
  };
}

describe('FocusLink encrypted guard-state producer fixture', () => {
  it('matches the consumer A256GCM/AAD golden vector byte-for-byte', async () => {
    const cryptoContext = await context();
    const plaintext = projectFocusGuardState(
      { state: 'running', sessionId: 'session-proof', revision: 42 },
      OBSERVED_AT,
    );
    const envelope = await encryptFocusGuardStateEnvelope({
      context: cryptoContext,
      plaintext,
      baseRevision: 7,
      nonce: NONCE,
      createdAt: OBSERVED_AT,
    });

    expect(focusGuardStateAad(FOCUS_GUARD_STATE_ENTITY_ID, 7, 'put')).toBe(
      'focus-guard|focus_guard_state_v1|guard-state-focuslink-live|7|put',
    );
    expect(envelope).toEqual({
      version: 1,
      algorithm: 'A256GCM',
      product: 'focus-guard',
      entityKind: 'state',
      nonce: 'oKGio6Slpqeoqaqr',
      ciphertext:
        'qCuJ38hJW47d4Dy8MBB0t-4QvDGvowYSLdi7jZEWfS3V--JW0SY8FxQ_hF5L0r7CyPgP1cj3XRsQpgeUNIBDywMJZvAxCmJUnAGoEI5cgiBk9AdJkSk0Tir-FuniS4AHjYE8BTc1kl2CJfpFwQQC1W5-PwA-XIvRXh6Bu_TOc_fdug',
      aadHash: 'e4e445a1033918e8d271bd1329d046eb06c61d98150ca709e89a466d06d26ed9',
      aadBaseRevision: 7,
      operation: 'put',
      createdAt: OBSERVED_AT,
    });
  });

  it('builds a canonical mutation without adding task, count or credential plaintext', async () => {
    const cryptoContext = await context();
    const mutation = await buildEncryptedFocusGuardStateMutation({
      context: cryptoContext,
      snapshot: { state: 'paused', sessionId: 'session-proof', revision: 43 },
      observedAt: OBSERVED_AT,
      baseRevision: 8,
      baseFingerprint: 'a'.repeat(64),
      deviceId: 'device-proof',
      accountGeneration: 2,
      nonce: NONCE,
      createdAt: OBSERVED_AT,
    });

    expect(mutation).toMatchObject({
      entityType: 'focus_guard_state_v1',
      entityId: FOCUS_GUARD_STATE_ENTITY_ID,
      kind: 'put',
      baseRevision: 8,
      deviceId: 'device-proof',
      accountGeneration: 2,
    });
    expect(mutation.opId).toMatch(/^guard-state-[a-f0-9]{64}$/);
    expect(JSON.stringify(mutation.payload)).not.toMatch(
      /task|count|accessToken|syncRoot|session-proof/,
    );
  });

  it('produces an envelope that the generic crypto consumer decrypts', async () => {
    const cryptoContext = await context();
    const plaintext = projectFocusGuardState(
      { state: 'paused', sessionId: 'session-cross-check', revision: 44 },
      OBSERVED_AT,
    );
    const envelope = await encryptFocusGuardStateEnvelope({
      context: cryptoContext,
      plaintext,
      baseRevision: 9,
      nonce: NONCE,
      createdAt: OBSERVED_AT,
    });

    await expect(
      decryptFocusGuardPayload({
        context: cryptoContext,
        entityType: 'focus_guard_state_v1',
        entityId: FOCUS_GUARD_STATE_ENTITY_ID,
        baseRevision: 9,
        operation: 'put',
        envelope,
      }),
    ).resolves.toEqual(plaintext);
  });

  it('rejects stale-by-construction TTLs and a running state without a session', async () => {
    expect(() =>
      projectFocusGuardState({ state: 'running', sessionId: null, revision: 1 }, OBSERVED_AT),
    ).toThrow('requires a sessionId');
    expect(() =>
      projectFocusGuardState({ state: 'idle', sessionId: null, revision: 1 }, OBSERVED_AT, 300_001),
    ).toThrow('TTL is invalid');
    const cryptoContext = await context();
    await expect(
      encryptFocusGuardStateEnvelope({
        context: {
          ...cryptoContext,
          root: { ...cryptoContext.root, rootKey: new Uint8Array(31) },
        },
        plaintext: {
          state: 'idle',
          sessionId: null,
          revision: 1,
          observedAt: OBSERVED_AT,
          expiresAt: OBSERVED_AT + 90_000,
        },
        baseRevision: 0,
      }),
    ).rejects.toThrow('verification failed');
  });
});

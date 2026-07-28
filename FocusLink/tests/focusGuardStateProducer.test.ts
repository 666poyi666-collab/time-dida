import { describe, expect, it } from 'vitest';
import {
  FOCUS_GUARD_STATE_ENTITY_ID,
  buildEncryptedFocusGuardStateMutation,
  encryptFocusGuardStateEnvelope,
  focusGuardStateAad,
  projectFocusGuardState,
} from '../shared/sync/focusGuardStateProducer';

const ROOT = Uint8Array.from({ length: 32 }, (_, index) => index);
const NONCE = Uint8Array.from({ length: 12 }, (_, index) => 0xa0 + index);
const OBSERVED_AT = 1_700_000_000_000;

describe('FocusLink encrypted guard-state producer fixture', () => {
  it('matches the consumer A256GCM/AAD golden vector byte-for-byte', async () => {
    const plaintext = projectFocusGuardState(
      { state: 'running', sessionId: 'session-proof', revision: 42 },
      OBSERVED_AT,
    );
    const envelope = await encryptFocusGuardStateEnvelope({
      rootKey: ROOT,
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
        'nToPWSS_Z51YR_WmaRSpsBeOdTLh0jEf9WFIzxuJTyOhEzSMxk09EC_ua6dvWK_bNX4wIRG5dRBjZD9siFLq0sfZ9xlVwaWU1tjOL7_-_Ir9O5uU9fGpVswQRurY6CjnzvAJkTKZv6uu6zZgvLjdGBQtAD2w6SxCWWNvo3ez98-9Wg',
      aadHash: 'e4e445a1033918e8d271bd1329d046eb06c61d98150ca709e89a466d06d26ed9',
      aadBaseRevision: 7,
      operation: 'put',
      createdAt: OBSERVED_AT,
    });
  });

  it('builds a canonical mutation without adding task, count or credential plaintext', async () => {
    const mutation = await buildEncryptedFocusGuardStateMutation({
      rootKey: ROOT,
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

  it('rejects stale-by-construction TTLs and a running state without a session', async () => {
    expect(() =>
      projectFocusGuardState({ state: 'running', sessionId: null, revision: 1 }, OBSERVED_AT),
    ).toThrow('requires a sessionId');
    expect(() =>
      projectFocusGuardState({ state: 'idle', sessionId: null, revision: 1 }, OBSERVED_AT, 300_001),
    ).toThrow('TTL is invalid');
    await expect(
      encryptFocusGuardStateEnvelope({
        rootKey: new Uint8Array(31),
        plaintext: {
          state: 'idle',
          sessionId: null,
          revision: 1,
          observedAt: OBSERVED_AT,
          expiresAt: OBSERVED_AT + 90_000,
        },
        baseRevision: 0,
      }),
    ).rejects.toThrow('root must be 32 bytes');
  });
});

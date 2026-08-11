import { describe, expect, it, vi } from 'vitest';

// The Durable Object base only needs to be definable for the module to load; this
// pure guard never instantiates it. Mirrors tests/cloudflareWorkerRouting.test.ts.
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor() {}
  },
}));

import {
  ProtocolError,
  assertV2DeviceBinding,
  authorizeV2CredentialRecord,
  deriveRegisteredDevicePublicId,
  encodeDevicePublicId,
  parseV2DeviceCredential,
  readJson,
  rejectUnexpectedQuery,
  validateV2Mutation,
  type V2DeviceCredentialRecord,
  type V2Identity,
} from '../cloudflare/accountDurableObject';
import type { EncryptedFocusGuardEnvelopeV1, SyncV2Mutation } from '../shared/sync/v2Protocol';

describe('device public id encoding', () => {
  it('never emits the underscore reserved as an fl2 credential separator', () => {
    const value = encodeDevicePublicId(
      Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]),
    );
    expect(value).toBe('ffffffffffffffffffffffff');
    expect(value).toMatch(/^[A-Za-z0-9-]{6,80}$/);
    expect(value).not.toContain('_');
  });

  it('requires the full 96 bits of random input', () => {
    expect(() => encodeDevicePublicId(new Uint8Array(11))).toThrow(
      'device public id requires 12 random bytes',
    );
  });
});

describe('identity-backed device ids', () => {
  it('keeps one installation on one device id without exposing the installation id', async () => {
    const pepper = 'device-pepper-with-at-least-32-characters';
    const installationId = 'install_0123456789abcdefghijklmnop';
    const first = await deriveRegisteredDevicePublicId(pepper, 'primary', installationId);
    const second = await deriveRegisteredDevicePublicId(pepper, 'primary', installationId);
    const other = await deriveRegisteredDevicePublicId(
      pepper,
      'primary',
      'install_abcdefghijklmnopqrstuvwxyz012345',
    );

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^[a-f0-9]{24}$/);
    expect(first).not.toContain(installationId);
  });
});

function identity(deviceId: string, owner = false): V2Identity {
  return { deviceId, scopes: ['sync:write'], owner };
}

describe('assertV2DeviceBinding (P0-1: device token cannot forge another device)', () => {
  it('allows a request whose deviceId and mutations all match the authenticated device', () => {
    expect(() =>
      assertV2DeviceBinding(identity('device-a'), 'device-a', [
        { deviceId: 'device-a' },
        { deviceId: 'device-a' },
      ]),
    ).not.toThrow();
  });

  it('rejects a request body that claims another device id', () => {
    // A holder of device-a's token填 device-b in the request body must be denied.
    expect(() => assertV2DeviceBinding(identity('device-a'), 'device-b')).toThrow(
      /does not match the authenticated device/,
    );
  });

  it('rejects a mutation claiming another device even when the request deviceId matches', () => {
    expect(() =>
      assertV2DeviceBinding(identity('device-a'), 'device-a', [
        { deviceId: 'device-a' },
        { deviceId: 'device-b' },
      ]),
    ).toThrow(/does not match the authenticated device/);
  });

  it('lets the internal owner-migration credential replay historical device ids', () => {
    expect(() =>
      assertV2DeviceBinding(identity('owner-migration', true), 'device-legacy', [
        { deviceId: 'device-old' },
      ]),
    ).not.toThrow();
  });
});

describe('device credential negative cases', () => {
  const now = 2_000_000_000_000;
  const credential = parseV2DeviceCredential(`Bearer fl2_accountaa_devicebb_${'s'.repeat(40)}`)!;
  const active: V2DeviceCredentialRecord = {
    device_id: 'device-devicebb',
    account_public_id: 'accountaa',
    secret_hmac: 'digest-a',
    scopes_json: '["sync:read","sync:write","live:read","live:write"]',
    expires_at: now + 60_000,
    revoked_at: null,
  };

  it('parses a format-valid token but rejects it when no device record exists', () => {
    expect(credential).not.toBeNull();
    expectCode(
      () => authorizeV2CredentialRecord(credential, undefined, null, 'sync:read', now),
      'device_revoked_or_expired',
    );
  });

  it('rejects expired and revoked credentials', () => {
    expectCode(
      () =>
        authorizeV2CredentialRecord(
          credential,
          { ...active, expires_at: now },
          'digest-a',
          'sync:read',
          now,
        ),
      'device_revoked_or_expired',
    );
    expectCode(
      () =>
        authorizeV2CredentialRecord(
          credential,
          { ...active, revoked_at: now - 1 },
          'digest-a',
          'sync:read',
          now,
        ),
      'device_revoked_or_expired',
    );
  });

  it('rejects cross-account and wrong-secret credentials', () => {
    expectCode(
      () =>
        authorizeV2CredentialRecord(
          credential,
          { ...active, account_public_id: 'another-account' },
          'digest-a',
          'sync:read',
          now,
        ),
      'device_revoked_or_expired',
    );
    expectCode(
      () => authorizeV2CredentialRecord(credential, active, 'digest-b', 'sync:read', now),
      'unauthenticated',
    );
  });

  it('requires an explicitly granted devices:manage scope for pair offers', () => {
    expectCode(
      () => authorizeV2CredentialRecord(credential, active, 'digest-a', 'devices:manage', now),
      'scope_denied',
    );
    expect(
      authorizeV2CredentialRecord(
        credential,
        {
          ...active,
          scopes_json: '["sync:read","sync:write","live:read","live:write","devices:manage"]',
        },
        'digest-a',
        'devices:manage',
        now,
      ).scopes,
    ).toContain('devices:manage');
  });
});

describe('Account DO request boundaries', () => {
  it('rejects an oversized body from content-length before JSON parsing', async () => {
    const request = new Request('https://focuslink.internal/v2/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '1000' },
      body: '{}',
    });
    await expect(readJson(request, 16)).rejects.toMatchObject({
      code: 'payload_too_large',
      status: 413,
    });
  });

  it('stops reading a streamed body as soon as its byte budget is exceeded', async () => {
    const request = new Request('https://focuslink.internal/v2/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(100) }),
    });
    await expect(readJson(request, 16)).rejects.toMatchObject({
      code: 'payload_too_large',
      status: 413,
    });
  });

  it('rejects query fields on canonical write routes', () => {
    expect(() =>
      rejectUnexpectedQuery(new URL('https://focuslink.internal/v1/tasks?unexpected=1')),
    ).toThrow(/query/);
    expect(() =>
      rejectUnexpectedQuery(new URL('https://focuslink.internal/v1/live/command?retry=1')),
    ).toThrow(/query/);
  });
});

const FOCUS_GUARD_ENVELOPE: EncryptedFocusGuardEnvelopeV1 = {
  version: 1,
  algorithm: 'A256GCM',
  product: 'focus-guard',
  entityKind: 'state',
  nonce: 'AAAAAAAAAAAAAAAA',
  ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA',
  aadHash: 'a'.repeat(64),
  aadBaseRevision: 7,
  operation: 'put',
  createdAt: 1_700_000_000_000,
};

function focusGuardMutation(baseRevision: number): SyncV2Mutation {
  return {
    opId: `focus-guard-authority-${baseRevision}`,
    entityType: 'focus_guard_state_v1',
    entityId: 'guard-state-focuslink-live',
    kind: 'put',
    baseRevision,
    baseFingerprint: null,
    payload: FOCUS_GUARD_ENVELOPE,
    deviceId: 'device-authority',
    accountGeneration: 1,
  };
}

describe('Account DO Focus Guard mutation authority', () => {
  it('rejects old ciphertext attached to a new mutation revision', () => {
    expect(validateV2Mutation(focusGuardMutation(7))).toBeNull();
    expect(validateV2Mutation(focusGuardMutation(8))).toBe(
      'invalid_encrypted_focus_guard_envelope',
    );
  });
});

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).code).toBe(code);
  }
}

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
  parseV2DeviceCredential,
  readJson,
  rejectUnexpectedQuery,
  type V2DeviceCredentialRecord,
  type V2Identity,
} from '../cloudflare/accountDurableObject';

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

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).code).toBe(code);
  }
}

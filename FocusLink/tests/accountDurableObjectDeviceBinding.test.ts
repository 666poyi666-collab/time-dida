import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The Durable Object base only needs to be definable for the module to load; this
// pure guard never instantiates it. Mirrors tests/cloudflareWorkerRouting.test.ts.
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor() {}
  },
}));

import {
  ProtocolError,
  assertPairOfferClaimAvailable,
  assertV2DeviceBinding,
  authorizeV2CredentialRecord,
  deriveRegisteredDevicePublicId,
  encodeDevicePublicId,
  parseV2DeviceCredential,
  pairMetadataMatches,
  readJson,
  rejectUnexpectedQuery,
  shouldRetryPairCodeCollision,
  validateV2Mutation,
  type V2DeviceCredentialRecord,
  type V2Identity,
} from '../cloudflare/accountDurableObject';
import type { EncryptedFocusGuardEnvelopeV1, SyncV2Mutation } from '../shared/sync/v2Protocol';

const authoritySource = fs.readFileSync(
  path.join(process.cwd(), 'cloudflare', 'accountDurableObject.ts'),
  'utf8',
);

describe('numeric pairing authority storage contract', () => {
  it('stores only a domain-separated HMAC and keeps same-device retries idempotent', () => {
    expect(authoritySource).toContain("'code_hmac'");
    expect(authoritySource).toContain('pairingCodeHmacInput(numericCode)');
    expect(authoritySource).toContain('UPDATE v2_pair_offers SET used_at = COALESCE(used_at, ?)');
    expect(authoritySource).toContain('focuslink-pair-offer-secret-v2');
    expect(authoritySource).toContain("await this.authorizeV2(request, 'sync:write')");
    const insert = /INSERT INTO v2_pair_offers[\s\S]*?\n\s*\);/.exec(authoritySource);
    expect(insert, 'pair offer insert must remain inspectable').not.toBeNull();
    expect(insert![0]).not.toContain('numericCode');
  });

  it('collapses unknown, used, expired and cross-account claims to the same 410 result', () => {
    const now = 2_000_000_000_000;
    const cases = [
      undefined,
      { used_at: now - 1, expires_at: now + 60_000, account_public_id: 'account-a' },
      { used_at: null, expires_at: now, account_public_id: 'account-a' },
      { used_at: null, expires_at: now + 60_000, account_public_id: 'account-b' },
    ];
    for (const offer of cases) {
      expectCode(() => assertPairOfferClaimAvailable(offer, now, 'account-a'), 'pairing_expired');
    }
    expect(() =>
      assertPairOfferClaimAvailable(
        { used_at: null, expires_at: now + 60_000, account_public_id: 'account-a' },
        now,
        'account-a',
      ),
    ).not.toThrow();
  });

  it('rejects a code already bound to another installation metadata tuple', () => {
    const offer = {
      installation_id: 'android-0123456789abcdefghijklmnop',
      display_name: 'FocusLink 手机',
      platform: 'android',
      device_kind: 'phone',
      app_version: '0.12.97',
    } as Parameters<typeof pairMetadataMatches>[0];
    const matching = {
      installationId: 'android-0123456789abcdefghijklmnop',
      displayName: 'FocusLink 手机',
      platform: 'android' as const,
      deviceKind: 'phone' as const,
      appVersion: '0.12.97',
    };
    expect(pairMetadataMatches(offer, matching)).toBe(true);
    expect(
      pairMetadataMatches(offer, {
        ...matching,
        installationId: 'android-abcdefghijklmnopqrstuvwxyz012345',
      }),
    ).toBe(false);
  });

  it('retries code-HMAC collisions only three times before failing closed', () => {
    const collision = new Error('UNIQUE constraint failed: v2_pair_offers.code_hmac');
    expect([0, 1, 2, 3].map((attempt) => shouldRetryPairCodeCollision(collision, attempt))).toEqual(
      [true, true, true, false],
    );
    expect(shouldRetryPairCodeCollision(new Error('disk unavailable'), 0)).toBe(false);
  });

  it('keeps a new-device code separate from its high-entropy claim capability', () => {
    expect(authoritySource).toContain('CREATE TABLE IF NOT EXISTS v2_pair_requests');
    expect(authoritySource).toContain('request_token_hmac TEXT NOT NULL UNIQUE');
    expect(authoritySource).toContain('pairingRequestTokenHmacInput(requestToken)');
    expect(authoritySource).toContain("await this.authorizeV2(request, 'sync:write')");
    expect(authoritySource).toContain("status: 'pending'");
    expect(authoritySource).toContain('focuslink-pair-request-secret-v1');
    const insert = /INSERT INTO v2_pair_requests[\s\S]*?\n\s*\);/.exec(authoritySource);
    expect(insert, 'pair request insert must remain inspectable').not.toBeNull();
    expect(insert![0]).not.toContain('requestToken,');
    expect(insert![0]).not.toContain('numericCode');
  });
});

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

  it('does not infer devices:manage from an ordinary sync:write credential', () => {
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
  it('keeps first-party task mutations on the task snapshot authority with durable CAS history', () => {
    expect(authoritySource).toContain("url.pathname === '/internal/mcp/v1/tasks'");
    expect(authoritySource).toContain("url.pathname === '/v1/tasks/mutate'");
    expect(authoritySource).toContain('CREATE TABLE IF NOT EXISTS task_operations');
    expect(authoritySource).toContain('task snapshot revision conflict');
    expect(authoritySource).toContain('task_operation_id_reused');
    expect(authoritySource).toContain('transactionSync');
    expect(authoritySource).toContain('TASK_SNAPSHOT_CAPABILITY_HEADER');
    expect(authoritySource).toContain('mergeLegacyTaskSchedulingFields');
    expect(authoritySource).toContain('withoutTaskSchedulingFields');
  });

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

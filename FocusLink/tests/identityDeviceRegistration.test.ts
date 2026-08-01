import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FOCUSLINK_CANONICAL_SYNC_ORIGIN,
  FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
  FOCUSLINK_ENROLLED_DEVICE_SCOPES,
  isCanonicalFocusLinkDeviceConnection,
  isCanonicalFocusLinkSyncEndpoint,
  isFocusLinkDeviceAccessToken,
  parseFocusLinkDeviceRegistrationRequest,
  validateFocusLinkDeviceRegistrationResponse,
} from '../shared/sync/identityProtocol';

describe('FocusLink identity device registration protocol', () => {
  it('accepts a stable installation identity and normalizes the display name', () => {
    expect(
      parseFocusLinkDeviceRegistrationRequest({
        protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
        installationId: 'install_0123456789abcdefghijklmnop',
        displayName: '  这台 Windows 电脑  ',
        platform: 'windows',
        deviceKind: 'desktop',
        appVersion: '0.12.74',
      }),
    ).toEqual({
      protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
      installationId: 'install_0123456789abcdefghijklmnop',
      displayName: '这台 Windows 电脑',
      platform: 'windows',
      deviceKind: 'desktop',
      appVersion: '0.12.74',
    });
  });

  it('rejects short installation ids, client-selected scopes and unknown device types', () => {
    const base = {
      protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
      installationId: 'install_0123456789abcdefghijklmnop',
      displayName: 'Phone',
      platform: 'android',
      deviceKind: 'phone',
    };
    expect(
      parseFocusLinkDeviceRegistrationRequest({ ...base, installationId: 'short' }),
    ).toBeNull();
    expect(
      parseFocusLinkDeviceRegistrationRequest({ ...base, scopes: ['devices:manage'] }),
    ).toBeNull();
    expect(parseFocusLinkDeviceRegistrationRequest({ ...base, deviceKind: 'server' })).toBeNull();
  });

  it('validates only server-issued fl2 registration responses', () => {
    const valid = {
      protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
      accountPublicId: 'primary',
      deviceId: 'device-0123456789abcdef01234567',
      accessToken: `fl2_primary_0123456789abcdef01234567_${'s'.repeat(48)}`,
      tokenType: 'Bearer',
      scopes: [...FOCUSLINK_ENROLLED_DEVICE_SCOPES],
      expiresAt: Date.now() + 1_000,
      serverTime: Date.now(),
    };
    expect(validateFocusLinkDeviceRegistrationResponse(valid)).toBe(true);
    expect(
      validateFocusLinkDeviceRegistrationResponse({
        ...valid,
        scopes: [...valid.scopes, 'devices:manage'],
      }),
    ).toBe(false);
    expect(
      validateFocusLinkDeviceRegistrationResponse({
        ...valid,
        scopes: ['sync:read'],
      }),
    ).toBe(false);
    expect(validateFocusLinkDeviceRegistrationResponse({ ...valid, extra: true })).toBe(false);
    expect(validateFocusLinkDeviceRegistrationResponse({ ...valid, accessToken: 'oauth' })).toBe(
      false,
    );
  });

  it('binds every production-shaped device credential to the canonical sync origin', () => {
    const token = `fl2_primary_mobile1_${'s'.repeat(48)}`;
    expect(isFocusLinkDeviceAccessToken(token)).toBe(true);
    expect(isCanonicalFocusLinkSyncEndpoint(`${FOCUSLINK_CANONICAL_SYNC_ORIGIN}/`)).toBe(true);
    expect(isCanonicalFocusLinkDeviceConnection(FOCUSLINK_CANONICAL_SYNC_ORIGIN, token)).toBe(true);
    expect(isCanonicalFocusLinkDeviceConnection('https://evil.example.test', token)).toBe(false);
    expect(isCanonicalFocusLinkDeviceConnection(FOCUSLINK_CANONICAL_SYNC_ORIGIN, 'legacy')).toBe(
      false,
    );
  });

  it('keeps the Android native canonical origin aligned with the shared protocol', () => {
    const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
    expect(gradle).toContain(
      `buildConfigField "String", "CANONICAL_SYNC_ORIGIN", '"${FOCUSLINK_CANONICAL_SYNC_ORIGIN}"'`,
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
  FOCUSLINK_ENROLLED_DEVICE_SCOPES,
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
        appVersion: '0.12.72',
      }),
    ).toEqual({
      protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
      installationId: 'install_0123456789abcdefghijklmnop',
      displayName: '这台 Windows 电脑',
      platform: 'windows',
      deviceKind: 'desktop',
      appVersion: '0.12.72',
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
    expect(validateFocusLinkDeviceRegistrationResponse({ ...valid, accessToken: 'oauth' })).toBe(
      false,
    );
  });
});

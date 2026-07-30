import { describe, expect, it } from 'vitest';
import {
  FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
  FOCUSLINK_CANONICAL_IDENTITY_ORIGIN,
  parseFocusLinkAccountBootstrapRequest,
  parseFocusLinkAccountBootstrapResponse,
  redactFocusLinkAccountBootstrapResponse,
} from '@shared/sync/accountBootstrapProtocol';
import {
  FOCUSLINK_CANONICAL_SYNC_ORIGIN,
  FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
} from '@shared/sync/identityProtocol';

const registration = {
  protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
  installationId: `windows-${'a'.repeat(32)}`,
  displayName: 'FocusLink · PC',
  platform: 'windows',
  deviceKind: 'desktop',
  appVersion: '0.12.73',
} as const;

const device = {
  protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
  accountPublicId: 'account1',
  deviceId: 'device-desktop1',
  accessToken: `fl2_account1_desktop1_${'s'.repeat(48)}`,
  tokenType: 'Bearer',
  scopes: ['sync:read', 'sync:write', 'live:read', 'live:write'],
  expiresAt: 2_000_000,
  serverTime: 1_000_000,
} as const;

describe('owner account bootstrap protocol', () => {
  it('keeps start registration and secret poll requests structurally separate', () => {
    expect(
      parseFocusLinkAccountBootstrapRequest({
        protocolVersion: FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
        action: 'start',
        registration,
      }),
    ).toMatchObject({
      action: 'start',
      registration: { installationId: registration.installationId },
    });
    expect(
      parseFocusLinkAccountBootstrapRequest({
        protocolVersion: FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
        action: 'poll',
        flowId: `flow_${'f'.repeat(40)}`,
        pollToken: `flb_${'p'.repeat(48)}`,
      }),
    ).toMatchObject({ action: 'poll' });
    expect(
      parseFocusLinkAccountBootstrapRequest({
        protocolVersion: 1,
        action: 'poll',
        flowId: `flow_${'f'.repeat(40)}`,
        pollToken: `flb_${'p'.repeat(48)}`,
        registration,
      }),
    ).toBeNull();
  });

  it('accepts only the canonical owner login origin and bounded poll metadata', () => {
    const response = {
      protocolVersion: 1,
      status: 'login-required',
      flowId: `flow_${'f'.repeat(40)}`,
      pollToken: `flb_${'p'.repeat(48)}`,
      loginUrl: `${FOCUSLINK_CANONICAL_IDENTITY_ORIGIN}/owner/focuslink-device?flow=public`,
      retryAfterMs: 1_500,
      expiresAt: 1_300_000,
      serverTime: 1_000_000,
    };
    expect(parseFocusLinkAccountBootstrapResponse(response)).toMatchObject({
      status: 'login-required',
    });
    expect(
      parseFocusLinkAccountBootstrapResponse({
        ...response,
        loginUrl: 'https://evil.example/owner/focuslink-device',
      }),
    ).toBeNull();
    expect(
      parseFocusLinkAccountBootstrapResponse({ ...response, retryAfterMs: 60_000 }),
    ).toBeNull();
    expect(
      parseFocusLinkAccountBootstrapResponse({
        ...response,
        loginUrl: `${FOCUSLINK_CANONICAL_IDENTITY_ORIGIN}.evil.example/owner/focuslink-device`,
      }),
    ).toBeNull();
    expect(parseFocusLinkAccountBootstrapResponse({ ...response, extra: true })).toBeNull();
    expect(
      parseFocusLinkAccountBootstrapResponse({ ...response, expiresAt: response.serverTime }),
    ).toBeNull();
  });

  it('validates authenticated device enrollment and redacts both credentials', () => {
    const authenticated = {
      protocolVersion: 1,
      status: 'authenticated',
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      accountLabel: 'Poyi',
      device,
    };
    expect(parseFocusLinkAccountBootstrapResponse(authenticated)).toMatchObject({
      status: 'authenticated',
      device: { deviceId: 'device-desktop1' },
    });
    const redacted = redactFocusLinkAccountBootstrapResponse(authenticated);
    expect(redacted).not.toHaveProperty('accessToken');
    expect(JSON.stringify(redacted)).not.toContain('fl2_');

    const login = {
      protocolVersion: 1,
      status: 'login-required',
      flowId: `flow_${'f'.repeat(40)}`,
      pollToken: `flb_${'p'.repeat(48)}`,
      loginUrl: `${FOCUSLINK_CANONICAL_IDENTITY_ORIGIN}/owner/focuslink-device?flow=public`,
      retryAfterMs: 1_500,
      expiresAt: 1_300_000,
      serverTime: 1_000_000,
    };
    const loginRedacted = redactFocusLinkAccountBootstrapResponse(login);
    expect(loginRedacted).not.toHaveProperty('pollToken');
    expect(JSON.stringify(loginRedacted)).not.toContain('flb_');

    expect(
      parseFocusLinkAccountBootstrapResponse({
        ...authenticated,
        device: { ...device, accountPublicId: 'account2' },
      }),
    ).toBeNull();
    expect(parseFocusLinkAccountBootstrapResponse({ ...authenticated, extra: true })).toBeNull();
  });
});

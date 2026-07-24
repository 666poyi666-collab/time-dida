import { describe, expect, it } from 'vitest';
import {
  createDeviceSyncPairingUrl,
  parseDeviceSyncPairingUrl,
} from '@shared/sync/pairingProtocol';

describe('device sync pairing deep link', () => {
  it('round-trips only endpoint, nonce, protocol and expiry', () => {
    const expiresAt = 1_800_000_120_000;
    const url = createDeviceSyncPairingUrl({
      protocolVersion: 1,
      endpoint: 'http://127.0.0.1:18787/',
      nonce: 'A1B2C3D4_nonce',
      expiresAt,
    });
    expect(url).not.toContain('token');
    expect(parseDeviceSyncPairingUrl(url, expiresAt - 1)).toEqual({
      protocolVersion: 1,
      endpoint: 'http://127.0.0.1:18787',
      nonce: 'A1B2C3D4_nonce',
      expiresAt,
    });
  });

  it('rejects expired, unsupported and remote cleartext links', () => {
    const valid =
      'focuslink://pair?protocolVersion=1&endpoint=https%3A%2F%2Fsync.example.test&nonce=A1B2C3D4&expiresAt=2000';
    expect(parseDeviceSyncPairingUrl(valid, 2000)).toBeNull();
    expect(
      parseDeviceSyncPairingUrl(valid.replace('protocolVersion=1', 'protocolVersion=2'), 1),
    ).toBeNull();
    expect(
      parseDeviceSyncPairingUrl(
        valid.replace('https%3A%2F%2Fsync.example.test', 'http%3A%2F%2F192.168.1.2'),
        1,
      ),
    ).toBeNull();
  });
});

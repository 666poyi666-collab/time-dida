import { describe, expect, it, vi } from 'vitest';

// The Durable Object base only needs to be definable for the module to load; this
// pure guard never instantiates it. Mirrors tests/cloudflareWorkerRouting.test.ts.
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor() {}
  },
}));

import { assertV2DeviceBinding, type V2Identity } from '../cloudflare/accountDurableObject';

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

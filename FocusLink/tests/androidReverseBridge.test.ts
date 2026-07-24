import { describe, expect, it } from 'vitest';
import { parseAuthorizedAdbDevices } from '../electron/sync/androidReverseBridgePolicy';

describe('Android reverse bridge discovery', () => {
  it('returns only authorized devices and keeps USB and Wi-Fi serials distinct', () => {
    expect(
      parseAuthorizedAdbDevices(`List of devices attached
2e28bb17 device product:OWW221
192.168.1.84:5555 device product:xaga
192.168.1.61:5555 offline
unauthorized-device unauthorized
`),
    ).toEqual(['2e28bb17', '192.168.1.84:5555']);
  });
});

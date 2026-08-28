import { describe, expect, it } from 'vitest';
import type { DeviceSyncManagedDevice } from '../shared/ipc/api';
import {
  groupManagedDevices,
  managedDeviceKindLabel,
  managedDeviceStateLabel,
} from '../shared/deviceRosterPolicy';

describe('paired device roster presentation', () => {
  it('keeps the current device visible and folds test, revoked and stale devices away', () => {
    const devices = [
      device('current', '我的小米', 'phone'),
      device('tablet', '华为平板', 'tablet'),
      device('smoke', 'FocusLink protocol smoke device', 'desktop'),
      { ...device('stale', '旧电脑', 'desktop'), stale: true },
      { ...device('revoked', '已删除手机', 'phone'), revokedAt: 20 },
    ];
    const groups = groupManagedDevices(devices, 'current');
    expect(groups.current?.deviceId).toBe('current');
    expect(groups.regular.map((item) => item.deviceId)).toEqual(['tablet']);
    expect(groups.inactiveOrTest.map((item) => item.deviceId)).toEqual([
      'smoke',
      'stale',
      'revoked',
    ]);
  });

  it('uses plain device kind and lifecycle wording', () => {
    expect(managedDeviceKindLabel('tablet')).toBe('平板');
    expect(managedDeviceStateLabel(device('test', 'QA staging device', 'phone'))).toBe('测试设备');
    expect(managedDeviceStateLabel({ ...device('old', '旧电脑', 'desktop'), stale: true })).toBe(
      '久未同步',
    );
  });
});

function device(
  id: string,
  displayName: string,
  deviceKind: DeviceSyncManagedDevice['deviceKind'],
): DeviceSyncManagedDevice {
  return {
    deviceId: id,
    devicePublicId: id,
    displayName,
    platform: deviceKind === 'desktop' ? 'windows' : 'android',
    deviceKind,
    appVersion: '0.12.104',
    expiresAt: null,
    revokedAt: null,
    lastSeenAt: 10,
    stale: false,
    registeredAt: 1,
  };
}

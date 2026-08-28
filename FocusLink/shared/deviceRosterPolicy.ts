import type { DeviceSyncManagedDevice } from './ipc/api';

export interface DeviceRosterGroups {
  current: DeviceSyncManagedDevice | null;
  regular: DeviceSyncManagedDevice[];
  inactiveOrTest: DeviceSyncManagedDevice[];
}

const NON_PRODUCT_DEVICE_PATTERN =
  /(?:^|[\s._-])(test|testing|smoke|protocol|synthetic|temporary|temp|staging|qa)(?:$|[\s._-])|测试|临时|验收|回归/i;

export function groupManagedDevices(
  devices: readonly DeviceSyncManagedDevice[],
  currentDeviceId?: string | null,
): DeviceRosterGroups {
  const current = devices.find((device) => device.deviceId === currentDeviceId) ?? null;
  const remaining = devices.filter((device) => device.deviceId !== currentDeviceId);
  return {
    current,
    regular: remaining.filter((device) => !isInactiveOrTestDevice(device)),
    inactiveOrTest: remaining.filter(isInactiveOrTestDevice),
  };
}

export function isInactiveOrTestDevice(device: DeviceSyncManagedDevice): boolean {
  if (device.revokedAt !== null || device.stale) return true;
  return NON_PRODUCT_DEVICE_PATTERN.test(`${device.displayName} ${device.appVersion ?? ''}`);
}

export function managedDeviceKindLabel(kind: DeviceSyncManagedDevice['deviceKind']): string {
  if (kind === 'desktop') return '电脑';
  if (kind === 'tablet') return '平板';
  if (kind === 'phone') return '手机';
  if (kind === 'watch') return '手表';
  return '设备';
}

export function managedDeviceStateLabel(device: DeviceSyncManagedDevice): string {
  if (device.revokedAt !== null) return '已失效';
  if (NON_PRODUCT_DEVICE_PATTERN.test(`${device.displayName} ${device.appVersion ?? ''}`)) {
    return '测试设备';
  }
  if (device.stale) return '久未同步';
  return '最近在线';
}

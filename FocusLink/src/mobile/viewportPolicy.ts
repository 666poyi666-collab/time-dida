export const TABLET_FOCUS_MIN_WIDTH = 760;

export function isTabletFocusViewport(width: number): boolean {
  return Number.isFinite(width) && width >= TABLET_FOCUS_MIN_WIDTH;
}

export function focusDeviceLabel(
  ownerDeviceId: string | null,
  localDeviceId: string,
  tabletViewport: boolean,
): string {
  if (!ownerDeviceId) return '尚无操作设备';
  if (ownerDeviceId === localDeviceId) return '此设备';
  if (tabletViewport || ownerDeviceId.length <= 18) return ownerDeviceId;
  return `${ownerDeviceId.slice(0, 8)}…${ownerDeviceId.slice(-6)}`;
}

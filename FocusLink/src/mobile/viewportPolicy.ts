/**
 * The Huawei DBY-W09 reports a 640 CSS-pixel portrait viewport at its native
 * 1600x2560 / 400 dpi configuration. Keep the breakpoint below that value so
 * the physical tablet does not fall back to the phone bottom-navigation shell.
 */
export const TABLET_FOCUS_MIN_WIDTH = 620;

export const WATCH_FOCUS_MAX_CSS_LONG_EDGE = 460;
export const WATCH_FOCUS_MAX_NATIVE_PHYSICAL_SHORT_EDGE = 480;
export const WATCH_FOCUS_MAX_NATIVE_PHYSICAL_LONG_EDGE = 600;

export interface WatchViewportOptions {
  native?: boolean;
  pixelRatio?: number;
}

/**
 * Detect the wearable tier without classifying a 360x480 browser preview as a
 * watch. Android WebView normally exposes the OWW221 as 189x248 or 320x420 CSS
 * pixels; the native physical-size fallback also covers WebView variants that
 * expose its full 378x496 panel.
 */
export function isWatchFocusViewport(
  width: number,
  height: number,
  options: WatchViewportOptions = {},
): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  if (longEdge <= WATCH_FOCUS_MAX_CSS_LONG_EDGE) return true;
  if (!options.native) return false;

  const pixelRatio = options.pixelRatio ?? 1;
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) return false;
  return (
    shortEdge * pixelRatio <= WATCH_FOCUS_MAX_NATIVE_PHYSICAL_SHORT_EDGE &&
    longEdge * pixelRatio <= WATCH_FOCUS_MAX_NATIVE_PHYSICAL_LONG_EDGE
  );
}

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

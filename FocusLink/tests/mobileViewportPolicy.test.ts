import { describe, expect, it } from 'vitest';
import {
  TABLET_FOCUS_MIN_WIDTH,
  focusDeviceLabel,
  isWatchFocusViewport,
  isTabletFocusViewport,
} from '../src/mobile/viewportPolicy';

describe('mobile FocusLink viewport policy', () => {
  it('keeps phone-only layouts free of the tablet focus display module', () => {
    expect(isTabletFocusViewport(393)).toBe(false);
    expect(isTabletFocusViewport(412)).toBe(false);
  });

  it('enables the tablet module at the Huawei CSS viewport boundary', () => {
    expect(TABLET_FOCUS_MIN_WIDTH).toBe(620);
    expect(isTabletFocusViewport(619)).toBe(false);
    expect(isTabletFocusViewport(620)).toBe(true);
    expect(isTabletFocusViewport(640)).toBe(true);
    expect(isTabletFocusViewport(800)).toBe(true);
  });

  it('routes both observed OWW221 WebView sizes to the watch without hijacking web previews', () => {
    expect(isWatchFocusViewport(189, 248)).toBe(true);
    expect(isWatchFocusViewport(320, 420)).toBe(true);
    expect(isWatchFocusViewport(378, 496, { native: true, pixelRatio: 1 })).toBe(true);
    expect(isWatchFocusViewport(360, 480)).toBe(false);
    expect(isWatchFocusViewport(392, 894, { native: true, pixelRatio: 2.75 })).toBe(false);
    expect(isWatchFocusViewport(640, 992, { native: true, pixelRatio: 2.5 })).toBe(false);
  });

  it('shows full authority device identity on tablets while keeping phones compact', () => {
    const owner = 'device-visual-proof-long-identifier';
    expect(focusDeviceLabel(owner, 'device-other', true)).toBe(owner);
    expect(focusDeviceLabel(owner, 'device-other', false)).toBe('device-v…tifier');
    expect(focusDeviceLabel(owner, owner, false)).toBe('此设备');
    expect(focusDeviceLabel(null, 'device-other', true)).toBe('尚无操作设备');
  });
});

import { describe, expect, it } from 'vitest';
import {
  TABLET_FOCUS_MIN_WIDTH,
  focusDeviceLabel,
  isTabletFocusViewport,
} from '../src/mobile/viewportPolicy';

describe('mobile FocusLink viewport policy', () => {
  it('keeps phone-only layouts free of the tablet focus display module', () => {
    expect(isTabletFocusViewport(393)).toBe(false);
    expect(isTabletFocusViewport(412)).toBe(false);
  });

  it('enables the tablet module at the Huawei CSS viewport boundary', () => {
    expect(TABLET_FOCUS_MIN_WIDTH).toBe(760);
    expect(isTabletFocusViewport(759)).toBe(false);
    expect(isTabletFocusViewport(760)).toBe(true);
    expect(isTabletFocusViewport(800)).toBe(true);
  });

  it('shows full authority device identity on tablets while keeping phones compact', () => {
    const owner = 'device-visual-proof-long-identifier';
    expect(focusDeviceLabel(owner, 'device-other', true)).toBe(owner);
    expect(focusDeviceLabel(owner, 'device-other', false)).toBe('device-v…tifier');
    expect(focusDeviceLabel(owner, owner, false)).toBe('此设备');
    expect(focusDeviceLabel(null, 'device-other', true)).toBe('尚无操作设备');
  });
});

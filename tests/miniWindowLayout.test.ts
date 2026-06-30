import { describe, expect, it } from 'vitest';
import {
  MINI_WINDOW_COLLAPSED_HEIGHT,
  MINI_WINDOW_DEFAULT_SIZE,
  MINI_WINDOW_SIZE_PRESETS,
  isMiniWindowCompact,
  snapMiniWindowSize,
} from '../shared/miniWindowLayout';

describe('mini window layout policy', () => {
  it('keeps three fixed expanded size presets and a 40px collapsed height', () => {
    expect(MINI_WINDOW_SIZE_PRESETS).toEqual([
      { width: 260, height: 88 },
      { width: 320, height: 144 },
      { width: 420, height: 184 },
    ]);
    expect(MINI_WINDOW_DEFAULT_SIZE).toEqual({ width: 320, height: 144 });
    expect(MINI_WINDOW_COLLAPSED_HEIGHT).toBe(40);
  });

  it('snaps arbitrary resize bounds to the nearest supported preset', () => {
    expect(snapMiniWindowSize(248, 90)).toEqual({ width: 260, height: 88 });
    expect(snapMiniWindowSize(330, 138)).toEqual({ width: 320, height: 144 });
    expect(snapMiniWindowSize(404, 190)).toEqual({ width: 420, height: 184 });
  });

  it('uses compact layout only for expanded windows that are too narrow or too short', () => {
    expect(isMiniWindowCompact(260, 88, false)).toBe(true);
    expect(isMiniWindowCompact(320, 144, false)).toBe(false);
    expect(isMiniWindowCompact(420, 184, false)).toBe(false);
    expect(isMiniWindowCompact(260, 88, true)).toBe(false);
  });
});

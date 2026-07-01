import { describe, expect, it } from 'vitest';
import {
  MINI_WINDOW_COLLAPSED_SIZE,
  MINI_WINDOW_COLLAPSED_HEIGHT,
  MINI_WINDOW_DEFAULT_SIZE,
  MINI_WINDOW_EXPANDED_SIZE,
  MINI_WINDOW_SIZE_PRESETS,
  getExpandedMiniWindowSize,
  snapMiniWindowSize,
} from '../shared/miniWindowLayout';

describe('mini window layout policy', () => {
  it('keeps fixed collapsed and expanded size presets', () => {
    expect(MINI_WINDOW_SIZE_PRESETS).toEqual([
      { width: 260, height: 88 },
      { width: 420, height: 184 },
    ]);
    expect(MINI_WINDOW_COLLAPSED_SIZE).toEqual({ width: 260, height: 88 });
    expect(MINI_WINDOW_EXPANDED_SIZE).toEqual({ width: 420, height: 184 });
    expect(MINI_WINDOW_DEFAULT_SIZE).toEqual({ width: 420, height: 184 });
    expect(MINI_WINDOW_COLLAPSED_HEIGHT).toBe(88);
  });

  it('snaps arbitrary resize bounds to the nearest supported preset', () => {
    expect(snapMiniWindowSize(248, 90)).toEqual({ width: 260, height: 88 });
    expect(snapMiniWindowSize(404, 190)).toEqual({ width: 420, height: 184 });
  });

  it('never restores the collapsed size as the expanded window', () => {
    expect(getExpandedMiniWindowSize(260, 88)).toEqual({ width: 420, height: 184 });
    expect(getExpandedMiniWindowSize(320, 144)).toEqual({ width: 420, height: 184 });
    expect(getExpandedMiniWindowSize(420, 184)).toEqual({ width: 420, height: 184 });
  });
});

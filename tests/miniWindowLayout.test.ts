import { describe, expect, it } from 'vitest';
import {
  MINI_WINDOW_COLLAPSED_SIZE,
  MINI_WINDOW_COLLAPSED_HEIGHT,
  MINI_WINDOW_DEFAULT_SIZE,
  MINI_WINDOW_EDGE_RELEASE_DISTANCE,
  MINI_WINDOW_EDGE_SNAP_DISTANCE,
  MINI_WINDOW_EXPANDED_SIZE,
  MINI_WINDOW_SIZE_PRESETS,
  anchorMiniWindowToEdge,
  detectMiniWindowEdge,
  getExpandedMiniWindowSize,
  fitMiniWindowInWorkArea,
  getMiniWindowEdgeDistance,
  resizeMiniWindowAroundCenter,
  snapMiniWindowSize,
} from '../shared/miniWindowLayout';

describe('mini window layout policy', () => {
  it('keeps fixed collapsed and expanded size presets', () => {
    expect(MINI_WINDOW_SIZE_PRESETS).toEqual([
      { width: 184, height: 35 },
      { width: 256, height: 92 },
    ]);
    expect(MINI_WINDOW_COLLAPSED_SIZE).toEqual({ width: 184, height: 35 });
    expect(MINI_WINDOW_EXPANDED_SIZE).toEqual({ width: 256, height: 92 });
    expect(MINI_WINDOW_DEFAULT_SIZE).toEqual({ width: 256, height: 92 });
    expect(MINI_WINDOW_COLLAPSED_HEIGHT).toBe(35);
  });

  it('snaps arbitrary resize bounds to the nearest supported preset', () => {
    expect(snapMiniWindowSize(180, 38)).toEqual({ width: 184, height: 35 });
    expect(snapMiniWindowSize(248, 98)).toEqual({ width: 256, height: 92 });
  });

  it('never restores the collapsed size as the expanded window', () => {
    expect(getExpandedMiniWindowSize(184, 35)).toEqual({ width: 256, height: 92 });
    expect(getExpandedMiniWindowSize(220, 60)).toEqual({ width: 256, height: 92 });
    expect(getExpandedMiniWindowSize(256, 92)).toEqual({ width: 256, height: 92 });
  });

  it('keeps the expanded window inside the display work area', () => {
    expect(
      fitMiniWindowInWorkArea({ x: 1660, y: 1010 }, MINI_WINDOW_EXPANDED_SIZE, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      }),
    ).toEqual({ x: 1660, y: 988, width: 256, height: 92 });
  });

  it('detects every work-area edge with a separate release hysteresis', () => {
    const workArea = { x: 100, y: 40, width: 1200, height: 760 };
    expect(MINI_WINDOW_EDGE_SNAP_DISTANCE).toBeLessThan(MINI_WINDOW_EDGE_RELEASE_DISTANCE);
    expect(detectMiniWindowEdge({ x: 108, y: 200, width: 256, height: 92 }, workArea)).toBe('left');
    expect(detectMiniWindowEdge({ x: 1038, y: 200, width: 256, height: 92 }, workArea)).toBe(
      'right',
    );
    expect(detectMiniWindowEdge({ x: 400, y: 48, width: 256, height: 92 }, workArea)).toBe('top');
    expect(detectMiniWindowEdge({ x: 400, y: 702, width: 256, height: 92 }, workArea)).toBe(
      'bottom',
    );
    expect(detectMiniWindowEdge({ x: 300, y: 200, width: 256, height: 92 }, workArea)).toBeNull();
    expect(
      getMiniWindowEdgeDistance({ x: 1038, y: 200, width: 256, height: 92 }, workArea, 'right'),
    ).toBe(6);
  });

  it('keeps the contacted edge pinned when collapsing or expanding', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
    const expanded = { x: 1664, y: 240, width: 256, height: 92 };
    const collapsed = anchorMiniWindowToEdge(
      expanded,
      MINI_WINDOW_COLLAPSED_SIZE,
      workArea,
      'right',
    );
    expect(collapsed).toEqual({ x: 1736, y: 269, width: 184, height: 35 });
    expect(anchorMiniWindowToEdge(collapsed, MINI_WINDOW_EXPANDED_SIZE, workArea, 'right')).toEqual(
      { ...expanded, y: 241 },
    );
  });

  it('resizes around its visual centre away from an edge', () => {
    expect(
      resizeMiniWindowAroundCenter(
        { x: 500, y: 300, width: 256, height: 92 },
        MINI_WINDOW_COLLAPSED_SIZE,
        { x: 0, y: 0, width: 1920, height: 1040 },
      ),
    ).toEqual({ x: 536, y: 329, width: 184, height: 35 });
  });
});

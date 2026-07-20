import { describe, expect, it } from 'vitest';
import {
  MINI_WINDOW_COLLAPSED_SIZE,
  MINI_WINDOW_COLLAPSED_HEIGHT,
  MINI_WINDOW_DEFAULT_SIZE,
  MINI_WINDOW_DOCK_TRANSITION_MS,
  MINI_WINDOW_EDGE_RELEASE_DISTANCE,
  MINI_WINDOW_EDGE_SNAP_DISTANCE,
  MINI_WINDOW_EXPANDED_SIZE,
  MINI_WINDOW_SIZE_PRESETS,
  anchorMiniWindowToEdge,
  areMiniWindowBoundsClose,
  detectMiniWindowEdge,
  getExpandedMiniWindowSize,
  fitMiniWindowInWorkArea,
  getMiniWindowEdgeDistance,
  resizeMiniWindowAroundCenter,
  snapMiniWindowSize,
} from '../shared/miniWindowLayout';

describe('mini window layout policy', () => {
  it('locks the two product-owned sizes: 256x70 expanded, 184x35 collapsed', () => {
    expect(MINI_WINDOW_EXPANDED_SIZE).toEqual({ width: 256, height: 70 });
    expect(MINI_WINDOW_COLLAPSED_SIZE).toEqual({ width: 184, height: 35 });
    expect(MINI_WINDOW_SIZE_PRESETS).toHaveLength(2);
  });

  it('keeps fixed collapsed and expanded size presets', () => {
    expect(MINI_WINDOW_SIZE_PRESETS).toEqual([
      MINI_WINDOW_COLLAPSED_SIZE,
      MINI_WINDOW_EXPANDED_SIZE,
    ]);
    expect(MINI_WINDOW_DEFAULT_SIZE).toBe(MINI_WINDOW_EXPANDED_SIZE);
    expect(MINI_WINDOW_COLLAPSED_HEIGHT).toBe(MINI_WINDOW_COLLAPSED_SIZE.height);
    expect(MINI_WINDOW_DOCK_TRANSITION_MS).toBeGreaterThanOrEqual(280);
    expect(MINI_WINDOW_DOCK_TRANSITION_MS).toBeLessThanOrEqual(400);
  });

  it('snaps arbitrary resize bounds to the nearest supported preset', () => {
    expect(
      snapMiniWindowSize(
        MINI_WINDOW_COLLAPSED_SIZE.width - 4,
        MINI_WINDOW_COLLAPSED_SIZE.height + 3,
      ),
    ).toEqual(MINI_WINDOW_COLLAPSED_SIZE);
    expect(
      snapMiniWindowSize(MINI_WINDOW_EXPANDED_SIZE.width - 8, MINI_WINDOW_EXPANDED_SIZE.height + 6),
    ).toEqual(MINI_WINDOW_EXPANDED_SIZE);
  });

  it('accepts one-pixel DPI normalization without hiding a real user move', () => {
    const expected = { x: 800, y: 160, ...MINI_WINDOW_EXPANDED_SIZE };
    expect(
      areMiniWindowBoundsClose(expected, {
        ...expected,
        x: expected.x + 1,
        height: expected.height - 1,
      }),
    ).toBe(true);
    expect(
      areMiniWindowBoundsClose(expected, {
        ...expected,
        x: expected.x + 3,
      }),
    ).toBe(false);
  });

  it('never restores the collapsed size as the expanded window', () => {
    expect(
      getExpandedMiniWindowSize(
        MINI_WINDOW_COLLAPSED_SIZE.width,
        MINI_WINDOW_COLLAPSED_SIZE.height,
      ),
    ).toEqual(MINI_WINDOW_EXPANDED_SIZE);
    expect(getExpandedMiniWindowSize(220, 60)).toEqual(MINI_WINDOW_EXPANDED_SIZE);
    expect(
      getExpandedMiniWindowSize(MINI_WINDOW_EXPANDED_SIZE.width, MINI_WINDOW_EXPANDED_SIZE.height),
    ).toEqual(MINI_WINDOW_EXPANDED_SIZE);
  });

  it('keeps the expanded window inside the display work area', () => {
    expect(
      fitMiniWindowInWorkArea({ x: 1700, y: 1010 }, MINI_WINDOW_EXPANDED_SIZE, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      }),
    ).toEqual({
      x: 1920 - MINI_WINDOW_EXPANDED_SIZE.width,
      y: 1080 - MINI_WINDOW_EXPANDED_SIZE.height,
      ...MINI_WINDOW_EXPANDED_SIZE,
    });
  });

  it('detects every work-area edge with a separate release hysteresis', () => {
    const workArea = { x: 100, y: 40, width: 1200, height: 760 };
    const nearLeft = { x: workArea.x + 8, y: 200, ...MINI_WINDOW_EXPANDED_SIZE };
    const nearRight = {
      x: workArea.x + workArea.width - MINI_WINDOW_EXPANDED_SIZE.width - 6,
      y: 200,
      ...MINI_WINDOW_EXPANDED_SIZE,
    };
    const nearTop = { x: 400, y: workArea.y + 8, ...MINI_WINDOW_EXPANDED_SIZE };
    const nearBottom = {
      x: 400,
      y: workArea.y + workArea.height - MINI_WINDOW_EXPANDED_SIZE.height - 6,
      ...MINI_WINDOW_EXPANDED_SIZE,
    };
    expect(MINI_WINDOW_EDGE_SNAP_DISTANCE).toBeLessThan(MINI_WINDOW_EDGE_RELEASE_DISTANCE);
    expect(detectMiniWindowEdge(nearLeft, workArea)).toBe('left');
    expect(detectMiniWindowEdge(nearRight, workArea)).toBe('right');
    expect(detectMiniWindowEdge(nearTop, workArea)).toBe('top');
    expect(detectMiniWindowEdge(nearBottom, workArea)).toBe('bottom');
    expect(
      detectMiniWindowEdge({ x: 300, y: 200, ...MINI_WINDOW_EXPANDED_SIZE }, workArea),
    ).toBeNull();
    expect(getMiniWindowEdgeDistance(nearRight, workArea, 'right')).toBe(6);
  });

  it('keeps the contacted edge pinned when collapsing or expanding', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
    const expanded = {
      x: workArea.width - MINI_WINDOW_EXPANDED_SIZE.width,
      y: 240,
      ...MINI_WINDOW_EXPANDED_SIZE,
    };
    const collapsed = anchorMiniWindowToEdge(
      expanded,
      MINI_WINDOW_COLLAPSED_SIZE,
      workArea,
      'right',
    );
    const collapsedY = Math.round(
      expanded.y + (MINI_WINDOW_EXPANDED_SIZE.height - MINI_WINDOW_COLLAPSED_SIZE.height) / 2,
    );
    expect(collapsed).toEqual({
      x: workArea.width - MINI_WINDOW_COLLAPSED_SIZE.width,
      y: collapsedY,
      ...MINI_WINDOW_COLLAPSED_SIZE,
    });
    expect(anchorMiniWindowToEdge(collapsed, MINI_WINDOW_EXPANDED_SIZE, workArea, 'right')).toEqual(
      {
        ...expanded,
        y: Math.round(
          collapsedY + (MINI_WINDOW_COLLAPSED_SIZE.height - MINI_WINDOW_EXPANDED_SIZE.height) / 2,
        ),
      },
    );
  });

  it('keeps every edge inside a negative-coordinate secondary display', () => {
    const workArea = { x: -1920, y: -120, width: 1920, height: 1040 };
    const expanded = { x: -1180, y: 240, ...MINI_WINDOW_EXPANDED_SIZE };
    const expectedPinnedAxis = {
      left: workArea.x,
      right: workArea.x + workArea.width - MINI_WINDOW_COLLAPSED_SIZE.width,
      top: workArea.y,
      bottom: workArea.y + workArea.height - MINI_WINDOW_COLLAPSED_SIZE.height,
    };

    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      const anchored = anchorMiniWindowToEdge(expanded, MINI_WINDOW_COLLAPSED_SIZE, workArea, edge);
      if (edge === 'left' || edge === 'right') {
        expect(anchored.x).toBe(expectedPinnedAxis[edge]);
      } else {
        expect(anchored.y).toBe(expectedPinnedAxis[edge]);
      }
      expect(anchored.x).toBeGreaterThanOrEqual(workArea.x);
      expect(anchored.y).toBeGreaterThanOrEqual(workArea.y);
      expect(anchored.x + anchored.width).toBeLessThanOrEqual(workArea.x + workArea.width);
      expect(anchored.y + anchored.height).toBeLessThanOrEqual(workArea.y + workArea.height);
    }

    expect(
      fitMiniWindowInWorkArea(
        { x: workArea.x - 500, y: workArea.y - 500 },
        MINI_WINDOW_EXPANDED_SIZE,
        workArea,
      ),
    ).toEqual({ x: workArea.x, y: workArea.y, ...MINI_WINDOW_EXPANDED_SIZE });
  });

  it('resizes around its visual centre away from an edge', () => {
    const origin = { x: 500, y: 300, ...MINI_WINDOW_EXPANDED_SIZE };
    expect(
      resizeMiniWindowAroundCenter(origin, MINI_WINDOW_COLLAPSED_SIZE, {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
      }),
    ).toEqual({
      x: Math.round(
        origin.x + (MINI_WINDOW_EXPANDED_SIZE.width - MINI_WINDOW_COLLAPSED_SIZE.width) / 2,
      ),
      y: Math.round(
        origin.y + (MINI_WINDOW_EXPANDED_SIZE.height - MINI_WINDOW_COLLAPSED_SIZE.height) / 2,
      ),
      ...MINI_WINDOW_COLLAPSED_SIZE,
    });
  });
});

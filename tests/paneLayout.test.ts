import { describe, expect, it } from 'vitest';
import {
  LEFT_PANE_MAX,
  LEFT_PANE_MIN,
  PANE_DIVIDER_WIDTH,
  RIGHT_PANE_MIN,
  clampLeftPaneWidth,
  getDefaultLeftPaneWidth,
  getLeftPaneBounds,
} from '../src/lib/paneLayout';

describe('pane layout constraints', () => {
  it('allows dragging the divider to the right until the left pane max is reached', () => {
    const containerWidth = 1400;

    expect(clampLeftPaneWidth(containerWidth, 720)).toBe(LEFT_PANE_MAX);
  });

  it('allows dragging the divider to the left until the left pane min is reached', () => {
    const containerWidth = 1180;

    expect(clampLeftPaneWidth(containerWidth, 220)).toBe(LEFT_PANE_MIN);
  });

  it('preserves the right pane minimum by clamping oversized saved widths', () => {
    const containerWidth = 960;
    const width = clampLeftPaneWidth(containerWidth, 860);

    expect(width).toBe(containerWidth - RIGHT_PANE_MIN - PANE_DIVIDER_WIDTH);
    expect(containerWidth - width - PANE_DIVIDER_WIDTH).toBe(RIGHT_PANE_MIN);
  });

  it('computes the same bounds for restore, drag, and double-click defaults', () => {
    const containerWidth = 1180;
    const bounds = getLeftPaneBounds(containerWidth);
    const defaultWidth = getDefaultLeftPaneWidth(containerWidth);

    expect(bounds.minLeft).toBe(LEFT_PANE_MIN);
    expect(bounds.maxLeft).toBe(LEFT_PANE_MAX);
    expect(defaultWidth).toBeGreaterThanOrEqual(bounds.minLeft);
    expect(defaultWidth).toBeLessThanOrEqual(bounds.maxLeft);
  });
});

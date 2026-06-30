export const LEFT_PANE_MIN = 320;
export const LEFT_PANE_MAX = 560;
export const RIGHT_PANE_MIN = 360;
export const PANE_DIVIDER_WIDTH = 6;
export const DEFAULT_LEFT_PANE_RATIO = 0.46;

export interface PaneLayoutBounds {
  minLeft: number;
  maxLeft: number;
}

export function getLeftPaneBounds(containerWidth: number): PaneLayoutBounds {
  const maxByRightPane = containerWidth - RIGHT_PANE_MIN - PANE_DIVIDER_WIDTH;
  const maxLeft = Math.max(LEFT_PANE_MIN, Math.min(LEFT_PANE_MAX, maxByRightPane));
  return {
    minLeft: LEFT_PANE_MIN,
    maxLeft,
  };
}

export function clampLeftPaneWidth(containerWidth: number, desiredWidth: number): number {
  const { minLeft, maxLeft } = getLeftPaneBounds(containerWidth);
  return Math.max(minLeft, Math.min(maxLeft, desiredWidth));
}

export function getDefaultLeftPaneWidth(containerWidth: number): number {
  return clampLeftPaneWidth(containerWidth, Math.round(containerWidth * DEFAULT_LEFT_PANE_RATIO));
}

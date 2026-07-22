export type MiniWindowSize = {
  width: number;
  height: number;
};

export type MiniWindowBounds = MiniWindowSize & { x: number; y: number };
export type MiniWindowEdge = 'left' | 'right' | 'top' | 'bottom';
export type MiniWindowDockPlacement =
  MiniWindowEdge | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * The mini window deliberately has two product-owned sizes. Keeping these as
 * shared tokens prevents renderer, main-process bounds and tests from drifting.
 */
export const MINI_WINDOW_COLLAPSED_SIZE = { width: 184, height: 35 } as const;
export const MINI_WINDOW_EXPANDED_SIZE = { width: 256, height: 70 } as const;

/** Enter and leave distances are deliberately different to prevent edge jitter. */
export const MINI_WINDOW_EDGE_SNAP_DISTANCE = 14;
export const MINI_WINDOW_EDGE_RELEASE_DISTANCE = 30;

/**
 * The expanded console remains visible for this long after snapping so the
 * edge-collapse reads as an intentional transition instead of a disappearing
 * window. This is motion timing, not a third size preset.
 */
export const MINI_WINDOW_DOCK_TRANSITION_MS = 320;

export const MINI_WINDOW_SIZE_PRESETS = [
  MINI_WINDOW_COLLAPSED_SIZE,
  MINI_WINDOW_EXPANDED_SIZE,
] as const satisfies readonly MiniWindowSize[];

export const MINI_WINDOW_DEFAULT_SIZE = MINI_WINDOW_EXPANDED_SIZE;
export const MINI_WINDOW_COLLAPSED_HEIGHT = MINI_WINDOW_COLLAPSED_SIZE.height;

/** Windows and mixed-DPI displays may normalize programmatic bounds by a physical pixel. */
export function areMiniWindowBoundsClose(
  actual: MiniWindowBounds,
  expected: MiniWindowBounds,
  tolerance = 2,
): boolean {
  return (
    Math.abs(actual.x - expected.x) <= tolerance &&
    Math.abs(actual.y - expected.y) <= tolerance &&
    Math.abs(actual.width - expected.width) <= tolerance &&
    Math.abs(actual.height - expected.height) <= tolerance
  );
}

export function snapMiniWindowSize(width: number, height: number): MiniWindowSize {
  let best: MiniWindowSize = MINI_WINDOW_DEFAULT_SIZE;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const preset of MINI_WINDOW_SIZE_PRESETS) {
    const score = Math.abs(width - preset.width) * 1.1 + Math.abs(height - preset.height) * 1.8;
    if (score < bestScore) {
      best = preset;
      bestScore = score;
    }
  }
  return best;
}

export function getExpandedMiniWindowSize(width: number, height: number): MiniWindowSize {
  const snapped = snapMiniWindowSize(width, height);
  if (
    snapped.width === MINI_WINDOW_COLLAPSED_SIZE.width &&
    snapped.height === MINI_WINDOW_COLLAPSED_SIZE.height
  ) {
    return MINI_WINDOW_EXPANDED_SIZE;
  }
  return snapped;
}

export function fitMiniWindowInWorkArea(
  current: Pick<MiniWindowBounds, 'x' | 'y'>,
  target: MiniWindowSize,
  workArea: MiniWindowBounds,
): MiniWindowBounds {
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - target.width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - target.height);
  return {
    x: Math.min(Math.max(current.x, workArea.x), maxX),
    y: Math.min(Math.max(current.y, workArea.y), maxY),
    width: target.width,
    height: target.height,
  };
}

export function getMiniWindowEdgeDistance(
  bounds: MiniWindowBounds,
  workArea: MiniWindowBounds,
  edge: MiniWindowEdge,
): number {
  switch (edge) {
    case 'left':
      return Math.abs(bounds.x - workArea.x);
    case 'right':
      return Math.abs(bounds.x + bounds.width - (workArea.x + workArea.width));
    case 'top':
      return Math.abs(bounds.y - workArea.y);
    case 'bottom':
      return Math.abs(bounds.y + bounds.height - (workArea.y + workArea.height));
  }
}

export function detectMiniWindowEdge(
  bounds: MiniWindowBounds,
  workArea: MiniWindowBounds,
  threshold = MINI_WINDOW_EDGE_SNAP_DISTANCE,
): MiniWindowEdge | null {
  const candidates: MiniWindowEdge[] = ['left', 'right', 'top', 'bottom'];
  let nearest: MiniWindowEdge | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const edge of candidates) {
    const distance = getMiniWindowEdgeDistance(bounds, workArea, edge);
    if (distance <= threshold && distance < nearestDistance) {
      nearest = edge;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Resolve corners separately so a docked strip can stay pinned to both contacted edges. */
export function resolveMiniWindowDockPlacement(
  bounds: MiniWindowBounds,
  workArea: MiniWindowBounds,
  edge: MiniWindowEdge,
  threshold = MINI_WINDOW_EDGE_SNAP_DISTANCE,
): MiniWindowDockPlacement {
  const nearLeft = getMiniWindowEdgeDistance(bounds, workArea, 'left') <= threshold;
  const nearRight = getMiniWindowEdgeDistance(bounds, workArea, 'right') <= threshold;
  const nearTop = getMiniWindowEdgeDistance(bounds, workArea, 'top') <= threshold;
  const nearBottom = getMiniWindowEdgeDistance(bounds, workArea, 'bottom') <= threshold;

  if (nearTop && (edge === 'left' || nearLeft)) return 'top-left';
  if (nearTop && (edge === 'right' || nearRight)) return 'top-right';
  if (nearBottom && (edge === 'left' || nearLeft)) return 'bottom-left';
  if (nearBottom && (edge === 'right' || nearRight)) return 'bottom-right';
  return edge;
}

/** Resize around the current visual centre, then clamp into the active work area. */
export function resizeMiniWindowAroundCenter(
  current: MiniWindowBounds,
  target: MiniWindowSize,
  workArea: MiniWindowBounds,
): MiniWindowBounds {
  return fitMiniWindowInWorkArea(
    {
      x: Math.round(current.x + (current.width - target.width) / 2),
      y: Math.round(current.y + (current.height - target.height) / 2),
    },
    target,
    workArea,
  );
}

/** Keep the contacted edge pinned while the native window changes preset. */
export function anchorMiniWindowToEdge(
  current: MiniWindowBounds,
  target: MiniWindowSize,
  workArea: MiniWindowBounds,
  edge: MiniWindowEdge,
): MiniWindowBounds {
  const centered = resizeMiniWindowAroundCenter(current, target, workArea);
  switch (edge) {
    case 'left':
      return { ...centered, x: workArea.x };
    case 'right':
      return { ...centered, x: workArea.x + workArea.width - target.width };
    case 'top':
      return { ...centered, y: workArea.y };
    case 'bottom':
      return { ...centered, y: workArea.y + workArea.height - target.height };
  }
}

/** Keep a side or corner placement pinned while changing between the two presets. */
export function anchorMiniWindowToPlacement(
  current: MiniWindowBounds,
  target: MiniWindowSize,
  workArea: MiniWindowBounds,
  placement: MiniWindowDockPlacement,
): MiniWindowBounds {
  if (!placement.includes('-')) {
    return anchorMiniWindowToEdge(current, target, workArea, placement as MiniWindowEdge);
  }

  const centered = resizeMiniWindowAroundCenter(current, target, workArea);
  const left = workArea.x;
  const right = workArea.x + workArea.width - target.width;
  const top = workArea.y;
  const bottom = workArea.y + workArea.height - target.height;
  switch (placement) {
    case 'top-left':
      return { ...centered, x: left, y: top };
    case 'top-right':
      return { ...centered, x: right, y: top };
    case 'bottom-left':
      return { ...centered, x: left, y: bottom };
    case 'bottom-right':
      return { ...centered, x: right, y: bottom };
    default:
      return centered;
  }
}

export type MiniWindowSize = {
  width: number;
  height: number;
};

export const MINI_WINDOW_COLLAPSED_SIZE = { width: 260, height: 88 } as const;
export const MINI_WINDOW_EXPANDED_SIZE = { width: 420, height: 184 } as const;

export const MINI_WINDOW_SIZE_PRESETS = [
  MINI_WINDOW_COLLAPSED_SIZE,
  MINI_WINDOW_EXPANDED_SIZE,
] as const satisfies readonly MiniWindowSize[];

export const MINI_WINDOW_DEFAULT_SIZE = MINI_WINDOW_EXPANDED_SIZE;
export const MINI_WINDOW_COLLAPSED_HEIGHT = MINI_WINDOW_COLLAPSED_SIZE.height;

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

export type MiniWindowSize = {
  width: number;
  height: number;
};

export const MINI_WINDOW_SIZE_PRESETS = [
  { width: 260, height: 88 },
  { width: 320, height: 144 },
  { width: 420, height: 184 },
] as const satisfies readonly MiniWindowSize[];

export const MINI_WINDOW_DEFAULT_SIZE = MINI_WINDOW_SIZE_PRESETS[1];
export const MINI_WINDOW_COLLAPSED_HEIGHT = 40;

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

export function isMiniWindowCompact(
  width: number,
  height: number,
  collapsed: boolean,
): boolean {
  return !collapsed && (width < 276 || height < 112);
}

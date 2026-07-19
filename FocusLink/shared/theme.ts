import type { AppSettings } from './types';

// Theme families were an experimental visual branch. Runtime rendering now has one
// FocusLink design language; the legacy setting is accepted only for migration.
export const THEME_FAMILIES = ['quiet'] as const satisfies readonly AppSettings['themeFamily'][];

export const FONT_PROFILES = [
  'noto',
  'misans',
  'wenkai',
] as const satisfies readonly AppSettings['fontProfile'][];

export const TIMER_STYLES = [
  'standard',
  'flip',
  'pixel',
  'thin',
  'segment',
] as const satisfies readonly AppSettings['timerStyle'][];

/** 旧计时样式值：仅用于清理遗留根类与设置迁移，不再是可选项。 */
export const LEGACY_TIMER_STYLES = ['editorial', 'digital', 'mono'] as const;

/** 专注强调色跨色相五选：只映射专注语义（--app-success），不触碰界面蓝与暂停红。 */
export const FOCUS_COLORS = [
  'emerald',
  'cobalt',
  'violet',
  'amber',
  'graphite',
] as const satisfies readonly AppSettings['focusColor'][];

export function resolveThemeFamily(value: unknown): AppSettings['themeFamily'] {
  void value;
  return 'quiet';
}

export function resolveFontProfile(value: unknown): AppSettings['fontProfile'] {
  if (FONT_PROFILES.includes(value as AppSettings['fontProfile'])) {
    return value as AppSettings['fontProfile'];
  }
  if (value === 'geist' || value === 'plex' || value === 'manrope' || value === 'sora') {
    return 'noto';
  }
  return 'noto';
}

/**
 * 计时仪表样式解析与旧值迁移：
 * - editorial → thin（极细编辑）
 * - digital → pixel（像素点阵）
 * - mono → standard（标准等宽）
 * 未知值一律回落 standard。
 */
export function resolveTimerStyle(value: unknown): AppSettings['timerStyle'] {
  if (TIMER_STYLES.includes(value as AppSettings['timerStyle'])) {
    return value as AppSettings['timerStyle'];
  }
  if (value === 'editorial') return 'thin';
  if (value === 'digital') return 'pixel';
  if (value === 'mono') return 'standard';
  return 'standard';
}

/** 专注强调色解析：未知值一律回落 emerald。 */
export function resolveFocusColor(value: unknown): AppSettings['focusColor'] {
  if (value === 'forest' || value === 'mint') return 'emerald';
  if (value === 'teal') return 'cobalt';
  return FOCUS_COLORS.includes(value as AppSettings['focusColor'])
    ? (value as AppSettings['focusColor'])
    : 'emerald';
}

export function resolveThemeAppearance(
  value: AppSettings['theme'],
  prefersDark: boolean,
): 'light' | 'dark' {
  return value === 'system' ? (prefersDark ? 'dark' : 'light') : value;
}

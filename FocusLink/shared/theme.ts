import type { AppSettings } from './types';

// Theme families were an experimental visual branch. Runtime rendering now has one
// FocusLink design language; the legacy setting is accepted only for migration.
export const THEME_FAMILIES = ['quiet'] as const satisfies readonly AppSettings['themeFamily'][];

// 旧排版气质字段已废弃：单一字体系统（Geist + MiSans + JetBrains Mono +
// Inter Tight + Oswald），仅保留解析以免旧设置启动报错。
export const FONT_PROFILES = [
  'plex',
  'geist',
  'manrope',
  'sora',
] as const satisfies readonly AppSettings['fontProfile'][];

export const TIMER_STYLES = [
  'standard',
  'flip',
  'pixel',
  'thin',
] as const satisfies readonly AppSettings['timerStyle'][];

/** 旧计时样式值：仅用于清理遗留根类与设置迁移，不再是可选项。 */
export const LEGACY_TIMER_STYLES = ['editorial', 'digital', 'mono'] as const;

/** 专注强调色四选：只映射专注语义（--app-success），不触碰界面蓝与暂停红。 */
export const FOCUS_COLORS = [
  'emerald',
  'forest',
  'mint',
  'teal',
] as const satisfies readonly AppSettings['focusColor'][];

export function resolveThemeFamily(value: unknown): AppSettings['themeFamily'] {
  void value;
  return 'quiet';
}

export function resolveFontProfile(value: unknown): AppSettings['fontProfile'] {
  return FONT_PROFILES.includes(value as AppSettings['fontProfile'])
    ? (value as AppSettings['fontProfile'])
    : 'plex';
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

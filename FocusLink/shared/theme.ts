import type { AppSettings } from './types';

// Theme families were an experimental visual branch. Runtime rendering now has one
// FocusLink design language; the legacy setting is accepted only for migration.
export const THEME_FAMILIES = ['quiet'] as const satisfies readonly AppSettings['themeFamily'][];

export const FONT_PROFILES = [
  'plex',
  'geist',
  'manrope',
  'sora',
] as const satisfies readonly AppSettings['fontProfile'][];

export function resolveThemeFamily(value: unknown): AppSettings['themeFamily'] {
  void value;
  return 'quiet';
}

export function resolveFontProfile(value: unknown): AppSettings['fontProfile'] {
  return FONT_PROFILES.includes(value as AppSettings['fontProfile'])
    ? (value as AppSettings['fontProfile'])
    : 'plex';
}

export function resolveThemeAppearance(
  value: AppSettings['theme'],
  prefersDark: boolean,
): 'light' | 'dark' {
  return value === 'system' ? (prefersDark ? 'dark' : 'light') : value;
}

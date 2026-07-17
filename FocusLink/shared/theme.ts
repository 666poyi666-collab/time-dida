import type { AppSettings } from './types';

export const THEME_FAMILIES = [
  'quiet',
  'dawn',
  'bloom',
] as const satisfies readonly AppSettings['themeFamily'][];

export function resolveThemeFamily(value: unknown): AppSettings['themeFamily'] {
  return THEME_FAMILIES.includes(value as AppSettings['themeFamily'])
    ? (value as AppSettings['themeFamily'])
    : 'quiet';
}

export function resolveThemeAppearance(
  value: AppSettings['theme'],
  prefersDark: boolean,
): 'light' | 'dark' {
  return value === 'system' ? (prefersDark ? 'dark' : 'light') : value;
}

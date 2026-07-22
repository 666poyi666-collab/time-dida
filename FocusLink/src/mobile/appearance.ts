import {
  FOCUS_COLORS,
  FONT_PROFILES,
  resolveFocusColor,
  resolveFontProfile,
  resolveThemeAppearance,
} from '@shared/theme';

export { FOCUS_COLORS, FONT_PROFILES } from '@shared/theme';

export type MobileAppearance = {
  theme: 'light' | 'dark' | 'system';
  focusColor: (typeof FOCUS_COLORS)[number];
  fontProfile: (typeof FONT_PROFILES)[number];
};

const STORAGE_KEY = 'focuslink.mobile.appearance.v1';

export const DEFAULT_MOBILE_APPEARANCE: MobileAppearance = {
  theme: 'light',
  focusColor: 'emerald',
  fontProfile: 'noto',
};

export function loadMobileAppearance(): MobileAppearance {
  if (typeof localStorage === 'undefined') return DEFAULT_MOBILE_APPEARANCE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MOBILE_APPEARANCE;
    const value = JSON.parse(raw) as Partial<MobileAppearance>;
    return normalizeMobileAppearance(value);
  } catch {
    return DEFAULT_MOBILE_APPEARANCE;
  }
}

export function saveMobileAppearance(value: MobileAppearance): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeMobileAppearance(value)));
}

/** Apply the same theme/focus/font classes used by the desktop renderer. */
export function applyMobileAppearance(value: MobileAppearance): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const normalized = normalizeMobileAppearance(value);
  const effectiveTheme = resolveThemeAppearance(normalized.theme, prefersDark);
  root.classList.toggle('dark', effectiveTheme === 'dark');
  root.classList.toggle('light', effectiveTheme === 'light');
  FOCUS_COLORS.forEach((color) => root.classList.remove(`focus-color-${color}`));
  FONT_PROFILES.forEach((profile) => root.classList.remove(`font-profile-${profile}`));
  root.classList.add(`focus-color-${normalized.focusColor}`);
  root.classList.add(`font-profile-${normalized.fontProfile}`);
  root.dataset.mobileTheme = normalized.theme;
  root.dataset.mobileFocusColor = normalized.focusColor;
  root.dataset.mobileFontProfile = normalized.fontProfile;
}

export function normalizeMobileAppearance(value: Partial<MobileAppearance>): MobileAppearance {
  const theme = value.theme === 'dark' || value.theme === 'system' ? value.theme : 'light';
  return {
    theme,
    focusColor: resolveFocusColor(value.focusColor ?? DEFAULT_MOBILE_APPEARANCE.focusColor),
    fontProfile: resolveFontProfile(value.fontProfile ?? DEFAULT_MOBILE_APPEARANCE.fontProfile),
  };
}

export const MOBILE_THEME_LABELS: Record<MobileAppearance['theme'], string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

export const MOBILE_FOCUS_LABELS: Record<MobileAppearance['focusColor'], string> = {
  emerald: '翡翠绿',
  cobalt: '钴蓝',
  violet: '紫罗兰',
  amber: '琥珀',
  graphite: '石墨',
};

export const MOBILE_FONT_LABELS: Record<MobileAppearance['fontProfile'], string> = {
  noto: '思源黑体',
  wenkai: '霞鹜文楷',
  zhisong: '霞鹜新致宋',
  marker: '霞鹜漫黑',
  xihei: '霞鹜新晰黑',
  smiley: '得意黑',
};

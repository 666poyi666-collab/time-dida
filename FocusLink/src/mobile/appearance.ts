import {
  FOCUS_COLORS,
  FONT_PROFILES,
  TIMER_STYLES,
  resolveFocusColor,
  resolveFontProfile,
  resolveTimerStyle,
  resolveThemeAppearance,
} from '@shared/theme';

export { FOCUS_COLORS, FONT_PROFILES, TIMER_STYLES } from '@shared/theme';

export type MobileAppearance = {
  theme: 'light' | 'dark' | 'system';
  focusColor: (typeof FOCUS_COLORS)[number];
  fontProfile: (typeof FONT_PROFILES)[number];
  timerStyle: (typeof TIMER_STYLES)[number];
};

const STORAGE_KEY = 'focuslink.mobile.appearance.v1';

export const DEFAULT_MOBILE_APPEARANCE: MobileAppearance = {
  theme: 'light',
  focusColor: 'emerald',
  fontProfile: 'wenkai',
  timerStyle: 'standard',
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

/** Apply the same theme/focus/font/timer classes used by the desktop renderer. */
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
  TIMER_STYLES.forEach((style) => root.classList.remove(`timer-style-${style}`));
  root.classList.add(`focus-color-${normalized.focusColor}`);
  root.classList.add(`font-profile-${normalized.fontProfile}`);
  root.classList.add(`timer-style-${normalized.timerStyle}`);
  root.dataset.mobileTheme = normalized.theme;
  root.dataset.mobileFocusColor = normalized.focusColor;
  root.dataset.mobileFontProfile = normalized.fontProfile;
  root.dataset.mobileTimerStyle = normalized.timerStyle;
}

/**
 * Live `system` theme: re-apply the appearance whenever the OS color scheme
 * changes so a device left in 跟随系统 tracks the current system theme without
 * a reload. Both the modern addEventListener path and the legacy addListener
 * path register so Capacitor WebView versions never silently drop the listener.
 */
export function watchMobileSystemTheme(
  apply: (value: MobileAppearance) => void,
  value: MobileAppearance,
): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  if (normalizeMobileAppearance(value).theme !== 'system') return () => undefined;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => apply(normalizeMobileAppearance(value));
  query.addEventListener?.('change', handleChange);
  query.addListener?.(handleChange);
  return () => {
    query.removeEventListener?.('change', handleChange);
    query.removeListener?.(handleChange);
  };
}

export function normalizeMobileAppearance(value: Partial<MobileAppearance>): MobileAppearance {
  const theme = value.theme === 'dark' || value.theme === 'system' ? value.theme : 'light';
  return {
    theme,
    focusColor: resolveFocusColor(value.focusColor ?? DEFAULT_MOBILE_APPEARANCE.focusColor),
    fontProfile: resolveFontProfile(value.fontProfile ?? DEFAULT_MOBILE_APPEARANCE.fontProfile),
    timerStyle: resolveTimerStyle(value.timerStyle ?? DEFAULT_MOBILE_APPEARANCE.timerStyle),
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

export const MOBILE_TIMER_LABELS: Record<MobileAppearance['timerStyle'], string> = {
  standard: '标准等宽',
  flip: '翻页机械',
  pixel: '像素点阵',
  thin: '高反差编辑',
  segment: '七段数码',
  counter: '滚筒计数器',
  analog: '指针表圈',
  vernier: '游标标尺',
  draft: '制图描线',
};

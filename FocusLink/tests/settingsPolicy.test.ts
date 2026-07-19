import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/types';
import type { AppSettings } from '../shared/types';
import { MINI_WINDOW_EXPANDED_SIZE } from '../shared/miniWindowLayout';
import {
  detectSettingsChangedDomains,
  mergeSettings,
  resolveTickTickTaskProvider,
} from '../shared/settingsPolicy';
import {
  FOCUS_COLORS,
  TIMER_STYLES,
  resolveFocusColor,
  resolveThemeAppearance,
  resolveThemeFamily,
} from '../shared/theme';

describe('settings partial update policy', () => {
  it('preserves the full settings object when the task drawer only changes taskSource', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { taskSource: 'ticktick-cli' });

    expect(next.taskSource).toBe('ticktick-cli');
    expect(next.themeFamily).toBe('quiet');
    expect(next.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(next.hotkeys).toEqual(DEFAULT_SETTINGS.hotkeys);
    expect(next.miniWindow).toEqual(DEFAULT_SETTINGS.miniWindow);
    expect(next.tomatodo).toEqual(DEFAULT_SETTINGS.tomatodo);
  });

  it('deep-merges a nested branch without erasing sibling fields', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, {
      tomatodo: { enabled: true },
      miniWindow: { opacity: 0.8 },
    });

    expect(next.tomatodo).toEqual({
      ...DEFAULT_SETTINGS.tomatodo,
      enabled: true,
    });
    expect(next.miniWindow.opacity).toBe(0.8);
    expect(next.miniWindow.width).toBe(MINI_WINDOW_EXPANDED_SIZE.width);
    expect(next.miniWindow.height).toBe(MINI_WINDOW_EXPANDED_SIZE.height);
  });

  it('adds the new font default to legacy settings and preserves explicit choices', () => {
    const legacySettings = { ...DEFAULT_SETTINGS } as Partial<AppSettings>;
    delete legacySettings.fontProfile;
    const migrated = mergeSettings(DEFAULT_SETTINGS, legacySettings);
    const chosen = mergeSettings(migrated, { fontProfile: 'wenkai' });

    expect(migrated.fontProfile).toBe('noto');
    expect(chosen.fontProfile).toBe('wenkai');
    expect(mergeSettings(chosen, { theme: 'dark' }).fontProfile).toBe('wenkai');
  });

  it('routes a font-only update through the theme domain without unrelated side effects', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { fontProfile: 'misans' });

    expect(detectSettingsChangedDomains(DEFAULT_SETTINGS, next)).toEqual(['theme']);
  });

  it('routes focus color and timer style through the theme domain', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { focusColor: 'violet', timerStyle: 'pixel' });

    expect(detectSettingsChangedDomains(DEFAULT_SETTINGS, next)).toEqual(['theme']);
  });

  it('adds the single-theme defaults to legacy settings and preserves appearance changes', () => {
    const legacySettings = { ...DEFAULT_SETTINGS } as Partial<AppSettings>;
    delete legacySettings.themeFamily;
    const migrated = mergeSettings(DEFAULT_SETTINGS, legacySettings);
    const system = mergeSettings(migrated, { themeFamily: 'dawn', theme: 'system' });

    expect(migrated.themeFamily).toBe('quiet');
    expect(migrated.theme).toBe('light');
    expect(detectSettingsChangedDomains(migrated, system)).toEqual(['theme']);
  });
});

describe('专注色与计时仪表样式的保存恢复', () => {
  it('专注色保存后跨无关更新恢复，跨色相专注色全部往返', () => {
    for (const color of FOCUS_COLORS) {
      const saved = mergeSettings(DEFAULT_SETTINGS, { focusColor: color });
      expect(saved.focusColor).toBe(color);
      const restored = mergeSettings(saved, { taskSource: 'local' });
      expect(restored.focusColor).toBe(color);
    }
  });

  it('旧设置缺 focusColor 时回落默认；未知值解析回落 emerald', () => {
    const legacy = { ...DEFAULT_SETTINGS } as Partial<AppSettings>;
    delete legacy.focusColor;
    expect(mergeSettings(DEFAULT_SETTINGS, legacy).focusColor).toBe('emerald');
    expect(resolveFocusColor('neon')).toBe('emerald');
    expect(resolveFocusColor(undefined)).toBe('emerald');
    expect(resolveFocusColor(null)).toBe('emerald');
    for (const color of FOCUS_COLORS) {
      expect(resolveFocusColor(color)).toBe(color);
    }
  });

  it('计时仪表样式保存后跨无关更新恢复，全部样式均可往返', () => {
    for (const style of TIMER_STYLES) {
      const saved = mergeSettings(DEFAULT_SETTINGS, { timerStyle: style });
      expect(saved.timerStyle).toBe(style);
      const restored = mergeSettings(saved, { theme: 'dark' });
      expect(restored.timerStyle).toBe(style);
    }
  });

  it('旧设置缺 timerStyle 时回落 standard', () => {
    const legacy = { ...DEFAULT_SETTINGS } as Partial<AppSettings>;
    delete legacy.timerStyle;
    expect(mergeSettings(DEFAULT_SETTINGS, legacy).timerStyle).toBe('standard');
  });
});

describe('cloud task provider policy', () => {
  it('does not strand an existing dida task when the browsing source is local', () => {
    expect(resolveTickTickTaskProvider('local', { cli: true, oauth: false })).toBe('dida-cli');
    expect(resolveTickTickTaskProvider('local', { cli: false, oauth: true })).toBe(
      'ticktick-oauth',
    );
  });

  it('respects an explicit cloud provider and reports unavailable providers', () => {
    expect(resolveTickTickTaskProvider('ticktick-cli', { cli: true, oauth: true })).toBe(
      'dida-cli',
    );
    expect(resolveTickTickTaskProvider('ticktick-oauth', { cli: true, oauth: true })).toBe(
      'ticktick-oauth',
    );
    expect(resolveTickTickTaskProvider('ticktick-cli', { cli: false, oauth: true })).toBeNull();
  });
});

describe('theme compatibility policy', () => {
  it('defaults unknown families to quiet and resolves system appearance', () => {
    expect(resolveThemeFamily(undefined)).toBe('quiet');
    expect(resolveThemeFamily('bloom')).toBe('quiet');
    expect(resolveThemeAppearance('system', false)).toBe('light');
    expect(resolveThemeAppearance('system', true)).toBe('dark');
  });
});

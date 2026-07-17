import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/types';
import type { AppSettings } from '../shared/types';
import { MINI_WINDOW_EXPANDED_SIZE } from '../shared/miniWindowLayout';
import {
  detectSettingsChangedDomains,
  mergeSettings,
  resolveTickTickTaskProvider,
} from '../shared/settingsPolicy';
import { resolveThemeAppearance, resolveThemeFamily } from '../shared/theme';

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
    const chosen = mergeSettings(migrated, { fontProfile: 'manrope' });

    expect(migrated.fontProfile).toBe('geist');
    expect(chosen.fontProfile).toBe('manrope');
    expect(mergeSettings(chosen, { theme: 'dark' }).fontProfile).toBe('manrope');
  });

  it('routes a font-only update through the theme domain without unrelated side effects', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { fontProfile: 'manrope' });

    expect(detectSettingsChangedDomains(DEFAULT_SETTINGS, next)).toEqual(['theme']);
  });

  it('adds the quiet light theme defaults to legacy settings and routes family changes', () => {
    const legacySettings = { ...DEFAULT_SETTINGS } as Partial<AppSettings>;
    delete legacySettings.themeFamily;
    const migrated = mergeSettings(DEFAULT_SETTINGS, legacySettings);
    const dawn = mergeSettings(migrated, { themeFamily: 'dawn', theme: 'system' });

    expect(migrated.themeFamily).toBe('quiet');
    expect(migrated.theme).toBe('light');
    expect(detectSettingsChangedDomains(migrated, dawn)).toEqual(['theme']);
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
    expect(resolveThemeFamily('bloom')).toBe('bloom');
    expect(resolveThemeAppearance('system', false)).toBe('light');
    expect(resolveThemeAppearance('system', true)).toBe('dark');
  });
});

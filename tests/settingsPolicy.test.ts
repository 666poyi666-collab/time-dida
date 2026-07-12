import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/types';
import { mergeSettings, resolveTickTickTaskProvider } from '../shared/settingsPolicy';

describe('settings partial update policy', () => {
  it('preserves the full settings object when the task drawer only changes taskSource', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { taskSource: 'ticktick-cli' });

    expect(next.taskSource).toBe('ticktick-cli');
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
    expect(next.miniWindow.width).toBe(256);
    expect(next.miniWindow.height).toBe(92);
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

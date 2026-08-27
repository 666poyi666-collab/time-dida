import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MOBILE_APPEARANCE,
  normalizeMobileAppearance,
  type MobileAppearance,
} from '../src/mobile/appearance';

describe('mobile appearance', () => {
  it('normalizes the same theme, font and focus choices as desktop settings', () => {
    expect(
      normalizeMobileAppearance({
        theme: 'dark',
        focusColor: 'violet',
        fontProfile: 'smiley',
        timerStyle: 'segment',
      }),
    ).toEqual({
      theme: 'dark',
      focusColor: 'violet',
      fontProfile: 'smiley',
      timerStyle: 'segment',
    });
    expect(
      normalizeMobileAppearance({ theme: 'invalid' as never, focusColor: 'teal' as never }),
    ).toEqual({ ...DEFAULT_MOBILE_APPEARANCE, focusColor: 'cobalt' });
  });

  it('registers and tears down the live system theme listener only for the system theme', async () => {
    const { watchMobileSystemTheme } = await import('../src/mobile/appearance');
    const apply = vi.fn();
    const handlers: Array<() => void> = [];
    const query = {
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn((handler: () => void) => handlers.push(handler)),
      removeListener: vi.fn(() => undefined),
      addEventListener: vi.fn((_type: string, handler: () => void) => handlers.push(handler)),
      removeEventListener: vi.fn(() => undefined),
      dispatchEvent: vi.fn(() => false),
    };
    vi.stubGlobal('window', { matchMedia: vi.fn().mockReturnValue(query) });

    const theme: MobileAppearance = {
      theme: 'system',
      focusColor: 'emerald',
      fontProfile: 'noto',
      timerStyle: 'standard',
    };
    const none = watchMobileSystemTheme(apply, { ...theme, theme: 'light' });
    expect(query.addEventListener).not.toHaveBeenCalled();
    expect(query.addListener).not.toHaveBeenCalled();
    none();

    const dispose = watchMobileSystemTheme(apply, theme);
    expect(query.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(query.addListener).toHaveBeenCalledWith(expect.any(Function));
    expect(handlers).toHaveLength(2);
    for (const handler of handlers) handler();
    expect(apply).toHaveBeenCalledWith(theme);

    dispose();
    expect(query.removeEventListener).toHaveBeenCalled();
    expect(query.removeListener).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('guards the live system theme listener when matchMedia is unavailable', async () => {
    const { watchMobileSystemTheme } = await import('../src/mobile/appearance');
    vi.stubGlobal('window', undefined);
    const theme: MobileAppearance = {
      theme: 'system',
      focusColor: 'emerald',
      fontProfile: 'noto',
      timerStyle: 'standard',
    };
    const dispose = watchMobileSystemTheme(vi.fn(), theme);
    expect(() => dispose()).not.toThrow();
    vi.unstubAllGlobals();
  });

  it('applies shared root classes and data attributes', async () => {
    const { applyMobileAppearance } = await import('../src/mobile/appearance');
    const appearance: MobileAppearance = {
      theme: 'dark',
      focusColor: 'amber',
      fontProfile: 'wenkai',
      timerStyle: 'analog',
    };
    const classes = new Set<string>();
    const root = {
      classList: {
        toggle: (name: string, enabled: boolean) => {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
        remove: (name: string) => classes.delete(name),
        add: (name: string) => classes.add(name),
      },
      dataset: {} as Record<string, string>,
    };
    vi.stubGlobal('document', { documentElement: root });
    const matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    });
    vi.stubGlobal('window', { matchMedia });
    applyMobileAppearance(appearance);
    expect(classes.has('dark')).toBe(true);
    expect(classes.has('focus-color-amber')).toBe(true);
    expect(classes.has('font-profile-wenkai')).toBe(true);
    expect(classes.has('timer-style-analog')).toBe(true);
    expect(root.dataset.mobileTheme).toBe('dark');
    expect(root.dataset.mobileTimerStyle).toBe('analog');
    vi.unstubAllGlobals();
  });
});

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
      }),
    ).toEqual({ theme: 'dark', focusColor: 'violet', fontProfile: 'smiley' });
    expect(
      normalizeMobileAppearance({ theme: 'invalid' as never, focusColor: 'teal' as never }),
    ).toEqual({ ...DEFAULT_MOBILE_APPEARANCE, focusColor: 'cobalt' });
  });

  it('applies shared root classes and data attributes', async () => {
    const { applyMobileAppearance } = await import('../src/mobile/appearance');
    const appearance: MobileAppearance = {
      theme: 'dark',
      focusColor: 'amber',
      fontProfile: 'wenkai',
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
    expect(root.dataset.mobileTheme).toBe('dark');
    vi.unstubAllGlobals();
  });
});

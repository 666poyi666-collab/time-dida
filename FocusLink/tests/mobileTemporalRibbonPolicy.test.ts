import { describe, expect, it } from 'vitest';
import {
  MOBILE_RIBBON_MAX_SPAN_MS,
  MOBILE_RIBBON_MIN_SPAN_MS,
  MOBILE_RIBBON_SPAN_HEADROOM,
  mobileRibbonFillRatio,
  mobileRibbonSpanMs,
  mobileRibbonTickMs,
} from '../src/mobile/MobileTemporalRibbon';

/**
 * Mobile temporal ribbon view-window contract. The device gate requires the
 * running/paused 时间之带 not to fill up during the first minute and to keep
 * readable ticks; this test locks the deterministic policy the canvas uses.
 */
describe('mobile temporal ribbon view policy', () => {
  it('keeps the first minute at most two-thirds full', () => {
    for (const seconds of [0, 10, 30, 45, 59, 60]) {
      const elapsed = seconds * 1_000;
      const span = mobileRibbonSpanMs(elapsed);
      expect(
        mobileRibbonFillRatio(elapsed, span),
        `first minute (${seconds}s) must not fill the band`,
      ).toBeLessThanOrEqual(2 / 3);
    }
  });

  it('shows the full elapsed span plus headroom and never below the floor', () => {
    expect(mobileRibbonSpanMs(0)).toBe(MOBILE_RIBBON_MIN_SPAN_MS);
    expect(mobileRibbonSpanMs(60_000)).toBe(MOBILE_RIBBON_MIN_SPAN_MS);
    // 90s elapsed -> 1.12 headroom pushes the window open past the floor.
    const ninety = mobileRibbonSpanMs(90_000);
    expect(ninety).toBeGreaterThan(MOBILE_RIBBON_MIN_SPAN_MS);
    expect(ninety).toBeCloseTo(90_000 * MOBILE_RIBBON_SPAN_HEADROOM, 0);
    // Every elapsed value below the 30-minute cap still fits inside its window.
    for (const seconds of [5, 61, 180, 600, 1500]) {
      const elapsed = seconds * 1_000;
      expect(mobileRibbonSpanMs(elapsed)).toBeGreaterThanOrEqual(elapsed);
    }
  });

  it('caps very long sessions at 30 minutes', () => {
    expect(mobileRibbonSpanMs(60 * 60_000)).toBe(MOBILE_RIBBON_MAX_SPAN_MS);
    expect(mobileRibbonSpanMs(10 * 60 * 60_000)).toBe(MOBILE_RIBBON_MAX_SPAN_MS);
  });

  it('keeps readable ticks inside the first-minute window on a phone canvas', () => {
    const span = mobileRibbonSpanMs(60_000);
    const tick = mobileRibbonTickMs(span);
    expect(tick).toBe(10_000);
    const usableWidth = 360 - 16; // 360px phone canvas with 8px side insets
    const spacingPx = (usableWidth * tick) / span;
    expect(spacingPx).toBeGreaterThanOrEqual(38);
  });

  it('ladders grid steps: 10s <= 2min, 60s <= 10min, 5min beyond', () => {
    expect(mobileRibbonTickMs(2 * 60_000)).toBe(10_000);
    expect(mobileRibbonTickMs(10 * 60_000)).toBe(60_000);
    expect(mobileRibbonTickMs(10 * 60_000 + 1)).toBe(5 * 60_000);
    expect(mobileRibbonTickMs(25 * 60_000)).toBe(5 * 60_000);
  });
});

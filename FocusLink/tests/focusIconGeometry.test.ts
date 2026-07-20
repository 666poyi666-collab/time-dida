import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  FOCUS_CORE_GLYPHS,
  FocusBrandGlyph,
  FocusGlyph,
  resolveFocusOpticalSize,
  resolveFocusStroke,
} from '../src/ui/icons/FocusGlyph';

describe('FocusLink icon geometry', () => {
  it('uses dedicated 12/16/20 optical drawings for compact controls', () => {
    expect(resolveFocusOpticalSize(12)).toBe(12);
    expect(resolveFocusOpticalSize(14)).toBe(16);
    expect(resolveFocusOpticalSize(20)).toBe(20);
    expect(resolveFocusStroke(12)).toBeGreaterThan(resolveFocusStroke(20));
  });

  it('contains every mini-window control glyph', () => {
    expect(FOCUS_CORE_GLYPHS).toEqual(
      expect.arrayContaining(['play', 'pause', 'stop', 'expand', 'collapse', 'main-window']),
    );
  });

  it('renders normalized decorative SVG markup', () => {
    const markup = renderToStaticMarkup(createElement(FocusGlyph, { glyph: 'expand', size: 12 }));
    expect(markup).toContain('viewBox="0 0 20 20"');
    expect(markup).toContain('data-focus-glyph="expand"');
    expect(markup).toContain('data-optical-size="12"');
    expect(markup).toContain('aria-hidden="true"');
  });

  it('keeps the product mark as two woven F/L time ribbons', () => {
    const markup = renderToStaticMarkup(createElement(FocusBrandGlyph));
    expect(markup).toContain('brand-mark-f');
    expect(markup).toContain('brand-mark-l');
    expect(markup).toContain('brand-mark-cross');
    expect(markup).not.toContain('brand-mark-track');
  });
});

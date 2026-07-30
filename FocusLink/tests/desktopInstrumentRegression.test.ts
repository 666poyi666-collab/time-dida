import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop instrument visual regression contract', () => {
  it('keeps the green focus material on the continuous frosted path without caterpillar particles', () => {
    const source = readFileSync(resolve('src/features/focus/TemporalRibbon.tsx'), 'utf8');
    const focusSection = source.slice(
      source.indexOf('function drawFocusMaterial('),
      source.indexOf('/* ─── 暂停：疤痕 + 前沿消散'),
    );

    expect(focusSection).toContain('drawFrostedFocusRibbon');
    expect(focusSection).toContain('保持上下沿完全平直');
    expect(focusSection).not.toMatch(/pauseFrontierDissolveParticles|traceResidueDot|\.arc\(/);
  });

  it('keeps the packaged UI smoke fail-closed on all nine preview bounds', () => {
    const smoke = readFileSync(resolve('scripts/smoke/ui-state-smoke.cjs'), 'utf8');

    expect(smoke).toContain("document.querySelector('.stats-ledger-chart')");
    expect(smoke).toContain("document.querySelector('.stats-time-donut')");
    expect(smoke).not.toContain('.stats-timeline-detail');
    expect(smoke).not.toContain('.stats-focus-gauge');
    expect(smoke).toContain('previewCount === 9');
    expect(smoke).toContain('previewBounds.every((preview) => preview.inside)');
    expect(smoke).toContain('all nine timer instrument previews fit completely inside');
  });

  it('keeps the dashboard compact before the 1240px two-rail threshold and motion-reduced', () => {
    const styles = readFileSync(resolve('src/styles/linear-workbench.css'), 'utf8');

    expect(styles).toContain('@media (max-width: 1239px)');
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.stats-time-donut \.segment/,
    );
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.stats-day-column/);
  });
});

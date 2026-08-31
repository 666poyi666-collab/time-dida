import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewportScreenshotSource = fs.readFileSync(
  path.join(projectRoot, 'scripts', 'regression', 'mobile-viewport-screenshot.ts'),
  'utf8',
);
const mobile13Source = fs.readFileSync(
  path.join(projectRoot, 'src', 'mobile', 'mobile-1-3.css'),
  'utf8',
);

function compactCss(file: string): string {
  return fs
    .readFileSync(path.join(projectRoot, 'src', 'mobile', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
}

describe('phone, tablet and watch responsive style contract', () => {
  it('keeps the complete eight-digit watch clock and both actions inside the viewport', () => {
    const css = compactCss('watch.css');

    expect(css).toMatch(/\.watch-main\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.watch-clock-cell\s*\{[^}]*overflow:\s*hidden[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.watch-clock\s*\{[^}]*font-size:\s*min\(68px,\s*17\.5vw,\s*22vh\)/);
    expect(css).toMatch(
      /\.watch-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(/\.watch-actions > :only-child\s*\{[^}]*grid-column:\s*1 \/ -1/);
    expect(css).toMatch(/\.watch-actions button\s*\{[^}]*min-width:\s*0/);
  });

  it('wraps phone sync failures and expands tablet runtime facts instead of ellipsizing them', () => {
    const css = compactCss('mobile.css');

    expect(css).toMatch(
      /@media \(max-width:\s*619px\)[\s\S]*?\.sync-copy span\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*text-overflow:\s*clip[^}]*white-space:\s*normal/,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*620px\)[\s\S]*?\.runtime-facts dd\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*text-overflow:\s*clip[^}]*white-space:\s*normal/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*480px\)[\s\S]*?\.focus-actions\s*\{[^}]*margin-right:\s*calc\(-1 \* max\(14px,[^}]*margin-left:\s*calc\(-1 \* max\(14px/,
    );
  });

  it('uses the real 640 CSS-pixel tablet layout and keeps cloud pairing in the sticky action row', () => {
    const css = compactCss('mobile.css');
    const consoleSource = fs.readFileSync(
      path.join(projectRoot, 'src', 'mobile', 'FocusConsole.tsx'),
      'utf8',
    );

    expect(css).toMatch(
      /@media \(min-width:\s*620px\)[\s\S]*?\.app-frame\s*\{[^}]*grid-template-columns:\s*80px minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*620px\)[\s\S]*?\.focus-console-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*760px\)[\s\S]*?\.focus-console-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(220px,\s*0\.32fr\)/,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*620px\)[\s\S]*?\.focus-actions\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*620px\) and \(max-width:\s*759px\)[\s\S]*?\.focus-task-picker\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
    expect(consoleSource).toContain('className="focus-action connection-action"');
    expect(consoleSource).not.toContain('inline-connection-action');
    expect(viewportScreenshotSource).toContain(
      "document.querySelector('.focus-instrument > .temporal-ribbon')",
    );
    expect(viewportScreenshotSource).not.toContain(
      "document.querySelector('.mobile-temporal-ribbon')",
    );
    expect(mobile13Source).toContain('.focus-instrument > .temporal-ribbon');
    expect(mobile13Source).toContain('order: 3');
    expect(mobile13Source).toContain('grid-area: ribbon');
  });

  it('keeps text inputs at 16px and wraps partial ledger copy on the phone strip', () => {
    const css = compactCss('mobile.css');

    expect(css).toMatch(
      /\.form-field input,\s*\.native-pause-reminder input\[type='number'\]\s*\{[^}]*font-size:\s*16px/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*619px\)[\s\S]*?\.sync-status-ledger\.state-partial \.sync-copy span\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*text-overflow:\s*clip[^}]*white-space:\s*normal/,
    );
  });

  it('flattens the timer stage and task nesting to continuous hairline rows', () => {
    const css = compactCss('mobile.css');

    expect(css).toMatch(
      /\.primary-readout\s*\{[^}]*border-radius:\s*0[^}]*background:\s*var\(--canvas\)[^}]*box-shadow:\s*none/,
    );
    expect(css).toMatch(
      /\.task-project-group\s*\{[^}]*border-radius:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/,
    );
    expect(css).toMatch(/\.task-children\s*\{[^}]*margin:\s*0 !important[^}]*border-radius:\s*0/);
  });

  it('keeps the 640 portrait CTA sticky above the nav and compresses the 760+ side pane', () => {
    const css = compactCss('mobile.css');

    expect(css).toMatch(
      /@media \(min-width:\s*620px\) and \(max-width:\s*759px\) and \(orientation:\s*portrait\)[\s\S]*?\.focus-actions\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*calc\(72px \+ env\(safe-area-inset-bottom,\s*0px\)\)/,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*620px\) and \(max-width:\s*759px\) and \(orientation:\s*portrait\)[\s\S]*?\.focus-instrument\s*\{[^}]*padding-bottom:\s*calc\(112px \+ env\(safe-area-inset-bottom,\s*0px\)\)/,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*760px\), \(orientation:\s*landscape\)[\s\S]*?\.live-context\s*\{[^}]*align-content:\s*start/,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*760px\), \(orientation:\s*landscape\)[\s\S]*?\.task-selection-detail\s*\{[^}]*min-height:\s*0/,
    );
  });

  it('keeps tablet settings status, font preview and timer instruments readable', () => {
    const mobile = compactCss('focuslink-2-mobile.css');
    const instruments = compactCss('mobile-instruments.css');

    expect(mobile).toMatch(
      /@media \(min-width:\s*620px\)[\s\S]*?\.settings-view > \.settings-status-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(mobile).toMatch(
      /\.appearance-font-controls\s*\{[^}]*grid-template-columns:\s*minmax\(180px,\s*0\.42fr\) minmax\(0,\s*0\.58fr\)/,
    );
    expect(mobile).toMatch(
      /\.appearance-font-preview\s*\{[^}]*min-height:\s*88px[^}]*margin-top:\s*0/,
    );
    expect(mobile).toMatch(
      /\.appearance-timer-choice\s*\{[^}]*min-height:\s*112px[^}]*padding:\s*11px 10px 9px/,
    );
    expect(instruments).toMatch(
      /@media \(min-width:\s*620px\)[\s\S]*?\.appearance-timer-preview\s*\{[^}]*min-height:\s*68px/,
    );
    expect(instruments).toMatch(
      /\.appearance-timer-preview \.timer-dial\s*\{[^}]*transform:\s*scale\(0\.64\)/,
    );
    expect(instruments).toMatch(
      /\.appearance-timer-preview \.dial-standard,[\s\S]*?\.appearance-timer-preview \.dial-draft\s*\{[^}]*transform:\s*scale\(0\.58\)/,
    );
    expect(instruments).toMatch(
      /\.appearance-timer-preview \.dial-standard\s*\{[^}]*transform-origin:\s*center/,
    );
    expect(instruments).toMatch(
      /\.appearance-timer-preview\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/,
    );
    expect(instruments).toMatch(
      /@media \(max-width:\s*380px\)[\s\S]*?\.appearance-timer-preview \.dial-standard\s*\{[^}]*transform:\s*scale\(0\.5\)/,
    );
  });

  it('keeps phone sync facts in a compact two-by-two matrix', () => {
    const mobile = compactCss('focuslink-2-mobile.css');
    expect(mobile).toMatch(
      /@media \(max-width:\s*619px\)[\s\S]*?\.settings-view > \.settings-status-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(mobile).toMatch(
      /\.settings-status-line\s*\{[^}]*min-height:\s*104px[^}]*grid-template-columns:\s*20px minmax\(0,\s*1fr\)/,
    );
  });

  it('checks every mobile font and all nine timer previews against their parent bounds', () => {
    expect(viewportScreenshotSource).toContain('assertMobileAppearancePreviews');
    expect(viewportScreenshotSource).toContain('Object.keys(FONT_PROFILE_EXPECTATIONS)');
    expect(viewportScreenshotSource).toContain('.appearance-font-choice[data-font-profile=');
    expect(viewportScreenshotSource).toContain('fontResult.width >= 100');
    expect(viewportScreenshotSource).toContain('.appearance-timer-preview');
    expect(viewportScreenshotSource).toContain('timerResult.count === 9');
    expect(viewportScreenshotSource).toContain('inner.right > outer.right + tolerance');
    expect(viewportScreenshotSource).toContain('inner.bottom > outer.bottom + tolerance');
  });
});

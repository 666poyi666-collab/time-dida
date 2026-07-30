import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule, type Node, type Root, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(...segments: string[]): string {
  return fs.readFileSync(path.join(projectRoot, ...segments), 'utf8');
}

const mobileCss = readProjectFile('src', 'mobile', 'mobile.css');
const liquidLayerMarker = '/* Liquid control layer';
const liquidLayerOffset = mobileCss.indexOf(liquidLayerMarker);

if (liquidLayerOffset < 0) {
  throw new Error('mobile.css is missing the liquid control layer marker');
}

const mobileRoot = postcss.parse(mobileCss);
const liquidRoot = postcss.parse(mobileCss.slice(liquidLayerOffset));

type RuleContext = {
  media?: string | null;
  supports?: string;
};

function ancestorParams(rule: Rule, name: string): string[] {
  const params: string[] = [];
  let parent: Node | undefined = rule.parent;
  while (parent) {
    if (parent.type === 'atrule') {
      const atRule = parent as AtRule;
      if (atRule.name === name) params.push(atRule.params);
    }
    parent = parent.parent;
  }
  return params;
}

function declarations(rule: Rule): Record<string, string> {
  const values: Record<string, string> = {};
  for (const node of rule.nodes ?? []) {
    if (node.type === 'decl') {
      values[node.prop] = `${node.value}${node.important ? ' !important' : ''}`;
    }
  }
  return values;
}

function findRule(
  root: Root,
  selector: string,
  expected: Record<string, string>,
  context: RuleContext = {},
): Rule | undefined {
  let match: Rule | undefined;
  root.walkRules((rule) => {
    if (match || !rule.selectors.includes(selector)) return;

    const media = ancestorParams(rule, 'media');
    const supports = ancestorParams(rule, 'supports');
    if (context.media === null && media.length > 0) return;
    if (typeof context.media === 'string' && !media.includes(context.media)) return;
    if (typeof context.supports === 'string' && !supports.includes(context.supports)) return;

    const values = declarations(rule);
    if (Object.entries(expected).every(([property, value]) => values[property] === value)) {
      match = rule;
    }
  });
  return match;
}

function expectRule(
  root: Root,
  selector: string,
  expected: Record<string, string>,
  context: RuleContext = {},
): void {
  expect(
    findRule(root, selector, expected, context),
    `${selector} should declare ${JSON.stringify(expected)} in ${JSON.stringify(context)}`,
  ).toBeDefined();
}

describe('mobile responsive and accessibility review contract', () => {
  it('keeps 360, 412 and 640x1024 on bottom tabs, then opens the sidebar at 760 or landscape', () => {
    const sidebarMedia = '(min-width: 760px), (orientation: landscape)';

    expectRule(liquidRoot, '.app-frame', { display: 'block' }, { media: null });
    expectRule(
      liquidRoot,
      '.app-navigation',
      {
        position: 'fixed',
        top: 'auto',
        'grid-template-columns': 'repeat(4, minmax(0, 1fr))',
      },
      { media: null },
    );
    expectRule(
      liquidRoot,
      '.focus-console-body',
      { 'grid-template-columns': 'minmax(0, 1fr)' },
      { media: null },
    );
    expectRule(
      liquidRoot,
      '.app-frame',
      { display: 'grid', 'grid-template-columns': '88px minmax(0, 1fr)' },
      { media: sidebarMedia },
    );
    expectRule(
      liquidRoot,
      '.app-navigation',
      { position: 'sticky', bottom: 'auto', 'grid-template-columns': '1fr' },
      { media: sidebarMedia },
    );
    expectRule(
      liquidRoot,
      '.focus-console-body',
      { 'grid-template-columns': 'minmax(0, 1fr) minmax(220px, 0.32fr)' },
      { media: sidebarMedia },
    );

    const modeAt = (width: number, height: number) =>
      width >= 760 || width > height ? 'sidebar' : 'bottom-tabs';
    expect([
      modeAt(360, 800),
      modeAt(412, 915),
      modeAt(640, 1024),
      modeAt(760, 1024),
      modeAt(700, 412),
    ]).toEqual(['bottom-tabs', 'bottom-tabs', 'bottom-tabs', 'sidebar', 'sidebar']);
  });

  it('keeps primary navigation, focus and settings targets at least 44 CSS pixels', () => {
    expectRule(mobileRoot, '.icon-button', { 'min-width': '52px', 'min-height': '44px' });
    expectRule(
      liquidRoot,
      '.app-navigation button',
      { 'min-width': '44px', 'min-height': '52px' },
      { media: null },
    );
    expectRule(liquidRoot, '.focus-action', { 'min-width': '44px', 'min-height': '50px' });
    expectRule(liquidRoot, '.sheet-close', {
      width: '44px',
      height: '44px',
      'min-width': '44px',
      'min-height': '44px',
    });
    expectRule(liquidRoot, '.dashboard-range button', { 'min-height': '44px' });
    expectRule(liquidRoot, '.form-field .field-quick-action', { 'min-height': '44px' });
    expectRule(liquidRoot, '.appearance-select-row select', { 'min-height': '44px' });
    expectRule(liquidRoot, '.focus-system-tool-actions button', { 'min-height': '44px' });
    expectRule(liquidRoot, '.sync-button', { 'min-width': '44px' });
    expectRule(liquidRoot, '.sync-button', { 'min-height': '44px' });
  });

  it('keeps the no-backdrop-filter path opaque in both light and dark themes', () => {
    const unsupported =
      'not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))';
    const supported = '((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))';

    expectRule(liquidRoot, ':root', { '--mobile-glass-fill': 'var(--surface)' }, { media: null });
    expectRule(
      liquidRoot,
      '.app-navigation',
      { background: 'var(--mobile-glass-fill)' },
      { media: null },
    );
    expectRule(
      liquidRoot,
      '.app-navigation',
      { background: 'var(--surface)' },
      { supports: unsupported },
    );
    expectRule(
      liquidRoot,
      ':root',
      { '--mobile-glass-fill': 'rgb(var(--app-surface) / 0.74)' },
      { supports: supported },
    );
    expectRule(
      liquidRoot,
      ':root.dark',
      { '--mobile-glass-fill': 'rgb(var(--app-surface) / 0.84)' },
      { supports: supported },
    );
    expectRule(
      liquidRoot,
      '.app-navigation',
      { '-webkit-backdrop-filter': 'none', 'backdrop-filter': 'none' },
      { media: '(prefers-reduced-transparency: reduce)' },
    );
  });

  it('removes continuous and interaction motion when reduced motion is requested', () => {
    const reducedMotion = '(prefers-reduced-motion: reduce)';

    expectRule(
      mobileRoot,
      '*',
      {
        'animation-duration': '0.01ms !important',
        'animation-iteration-count': '1 !important',
        'transition-duration': '0.01ms !important',
      },
      { media: reducedMotion },
    );
    expectRule(mobileRoot, '.mobile-workspace', { animation: 'none' }, { media: reducedMotion });
    expectRule(
      liquidRoot,
      '.app-navigation button',
      { transition: 'none', transform: 'none !important' },
      { media: reducedMotion },
    );
    expectRule(
      liquidRoot,
      '.focus-action',
      { transition: 'none', transform: 'none !important' },
      { media: reducedMotion },
    );
  });

  it('keeps navigation, focus console and modal controls named for assistive technology', () => {
    const navigation = readProjectFile('src', 'mobile', 'AppNavigation.tsx');
    const consoleSource = readProjectFile('src', 'mobile', 'FocusConsole.tsx');
    const appSource = readProjectFile('src', 'mobile', 'MobileApp.tsx');
    const connectionSheet = readProjectFile('src', 'mobile', 'ConnectionSheet.tsx');

    expect(navigation).toContain('<nav className="app-navigation" aria-label="主要功能">');
    expect(navigation).toContain("aria-current={activeView === item.id ? 'page' : undefined}");
    expect(navigation).toContain('<Icon aria-hidden="true" />');
    expect(appSource).toContain('<main className="mobile-main">');
    expect(consoleSource).toContain('aria-labelledby="focus-console-title"');
    expect(consoleSource).toContain('aria-label="本轮三时间"');
    expect(consoleSource).toContain('aria-label="多端状态"');
    expect(connectionSheet).toContain('role="dialog"');
    expect(connectionSheet).toContain('aria-modal="true"');
    expect(connectionSheet).toContain('aria-labelledby="connection-title"');
    expect(connectionSheet).toContain('aria-label="关闭账号设置"');
  });
});

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
const mobileRoot = postcss.parse(mobileCss);
const mobile13Root = postcss.parse(readProjectFile('src', 'mobile', 'mobile-1-3.css'));
const focuslink2MobileRoot = postcss.parse(
  readProjectFile('src', 'mobile', 'focuslink-2-mobile.css'),
);
const appleLayerMarker = '/* Apple platform surface';
const appleLayerOffset = mobileCss.indexOf(appleLayerMarker);

if (appleLayerOffset < 0) {
  throw new Error('mobile.css is missing the Apple platform surface marker');
}

const appleRoot = postcss.parse(mobileCss.slice(appleLayerOffset));

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

    expectRule(appleRoot, '.app-frame', { display: 'block' }, { media: null });
    expectRule(
      appleRoot,
      '.app-navigation',
      {
        position: 'fixed',
        top: 'auto',
        bottom: 'max(8px, env(safe-area-inset-bottom))',
        height: 'auto',
        'grid-auto-rows': 'auto',
        'grid-template-columns': 'repeat(4, minmax(0, 1fr))',
        'align-content': 'normal',
      },
      { media: null },
    );
    expectRule(
      appleRoot,
      '.focus-console-body',
      { 'grid-template-columns': 'minmax(0, 1fr)' },
      { media: null },
    );
    expectRule(
      appleRoot,
      '.app-frame',
      { display: 'grid', 'grid-template-columns': '88px minmax(0, 1fr)' },
      { media: sidebarMedia },
    );
    expectRule(
      appleRoot,
      '.app-navigation',
      { position: 'sticky', bottom: 'auto', 'grid-template-columns': '1fr' },
      { media: sidebarMedia },
    );
    expectRule(
      appleRoot,
      '.focus-console-body',
      { 'grid-template-columns': 'minmax(0, 1fr) minmax(220px, 0.32fr)' },
      { media: sidebarMedia },
    );
    expect(
      findRule(
        appleRoot,
        '.app-navigation',
        { position: 'sticky' },
        { media: '(min-width: 620px)' },
      ),
    ).toBeUndefined();

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
      appleRoot,
      '.app-navigation button',
      { 'min-width': '44px', 'min-height': '52px' },
      { media: null },
    );
    expectRule(appleRoot, '.focus-action', { 'min-width': '44px', 'min-height': '48px' });
    expectRule(appleRoot, '.sheet-close', { 'min-width': '44px', 'min-height': '44px' });
    expectRule(appleRoot, '.dashboard-range button', { 'min-height': '44px' });
    expectRule(appleRoot, '.focus-task-clear', { 'min-height': '44px' });
    expectRule(appleRoot, '.task-project-toggle', { 'min-height': '52px' });
    expectRule(appleRoot, '.task-row-main', { 'min-height': '60px' });
    expectRule(appleRoot, '.task-start-button', { 'min-height': '52px' });
    expectRule(appleRoot, '.sync-button', { 'min-width': '44px', 'min-height': '44px' });
    expectRule(mobile13Root, '.appearance-segmented-option', { 'min-height': '46px' });
    expectRule(mobile13Root, '.appearance-font-choice', { 'min-height': '92px' });
    expectRule(mobile13Root, '.native-permission-action', { 'min-height': '46px' });
    expectRule(mobile13Root, '.focus-instrument > .temporal-ribbon .ribbon-view-switch button', {
      'min-height': '44px',
    });
    expectRule(mobile13Root, '.task-add-destination select', { 'min-height': '44px' });
    expectRule(focuslink2MobileRoot, '.mobile-sync-pill', {
      'min-width': '44px',
      'min-height': '44px',
    });
    expectRule(focuslink2MobileRoot, '.mobile-topbar .icon-button', {
      width: '44px',
      'min-width': '44px',
    });
    expectRule(
      focuslink2MobileRoot,
      '.mobile-sync-pill',
      { width: '44px', 'min-width': '44px' },
      { media: '(max-width: 380px)' },
    );
  });

  it('uses the full tablet width for all eight live font previews', () => {
    expectRule(
      mobile13Root,
      "html[data-device-tier='tablet'] body .appearance-font-controls",
      { display: 'block', 'margin-top': '14px' },
      { media: '(min-width: 620px)' },
    );
    expectRule(
      mobile13Root,
      '.appearance-font-choices',
      { 'grid-template-columns': 'repeat(4, minmax(0, 1fr))' },
      { media: '(min-width: 620px)' },
    );
  });

  it('keeps editable text at 16px and the flattened timer stage on the canvas surface', () => {
    expectRule(appleRoot, '.task-search input', { 'min-height': '44px', 'font-size': '16px' });
    expectRule(appleRoot, '.form-field input', { 'font-size': '16px' });
    expectRule(appleRoot, '.primary-readout', {
      background: 'var(--canvas)',
      'border-radius': '0',
      'box-shadow': 'none',
    });
  });

  it('keeps content opaque and scopes Liquid Glass to the functional chrome with a solid fallback', () => {
    const supported = '((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))';
    const controls = ['.app-navigation', '.focus-actions', '.dashboard-range', '.connection-sheet'];

    for (const selector of controls) {
      expectRule(appleRoot, selector, { background: 'var(--surface) !important' });
      expectRule(
        appleRoot,
        selector,
        {
          '-webkit-backdrop-filter': 'blur(18px) saturate(1.2) !important',
          'backdrop-filter': 'blur(18px) saturate(1.2) !important',
        },
        { supports: supported },
      );
      expectRule(
        appleRoot,
        selector,
        { '-webkit-backdrop-filter': 'none !important', 'backdrop-filter': 'none !important' },
        { media: '(prefers-reduced-transparency: reduce)' },
      );
    }

    expectRule(appleRoot, '.task-browser', {
      '-webkit-backdrop-filter': 'none !important',
      'backdrop-filter': 'none !important',
      'background-image': 'none !important',
    });
    expect(appleRoot.toString()).not.toContain('--mobile-glass-sheen');

    const confirmCss = readProjectFile('src', 'mobile', 'mobile-confirm.css');
    expect(confirmCss).not.toMatch(/backdrop-filter:\s*blur/);
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
      appleRoot,
      '.app-navigation button',
      { transition: 'none !important', transform: 'none !important' },
      { media: reducedMotion },
    );
    expectRule(
      appleRoot,
      '.focus-action',
      { transition: 'none !important', transform: 'none !important' },
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
    expect(connectionSheet).toContain("'关闭设备同步，返回本机模式'");
    expect(connectionSheet).toContain('aria-label={authenticated');
  });
});

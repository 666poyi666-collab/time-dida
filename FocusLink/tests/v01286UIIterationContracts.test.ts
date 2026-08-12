import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule, type Node, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

// v0.12.86（FL-REQ-20260811-UI-ITER）验收契约——只锁其他验收文件未覆盖的条款：
//  1. IME 不遮挡粘性操作区：Web viewport meta 的 interactive-widget + Android adjustResize。
//  2. 移动首屏压缩带与侧栏事实行扁平化（连续工作面）的具体声明。
//  3. 640 竖屏粘性主操作必须排在旧 620 覆盖层之后（级联序，防止「半失效 legacy 620 覆盖层」复活）。
//  4. 语义 token 对比度：正文 ≥7:1；次要、辅助、成功、危险与实心按钮标签 ≥4.5:1。
// 本文件只读源码与清单，不改产品实现；CSS/清单的静默失败（圆角回退、字号掉档、软键盘遮挡、
// token 色相漂移）在这里变成可失败断言。

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(...segments: string[]): string {
  return fs.readFileSync(path.join(projectRoot, ...segments), 'utf8');
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function declarations(rule: Rule): Record<string, string> {
  const values: Record<string, string> = {};
  for (const node of rule.nodes ?? []) {
    if (node.type === 'decl') {
      values[node.prop] = node.value + (node.important ? ' !important' : '');
    }
  }
  return values;
}

function mediaOf(rule: Rule): string[] {
  const params: string[] = [];
  let parent: Node | undefined = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && (parent as AtRule).name === 'media') {
      params.push((parent as AtRule).params);
    }
    parent = parent.parent;
  }
  return params;
}

function findRule(
  root: postcss.Root,
  selector: string,
  expected: Record<string, string>,
  mediaParams?: string,
): Rule | undefined {
  let match: Rule | undefined;
  root.walkRules((rule) => {
    if (match || !rule.selectors.includes(selector)) return;
    const media = mediaOf(rule);
    if (mediaParams !== undefined && !media.includes(mediaParams)) return;
    const values = declarations(rule);
    if (Object.entries(expected).every(([property, value]) => values[property] === value)) {
      match = rule;
    }
  });
  return match;
}

function expectRuleAt(
  root: postcss.Root,
  selector: string,
  expected: Record<string, string>,
  mediaParams?: string,
): void {
  const context = mediaParams === undefined ? '无媒体查询' : mediaParams;
  expect(
    findRule(root, selector, expected, mediaParams),
    selector + ' 应声明 ' + JSON.stringify(expected) + '（' + context + '）',
  ).toBeDefined();
}

describe('v0.12.86 IME contract: the soft keyboard never covers the sticky action area', () => {
  it('declares interactive-widget=resizes-content on the mobile viewport', () => {
    const html = readProjectFile('mobile', 'index.html');
    const viewport = /<meta\s+name="viewport"\s+content="([^"]+)"/.exec(html);
    expect(viewport, 'mobile/index.html 缺少 viewport meta').not.toBeNull();
    expect(viewport![1]).toContain('width=device-width');
    expect(viewport![1], '软键盘弹出时必须压缩视觉视口，否则粘性操作区被遮挡').toContain(
      'interactive-widget=resizes-content',
    );
  });

  it('declares adjustResize on the Android main activity for the WebView keyboard', () => {
    const manifest = readProjectFile('android', 'app', 'src', 'main', 'AndroidManifest.xml');
    const activity = /<activity[\s\S]*?android:name="[^"]*MainActivity"[\s\S]*?<\/activity>/.exec(
      manifest,
    );
    expect(activity, 'AndroidManifest 缺少 MainActivity 元素').not.toBeNull();
    expect(
      activity![0],
      'MainActivity 必须声明 windowSoftInputMode=adjustResize，否则软键盘会覆盖粘性操作区',
    ).toContain('android:windowSoftInputMode="adjustResize"');
  });
});

describe('v0.12.86 mobile continuous work surface contracts', () => {
  const css = stripComments(readProjectFile('src', 'mobile', 'mobile.css'));
  const root = postcss.parse(css);

  it('compresses the phone band so readout and primary action stay in the first viewport', () => {
    expectRuleAt(
      root,
      '.mobile-topbar',
      {
        'min-height': 'calc(52px + env(safe-area-inset-top))',
      },
      '(max-width: 619px)',
    );
    expectRuleAt(
      root,
      '.sync-strip',
      {
        'min-height': '46px',
        'padding-block': '6px',
      },
      '(max-width: 619px)',
    );
  });

  it('flattens side facts into hairline rows instead of rounded cards', () => {
    for (const selector of ['.connection-callout', '.runtime-facts']) {
      expectRuleAt(root, selector, {
        'border-radius': '0',
        background: 'transparent',
        'box-shadow': 'none',
      });
    }
    expectRuleAt(root, '.connection-callout', {
      'border-bottom': '1px solid var(--mobile-hairline)',
    });
    expectRuleAt(root, '.runtime-facts', {
      'border-top': '1px solid var(--mobile-hairline)',
      'border-bottom': '1px solid var(--mobile-hairline)',
    });
    expectRuleAt(root, '.desktop-delivery-note', {
      'border-top': '1px solid var(--mobile-hairline)',
    });
    expectRuleAt(root, '.native-system-controls', {
      'border-top': '1px solid var(--mobile-hairline)',
      'border-bottom': '1px solid var(--mobile-hairline)',
    });
  });

  it('compacts the empty stats placeholder instead of a tall blank first viewport', () => {
    expectRuleAt(root, '.analytics-empty', { 'min-height': '64px', margin: '0' });
    expectRuleAt(root, '.mobile-gap-ledger > p', { 'min-height': '56px' });
    expectRuleAt(root, '.dashboard-primary', { 'min-height': '150px' });
  });
});

describe('v0.12.86 640 portrait sticky action cascade (legacy 620 overlay cleanup)', () => {
  const css = stripComments(readProjectFile('src', 'mobile', 'mobile.css'));
  const root = postcss.parse(css);

  it('orders the 640-portrait sticky CTA after any generic >=620 bottom:0 overlay', () => {
    const generic: number[] = [];
    root.walkAtRules('media', (atRule) => {
      if (!/min-width:\s*620px/.test(atRule.params) || /max-width/.test(atRule.params)) return;
      atRule.walkRules((rule) => {
        if (!rule.selectors.includes('.focus-actions')) return;
        const values = declarations(rule);
        if (values['position'] === 'sticky' && values['bottom'] === '0') {
          generic.push(rule.source?.start?.line ?? 0);
        }
      });
    });
    expect(generic, '需要存在旧的通用 ≥620 粘底覆盖层作为对比基线').not.toHaveLength(0);

    const portrait = findRule(
      root,
      '.focus-actions',
      {
        position: 'sticky',
        bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
        'z-index': '32',
      },
      '(min-width: 620px) and (max-width: 759px) and (orientation: portrait)',
    );
    expect(portrait, '620–759 竖屏必须存在粘性主操作（位于底部导航之上）').toBeDefined();
    const portraitLine = portrait!.source?.start?.line ?? 0;
    expect(
      portraitLine,
      'v0.12.86 的 640 竖屏规则必须排在旧 620 覆盖层之后，否则级联序会让粘性操作落回底边',
    ).toBeGreaterThan(Math.max(...generic));
  });
});

describe('v0.12.86 semantic token contrast floor (WCAG)', () => {
  const foundation = stripComments(readProjectFile('src', 'styles', 'temporal-foundation.css'));

  function tokensOf(blockLabel: string): Record<string, [number, number, number]> {
    const anchor = blockLabel === ':root' ? ':root' : '\\.dark';
    const block = new RegExp('^' + anchor + '\\s*\\{([\\s\\S]*?)^\\}', 'm').exec(foundation);
    expect(block, 'temporal-foundation.css 缺少 ' + blockLabel + ' 块').not.toBeNull();
    const tokens: Record<string, [number, number, number]> = {};
    for (const name of [
      'app-bg',
      'app-surface-2',
      'app-text',
      'app-muted',
      'app-subtle',
      'app-danger',
      'app-danger-solid',
      'app-danger-solid-fg',
      'app-pause',
      'app-success',
      'app-accent',
      'app-accent-fg',
    ]) {
      const value = new RegExp('--' + name + '\\s*:\\s*([^;]+);').exec(block![1]);
      expect(value, 'temporal-foundation.css ' + blockLabel + ' 缺少 --' + name).not.toBeNull();
      const parts = value![1].trim().split(/\s+/).map(Number);
      expect(parts, '--' + name + ' 不是三元 RGB').toHaveLength(3);
      tokens[name] = [parts[0], parts[1], parts[2]];
    }
    return tokens;
  }

  const light = tokensOf(':root');
  const dark = tokensOf('.dark');

  function lin(channel: number): number {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function ratio(a: [number, number, number], b: [number, number, number]): number {
    const la = 0.2126 * lin(a[0]) + 0.7152 * lin(a[1]) + 0.0722 * lin(a[2]);
    const lb = 0.2126 * lin(b[0]) + 0.7152 * lin(b[1]) + 0.0722 * lin(b[2]);
    const hi = la > lb ? la : lb;
    const lo = la > lb ? lb : la;
    return (hi + 0.05) / (lo + 0.05);
  }

  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)(
    '%s theme: primary, secondary, danger and solid-button labels clear AA',
    (_label, tokens) => {
      const canvasDesktop = tokens['app-surface-2'];
      const canvasMobile = tokens['app-bg'];
      // 实心按钮标签以按钮自身实心底为背景计算，不能拿页面画布对比。
      const pairs: Array<[string, [number, number, number], [number, number, number], number]> = [
        ['正文文字', tokens['app-text'], canvasDesktop, 7],
        ['正文文字（移动）', tokens['app-text'], canvasMobile, 7],
        ['次要文字', tokens['app-muted'], canvasDesktop, 4.5],
        ['次要文字（移动）', tokens['app-muted'], canvasMobile, 4.5],
        ['危险文字', tokens['app-danger'], canvasDesktop, 4.5],
        ['危险文字（移动）', tokens['app-danger'], canvasMobile, 4.5],
        ['实心危险按钮标签', tokens['app-danger-solid-fg'], tokens['app-danger-solid'], 4.5],
        ['强调实心按钮标签', tokens['app-accent-fg'], tokens['app-accent'], 4.5],
        ['暂停红（大文本/UI 级）', tokens['app-pause'], canvasDesktop, 3],
      ];
      for (const [labelText, fg, canvas, floor] of pairs) {
        const value = ratio(fg, canvas);
        expect(
          value,
          labelText + ' 对比度 ' + value.toFixed(2) + ':1 低于下限 ' + floor + ':1',
        ).toBeGreaterThanOrEqual(floor);
      }
    },
  );

  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('%s theme: auxiliary and success text clear AA', (_label, tokens) => {
    for (const canvas of [tokens['app-surface-2'], tokens['app-bg']]) {
      expect(ratio(tokens['app-subtle'], canvas)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tokens['app-success'], canvas)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

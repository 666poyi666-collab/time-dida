import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 桌面时间仪器工作台（linear-workbench.css + legacy-support.css）的可失败样式契约。
// CSS 的失败是静默的：断点写错、字号掉到 8px、阴影写死 rgb(0 0 0) 都不会报编译错误，
// 只会在真实窗口里露出裁切、低对比度或主题失效。这里把「980×660 最小地板」「账本
// 宽度分层」「辅助字号 ≥10px」「token 化白/遮罩」「危险红」等本轮验收规则变成断言。

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylesDir = path.join(projectRoot, 'src', 'styles');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function compact(file: string): string {
  return stripComments(fs.readFileSync(path.join(stylesDir, file), 'utf8')).replace(/\s+/g, ' ');
}

describe('desktop responsive style contract', () => {
  it('keeps 980×660 on the one-column band and never lets the low-height rule steal it back', () => {
    const css = compact('linear-workbench.css');

    // ≤1080：仪表列必须折为纪念碑上方的横档（单列）。
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1080px\)[\s\S]*?\.focus-instrument\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1080px\)[\s\S]*?\.focus-meter-rail\s*\{[^}]*border-right:\s*0/,
    );

    // 双列「仪表列 + 纪念碑」只在宽度足够时配合低保高度生效：两条件都必须显式写在同一
    // 查询里，否则 980×660（宽度 ≤1080 又高度 ≤760）会被 max-height 单条件抢回双列。
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1081px\)\s*and\s*\(max-height:\s*760px\)[\s\S]*?\.focus-instrument\s*\{[^}]*grid-template-columns:\s*206px\s+minmax\(0,\s*1fr\)/,
    );

    // 低保档永远保留可容纳最小读数的舞台下限，防止读数被压缩后裁切。
    expect(css).toMatch(
      /@media\s*\(max-height:\s*760px\)[\s\S]*?\.timer-dial-stage\s*\{[^}]*min-height:\s*112px/,
    );
  });

  it('uses the 336px ledger under 1100 and the 384/440 px tiers above', () => {
    const css = compact('linear-workbench.css');

    expect(css).toMatch(
      /@media\s*\(max-width:\s*1099px\)[\s\S]*?\.focus-console\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*336px/,
    );
    expect(css).toMatch(
      /\.focus-console\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*384px/,
    );
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1600px\)[\s\S]*?\.focus-console\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*440px/,
    );
  });

  it('tightens the shared console banner density without touching heights', () => {
    const css = compact('linear-workbench.css');

    expect(css).toMatch(/\.view-console\s*\{[^}]*gap:\s*16px/);
    expect(css).toMatch(/\.view-console\s*\{[^}]*padding:\s*0\s+16px\s+0\s+20px/);
    expect(css).toMatch(/\.view-console\s*\{[^}]*min-height:\s*58px/);
    expect(css).toMatch(/\.console-identity\s*\{[^}]*gap:\s*12px/);
  });

  it('wraps the history header into its own full-width control row before it can overflow', () => {
    const css = compact('linear-workbench.css');

    expect(css).toMatch(
      /@media\s*\(min-width:\s*901px\)\s*and\s*\(max-width:\s*1239px\)[\s\S]*?\.history-header\.view-console\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/,
    );
    expect(css).toMatch(
      /@media\s*\(min-width:\s*901px\)\s*and\s*\(max-width:\s*1239px\)[\s\S]*?\.history-header\.view-console\s*\.history-header-controls\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*grid-row:\s*2/,
    );
  });

  it('protects long ledger duration text from being squeezed by the task title', () => {
    const css = compact('linear-workbench.css');

    expect(css).toMatch(/\.ledger-row-main\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.ledger-row-title\s*\{[^}]*min-width:\s*0[^}]*flex:\s*1\s+1\s+auto/);
    expect(css).toMatch(/\.ledger-row-duration\s*\{[^}]*flex:\s*0\s+0\s+auto/);
    expect(css).toMatch(/\.ledger-row-duration\s*\{[^}]*white-space:\s*nowrap/);
  });

  it('replaces the heavy donut shadow with a restrained token-derived one', () => {
    const css = compact('linear-workbench.css');

    expect(css).not.toMatch(/drop-shadow\(0\s+10px\s+24px/);
    expect(css).toMatch(
      /\.stats-time-donut\s*\{[^}]*filter:\s*drop-shadow\(0\s+4px\s+10px\s+rgb\(var\(--app-scrim\)/,
    );
  });

  it('styles window-blurred subtly and only desaturates state colors', () => {
    const css = compact('linear-workbench.css');

    expect(css).toMatch(/\.window-blurred\s[\s\S]*?\{[^}]*filter:\s*saturate\(0\.8\)/);
  });
});

describe('desktop design-system token contract', () => {
  const css = compact('linear-workbench.css') + compact('legacy-support.css');

  it('keeps the auxiliary text floor at 10px in the desktop styles', () => {
    // 主窗信息字号下限 11px；10px 只允许辅助标签。8/9px 一律不得出现在桌面样式里。
    const subTen = [...css.matchAll(/(?:font-size|font):\s*[^;]*?(\d+(?:\.\d+)?)px/g)]
      .map((m) => parseFloat(m[1]))
      .filter((n) => n < 10);
    expect(subTen, `发现 <10px 的桌面字号：${subTen.join(', ')}`).toEqual([]);
  });

  it('tokenizes literal white foreground and scrim shadows', () => {
    expect(css).not.toMatch(/(?<![\w-])color\s*:\s*(#fff(fff)?|white)\b/i);
    expect(css).not.toMatch(/rgb\(\s*0\s+0\s+0\s*\//);
    expect(css).toMatch(/rgb\(var\(--app-scrim\)/);
  });

  it('applies the radius ladder tokens instead of bare pixels', () => {
    for (const bare of ['border-radius:2px', 'border-radius:3px', 'border-radius:4px']) {
      expect(css, `遗留裸圆角 ${bare}`).not.toMatch(new RegExp(`${bare.replace(/:/, '\\s*:')}\\b`));
    }
    expect(css).toMatch(/border-radius:\s*var\(--radius-sm\)/);
    expect(css).toMatch(/border-radius:\s*var\(--radius-md\)/);
    expect(css).toMatch(/border-radius:\s*var\(--radius-lg\)/);
    expect(css).toMatch(/border-radius:\s*var\(--radius-2xl\)/);
  });

  it('maps sync failure danger to --app-danger, not pause red', () => {
    expect(css).toMatch(
      /\.ledger-sync\.tone-danger\s*,\s*\.ledger-sync\.tone-error\s*\{[^}]*color:\s*rgb\(var\(--app-danger\)\)/,
    );
  });

  it('gives keyboard focus an accent ring on the search inputs', () => {
    expect(css).toMatch(
      /\.settings-search-input:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+rgb\(var\(--app-accent\)/,
    );
    expect(css).toMatch(
      /\.task-workspace-search\s+input:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+rgb\(var\(--app-accent\)/,
    );
  });

  it('declares explicit disabled states for solid buttons and form controls', () => {
    expect(css).toMatch(
      /\.btn-solid:disabled\s*,[^}]*\.btn-primary:disabled[^}]*\.btn-accent:disabled[^}]*\.btn-danger:disabled\s*\{/,
    );
    expect(css).toMatch(/select:disabled\s*,\s*input:disabled\s*,\s*textarea:disabled\s*\{/);
  });

  it('shades dark dials with the scrim token and drops the dead temporal-sweep animation', () => {
    expect(css).toMatch(/\.dial-standard\s*\{[^}]*inset\s+0\s+-2px\s+rgb\(var\(--app-scrim\)/);
    expect(css).not.toMatch(/temporal-sweep/);
    expect(css).toMatch(/\.skeleton\s*\{[^}]*animation:\s*temporal-pulse/);
  });
});

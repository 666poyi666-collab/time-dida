import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CSS 的失败模式是静默的：引用一个未定义的自定义属性不会报错，只会让整条声明
// 在计算期作废；类名拼错或规则从未写过，元素就退回浏览器默认盒子。两者都能通过
// 编译、通过 lint、通过所有单元测试，只在人眼看到界面时才暴露。
//
// 真实案例：--font-display / --font-mono 从未定义过，而 10 处
// `font: 620 13px/1.2 var(--font-display)` 这样的简写因此整条失效——
// 连字号字重一起丢掉，标题退回浏览器默认的 h3 尺寸。同一时期
// SettingsPanel 引用的 23 个类名在样式表里根本不存在，CLI 状态卡因此
// 散成三行、details 露出原生三角。
//
// 这里把两件事都变成可失败的断言。

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylesDir = path.join(projectRoot, 'src', 'styles');

/** 注释里常拿 `rgb(var(--x) / α)` 举例说明约定；扫描前必须剥掉，否则会误报。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function readStyles(): { name: string; text: string }[] {
  return fs
    .readdirSync(stylesDir)
    .filter((file) => file.endsWith('.css'))
    .map((file) => ({
      name: file,
      text: stripComments(fs.readFileSync(path.join(stylesDir, file), 'utf8')),
    }));
}

function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'assets') walkSource(full, out);
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('style contract', () => {
  it('FocusLink 2.0 dark solid actions keep AA contrast after the final cascade', () => {
    const css = stripComments(fs.readFileSync(path.join(stylesDir, 'focuslink-2.css'), 'utf8'));
    const block = /html\.dark\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(block, 'focuslink-2.css 缺少 html.dark 覆盖').not.toBeNull();
    const token = (name: string): [number, number, number] => {
      const value = new RegExp(`--${name}\\s*:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+);`).exec(block![1]);
      expect(value, `html.dark 缺少 --${name}`).not.toBeNull();
      return [Number(value![1]), Number(value![2]), Number(value![3])];
    };
    const luminance = (rgb: [number, number, number]) => {
      const linear = rgb.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const foreground = luminance(token('app-accent-fg'));
    const background = luminance(token('app-accent'));
    const ratio =
      (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('every referenced custom property is defined somewhere', () => {
    const styles = readStyles();
    const css = styles.map((file) => file.text).join('\n');
    const tailwind = stripComments(
      fs.readFileSync(path.join(projectRoot, 'tailwind.config.js'), 'utf8'),
    );

    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    // 一部分令牌由组件在 style={{ '--x': ... }} 里逐元素写入，样式表里只读不写。
    for (const file of walkSource(path.join(projectRoot, 'src'))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/['"](--[\w-]+)['"]\s*:/g)) defined.add(match[1]);
    }

    const referenced = new Set(
      [...`${css}\n${tailwind}`.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]),
    );
    const undefinedTokens = [...referenced].filter((token) => !defined.has(token)).sort();

    expect(undefinedTokens, `未定义的自定义属性：${undefinedTokens.join(', ')}`).toEqual([]);
  });

  it('the font role tokens resolve to a real family, not an empty value', () => {
    const css = readStyles()
      .map((file) => file.text)
      .join('\n');
    // 这四个角色被 font 简写和 Tailwind 的 font-* 引用；任何一个空掉都会
    // 让引用它的整条声明作废，而不是退化成默认字体。
    for (const token of ['--font-ui', '--font-display', '--font-mono', '--font-number']) {
      const match = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(css);
      expect(match, `${token} 没有定义`).not.toBeNull();
      expect(match![1].trim().length, `${token} 定义为空`).toBeGreaterThan(0);
    }
  });

  it('every settings class used by the panel has a rule', () => {
    const css = readStyles()
      .map((file) => file.text)
      .join('\n');
    const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    const panel = fs.readFileSync(
      path.join(projectRoot, 'src', 'features', 'settings', 'SettingsPanel.tsx'),
      'utf8',
    );

    const used = new Set<string>();
    for (const match of panel.matchAll(/className=[{"`]+([^"`}]*)/g)) {
      for (const token of match[1].split(/[\s\\${}]+/)) {
        // 只检查 settings- 命名空间：其余是 Tailwind 工具类，由 Tailwind 生成。
        if (/^settings-[\w-]*[a-z0-9]$/.test(token)) used.add(token);
      }
    }

    expect(used.size).toBeGreaterThan(20);
    // settings-choice-group-wide 是纯语义标记：默认的 .settings-choice-group
    // 已经是整行单列，它只用来和 -inline 变体对读，没有自己的规则。
    const allowUnstyled = new Set(['settings-choice-group-wide']);
    const missing = [...used].filter((c) => !defined.has(c) && !allowUnstyled.has(c)).sort();

    expect(missing, `设置页引用了但样式表里没有的类：${missing.join(', ')}`).toEqual([]);
  });

  it('前景白色必须来自 token，不允许字面 color: white / #fff', () => {
    const offenders: { file: string; line: number; match: string }[] = [];
    for (const file of readStyles()) {
      const lines = file.text.split('\n');
      lines.forEach((line, index) => {
        // (?<![\w-]) 排除 border-color 等复合属性；注释已被 stripComments 剥掉。
        const match = /(?<![\w-])color\s*:\s*(#fff(fff)?|white)\b/i.exec(line);
        if (match) offenders.push({ file: file.name, line: index + 1, match: match[0] });
      });
    }
    expect(
      offenders.map((o) => `${o.file}:${o.line} ${o.match}`).join('；'),
      '发现字面白色前景，应改用 token（如 --app-danger-solid-fg）',
    ).toEqual('');
  });

  it('桌面组件的高光、遮罩与表盘阴影必须来自语义 token', () => {
    const desktopSheets = new Set([
      'focus-motion.css',
      'legacy-support.css',
      'linear-workbench.css',
      'settings-motion.css',
    ]);
    const offenders: string[] = [];
    for (const file of readStyles().filter((entry) => desktopSheets.has(entry.name))) {
      file.text.split('\n').forEach((line, index) => {
        if (/rgb\(\s*255\s+255\s+255\s*\//i.test(line)) {
          offenders.push(`${file.name}:${index + 1} ${line.trim()}`);
        }
        if (/rgb\(\s*0\s+0\s+0\s*\//i.test(line)) {
          offenders.push(`${file.name}:${index + 1} ${line.trim()}`);
        }
      });
    }
    expect(
      offenders.join('；'),
      '桌面组件不得散落字面黑白高光/遮罩，应使用 --app-highlight / --app-scrim',
    ).toEqual('');
  });

  it('桌面非零圆角只允许来自 --radius-* 梯子', () => {
    const desktopSheets = new Set([
      'focus-motion.css',
      'legacy-support.css',
      'linear-workbench.css',
      'settings-motion.css',
      'temporal-foundation.css',
    ]);
    const offenders: string[] = [];
    for (const file of readStyles().filter((entry) => desktopSheets.has(entry.name))) {
      file.text.split('\n').forEach((line, index) => {
        const match = /border-radius\s*:\s*([^;]+);/i.exec(line);
        if (!match) return;
        const value = match[1].replace(/\s*!important\s*$/i, '').trim();
        if (value === 'inherit') return;
        const parts = value.match(/var\(--radius-[\w-]+\)|0/g) ?? [];
        if (parts.join(' ') === value.replace(/\s+/g, ' ')) return;
        offenders.push(`${file.name}:${index + 1} border-radius: ${value}`);
      });
    }
    expect(offenders.join('；'), '桌面圆角必须使用 --radius-* token').toEqual('');
  });

  it('全局 :focus-visible 描边必须派生自强调色 token', () => {
    // 全局焦点环只定义在基础层 temporal-foundation.css；行内组件的 :focus-visible
    // 变体不承担全局描边契约，扫全量会先撞到它们。
    const foundation = readStyles().find((file) => file.name === 'temporal-foundation.css');
    expect(foundation, '缺少 temporal-foundation.css').toBeDefined();
    const block = /:focus-visible\s*\{([^}]*)\}/.exec(foundation!.text);
    expect(block, '基础层缺少全局 :focus-visible 规则').not.toBeNull();
    expect(block![1]).toContain('outline:');
    expect(block![1], ':focus-visible 描边必须用 --app-accent，禁止硬编码蓝').toContain(
      'var(--app-accent)',
    );
  });

  it('移动控制层边框必须在不支持 color-mix 的旧 WebView 中保持语义色', () => {
    const css = stripComments(
      fs.readFileSync(path.join(projectRoot, 'src', 'mobile', 'focuslink-2-mobile.css'), 'utf8'),
    );
    expect(css, '旧 WebView 会把 color-mix 边框退化为 currentColor 黑边').not.toMatch(
      /border(?:-color)?\s*:[^;]*color-mix\(/,
    );
    for (const selector of ['.primary-readout', '.focus-actions', '.app-navigation']) {
      const block = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\}`).exec(css);
      expect(block, `缺少 ${selector} 兼容边框规则`).not.toBeNull();
      expect(block![1]).toMatch(/border(?:-color)?\s*:[^;]*var\(--border/);
    }
  });

  it('辅助文字字号守住确定性下限：text-meta ≥ 11px、text-diag ≥ 10px', () => {
    const css = readStyles()
      .map((file) => file.text)
      .join('\n');
    const meta = /\.text-meta\s*\{([^}]*)\}/.exec(css);
    const diag = /\.text-diag\s*\{([^}]*)\}/.exec(css);
    expect(meta, '缺少 .text-meta 规则').not.toBeNull();
    expect(diag, '缺少 .text-diag 规则').not.toBeNull();
    const sizeOf = (block: string) => {
      const match = /(?:font-size|font)\s*:\s*[^;]*?([\d.]+)px/.exec(block);
      expect(match, `无法解析字号: ${block}`).not.toBeNull();
      return parseFloat(match![1]);
    };
    expect(sizeOf(meta![1]), '.text-meta 是主信息，字号不得低于 11px').toBeGreaterThanOrEqual(11);
    expect(sizeOf(diag![1]), '.text-diag 是辅助标签，字号不得低于 10px').toBeGreaterThanOrEqual(10);
  });
});

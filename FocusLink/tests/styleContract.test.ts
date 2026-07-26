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
});

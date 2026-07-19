// 时间仪器 token 契约：直接读取唯一 token 来源（temporal-foundation.css），
// 锁定专注绿/暂停红语义数值，使冒烟脚本断言与真实样式永不漂移。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(__dirname, '../src/styles/temporal-foundation.css'), 'utf8');

function blockOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`temporal-foundation.css 缺少选择器块: ${selector}`);
  return match[1];
}

describe('专注/暂停颜色语义 token 契约', () => {
  it('浅色主题：专注绿 14 159 110、暂停红 210 67 57', () => {
    const root = blockOf(':root');
    expect(root).toContain('--app-success: 14 159 110;');
    expect(root).toContain('--app-pause: 210 67 57;');
  });

  it('深色主题：专注绿 52 211 153、暂停红 244 112 103', () => {
    const dark = blockOf('.dark');
    expect(dark).toContain('--app-success: 52 211 153;');
    expect(dark).toContain('--app-pause: 244 112 103;');
  });

  it('五种跨色相强调色同时映射界面与专注语义，但绝不触碰暂停红', () => {
    for (const color of ['emerald', 'cobalt', 'violet', 'amber', 'graphite']) {
      for (const prefix of ['', '.dark']) {
        const block = blockOf(`${prefix}.focus-color-${color}`);
        expect(block).toContain('--app-success:');
        expect(block).toContain('--app-accent:');
        expect(block).not.toContain('--app-pause');
      }
    }
  });
});

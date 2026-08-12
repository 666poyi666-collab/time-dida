// 时间仪器 token 契约：直接读取唯一 token 来源（temporal-foundation.css），
// 锁定专注绿/暂停红语义数值、危险实心/遮罩/圆角梯子，使冒烟脚本断言与真实样式永不漂移。
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

function valueOf(block: string, token: string): string {
  const match = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(block);
  if (!match) throw new Error(`temporal-foundation.css 缺少 token: ${token}`);
  return match[1].trim();
}

describe('专注/暂停颜色语义 token 契约', () => {
  it('浅色主题：专注绿满足小字 AA 的 11 122 85、暂停红 210 67 57', () => {
    const root = blockOf(':root');
    expect(root).toContain('--app-success: 11 122 85;');
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

describe('危险语义 token 契约', () => {
  it('danger 与 danger-solid 双主题齐备，并带语义短别名', () => {
    for (const [label, block] of [
      ['浅色', blockOf(':root')],
      ['深色', blockOf('.dark')],
    ] as const) {
      expect(valueOf(block, '--app-danger').length, `${label} 缺 --app-danger`).toBeGreaterThan(0);
      expect(
        valueOf(block, '--app-danger-solid').length,
        `${label} 缺 --app-danger-solid`,
      ).toBeGreaterThan(0);
      expect(
        valueOf(block, '--app-danger-solid-fg').length,
        `${label} 缺 --app-danger-solid-fg`,
      ).toBeGreaterThan(0);
    }
    const root = blockOf(':root');
    expect(root).toContain('--danger-solid: var(--app-danger-solid);');
    expect(root).toContain('--danger-solid-fg: var(--app-danger-solid-fg);');
  });

  it('danger 与 pause 保持独立红相，solid-fg 在实心底上可读', () => {
    const root = blockOf(':root');
    const danger = valueOf(root, '--app-danger');
    const pause = valueOf(root, '--app-pause');
    expect(danger).not.toBe(pause);
    expect(danger).toBe('160 43 32');
    expect(valueOf(root, '--app-danger-solid')).toBe('160 43 32');
    expect(valueOf(root, '--app-danger-solid-fg')).toBe('255 255 255');
  });

  it('深色主题 danger 文本色转浅，solid 底色保持深红，角色不互换', () => {
    const dark = blockOf('.dark');
    expect(valueOf(dark, '--app-danger')).toBe('255 138 128');
    expect(valueOf(dark, '--app-danger-solid')).toBe('137 37 30');
    expect(valueOf(dark, '--app-danger-solid-fg')).toBe('255 255 255');
  });
});

describe('scrim 遮罩 token 契约', () => {
  it('scrim 基底色亮暗双主题齐备并带 --scrim 别名', () => {
    expect(blockOf(':root')).toContain('--app-scrim: 24 26 29;');
    expect(blockOf('.dark')).toContain('--app-scrim: 0 0 0;');
    expect(blockOf(':root')).toContain('--scrim: var(--app-scrim);');
  });
});

describe('圆角梯子 token 契约', () => {
  it('radius 梯子值被锁死、数值单调不减，pill 保持全圆', () => {
    const root = blockOf(':root');
    const steps = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
    const values = steps.map((step) => valueOf(root, `--radius-${step}`));
    const expected: Record<string, string> = {
      xs: '2px',
      sm: '3px',
      md: '4px',
      lg: '6px',
      xl: '6px',
      '2xl': '8px',
    };
    steps.forEach((step, i) => {
      expect(values[i], `--radius-${step} 的值被改动`).toBe(expected[step]);
    });
    const numbers = values.map((v) => {
      const match = /^(\d+(?:\.\d+)?)px$/.exec(v);
      expect(match, `圆角值不是 px: ${v}`).not.toBeNull();
      return parseFloat(match![1]);
    });
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i], `圆角梯子在 ${steps[i]} 处回退`).toBeGreaterThanOrEqual(numbers[i - 1]);
    }
    expect(valueOf(root, '--radius-pill')).toBe('999px');
  });
});

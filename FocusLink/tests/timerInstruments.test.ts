// 计时仪表样式迁移与像素仪表字库测试
import { describe, expect, it } from 'vitest';
import { resolveTimerStyle, TIMER_STYLES } from '../shared/theme';
import { formatDurationPadded } from '../src/lib/time';
import {
  FOCUS_CORE_GRID,
  PIXEL_FONT,
  PIXEL_FONT_COLS,
  PIXEL_FONT_ROWS,
  advanceFlipMachine,
  createFlipMachine,
  focusCoreLitCount,
  focusCoreOrder,
  pixelCells,
  updateFlipMachine,
} from '../shared/timerInstruments';

describe('计时仪表样式解析与旧值迁移', () => {
  it('新仪表样式全部直通', () => {
    for (const style of TIMER_STYLES) {
      expect(resolveTimerStyle(style)).toBe(style);
    }
    expect(TIMER_STYLES).toEqual(['standard', 'flip', 'pixel', 'thin', 'segment']);
  });

  it('旧 editorial/digital/mono 映射到新体系', () => {
    expect(resolveTimerStyle('editorial')).toBe('thin');
    expect(resolveTimerStyle('digital')).toBe('pixel');
    expect(resolveTimerStyle('mono')).toBe('standard');
  });

  it('未知值与空值回落 standard', () => {
    expect(resolveTimerStyle('neon')).toBe('standard');
    expect(resolveTimerStyle('')).toBe('standard');
    expect(resolveTimerStyle(undefined)).toBe('standard');
    expect(resolveTimerStyle(null)).toBe('standard');
    expect(resolveTimerStyle(42)).toBe('standard');
  });
});

describe('像素点阵字库', () => {
  it('0-9 与冒号都有 7×9 定义，行掩码不越界', () => {
    for (const ch of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':']) {
      const rows = PIXEL_FONT[ch];
      expect(rows).toBeDefined();
      expect(rows.length).toBe(PIXEL_FONT_ROWS);
      for (const mask of rows) {
        expect(mask).toBeGreaterThanOrEqual(0);
        expect(mask).toBeLessThan(1 << PIXEL_FONT_COLS);
      }
    }
  });

  it('数字造型真实不同：1 比 8 点亮格少，0 形成闭环', () => {
    expect(pixelCells('1').length).toBeLessThan(pixelCells('8').length);
    expect(pixelCells('0').length).toBeGreaterThan(pixelCells('1').length);
    // 0 的四个角应为空（闭环轮廓）
    const zero = new Set(pixelCells('0').map(([x, y]) => `${x},${y}`));
    expect(zero.has('0,0')).toBe(false);
    expect(zero.has('6,0')).toBe(false);
    expect(zero.has('0,8')).toBe(false);
    expect(zero.has('6,8')).toBe(false);
    // 8 的中间行应满格
    const eight = new Set(pixelCells('8').map(([x, y]) => `${x},${y}`));
    expect(eight.has('2,3')).toBe(true);
    expect(eight.has('3,3')).toBe(true);
    expect(eight.has('4,3')).toBe(true);
  });

  it('冒号只有中间列的上下两点', () => {
    const cells = pixelCells(':');
    expect(cells.every(([x]) => x === 2 || x === 3)).toBe(true);
    expect(cells.length).toBe(8);
  });
});

describe('翻页机械状态机', () => {
  it('完整经过折下、翻起、提交三阶段', () => {
    const fold = updateFlipMachine(createFlipMachine('9'), '0', true);
    expect(fold).toMatchObject({ shown: '9', from: '9', to: '0', phase: 'fold' });
    const unfold = advanceFlipMachine(fold);
    expect(unfold.phase).toBe('unfold');
    expect(advanceFlipMachine(unfold)).toMatchObject({ shown: '0', phase: 'steady' });
  });

  it('动画中只保留最新目标，不中途篡改当前 from/to', () => {
    let machine = updateFlipMachine(createFlipMachine('7'), '8', true);
    machine = updateFlipMachine(machine, '9', true);
    machine = updateFlipMachine(machine, '0', true);
    expect(machine).toMatchObject({ from: '7', to: '8', queued: '0', phase: 'fold' });
    machine = advanceFlipMachine(machine);
    machine = advanceFlipMachine(machine);
    expect(machine).toMatchObject({ shown: '8', from: '8', to: '0', phase: 'fold' });
  });

  it('finished/idle 归零直接静态提交，不播放翻页', () => {
    const active = updateFlipMachine(createFlipMachine('5'), '6', true);
    expect(updateFlipMachine(active, '0', false)).toMatchObject({ shown: '0', phase: 'steady' });
  });
});

describe('专注核心点亮', () => {
  it('比例被钳制在 0..1', () => {
    const total = focusCoreOrder().length;
    expect(focusCoreLitCount(-0.5)).toBe(0);
    expect(focusCoreLitCount(0)).toBe(0);
    expect(focusCoreLitCount(1)).toBe(total);
    expect(focusCoreLitCount(2)).toBe(total);
  });

  it('点亮顺序只落在核心掩码内且不重复', () => {
    const order = focusCoreOrder();
    const seen = new Set(order.map(([x, y]) => `${x},${y}`));
    expect(seen.size).toBe(order.length);
    for (const [x, y] of order) {
      expect(FOCUS_CORE_GRID[y][x]).toBe('#');
    }
  });

  it('充能语义：45 分钟目标的一半点亮约一半格子', () => {
    const total = focusCoreOrder().length;
    expect(focusCoreLitCount(0.5)).toBe(Math.round(total / 2));
  });
});

describe('仪表读数格式化（所有仪表共用契约）', () => {
  it('idle 与秒级推进：分钟始终补零', () => {
    expect(formatDurationPadded(0)).toBe('00:00');
    expect(formatDurationPadded(9_000)).toBe('00:09');
    expect(formatDurationPadded(59_000)).toBe('00:59');
    expect(formatDurationPadded(60_000)).toBe('01:00');
    expect(formatDurationPadded(599_000)).toBe('09:59');
  });

  it('进入小时档切换为 H:MM:SS，长会话读数不溢出', () => {
    expect(formatDurationPadded(3_600_000)).toBe('1:00:00');
    expect(formatDurationPadded(3_661_000)).toBe('1:01:01');
    expect(formatDurationPadded(36_000_000)).toBe('10:00:00');
  });

  it('负值安全归零，不显示负读数', () => {
    expect(formatDurationPadded(-5)).toBe('00:00');
    expect(formatDurationPadded(-60_000)).toBe('00:00');
  });
});

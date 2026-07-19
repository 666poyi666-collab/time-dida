// 小窗任务名显示策略：单行完整 / 克制滚动 / reduced-motion 静态容器。
import { describe, expect, it } from 'vitest';
import { resolveMiniTaskDisplayMode } from '../src/features/mini/miniDisplayPolicy';

describe('小窗长任务名显示策略', () => {
  it('装得下：完整单行显示（含 2px 亚像素取整容忍）', () => {
    expect(resolveMiniTaskDisplayMode(100, 100, false)).toBe('single');
    expect(resolveMiniTaskDisplayMode(102, 100, false)).toBe('single');
  });

  it('长任务名装不下：克制 marquee 滚动，不用省略号截断', () => {
    expect(resolveMiniTaskDisplayMode(103, 100, false)).toBe('marquee');
    expect(resolveMiniTaskDisplayMode(600, 160, false)).toBe('marquee');
  });

  it('reduced-motion：静态可滚动容器，不做往返滚动动画', () => {
    expect(resolveMiniTaskDisplayMode(600, 160, true)).toBe('scroll');
    expect(resolveMiniTaskDisplayMode(100, 100, true)).toBe('single');
  });
});

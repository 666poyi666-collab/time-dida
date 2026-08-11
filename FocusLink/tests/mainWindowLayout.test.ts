import { describe, expect, it } from 'vitest';
import { MAIN_WINDOW_DEFAULT_SIZE, MAIN_WINDOW_MIN_SIZE } from '../shared/mainWindowLayout';

// 桌面验收布局契约：980x660 是保证的最小地板（单列时间之带且仪表不裁切），
// 1280x720 是紧凑验收尺寸（保留全部元素）；两者都必须落在可缩放区间内。
const DESKTOP_ACCEPTANCE_SIZES = [
  { width: 980, height: 660, role: 'minimum floor' },
  { width: 1280, height: 720, role: 'compact acceptance' },
] as const;

describe('main window layout policy', () => {
  it('keeps the redesigned default and minimum bounds explicit', () => {
    expect(MAIN_WINDOW_DEFAULT_SIZE).toEqual({ width: 1240, height: 800 });
    expect(MAIN_WINDOW_MIN_SIZE).toEqual({ width: 980, height: 660 });
    expect(MAIN_WINDOW_DEFAULT_SIZE.width).toBeGreaterThan(MAIN_WINDOW_MIN_SIZE.width);
    expect(MAIN_WINDOW_DEFAULT_SIZE.height).toBeGreaterThan(MAIN_WINDOW_MIN_SIZE.height);
  });

  it('980x660 matches the guaranteed minimum floor', () => {
    const floor = DESKTOP_ACCEPTANCE_SIZES.find((s) => s.width === 980 && s.height === 660);
    expect(floor).toBeDefined();
    expect(MAIN_WINDOW_MIN_SIZE).toEqual({ width: floor!.width, height: floor!.height });
  });

  it('1280x720 is a reachable working size above the guaranteed floor', () => {
    const compact = DESKTOP_ACCEPTANCE_SIZES.find((s) => s.width === 1280 && s.height === 720);
    expect(compact).toBeDefined();
    // 窗口在最小地板之上可自由缩放，因此契约是：验收尺寸任一维不得低于地板。
    expect(compact!.width).toBeGreaterThanOrEqual(MAIN_WINDOW_MIN_SIZE.width);
    expect(compact!.height).toBeGreaterThanOrEqual(MAIN_WINDOW_MIN_SIZE.height);
    expect(compact!.height).toBeLessThanOrEqual(MAIN_WINDOW_DEFAULT_SIZE.height);
  });
});

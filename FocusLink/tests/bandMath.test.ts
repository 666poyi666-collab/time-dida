// 时间之带纯函数内核测试：缩放状态机、逐秒步进、变焦插值、刻度层透明度
import { describe, expect, it } from 'vitest';
import {
  BAND_SCALE_FAR,
  BAND_SCALE_NEAR,
  BAND_TICK_MS,
  bandScaleForState,
  easeInOutQuart,
  easeOutStep,
  interpolateZoomScale,
  macroTickAlpha,
  secondTickAlpha,
  steppedDisplaySeconds,
} from '../shared/focus/bandMath';

describe('时间之带缩放状态机', () => {
  it('专注态进入秒级近景，其余状态使用远景', () => {
    expect(bandScaleForState('running')).toBe(BAND_SCALE_NEAR);
    expect(bandScaleForState('paused')).toBe(BAND_SCALE_FAR);
    expect(bandScaleForState('idle')).toBe(BAND_SCALE_FAR);
    expect(bandScaleForState('finished')).toBe(BAND_SCALE_FAR);
    expect(bandScaleForState('stopping')).toBe(BAND_SCALE_FAR);
  });

  it('近景一分钟大格远大于远景，远景 30 分钟占据合理宽度', () => {
    expect(BAND_SCALE_NEAR * 60).toBeGreaterThan(300);
    const farThirtyMin = BAND_SCALE_FAR * 1800;
    expect(farThirtyMin).toBeGreaterThan(300);
    expect(farThirtyMin).toBeLessThan(600);
  });
});

describe('逐秒擒纵步进', () => {
  it('秒边界瞬间仍停在上一秒，随后在 130ms 内步进到当前秒', () => {
    const whole = 1_700_000_010_000;
    // 边界瞬间：显示上一秒（擒纵尚未释放）
    expect(steppedDisplaySeconds(whole, false)).toBe(whole / 1000 - 1);
    // 步进中段：介于两秒之间
    const mid = steppedDisplaySeconds(whole + 60, false);
    expect(mid).toBeGreaterThan(whole / 1000 - 1);
    expect(mid).toBeLessThan(whole / 1000);
  });

  it('步进窗口内从上一秒向当前秒过渡，且不超过当前秒', () => {
    const whole = 1_700_000_010_000;
    const mid = whole + BAND_TICK_MS / 2;
    const v = steppedDisplaySeconds(mid, false);
    expect(v).toBeGreaterThan(whole / 1000 - 1);
    expect(v).toBeLessThanOrEqual(whole / 1000);
  });

  it('步进结束后稳定吸附到当前整秒', () => {
    const whole = 1_700_000_010_000;
    const after = whole + BAND_TICK_MS + 200;
    expect(steppedDisplaySeconds(after, false)).toBe(whole / 1000);
  });

  it('reduced-motion 直接吸附整秒，无中间过渡', () => {
    const whole = 1_700_000_010_000;
    expect(steppedDisplaySeconds(whole + 30, true)).toBe(whole / 1000);
  });

  it('easeOutStep 单调端点正确', () => {
    expect(easeOutStep(0)).toBeCloseTo(0, 5);
    expect(easeOutStep(1)).toBeCloseTo(1, 5);
  });
});

describe('变焦插值', () => {
  it('端点精确到达目标尺度', () => {
    expect(interpolateZoomScale(BAND_SCALE_NEAR, BAND_SCALE_FAR, 0)).toBeCloseTo(
      BAND_SCALE_NEAR,
      6,
    );
    expect(interpolateZoomScale(BAND_SCALE_NEAR, BAND_SCALE_FAR, 1)).toBeCloseTo(BAND_SCALE_FAR, 6);
  });

  it('对数空间插值：中点是几何均值而非算术均值', () => {
    const mid = interpolateZoomScale(8, 0.5, 0.5);
    expect(mid).toBeCloseTo(Math.sqrt(8 * 0.5), 6);
  });

  it('easeInOutQuart 端点与中点', () => {
    expect(easeInOutQuart(0)).toBe(0);
    expect(easeInOutQuart(1)).toBe(1);
    expect(easeInOutQuart(0.5)).toBe(0.5);
  });
});

describe('刻度层透明度随密度渐变', () => {
  it('近景秒刻度全显、远景刻度全隐', () => {
    expect(secondTickAlpha(BAND_SCALE_NEAR)).toBe(1);
    expect(macroTickAlpha(BAND_SCALE_NEAR)).toBe(0);
    expect(secondTickAlpha(BAND_SCALE_FAR)).toBe(0);
    expect(macroTickAlpha(BAND_SCALE_FAR)).toBe(1);
  });

  it('变焦中段两层交叉可见（收缩过程不是换图）', () => {
    // 对数空间下，秒刻度/远景刻度的交叉淡化发生在前段
    const mid = interpolateZoomScale(BAND_SCALE_NEAR, BAND_SCALE_FAR, 0.28);
    const nearA = secondTickAlpha(mid);
    const farA = macroTickAlpha(mid);
    expect(nearA).toBeGreaterThan(0);
    expect(nearA).toBeLessThan(1);
    expect(farA).toBeGreaterThan(0);
    expect(farA).toBeLessThan(1);
  });
});
